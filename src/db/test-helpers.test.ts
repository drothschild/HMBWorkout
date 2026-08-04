import * as fs from 'fs';
import { Database } from '@nozbe/watermelondb';
import { flush, createTestDatabase, closeTestDatabase } from './test-helpers';

/**
 * One trial: create a fresh queue-depth-2 scenario (two un-awaited
 * database.write calls back to back, mirroring the fire-and-forget shape
 * un-awaited effect executors like onCompleteSession produce) and report
 * whether the second write had landed by the time a bare setImmediate
 * fires, and again after flush().
 *
 * Anchored in a (nested) fs.readFile callback so the starting event-loop
 * phase is the documented, deterministic one: per Node's docs, a
 * setImmediate scheduled from inside an I/O (poll-phase) callback always
 * runs before a same-tick setTimeout(0). Nested twice because
 * createTestDatabase's LokiJS adapter does its own async init (visible as
 * "[Loki] Initializing..." log lines) with timers/immediates of its own,
 * which would otherwise compete with the first anchor.
 *
 * Even with this anchoring, a single trial is not perfectly deterministic
 * in the real jest + WatermelonDB environment -- manual verification during
 * development saw a bare setImmediate occasionally still catch the queued
 * write (this is why the test below repeats the trial rather than asserting
 * on one run: a single-shot version of this exact test failed to catch a
 * deliberately broken flush() in roughly 1 of 5 fresh-process runs, too
 * unreliable to pin a contract). Treat this as evidence the phase-ordering
 * guarantee, while real and strongly directional, is not airtight in a
 * jest process with its own background timers -- not as evidence the
 * anchoring approach is wrong.
 *
 * Each trial's queue-depth-2 write pair is exactly the shape that makes
 * WatermelonDB's WorkQueue schedule its own uncleared 1500ms dev-mode
 * queue-warning timer (WorkQueue.js, gated on NODE_ENV !== 'production').
 * That's a pre-existing, separately-tracked leak (see the board), not
 * something this test can avoid while genuinely exercising a contended
 * enqueue -- if you're chasing an open-handle warning from this file, it's
 * that timer, not a bug in this test's own cleanup.
 */
function trial(database: Database): Promise<{ bareCaughtIt: boolean; flushCaughtIt: boolean }> {
  return new Promise((resolve) => {
    fs.readFile(__filename, () => {
      fs.readFile(__filename, () => {
        let firstDone = false;
        let secondDone = false;

        database.write(async () => {
          firstDone = true;
        });
        database.write(async () => {
          secondDone = true;
        });

        setImmediate(() => {
          if (!firstDone) {
            throw new Error('trial invariant violated: first write did not land before check phase');
          }
          const bareCaughtIt = secondDone;

          flush().then(() => {
            resolve({ bareCaughtIt, flushCaughtIt: secondDone });
          });
        });
      });
    });
  });
}

describe('flush', () => {
  let database: Database;

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  test('reliably drains a write a bare setImmediate reliably misses', async () => {
    database = createTestDatabase();

    const TRIALS = 10;
    const results = [];
    for (let i = 0; i < TRIALS; i++) {
      results.push(await trial(database));
    }

    const bareMissCount = results.filter((r) => !r.bareCaughtIt).length;
    const flushCatchCount = results.filter((r) => r.flushCaughtIt).length;

    // Not asserting 100% on the bare-setImmediate side -- see the docstring
    // above the `trial` helper: this is real but not airtight in this
    // environment. Asserting a strong majority is what's actually true and
    // actually distinguishes flush() from a bare setImmediate; a weaker bar
    // here would stop being a meaningful regression guard.
    expect(bareMissCount).toBeGreaterThanOrEqual(TRIALS - 1);
    // flush() must catch it every time -- this is the property that
    // actually matters for callers, and manual verification saw exactly
    // this: 100% for flush() even in the same runs where a bare
    // setImmediate occasionally succeeded.
    expect(flushCatchCount).toBe(TRIALS);
  });
});
