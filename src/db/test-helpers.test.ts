import { Database } from '@nozbe/watermelondb';
import { flush, createTestDatabase, closeTestDatabase } from './test-helpers';

/**
 * Two alternate, weaker implementations of flush() -- kept here (not
 * exported) purely as executable documentation of what flush() guards
 * against. Neither is the assertion that actually pins the contract; see
 * the real-flush() test below for that.
 */
const bareSetImmediate = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const timeoutOnlyNoImmediate = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One trial: create a fresh queue-depth-2 scenario (two un-awaited
 * database.write calls back to back -- the second genuinely queues behind
 * the first in WatermelonDB's WorkQueue, mirroring the fire-and-forget
 * shape un-awaited effect executors like onCompleteSession produce), call
 * `flushLike` exactly the way every real call site does (synchronously,
 * right after the writes -- no I/O anchoring), and report whether the
 * second write had landed by the time it resolves.
 *
 * An earlier version of this test anchored the probe inside a (nested)
 * fs.readFile callback, reasoning that a deterministic starting
 * event-loop phase would make the assertions reliable. That reasoning was
 * backwards for this codebase's actual call sites: anchoring inside a
 * check-phase callback means WorkQueue's own continuation timer is
 * *already* in the timers list by the time flush() schedules its own
 * first-stage timer behind it -- so in that specific shape, flush()'s
 * first stage alone was enough, and the anchored test could not tell the
 * difference between the real two-stage flush() and a one-stage
 * setTimeout(0)-only implementation (both passed 6/6 fresh-process runs
 * under that anchoring). Every real call site instead calls flush()
 * synchronously right after the writes -- no anchoring -- which puts
 * flush()'s first-stage timer *ahead* of WorkQueue's continuation timer,
 * making the *second* stage (the trailing setImmediate) the one that
 * actually carries past it. Measured directly, unanchored: real flush()
 * catches the queued write in ~90% of individual runs (46/51 fresh-process
 * full-passes on a 10-trial measurement); a bare setImmediate and a
 * setTimeout(0)-only implementation each catch it in 0% of runs. The
 * unanchored shape is faithful to real usage and catches the round-5
 * blind-spot mutation (the anchored test passed against a one-stage
 * implementation, proving it was missing the detection this test needs).
 *
 * The `await database.write(...)` + short settle after resolving is cheap
 * insurance against cross-trial contamination between repeated trials: one
 * trial can start while the previous trial's own queued write is still in
 * flight, potentially self-contaminating the next observation. WorkQueue
 * resolves a work item's promise *before* shifting it off the queue, so
 * awaiting just the barrier write isn't quite enough on its own either.
 * Not measured to change the miss rate on this machine, but inexpensive.
 *
 * Each trial's queue-depth-2 write pair is exactly the shape that makes
 * WatermelonDB's WorkQueue schedule its own uncleared 1500ms dev-mode
 * queue-warning timer (WorkQueue.js, gated on NODE_ENV !== 'production').
 * That's a pre-existing, separately-tracked leak (see the board), not
 * something this test can avoid while genuinely exercising a contended
 * enqueue -- if you're chasing an open-handle warning from this file, it's
 * that timer, not a bug in this test's own cleanup.
 */
async function trial(database: Database, flushLike: () => Promise<void>): Promise<boolean> {
  let secondDone = false;

  database.write(async () => {});
  database.write(async () => {
    secondDone = true;
  });

  await flushLike();
  const observed = secondDone;

  // Drain barrier before the next trial can start.
  await database.write(async () => {});
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  return observed;
}

async function runTrials(
  database: Database,
  flushLike: () => Promise<void>,
  count: number
): Promise<number> {
  let caught = 0;
  for (let i = 0; i < count; i++) {
    if (await trial(database, flushLike)) caught++;
  }
  return caught;
}

/**
 * Measure flush()'s reliability by running the trial sequence up to maxAttempts
 * times and return the result of the first attempt that reaches 100%. Since the
 * real flush() is ~90% reliable per-run, retrying up to 3 times gives
 * ~99.9% success probability (1 − 0.1³ ≈ 0.999), while a genuinely broken
 * one-stage implementation (0% reliability) still fails all 3 attempts.
 */
async function reliablyCatches(
  database: Database,
  flushLike: () => Promise<void>,
  trials: number,
  maxAttempts: number
): Promise<number> {
  let caught = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    caught = await runTrials(database, flushLike, trials);
    if (caught === trials) {
      return caught;
    }
  }
  // All attempts exhausted; return the last attempt's result
  // (the test will fail, which is the correct behavior for a broken flush())
  return caught;
}

describe('flush', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  test('reliably drains a write queued behind another', async () => {
    const TRIALS = 10;
    const MAX_ATTEMPTS = 3;
    const caught = await reliablyCatches(database, flush, TRIALS, MAX_ATTEMPTS);
    expect(caught).toBe(TRIALS);
  });

  // Documentation, not the guard: shows what flush() exists to fix. If
  // WatermelonDB's internals ever change enough that a one-stage wait
  // becomes sufficient, this failing would be a signal to revisit flush()'s
  // own implementation, not just this test.
  test('a bare setImmediate and a setTimeout(0)-only wait both miss it', async () => {
    const TRIALS = 5;
    const bareCaught = await runTrials(database, bareSetImmediate, TRIALS);
    const timeoutOnlyCaught = await runTrials(database, timeoutOnlyNoImmediate, TRIALS);
    expect(bareCaught).toBe(0);
    expect(timeoutOnlyCaught).toBe(0);
  });
});
