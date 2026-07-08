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
    // Disable autosave to prevent background timers/handles from blocking Jest exit
    autosave: false,
    autosaveInterval: false,
  } as any);

  return new Database({
    adapter,
    modelClasses: [Routine, Exercise, RoutineExercise, Session, SessionSet],
  });
}

/**
 * Clean up a test database after tests complete.
 * Closes the LokiJS adapter to release IndexedDB handles and prevent Jest hang.
 *
 * @param database The database instance to close
 */
export async function closeTestDatabase(database: Database): Promise<void> {
  try {
    // Access the underlying LokiJS driver and close its handles
    const adapter = (database as any).adapter as any;
    if (adapter && adapter._driver && adapter._driver.loki) {
      // Close the Loki instance - this releases IndexedDB handles
      adapter._driver.loki.close();
    }
  } catch (error) {
    // Ignore errors during cleanup
    console.debug('Error closing Loki adapter:', error);
  }
}
