import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { databaseSchema } from './schema';
import { migrations } from './migrations';

export function createAdapter() {
  return new SQLiteAdapter({
    dbName: 'hmbworkout',
    schema: databaseSchema,
    migrations,
    jsi: true,
    onSetUpError: (error) => {
      console.error('Database setup error:', error);
    },
  });
}
