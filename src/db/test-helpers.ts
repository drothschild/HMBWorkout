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
 *
 * WatermelonDB's WorkQueue continues a queued write via a real `setTimeout(fn, 0)`,
 * not a microtask, scheduled from the promise continuation after the preceding item
 * resolves. BOTH of this function's two stages are load-bearing when called the way
 * every real call site does (synchronously, right after the writes) -- a bare
 * `setImmediate` alone or a bare `setTimeout(fn, 0)` alone each reliably miss a write
 * queued behind another. Measured directly in the unanchored call shape every real
 * site uses: real flush() catches the queued write in the high-90s% of individual
 * calls (~90% per run), while bare setImmediate or setTimeout(0) alone catch it 0%.
 *
 * See test-helpers.test.ts for the actual measurement (it runs repeated trials in the
 * same unanchored call shape every real site uses) and the guard test there for why
 * a single flush() call is ~90% reliable per invocation but the test itself is
 * reliable: the test retries the 10-trial measurement up to 3 times and passes as
 * soon as any attempt reaches 10/10 caught, giving the guard ~99.9% reliability
 * (1 − 0.1³). A genuinely broken one-stage implementation stays 0% across all 3
 * retries and still fails the test. See AGENTS.md's Testing gotchas for the fuller
 * explanation.
 *
 * This is NOT an unconditional guarantee for queue depth >= 3 (e.g. onCompleteSession
 * draining several pending set-persists then its own write): use a bounded retry /
 * poll-until-true there instead (see activeSession.test.ts:512,601, the two
 * bounded-retry loops).
 */
export function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(
    () => new Promise<void>((resolve) => setImmediate(resolve))
  );
}
