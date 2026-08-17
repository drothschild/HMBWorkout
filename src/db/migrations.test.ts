import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { createAdapter as createWebAdapter } from './adapter.web';

jest.mock('@nozbe/watermelondb/adapters/lokijs');

describe('Database schema migrations', () => {
  it('has bumped the schema version to 6 for the routine_sets table', () => {
    expect(databaseSchema.version).toBe(6);
  });

  it('declares the routine_sets table with a per-set prescription on every column', () => {
    // AC1.1. A routine entry owns an ordered list of prescribed sets; each row
    // carries its own type, reps (or rep range), weight, duration and distance.
    // target_distance_m has no aggregate ancestor — it exists because Hevy
    // sends distance_meters and the column is free once a set table exists.
    expect(databaseSchema.tables['routine_sets'].columns).toEqual({
      routine_exercise_id: { name: 'routine_exercise_id', type: 'string', isIndexed: true },
      order: { name: 'order', type: 'number' },
      set_type: { name: 'set_type', type: 'string' },
      target_reps: { name: 'target_reps', type: 'number', isOptional: true },
      target_reps_max: { name: 'target_reps_max', type: 'number', isOptional: true },
      target_weight_kg: { name: 'target_weight_kg', type: 'number', isOptional: true },
      target_duration_seconds: {
        name: 'target_duration_seconds',
        type: 'number',
        isOptional: true,
      },
      target_distance_m: { name: 'target_distance_m', type: 'number', isOptional: true },
    });
  });

  it('leaves routine_exercises untouched at v6, because this phase is additive', () => {
    // Phases 1–5 are expand, not contract: every existing reader still reads
    // the aggregate columns and upsertRoutine still writes them, derived from
    // the set list. They are undeclared in Phase 6, not here.
    for (const column of [
      'warmup_sets',
      'target_sets',
      'target_reps',
      'target_duration_seconds',
      'target_weight_kg',
    ]) {
      expect(databaseSchema.tables['routine_exercises'].columns[column]).toBeDefined();
    }
  });

  it('declares exercises.description as an optional string column in the current schema', () => {
    expect(databaseSchema.tables['exercises'].columns['description']).toEqual({
      name: 'description',
      type: 'string',
      isOptional: true,
    });
  });

  it('declares session_sets.exercise_id as an optional indexed string column', () => {
    // Optional because every row written before v3 has no recorded identity —
    // those fall back to the routine_exercises join. Indexed because
    // getExerciseWorkingSetHistory now queries it directly.
    expect(databaseSchema.tables['session_sets'].columns['exercise_id']).toEqual({
      name: 'exercise_id',
      type: 'string',
      isOptional: true,
      isIndexed: true,
    });
  });

  it('declares routine_exercises.target_weight_kg as an optional number column', () => {
    // Optional and nullable: a coach-prescribed load for an entry. An absent
    // prescription (null) leaves the SetLogger's history-derived prefill
    // unchanged.
    expect(databaseSchema.tables['routine_exercises'].columns['target_weight_kg']).toEqual({
      name: 'target_weight_kg',
      type: 'number',
      isOptional: true,
    });
  });

  it('is a validated SchemaMigrations object', () => {
    expect(migrations.validated).toBe(true);
  });

  it('deliberately stops one version short of the schema, which is what wipes the database', () => {
    // AC1.7. THE OMISSION IS THE MECHANISM — do not "fix" this by adding a
    // toVersion: 6 entry.
    //
    // #276 replaces the per-exercise aggregate with a per-set list, and a
    // back-fill is impossible in the lossy direction: the count `3` cannot be
    // turned back into the warmup ramp 9.07 → 11.34 → 18.14 kg. Every routine
    // reconstructed from aggregates would be a flat ramp that lies about the
    // plan. Losing the stored routines is accepted (the user said so on #276);
    // a half-migrated database carrying aggregate routines with no routine_sets
    // rows is worse, because nothing downstream would ever notice.
    //
    // So the schema is bumped and the migration is withheld. WatermelonDB's own
    // fallback then drops and recreates: stepsForMigration returns null past
    // maxVersion, and both adapters log "Migrations not available for this
    // version range, resetting database instead" and set up from schema.
    //
    // Adding a toVersion: 6 entry makes this test go red rather than silently
    // preserving that half-migrated database.
    expect(migrations.maxVersion).toBe(5);
    expect(migrations.maxVersion).toBeLessThan(databaseSchema.version);
    expect(migrations.minVersion).toBe(1);
  });

  it('returns null for every upgrade path into v6, from every version an install can hold', () => {
    // AC1.7, stated over the whole domain rather than one walk: null is the
    // signal both adapters branch on to reset. A migration entry added for any
    // single starting version would show up here.
    for (let fromVersion = 1; fromVersion <= 5; fromVersion += 1) {
      expect(
        stepsForMigration({ migrations, fromVersion, toVersion: databaseSchema.version })
      ).toBeNull();
    }
  });

  it('provides a migration step from version 1 to 2 that adds exercises.description', () => {
    const steps = stepsForMigration({ migrations, fromVersion: 1, toVersion: 2 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('exercises');
    expect(step.columns).toEqual([{ name: 'description', type: 'string', isOptional: true }]);
  });

  it('still walks a v1 install to v5, the last version the migrations cover', () => {
    // The migration chain itself is intact and unchanged by the v6 bump — it is
    // only the step INTO v6 that is withheld. Asserting the walk against the
    // literal 5 rather than databaseSchema.version keeps this test about the
    // chain; the destructive step into the current version is asserted above.
    const steps = stepsForMigration({
      migrations,
      fromVersion: 1,
      toVersion: 5,
    }) as { table: string; columns: { name: string }[] }[];

    expect(steps.map((step) => `${step.table}.${step.columns[0].name}`)).toEqual([
      'exercises.description',
      'session_sets.exercise_id',
      'routine_exercises.target_weight_kg',
    ]);
  });

  it('provides a migration step from version 2 to 3 that adds session_sets.exercise_id', () => {
    const steps = stepsForMigration({ migrations, fromVersion: 2, toVersion: 3 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('session_sets');
    expect(step.columns).toEqual([
      { name: 'exercise_id', type: 'string', isOptional: true, isIndexed: true },
    ]);
  });

  it('has an empty v3 to v4 migration that adds no steps, because sync_status is undeclared rather than dropped', () => {
    // AC3.2: The v3→v4 migration returns an empty steps array. This is
    // deliberate: WatermelonDB 0.28 ships no column-removal step, and official
    // guidance is to leave the physical column in place and omit it from the
    // schema. The entry exists to keep the version sequence gapless.
    const steps = stepsForMigration({ migrations, fromVersion: 3, toVersion: 4 });
    expect(steps).toEqual([]);

    // AC3.6: The v3→v4 upgrade path does not throw. Note this test runs on
    // LokiJS via createTestDatabase(), so a real SQLite v3→v4 open is only
    // verified by the simulator pass in Task 7 (Phase 3).
  });

  it('provides a real migration step from v4 to v5 that adds routine_exercises.target_weight_kg', () => {
    // AC1.2: The v4→v5 migration uses a real addColumns step, unlike v4's
    // deliberately empty one. Copying v4's empty-steps shape here would leave
    // every upgrading install with a schema declaring a column its database
    // does not have.
    const steps = stepsForMigration({ migrations, fromVersion: 4, toVersion: 5 });

    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);

    const [step] = steps as { type: string; table: string; columns: unknown }[];
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('routine_exercises');
    expect(step.columns).toEqual([
      { name: 'target_weight_kg', type: 'number', isOptional: true },
    ]);
  });

  it('declares no sync_status column on the sessions table in the current schema', () => {
    // AC3.1: The undeclared sync_status must not appear in the schema.
    expect(databaseSchema.tables['sessions'].columns['sync_status']).toBeUndefined();
  });

  it('pins that the web adapter carries the exact migrations object exported by migrations.ts', () => {
    // Asserts by reference identity: if migrations is deleted or replaced with
    // a different object, this test fails, blocking silent wipes on upgrade.
    // Mocking LokiJSAdapter prevents creating a live IndexedDB handle that would
    // hang the test; instead we verify the migrations object was passed as a constructor argument.
    createWebAdapter();
    expect(jest.mocked(LokiJSAdapter).mock.calls[0][0].migrations).toBe(migrations);
  });

});
