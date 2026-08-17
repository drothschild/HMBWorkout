/**
 * The destructive v5 → v6 bump, demonstrated rather than asserted.
 *
 * #276 replaces the per-exercise aggregate with a per-set list, and back-fill is
 * impossible in the lossy direction — the count `3` cannot become the warmup
 * ramp 9.07 → 11.34 → 18.14 kg. So the schema is bumped and no migration into
 * v6 is written; WatermelonDB's own fallback drops and recreates the database.
 * `migrations.test.ts` pins the `null` that triggers it. This file opens a
 * genuinely pre-existing v5 database at v6 and watches the data go.
 *
 * The vehicle is LokiJS, which is what the whole node suite runs on. The branch
 * it exercises is the same one SQLite takes, line for line: `_getMigrationSteps`
 * / `_migrationSteps` returns null, the adapter logs "Migrations not available
 * for this version range, resetting database instead", and sets up from schema
 * (adapters/lokijs/worker/DatabaseDriver.js:354, adapters/sqlite/index.js:132).
 * A real SQLite open is still only observable in the simulator.
 *
 * Sharing one `LokiMemoryAdapter` between the two opens via WatermelonDB's own
 * `_testLokiAdapter` escape hatch is what makes the second open see a database
 * that already exists; without it every Loki open in node is a fresh "Empty
 * database, setting up" and there is nothing to reset.
 */

import { appSchema, Database, Model } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { migrationsForAdapter } from './adapterMigrations';

class Routine extends Model {
  static table = 'routines';
}
class RoutineExercise extends Model {
  static table = 'routine_exercises';
}
/** Only exists at v6, so the "the new table is usable" assertion can run. */
class RoutineSet extends Model {
  static table = 'routine_sets';
}

/**
 * The schema as it stood at v5: today's tables minus `routine_sets`, taken from
 * the real declaration rather than copied, so it cannot drift.
 */
const v5Schema = appSchema({
  version: 5,
  tables: Object.values(databaseSchema.tables).filter(
    (table) => table.name !== 'routine_sets'
  ) as any,
});

/**
 * LokiJS's persistence-adapter contract, in ten lines, so this file needs no
 * dependency on lokijs itself (which ships no types). One instance is shared
 * between the two opens, which is what makes the second one find a database
 * that already exists. Calling `loadDatabase` back with a falsy value is how
 * Loki's own memory adapter reports "nothing stored yet" (lokijs.js:1995); an
 * Error there is a load *failure* and leaves the driver unusable.
 */
class SharedMemoryStore {
  private serialized: Record<string, string> = {};

  loadDatabase(name: string, callback: (value: string | null) => void): void {
    callback(this.serialized[name] ?? null);
  }

  saveDatabase(name: string, data: string, callback: (error?: Error | null) => void): void {
    this.serialized[name] = data;
    callback(null);
  }

  deleteDatabase(name: string, callback: (response?: { success: boolean }) => void): void {
    delete this.serialized[name];
    // With NO argument. WatermelonDB's deleteDatabase treats anything other
    // than `undefined` or `{ success: true }` as a failure and rejects with it
    // (lokiExtensions.js:126), so `callback(null)` fails the reset.
    callback();
  }
}

describe('A pre-existing v5 database opened at v6', () => {
  const sharedStore = new SharedMemoryStore();
  const DB_NAME = 'per-set-wipe-demo';

  function open(schema: typeof databaseSchema): Database {
    const adapter = new LokiJSAdapter({
      dbName: DB_NAME,
      schema,
      // Exactly what src/db/adapter.ts and adapter.web.ts now pass.
      ...(migrationsForAdapter(schema.version, migrations)
        ? { migrations: migrationsForAdapter(schema.version, migrations) }
        : {}),
      useWebWorker: false,
      useIncrementalIndexedDB: false,
      _testLokiAdapter: sharedStore,
      extraLokiOptions: { autosave: false },
    } as any);

    // RoutineSet only at v6: WatermelonDB rejects a model whose table the
    // schema does not declare, which is itself a small proof that the table is
    // new in this version.
    const modelClasses = schema.tables['routine_sets']
      ? [Routine, RoutineExercise, RoutineSet]
      : [Routine, RoutineExercise];

    return new Database({ adapter, modelClasses });
  }

  const driverOf = (database: Database) => (database.adapter as any).underlyingAdapter._driver;

  it('logs the reset warning and comes up empty, losing the stored routines', async () => {
    const before = open(v5Schema);

    await before.write(async () => {
      const routine = await before.get('routines').create((r: any) => {
        r._raw.id = 'routine-push';
        r.name = 'Push Day';
      });
      await before.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = (routine as any).id;
        re._raw.exercise_id = 'bench-press-dumbbell';
        re._raw.order = 0;
        re.warmupSets = 3;
        re.targetSets = 4;
      });
    });

    expect(await before.get('routines').query().fetch()).toHaveLength(1);
    expect(await before.get('routine_exercises').query().fetch()).toHaveLength(1);
    expect(driverOf(before)._databaseVersion).toBe(5);

    // Flush loki's in-memory image into the shared store so the next open sees
    // a database that genuinely already exists at v5.
    await new Promise<void>((resolve) =>
      driverOf(before).loki.saveDatabase(() => resolve())
    );

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const after = open(databaseSchema);
      // The reset happens during the driver's async setup, not in the
      // constructor; the first query awaits it.
      const routinesAfter = await after.get('routines').query().fetch();

      expect(warn.mock.calls.flat().join(' ')).toContain(
        'Migrations not available for this version range, resetting database instead'
      );
      expect(routinesAfter).toEqual([]);
      expect(await after.get('routine_exercises').query().fetch()).toEqual([]);
      expect(driverOf(after)._databaseVersion).toBe(databaseSchema.version);

      // And the new table is there to be written to.
      expect(await after.get('routine_sets').query().fetch()).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  }, 20000);
});
