/**
 * The one proof #335 cannot ship without: a v8 database opens at v9 WITHOUT
 * wiping, and its exercises rows keep their data including the two new
 * nullable image columns reading null.
 *
 * Like v7→v8, v8→v9 is a NON-destructive, migrating bump: it adds two nullable
 * columns (`exercises.image_path` and `exercises.image_source`) with a real
 * `addColumns` step, so there is nothing to wipe and every existing `exercises`
 * row must survive. Getting the migration wrong here does not fail loudly — it
 * resets the database, silently, exactly as a withheld migration would. So this
 * file drives WatermelonDB's real Loki driver across the upgrade rather than
 * reading `stepsForMigration`, the way `migrationV6ToV7.test.ts` does.
 *
 * `_testLokiAdapter` (`lokiExtensions.js:50`) lets both opens share one
 * `LokiMemoryAdapter`, so the second open is an *upgrade* of the first database
 * rather than a fresh one. Data surviving the second open is the assertion; a
 * negative control (migrations withheld) asserts the reset path so a green
 * result cannot mean "the harness cannot see a wipe".
 *
 * Note: this file proves the upgrade does not wipe data and that the columns
 * are writable, NOT that the column is created — LokiJS ignores column
 * declarations so it cannot see a steps: [] migration; the step's presence is
 * pinned by 'adds exercises.image_path and image_source with a real addColumns
 * step from v8 to v9' in migrations.test.ts.
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
 * The v8 schema, reconstructed from the shipping one: v8 IS v9 minus the
 * `exercises.image_path` and `exercises.image_source` columns. Derived rather
 * than copied so it cannot drift — writing it out as a literal would make this
 * file a second declaration of the schema that goes stale the first time an
 * unrelated column lands.
 */
