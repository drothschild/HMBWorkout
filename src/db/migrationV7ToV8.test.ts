/**
 * The one proof #281 cannot ship without: a v7 database opens at v8 WITHOUT
 * wiping, and its per-set rows keep their data.
 *
 * Unlike #276's v6 bump, v7→v8 is a NON-destructive, migrating bump: it adds
 * one nullable column (`routine_sets.rest_seconds`) with a real `addColumns`
 * step, so there is nothing to wipe and every existing `routine_sets` row must
 * survive. Getting the migration wrong here does not fail loudly — it resets
 * the database, silently, exactly as a withheld migration would. So this file
 * drives WatermelonDB's real Loki driver across the upgrade rather than reading
 * `stepsForMigration`, the way `migrationV6ToV7.test.ts` does.
 *
 * `_testLokiAdapter` (`lokiExtensions.js:50`) lets both opens share one
 * `LokiMemoryAdapter`, so the second open is an *upgrade* of the first database
 * rather than a fresh one. Data surviving the second open is the assertion; a
 * negative control (migrations withheld) asserts the reset path so a green
 * result cannot mean "the harness cannot see a wipe".
 *
 * SQLite is not exercised — the node project has no JSI (AGENTS.md's testing
 * boundary); the native file upgrade stays a simulator check.
 */

import { Database, appSchema, tableSchema } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { AppSchema } from '@nozbe/watermelondb';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { migrationsForAdapter } from './adapterMigrations';
import Routine from './models/Routine';
import Exercise from './models/Exercise';
import RoutineExercise from './models/RoutineExercise';
import RoutineSet from './models/RoutineSet';
import Session from './models/Session';
import SessionSet from './models/SessionSet';

const LokiMemoryAdapter = require('lokijs').LokiMemoryAdapter;

/**
 * The v7 schema, reconstructed from the shipping one: v7 IS v8 minus the
 * `routine_sets.rest_seconds` column. Derived rather than copied so it cannot
 * drift — writing it out as a literal would make this file a second declaration
 * of the schema that goes stale the first time an unrelated column lands.
 */
function historicalV7Schema(): AppSchema {
  return appSchema({
    version: 7,
    tables: Object.values(databaseSchema.tables).map((table) =>
      tableSchema({
        name: table.name,
        columns:
          table.name === 'routine_sets'
            ? table.columnArray.filter((column) => column.name !== 'rest_seconds')
            : [...table.columnArray],
      })
    ),
  });
}

interface OpenOptions {
  readonly schema: AppSchema;
  readonly lokiAdapter: unknown;
  /** Omitted for a historical open: those builds shipped their own migrations. */
  readonly withMigrations?: boolean;
}

function open({ schema, lokiAdapter, withMigrations }: OpenOptions): Database {
  const adapter = new LokiJSAdapter({
    dbName: 'phase8-upgrade-probe',
    schema,
    migrations: withMigrations ? migrationsForAdapter(schema.version, migrations) : undefined,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    _testLokiAdapter: lokiAdapter,
    extraLokiOptions: { autosave: false },
  } as never);

  return new Database({
    adapter,
    modelClasses: [Routine, Exercise, RoutineExercise, RoutineSet, Session, SessionSet],
  });
}

/**
 * Persist and release, so the next open reads a stored database rather than
 * this one's live memory. `loki.close()` alone is not enough under
 * `autosave: false` — see the matching note in `migrationV6ToV7.test.ts`.
 */
async function persistAndClose(database: Database): Promise<void> {
  const loki = (database.adapter as any).underlyingAdapter?._driver?.loki;
  if (!loki) {
    throw new Error('persistAndClose: could not reach the loki instance — adapter internals changed?');
  }
  await new Promise<void>((resolve, reject) =>
    loki.saveDatabase((error?: Error) => (error ? reject(error) : resolve()))
  );
  await new Promise<void>((resolve) => loki.close(() => resolve()));
}

/**
 * A routine with a real drop-set prescription: three descending loads whose
 * rest pattern (0 / 0 / full) is exactly what #281 adds and the thing the
 * upgrade must preserve. Written straight to `_raw` because the schema shape,
 * not the model setters, is what the upgrade has to carry.
 */
