import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { createAdapter as createWebAdapter } from './adapter.web';

jest.mock('@nozbe/watermelondb/adapters/lokijs');

describe('Database schema migrations', () => {
  it('has bumped the schema version to 4 for the sessions.sync_status undeclaration', () => {
    expect(databaseSchema.version).toBe(4);
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

  it('is a validated SchemaMigrations object', () => {
    expect(migrations.validated).toBe(true);
  });

  it('covers migrations up to the current schema version with no gap', () => {
    // This is the exact invariant WatermelonDB's own adapter setup enforces at boot
    // (validateAdapter, in @nozbe/watermelondb/adapters/common.js): if maxVersion is
    // behind schema.version, an existing install has no path to the new schema and
    // the adapter throws "Missing migration" instead of upgrading in place.
    expect(migrations.maxVersion).toBe(databaseSchema.version);
    expect(migrations.minVersion).toBe(1);
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

  it('walks a v1 install all the way to the current version in one upgrade', () => {
    // The real path for an install that predates both columns: WatermelonDB
    // applies every step between its version and the schema's, so a v1 install
    // must arrive at v3 with both columns, not just the first one it meets.
    const steps = stepsForMigration({
      migrations,
      fromVersion: 1,
      toVersion: databaseSchema.version,
    }) as { table: string; columns: { name: string }[] }[];

    expect(steps.map((step) => `${step.table}.${step.columns[0].name}`)).toEqual([
      'exercises.description',
      'session_sets.exercise_id',
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

  it('has an empty v3 to v4 migration that undeclares sessions.sync_status', () => {
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
