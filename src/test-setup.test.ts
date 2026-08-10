/**
 * Test for issue #129 fix: verify WorkQueue's dev-mode warning timers are unref'd
 *
 * This test runs AFTER test-setup.ts has already patched global.setTimeout,
 * so it verifies that the patch is working by reproducing the scenario.
 */

describe('Issue #129: WorkQueue warning timer unref', () => {
  it('should unref WorkQueue 1500ms warning timers', async () => {
    // Import after test-setup has run, so the patched setTimeout is active
    const { Database, appSchema } = require('@nozbe/watermelondb');
    const LokiJSAdapter = require('@nozbe/watermelondb/adapters/lokijs').default;

    // Track timers to verify they're being unref'd
    const liveTimers: ReturnType<typeof setTimeout>[] = [];
    const originalSetTimeout = global.setTimeout;
    let unrefCount = 0;

    // Temporarily override setTimeout to track unref calls
    global.setTimeout = function (
      callback: (...args: any[]) => void,
      ms?: number,
      ...args: any[]
    ) {
      const handle = originalSetTimeout(callback, ms, ...args);

      // Track if this is a WorkQueue timer
      if (ms === 1500) {
        const stack = new Error().stack || '';
        if (stack.includes('WorkQueue')) {
          liveTimers.push(handle);
          // Check if it's already been unref'd by test-setup
          if (typeof handle.hasRef === 'function' && !handle.hasRef()) {
            unrefCount += 1;
          }
        }
      }

      return handle;
    } as any;

    try {
      // Create a database and trigger contended writes to spawn WorkQueue timers
      const adapter = new LokiJSAdapter({
        schema: appSchema({ version: 1, tables: [] }),
        useWebWorker: false,
        useIncrementalIndexedDB: false,
        extraLokiOptions: { autosave: false },
      });
      const database = new Database({ adapter, modelClasses: [] });

      // Four writes issued in the same tick trigger contended enqueues
      await Promise.all([
        database.write(async () => {}),
        database.write(async () => {}),
        database.write(async () => {}),
        database.write(async () => {}),
      ]);

      // Close the database
      const loki = database.adapter.underlyingAdapter?._driver?.loki;
      if (loki) {
        await new Promise((resolve) => loki.close(() => resolve()));
      }

      // Verify: at least one WorkQueue timer was created and unref'd by test-setup
      // (we expect 3 contended writes → 3 timers, and all should be unref'd)
      expect(unrefCount).toBeGreaterThan(0);

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;

      // Clean up: clear all the timers we created
      for (const timer of liveTimers) {
        clearTimeout(timer);
      }
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });
});
