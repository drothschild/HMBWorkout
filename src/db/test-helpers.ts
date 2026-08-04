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
    // WatermelonDB defaults loki to autosave:true/500ms, which leaves a live
    // timer that keeps Jest's process alive; only extraLokiOptions overrides it.
    extraLokiOptions: { autosave: false },
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
  // database.adapter is a DatabaseAdapterCompat wrapper; the LokiJSAdapter
  // (and its _driver.loki instance) lives on underlyingAdapter.
  const loki = (database.adapter as any).underlyingAdapter?._driver?.loki;
  if (!loki) {
    throw new Error('closeTestDatabase: could not reach loki instance — adapter internals changed?');
  }
  await new Promise<void>((resolve) => loki.close(() => resolve()));
}

/**
 * Let queued WatermelonDB writes and un-awaited fire-and-forget effect
 * executors (e.g. onCompleteSession) settle before asserting on DB state.
 * WatermelonDB's WorkQueue continues a queued write via a real
 * `setTimeout(fn, 0)`, not a microtask, scheduled from the promise
 * continuation after the preceding item resolves — so it isn't due until the
 * *next* event-loop iteration's timers phase. A bare `await setImmediate()`
 * only reaches the *current* iteration's check phase and resolves before
 * that timer ever fires, which is what makes it miss a write queued behind
 * another — deterministically given a clean starting phase, though not
 * airtight as a single observation inside a real jest process (see the
 * repeated-trial test in test-helpers.test.ts, which is the source of truth
 * for how reliable this actually is in practice, and AGENTS.md's Testing
 * gotchas for the full explanation). This waits through one more
 * timers-then-check cycle, draining a queue depth of two where a bare
 * `setImmediate` drains only one — NOT an unconditional guarantee for depth
 * >= 3 (e.g. onCompleteSession draining several pending set-persists then
 * its own write): use a bounded retry / poll-until-true there instead (see
 * activeSession.test.ts:512,601, the two bounded-retry loops).
 */
export function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(
    () => new Promise<void>((resolve) => setImmediate(resolve))
  );
}
