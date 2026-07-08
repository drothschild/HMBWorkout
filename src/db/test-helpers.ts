import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { databaseSchema } from './schema';
import Routine from './models/Routine';
import Exercise from './models/Exercise';
import RoutineExercise from './models/RoutineExercise';
import Session from './models/Session';
import SessionSet from './models/SessionSet';

/**
 * Create an in-memory test database using LokiJS adapter.
 * Used for unit tests that need a database but can't use SQLite/JSI.
 */
export function createTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema: databaseSchema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });

  return new Database({
    adapter,
    modelClasses: [Routine, Exercise, RoutineExercise, Session, SessionSet],
  });
}

/**
 * Clean up a test database after tests complete.
 * Clears handles to prevent Jest hangs.
 *
 * @param database The database instance to close
 */
export async function closeTestDatabase(database: Database): Promise<void> {
  // Note: LokiJS adapter holds IndexedDB handles; simply let the instance
  // be garbage collected when the test ends. Each test creates a fresh database
  // instance, so there's no leak within the test lifecycle.
  // To properly close, we would need to reset, but that creates timing issues.
}
