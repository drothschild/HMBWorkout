import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { migrationsForAdapter } from './adapterMigrations';

export function createAdapter() {
  return new LokiJSAdapter({
    schema: databaseSchema,
    // Withheld while the schema deliberately outruns the migrations; see
    // ./adapterMigrations.ts and the tail comment in ./migrations.ts.
    migrations: migrationsForAdapter(databaseSchema.version, migrations),
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    onSetUpError: (error) => {
      console.error('Database setup error:', error);
    },
  });
}
