import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { migrationsForAdapter } from './adapterMigrations';

export function createAdapter() {
  return new SQLiteAdapter({
    dbName: 'hmbworkout',
    schema: databaseSchema,
    // Withheld while the schema deliberately outruns the migrations, so a
    // Debug build takes the same reset path a Release build does instead of
    // throwing "Missing migration" out of this constructor. See
    // ./adapterMigrations.ts.
    migrations: migrationsForAdapter(databaseSchema.version, migrations),
    jsi: true,
    onSetUpError: (error) => {
      console.error('Database setup error:', error);
    },
  });
}
