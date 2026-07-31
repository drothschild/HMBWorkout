import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import { databaseSchema } from './schema';
import { migrations } from './migrations';

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

    const [step] = steps as Array<{ type: string; table: string; columns: unknown }>;
    expect(step.type).toBe('add_columns');
    expect(step.table).toBe('exercises');
    expect(step.columns).toEqual([{ name: 'description', type: 'string', isOptional: true }]);
  });
});
