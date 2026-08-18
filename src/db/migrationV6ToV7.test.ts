/**
 * The one proof #276 Phase 6 cannot ship without: a v6 database opens at v7
 * WITHOUT wiping.
 *
 * Every other assertion in this phase is about declarations — that
 * `migrations.maxVersion` is 7, that the v6 entry carries a `createTable`,
 * that the gate hands the adapter its migrations again. None of them opens a
 * database. Phase 1 wiped the user once, deliberately; the failure mode this
 * phase is one wrong line away from is wiping them a *second* time, and the
 * only way to know it does not is to build a populated v6 database and open it
 * under the shipping v7 schema.
 *
 * So this file drives WatermelonDB's real Loki driver end to end rather than
 * reading `stepsForMigration`. `_testLokiAdapter` (`lokiExtensions.js:50`) lets
 * both opens share one `LokiMemoryAdapter`, which is what makes the second open
 * an *upgrade* of the first database rather than a fresh one — the driver reads
 * the stored version out of the `local_storage` collection it persisted, takes
 * the `0 < dbVersion < schemaVersion` branch, and either migrates or logs
 * "Migrations not available for this version range, resetting database
 * instead" and calls `unsafeResetDatabase`. Data surviving the second open is
 * the assertion; the reset path is asserted too, from a v5 database, so a green
 * result here cannot mean "the harness cannot see a wipe".
 *
 * SQLite is not exercised — the node project has no JSI. AGENTS.md's testing
 * boundary applies: this proves the driver contract both adapters share
 * (`_getMigrationSteps` → `stepsForMigration` → null-means-reset), not the
 * native file upgrade, which stays a simulator check.
 */

import { Database, appSchema, tableSchema } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { AppSchema, ColumnSchema } from '@nozbe/watermelondb';
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
 * The five columns v7 undeclares. Spelling them here rather than importing them
 * is the point: after Phase 6 they exist nowhere in `src/`, and a historical
 * database is the only place they are still real.
 */
const V6_AGGREGATE_COLUMNS: ColumnSchema[] = [
  { name: 'warmup_sets', type: 'number' },
  { name: 'target_sets', type: 'number', isOptional: true },
  { name: 'target_reps', type: 'number', isOptional: true },
  { name: 'target_duration_seconds', type: 'number', isOptional: true },
  { name: 'target_weight_kg', type: 'number', isOptional: true },
];

/**
 * A historical schema, reconstructed from the shipping one.
 *
 * Derived rather than copied so it cannot drift: v6 IS v7 plus the five
 * aggregate columns, and v5 is v6 minus `routine_sets`. Writing either out as a
 * literal would make this file a second declaration of the schema that goes
 * stale the first time an unrelated column lands.
 */
