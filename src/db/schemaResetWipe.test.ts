/**
 * The v5 → (was v6, now v7) bump, once destructive and now not.
 *
 * #276 Phase 1 replaced the per-exercise aggregate with a per-set list by
 * bumping the schema to v6 with no migration written into it — back-fill was
 * impossible in the lossy direction, the count `3` cannot become the warmup
 * ramp 9.07 → 11.34 → 18.14 kg — so WatermelonDB's own fallback dropped and
 * recreated the database. That was a real, one-time wipe, and this file
 * originally demonstrated it by opening a genuinely pre-existing v5 database
 * at the then-current v6 schema and watching the data go.
 *
 * #276 Phase 6 changes the premise this file exercises, not just its
 * expected outcome: `./migrations.ts` now carries a `toVersion: 6` entry
 * (the real `createTable('routine_sets')`, backfilled after the fact) AND a
 * `toVersion: 7` entry (undeclaring the five aggregate columns), so migration
 * coverage is gapless from 1 to 7 — matching `databaseSchema.version`. Opening
 * the SAME pre-existing v5 database this file has always built, now under the
 * shipping v7 schema, therefore MIGRATES it in place (v5 → v6 → v7) instead of
 * wiping it. `migrationV6ToV7.test.ts` is the authoritative, exhaustive proof
 * of that upgrade path end to end, including a negative control that shows the
 * wipe still happens if the migrations gate withholds them (its third case).
 * This file stays narrower and closer to its original shape: same shared-Loki-
 * store fixture, now asserting the data survives rather than asserting it is
 * lost.
 *
 * The vehicle is LokiJS, which is what the whole node suite runs on. The
 * branch it exercises is the same one SQLite takes, line for line —
 * `_getMigrationSteps` / `_migrationSteps` resolves real steps rather than
 * `null`, so the adapter migrates instead of logging "Migrations not
 * available for this version range, resetting database instead" and resetting
 * (adapters/lokijs/worker/DatabaseDriver.js:354, adapters/sqlite/index.js:132).
 * A real SQLite open is still only observable in the simulator.
 *
 * Sharing one `LokiMemoryAdapter` between the two opens via WatermelonDB's own
 * `_testLokiAdapter` escape hatch is what makes the second open see a database
 * that already exists; without it every Loki open in node is a fresh "Empty
 * database, setting up" and there would be nothing to migrate.
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

describe('A pre-existing v5 database opened at the current (v7) schema', () => {
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

  it('#276 Phase 6: migrates in place and keeps the stored routine, instead of wiping it', async () => {
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
        // No setters for these on a bare, undecorated Model class — same as
        // before Phase 6 — but harmless: this test only ever asserted on row
        // counts and ids, never on these values.
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
      // The migration happens during the driver's async setup, not in the
      // constructor; the first query awaits it.
      const routinesAfter = await after.get('routines').query().fetch();

      // #276 Phase 6: migration coverage now reaches v7 (1-7, gapless), so
      // this no longer resets — the wipe warning must NOT appear.
      expect(warn.mock.calls.flat().join(' ')).not.toContain(
        'Migrations not available for this version range, resetting database instead'
      );
      // The routine and its entry survive the upgrade.
      expect(routinesAfter.map((r: any) => r._raw.id)).toEqual(['routine-push']);
      const routineExercisesAfter = await after.get('routine_exercises').query().fetch();
      expect(routineExercisesAfter).toHaveLength(1);
      expect((routineExercisesAfter[0] as any)._raw.exercise_id).toBe('bench-press-dumbbell');
      expect(driverOf(after)._databaseVersion).toBe(databaseSchema.version);

      // The new table is there and queryable — but empty. A v5 install never
      // had per-set data to carry forward (the whole reason Phase 1 wiped
      // instead of backfilling), and the v6 migration step is a bare
      // createTable, so there is nothing to migrate INTO it.
      expect(await after.get('routine_sets').query().fetch()).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  }, 20000);
});