async function seedDropSet(database: Database): Promise<void> {
  await database.write(async () => {
    await database.get('routines').create((record: any) => {
      record._raw.id = 'routine-keepsake';
      record._raw.name = 'DROP';
      record._raw.created_at = 1;
      record._raw.updated_at = 1;
    });
    await database.get('exercises').create((record: any) => {
      record._raw.id = 'lat-pulldown';
      record._raw.title = 'Lat Pulldown';
      record._raw.kind = 'strength';
      record._raw.created_at = 1;
    });
    await database.get('routine_exercises').create((record: any) => {
      record._raw.id = 'row-1';
      record._raw.routine_id = 'routine-keepsake';
      record._raw.exercise_id = 'lat-pulldown';
      record._raw.order = 0;
      record._raw.rest_seconds = 120;
    });
    // A v7 routine_sets row has NO rest_seconds column, so it is not written
    // here — the upgrade adds the nullable column and these rows must survive
    // reading back with rest_seconds absent.
    for (const [order, kg] of [40, 30, 20].entries()) {
      await database.get('routine_sets').create((record: any) => {
        record._raw.id = `set-${order}`;
        record._raw.routine_exercise_id = 'row-1';
        record._raw.order = order;
        record._raw.set_type = 'normal';
        record._raw.target_weight_kg = kg;
      });
    }
  });
}

describe('opening a v7 database under the v8 schema', () => {
  it('upgrades a POPULATED v7 database in place, without wiping it, and keeps every routine_sets row', async () => {
    const lokiAdapter = new LokiMemoryAdapter();

    const v7 = open({ schema: historicalV7Schema(), lokiAdapter });
    await seedDropSet(v7);
    await persistAndClose(v7);

    const v8 = open({ schema: databaseSchema, lokiAdapter, withMigrations: true });

    const routines = await v8.get('routines').query().fetch();
    expect(routines.map((routine: any) => routine._raw.name)).toEqual(['DROP']);

    // The three descending loads are the thing worth keeping. A wipe takes them
    // with it, and the drop set is what cannot be reconstructed from a count.
    const sets = await v8.get('routine_sets').query().fetch();
    expect(
      sets.map((set: any) => set._raw.target_weight_kg).sort((a: number, b: number) => a - b)
    ).toEqual([20, 30, 40]);

    // The new column exists and reads back null on rows written before it —
    // the nullable, non-backfilled contract every prior addColumns bump has.
    expect(sets.every((set: any) => set._raw.rest_seconds == null)).toBe(true);

    await persistAndClose(v8);
  });

  it('writes and reads a per-set rest_seconds through the migrated column', async () => {
    // The column is not merely present but writable: a set carrying its own
    // rest survives the round-trip, which is the whole point of the bump.
    const lokiAdapter = new LokiMemoryAdapter();

    const v7 = open({ schema: historicalV7Schema(), lokiAdapter });
    await seedDropSet(v7);
    await persistAndClose(v7);

    const v8 = open({ schema: databaseSchema, lokiAdapter, withMigrations: true });
    await v8.write(async () => {
      await v8.get('routine_sets').create((record: any) => {
        record._raw.id = 'set-with-rest';
        record._raw.routine_exercise_id = 'row-1';
        record._raw.order = 3;
        record._raw.set_type = 'normal';
        record._raw.rest_seconds = 0;
      });
    });

    const withRest = await v8.get('routine_sets').find('set-with-rest');
    expect((withRest as any)._raw.rest_seconds).toBe(0);

    await persistAndClose(v8);
  });

  it('DOES wipe that same v7 database when the migrations are withheld, which is the mistake', async () => {
    // The negative control: withholding the migrations keeps the gate returning
    // undefined, `_getMigrationSteps` short-circuits on `if (!migrations)
    // return null`, and the driver resets. Without this, a green result above
    // could mean the harness never reopened the same database.
    const lokiAdapter = new LokiMemoryAdapter();

    const v7 = open({ schema: historicalV7Schema(), lokiAdapter });
    await seedDropSet(v7);
    await persistAndClose(v7);

    const withheld = open({ schema: databaseSchema, lokiAdapter, withMigrations: false });

    await expect(withheld.get('routines').query().fetch()).resolves.toEqual([]);
    await expect(withheld.get('routine_sets').query().fetch()).resolves.toEqual([]);

    await persistAndClose(withheld);
  });
});
