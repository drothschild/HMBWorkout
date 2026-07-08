import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { databaseSchema } from './schema';

export function createAdapter() {
  return new SQLiteAdapter({
    dbName: 'hmbworkout',
    schema: databaseSchema,
    jsi: true,
    onSetUpError: (error) => {
      console.error('Database setup error:', error);
    },
  });
}
