#!/usr/bin/env node
/**
 * Mechanism proof for GitHub issue #129 — "A worker process has failed to exit
 * gracefully" in the jest suite.
 *
 * THE LEAD
 * --------
 * WatermelonDB's WorkQueue.enqueue registers a dev-mode "your queue is contended"
 * warning timer on every *contended* enqueue (i.e. whenever `_queue.length` is
 * already non-zero), gated on NODE_ENV !== 'production':
 *
 *   node_modules/@nozbe/watermelondb/Database/WorkQueue.js:70-82   (compiled, v0.28.0)
 *
 *     if ('production' !== process.env.NODE_ENV && _this._queue.length) {
 *       setTimeout(function () { ...logger.warn(...) }, 1500);
 *     }
 *
 * The return value is discarded: the timer is never cleared when the work item
 * runs, and never .unref()ed. Jest sets NODE_ENV=test, so the branch is always
 * live under test. A ref'd pending timer keeps a Node event loop alive, so a
 * worker that has issued a contended enqueue cannot exit naturally for up to
 * 1500ms afterwards.
 *
 * WHAT THIS SCRIPT MEASURES
 * -------------------------
 * It does NOT use the project's test suite, models, or jest. It builds the
 * smallest thing that contends the queue — two overlapping `database.write()`
 * calls on an empty schema — then measures how long the process stays alive
 * after all work has settled and the adapter is closed. If the lead is real,
 * the process should linger for ~the remainder of 1500ms with nothing left to
 * do, and the count of intercepted 1500ms WorkQueue timers should be non-zero.
 *
 * It reports, as JSON on stdout:
 *   warningTimersCreated  how many 1500ms WorkQueue warning timers were registered
 *   warningTimersFired    how many actually ran (i.e. printed a warning)
 *   pendingAtSettle       how many were still pending once all work had settled
 *   refdAtSettle          how many of those still held a ref on the event loop
 *   heldOpenMs            ms between "all work settled" and natural process exit
 *
 * USAGE
 *   node scripts/repro-workqueue-timer.mjs
 *   WMDB_UNREF_QUEUE_WARNING=1 node scripts/repro-workqueue-timer.mjs
 *
 * The second form only differs if scripts/patch-workqueue-unref.js has been
 * applied to node_modules first; it is the treatment arm of the A/B.
 */

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Instrument setTimeout so we can see WorkQueue's warning timers specifically.
// Identified by the pair (delay === 1500, creation stack mentions WorkQueue) so
// we cannot accidentally count unrelated timers.
// ---------------------------------------------------------------------------
const WARNING_DELAY_MS = 1500;
const realSetTimeout = globalThis.setTimeout;

const liveWarningTimers = new Set();
let created = 0;
let fired = 0;

globalThis.setTimeout = function patchedSetTimeout(fn, delay, ...args) {
  const isWarningTimer =
    delay === WARNING_DELAY_MS &&
    typeof fn === 'function' &&
    (new Error().stack || '').includes('WorkQueue');

  if (!isWarningTimer) {
    return realSetTimeout(fn, delay, ...args);
  }

  created += 1;
  let handle;
  const wrapped = function wrappedWarning(...callArgs) {
    liveWarningTimers.delete(handle);
    fired += 1;
    return fn.apply(this, callArgs);
  };
  handle = realSetTimeout(wrapped, delay, ...args);
  liveWarningTimers.add(handle);
  return handle;
};

// ---------------------------------------------------------------------------
// Smallest possible contended queue.
// ---------------------------------------------------------------------------
const { Database, appSchema } = require('@nozbe/watermelondb');
const LokiJSAdapter = require('@nozbe/watermelondb/adapters/lokijs').default;

function createEmptyDatabase() {
  const adapter = new LokiJSAdapter({
    schema: appSchema({ version: 1, tables: [] }),
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    // Match src/db/test-helpers.ts: loki's default autosave leaves its own live
    // timer, which would confound the measurement.
    extraLokiOptions: { autosave: false },
  });
  return new Database({ adapter, modelClasses: [] });
}

function closeDatabase(database) {
  const loki = database.adapter.underlyingAdapter?._driver?.loki;
  if (!loki) {
    throw new Error('repro: could not reach loki instance — adapter internals changed?');
  }
  return new Promise((resolve) => loki.close(() => resolve()));
}

async function main() {
  const database = createEmptyDatabase();

  // Two writes issued in the same tick. The first occupies the queue, so the
  // second (and any after it) enqueue *contended* and arm the warning timer.
  // A single write would not reproduce this — `_queue.length` is 0 for it.
  await Promise.all([
    database.write(async () => {}),
    database.write(async () => {}),
    database.write(async () => {}),
    database.write(async () => {}),
  ]);

  await closeDatabase(database);

  const pendingAtSettle = liveWarningTimers.size;
  let refdAtSettle = 0;
  for (const handle of liveWarningTimers) {
    if (typeof handle.hasRef !== 'function' || handle.hasRef()) {
      refdAtSettle += 1;
    }
  }

  // Everything the script set out to do is now done. Any further wall-clock
  // time before the process exits is time the event loop was held open by
  // something we did not ask for.
  const settledAt = performance.now();

  process.on('exit', () => {
    const heldOpenMs = Math.round(performance.now() - settledAt);
    process.stdout.write(
      `${JSON.stringify(
        {
          unrefEnvSet: process.env.WMDB_UNREF_QUEUE_WARNING === '1',
          warningTimersCreated: created,
          warningTimersFired: fired,
          pendingAtSettle,
          refdAtSettle,
          heldOpenMs,
        },
        null,
        2,
      )}\n`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
