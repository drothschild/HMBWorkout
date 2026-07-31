import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { createAdapter as createWebAdapter } from './adapter.web';

jest.mock('@nozbe/watermelondb/adapters/lokijs');

describe('Database schema migrations', () => {
  it('has bumped the schema version to 2 for the exercises.description column', () => {
    expect(databaseSchema.version).toBe(2);
  });

  it('declares exercises.description as an optional string column in the current schema', () => {
    expect(databaseSchema.tables['exercises'].columns['description']).toEqual({
      name: 'description',
      type: 'string',
      isOptional: true,
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

  it('pins that the web adapter carries the exact migrations object exported by migrations.ts', () => {
    // Asserts by reference identity: if migrations is deleted or replaced with
    // a different object, this test fails, blocking silent wipes on upgrade.
    // Mocking LokiJSAdapter prevents creating a live IndexedDB handle that would
    // hang the test; instead we verify the migrations object was passed as a constructor argument.
    createWebAdapter();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() necessary after jest.mock() to get mocked adapter
    const LokiJSAdapter = jest.mocked(require('@nozbe/watermelondb/adapters/lokijs').default);
    expect(LokiJSAdapter.mock.calls[0][0].migrations).toBe(migrations);
  });

});
