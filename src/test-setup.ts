/**
 * Jest test setup - runs once before all tests in the node project
 *
 * Issue #129: Unref WorkQueue's dev-mode queue-warning timers
 * ============================================================
 * WatermelonDB's WorkQueue registers a 1500ms dev-mode warning timer on every
 * contended enqueue (queue already has work), gated on NODE_ENV !== 'production'.
 * Jest uses NODE_ENV=test, so the timer always fires during contended operations.
 * The timer handle is discarded in the library, so it's never .unref()'d, causing
 * jest workers to linger up to 1500ms waiting for timers that serve only as
 * warnings and are never actually awaited.
 *
 * This setup intercepts setTimeout to detect these specific timers (delay === 1500ms,
 * creation stack mentions WorkQueue) and .unref() them so they don't hold the
 * process open. No node_modules edits needed; this runs before tests execute.
 *
 * Evidence and decision: see GitHub issue #129 and PR #186.
 */

const originalSetTimeout = global.setTimeout;
const WARNING_DELAY_MS = 1500;

// Override setTimeout to unref WorkQueue's dev-mode warning timers
global.setTimeout = function patchedSetTimeout(
  callback: (...args: any[]) => void,
  ms?: number,
  ...args: any[]
): ReturnType<typeof originalSetTimeout> {
  const handle = originalSetTimeout(callback, ms, ...args);

  // Detect WorkQueue's 1500ms dev-mode queue warning timer
  // It's identified by the exact delay and the creation stack
  if (ms === WARNING_DELAY_MS && typeof callback === 'function') {
    const stack = new Error().stack || '';
    if (stack.includes('WorkQueue')) {
      // Unref this timer so it doesn't hold the event loop open
      if (typeof handle.unref === 'function') {
        handle.unref();
      }
    }
  }

  return handle;
};
