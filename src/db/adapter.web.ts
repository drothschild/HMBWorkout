import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import { migrations } from './migrations';

export function createAdapter() {
  return new LokiJSAdapter({
    schema: databaseSchema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    onSetUpError: (error) => {
      console.error('Database setup error:', error);
    },
  });
}