function historicalSchema(version: 5 | 6): AppSchema {
  return appSchema({
    version,
    tables: Object.values(databaseSchema.tables)
      .filter((table) => !(version === 5 && table.name === 'routine_sets'))
      .map((table) =>
        tableSchema({
          name: table.name,
          columns:
            table.name === 'routine_exercises'
              ? [...table.columnArray, ...V6_AGGREGATE_COLUMNS]
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
    dbName: 'phase6-upgrade-probe',
    schema,
    // The production wiring, gate included, so this exercises what
    // `adapter.ts`/`adapter.web.ts` actually pass rather than a hand-picked
    // value. At v6 the gate withheld the migrations; at v7 it must hand them
    // over, and if it does not, the second open resets.
    migrations: withMigrations ? migrationsForAdapter(schema.version, migrations) : undefined,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    _testLokiAdapter: lokiAdapter,
    extraLokiOptions: { autosave: false },
  } as never);

  // Only the models the schema declares: WatermelonDB's CollectionMap asserts
  // every model class has a table, so a v5 open cannot register RoutineSet.
  const modelClasses = [Routine, Exercise, RoutineExercise, RoutineSet, Session, SessionSet].filter(
    (model) => schema.tables[(model as any).table] !== undefined
  );

  return new Database({ adapter, modelClasses });
}

/**
 * Persist and release, so the next open reads a stored database rather than
 * this one's live memory.
 *
 * `loki.close()` alone is not enough: with `autosave: false` LokiJS's `close`
 * skips `saveDatabase` entirely, so the memory adapter's `hashStore` would
 * never receive the write and the second open would look like a fresh install
 * — a false GREEN of exactly the shape this file exists to rule out.
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
 * A routine with a real per-set prescription, written straight to `_raw`.
 *
 * `_raw` throughout rather than the model setters, because the aggregate
 * columns have no setters after this phase and `createdAt`/`updatedAt` are
 * `@readonly`. The columns are what the upgrade has to preserve anyway.
 */
async function seedRoutine(database: Database, options: { withSets: boolean }): Promise<void> {
  await database.write(async () => {
    await database.get('routines').create((record: any) => {
      record._raw.id = 'routine-keepsake';
      record._raw.name = 'RAMP';
      record._raw.created_at = 1;
      record._raw.updated_at = 1;
    });
    await database.get('exercises').create((record: any) => {
      record._raw.id = 'back-squat';
      record._raw.title = 'Back Squat';
      record._raw.kind = 'strength';
      record._raw.created_at = 1;
    });
    await database.get('routine_exercises').create((record: any) => {
      record._raw.id = 'row-1';
      record._raw.routine_id = 'routine-keepsake';
      record._raw.exercise_id = 'back-squat';
      record._raw.order = 0;
      record._raw.warmup_sets = 3;
      record._raw.target_sets = 4;
      record._raw.target_reps = 5;
      record._raw.rest_seconds = 180;
    });
    if (!options.withSets) return;
    for (const [order, kg] of [9.07, 11.34, 18.14].entries()) {
      await database.get('routine_sets').create((record: any) => {
        record._raw.id = `set-${order}`;
        record._raw.routine_exercise_id = 'row-1';
        record._raw.order = order;
        record._raw.set_type = 'warmup';
        record._raw.target_weight_kg = kg;
      });
    }
  });
}

describe('opening a historical database under the v7 schema', () => {
  it('upgrades a POPULATED v6 database in place, without wiping it', async () => {
    // AC6.1's non-negotiable proof, and the reason both a toVersion: 6 and a
    // toVersion: 7 entry are mandatory. A v6 install is every install that
    // exists in practice — Phase 1 put them all there — so this is the upgrade
    // path the release actually takes.
    const lokiAdapter = new LokiMemoryAdapter();

    const v6 = open({ schema: historicalSchema(6), lokiAdapter });
    await seedRoutine(v6, { withSets: true });
    await persistAndClose(v6);

    const v7 = open({ schema: databaseSchema, lokiAdapter, withMigrations: true });

    const routines = await v7.get('routines').query().fetch();
    expect(routines.map((routine: any) => routine._raw.name)).toEqual(['RAMP']);

    // The per-set prescription is the thing worth keeping — a wipe would take
    // the ramp with it, and the ramp is what cannot be reconstructed.
    const sets = await v7.get('routine_sets').query().fetch();
    expect(sets.map((set: any) => set._raw.target_weight_kg).sort((a: number, b: number) => a - b))
      .toEqual([9.07, 11.34, 18.14]);

    await persistAndClose(v7);
  });

  it('walks a v5 database up through the routine_sets createTable, also without wiping', async () => {
    // The v6 entry is not gap-filler alone: an install that never saw v6 must
    // arrive at v7 with the table its schema declares, or the first
    // `routine_sets` query throws. `steps: []` on that entry passes every
    // declaration-level assertion in migrations.test.ts and fails here.
    const lokiAdapter = new LokiMemoryAdapter();

    const v5 = open({ schema: historicalSchema(5), lokiAdapter });
    await seedRoutine(v5, { withSets: false });
    await persistAndClose(v5);

    const v7 = open({ schema: databaseSchema, lokiAdapter, withMigrations: true });

    const routines = await v7.get('routines').query().fetch();
    expect(routines.map((routine: any) => routine._raw.name)).toEqual(['RAMP']);

    // The table has to be queryable, not merely declared. This is the
    // assertion `steps: []` on the v6 entry fails.
    await expect(v7.get('routine_sets').query().fetch()).resolves.toEqual([]);

    await persistAndClose(v7);
  });

  it('DOES wipe that same v6 database when the migrations are withheld, which is the mistake', async () => {
    // The negative control, and it is the AC's second wrong reading executed
    // rather than quoted: "leave the migrations withheld at v7" keeps the gate
    // returning undefined, `_getMigrationSteps` short-circuits on `if
    // (!migrations) return null`, and the driver resets — destroying whatever
    // the user rebuilt after Phase 1.
    //
    // Without this, a green result above could equally mean the harness never
    // reopened the same database. It proves the probe can see a wipe.
    const lokiAdapter = new LokiMemoryAdapter();

    const v6 = open({ schema: historicalSchema(6), lokiAdapter });
    await seedRoutine(v6, { withSets: true });
    await persistAndClose(v6);

    const withheld = open({ schema: databaseSchema, lokiAdapter, withMigrations: false });

    await expect(withheld.get('routines').query().fetch()).resolves.toEqual([]);
    await expect(withheld.get('routine_sets').query().fetch()).resolves.toEqual([]);

    await persistAndClose(withheld);
  });
});