function historicalV8Schema(): AppSchema {
  return appSchema({
    version: 8,
    tables: Object.values(databaseSchema.tables).map((table) =>
      tableSchema({
        name: table.name,
        columns:
          table.name === 'exercises'
            ? table.columnArray.filter(
                (column) => column.name !== 'image_path' && column.name !== 'image_source'
              )
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
    dbName: 'phase9-upgrade-probe',
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
 * A v8 database with exercises and routines. Written straight to `_raw`
 * because the schema shape, not the model setters, is what the upgrade has to
 * carry. No image columns exist on v8, so none are written here — the upgrade
 * adds the nullable columns and these rows must survive reading back with both
 * image_path and image_source absent.
 */
async function seedExercisesAndRoutine(database: Database): Promise<void> {
  await database.write(async () => {
    await database.get('routines').create((record: any) => {
      record._raw.id = 'routine-image-test';
      record._raw.name = 'Image Test Routine';
      record._raw.created_at = 1;
      record._raw.updated_at = 1;
    });
    // Exercise with description
    await database.get('exercises').create((record: any) => {
      record._raw.id = 'barbell-bench-press';
      record._raw.title = 'Barbell Bench Press';
      record._raw.kind = 'strength';
      record._raw.description = 'Classic pressing movement';
      record._raw.muscle_group = 'chest';
      record._raw.equipment = 'barbell';
      record._raw.created_at = 1;
    });
    // Exercise without optional fields
    await database.get('exercises').create((record: any) => {
      record._raw.id = 'running';
      record._raw.title = 'Running';
      record._raw.kind = 'cardio';
      record._raw.created_at = 1;
    });
    await database.get('routine_exercises').create((record: any) => {
      record._raw.id = 'row-1';
      record._raw.routine_id = 'routine-image-test';
      record._raw.exercise_id = 'barbell-bench-press';
      record._raw.order = 0;
      record._raw.rest_seconds = 120;
    });
    // Create a routine_sets row to ensure the entire data structure survives
    await database.get('routine_sets').create((record: any) => {
      record._raw.id = 'set-1';
      record._raw.routine_exercise_id = 'row-1';
      record._raw.order = 0;
      record._raw.set_type = 'normal';
      record._raw.target_weight_kg = 100;
    });
  });
}

describe('opening a v8 database under the v9 schema', () => {
  it('upgrades a POPULATED v8 database in place, without wiping it, and keeps every exercise', async () => {
    const lokiAdapter = new LokiMemoryAdapter();

    const v8 = open({ schema: historicalV8Schema(), lokiAdapter });
    await seedExercisesAndRoutine(v8);
    await persistAndClose(v8);

    const v9 = open({ schema: databaseSchema, lokiAdapter, withMigrations: true });

    // The exercises are the things worth keeping.
    const exercises = await v9.get('exercises').query().fetch();
    expect(exercises.map((ex: any) => ex._raw.title)).toEqual(['Barbell Bench Press', 'Running']);

    // The routine and sets survive too.
    const routines = await v9.get('routines').query().fetch();
    expect(routines.map((routine: any) => routine._raw.name)).toEqual(['Image Test Routine']);

    const sets = await v9.get('routine_sets').query().fetch();
    expect(sets.map((set: any) => set._raw.target_weight_kg)).toEqual([100]);

    // The new columns exist and read back null on rows written before they existed —
    // the nullable, non-backfilled contract every prior addColumns bump has.
    expect(exercises.every((ex: any) => ex._raw.image_path == null)).toBe(true);
    expect(exercises.every((ex: any) => ex._raw.image_source == null)).toBe(true);

    // Description from the exercise with it survives intact.
    const descEx = exercises.find((ex: any) => ex._raw.id === 'barbell-bench-press');
    expect((descEx as any)._raw.description).toBe('Classic pressing movement');

    await persistAndClose(v9);
  });

  it('writes and reads image_path and image_source through the migrated columns', async () => {
    // The columns are not merely present but writable: exercises with image data
    // survive the round-trip, which is the whole point of the bump.
    const lokiAdapter = new LokiMemoryAdapter();

    const v8 = open({ schema: historicalV8Schema(), lokiAdapter });
    await seedExercisesAndRoutine(v8);
    await persistAndClose(v8);

    const v9 = open({ schema: databaseSchema, lokiAdapter, withMigrations: true });
    await v9.write(async () => {
      await v9.get('exercises').create((record: any) => {
        record._raw.id = 'pull-up';
        record._raw.title = 'Pull Up';
        record._raw.kind = 'strength';
        record._raw.image_path = 'pull-up.jpg';
        record._raw.image_source = 'catalog:PullUp';
        record._raw.created_at = 2;
      });
    });

    const withImage = await v9.get('exercises').find('pull-up');
    expect((withImage as any)._raw.image_path).toBe('pull-up.jpg');
    expect((withImage as any)._raw.image_source).toBe('catalog:PullUp');

    // Also assert that the model fields read correctly (not just _raw).
    expect((withImage as Exercise).imagePath).toBe('pull-up.jpg');
    expect((withImage as Exercise).imageSource).toBe('catalog:PullUp');

    await persistAndClose(v9);
  });

  it('DOES wipe that same v8 database when the migrations are withheld, which is the mistake', async () => {
    // The negative control: withholding the migrations keeps the gate returning
    // undefined, `_getMigrationSteps` short-circuits on `if (!migrations)
    // return null`, and the driver resets. Without this, a green result above
    // could mean the harness never reopened the same database.
    const lokiAdapter = new LokiMemoryAdapter();

    const v8 = open({ schema: historicalV8Schema(), lokiAdapter });
    await seedExercisesAndRoutine(v8);
    await persistAndClose(v8);

    const withheld = open({ schema: databaseSchema, lokiAdapter, withMigrations: false });

    await expect(withheld.get('exercises').query().fetch()).resolves.toEqual([]);
    await expect(withheld.get('routines').query().fetch()).resolves.toEqual([]);
    await expect(withheld.get('routine_sets').query().fetch()).resolves.toEqual([]);

    await persistAndClose(withheld);
  });
});
