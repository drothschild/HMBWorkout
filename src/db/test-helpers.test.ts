import { flush, createTestDatabase, closeTestDatabase } from './test-helpers';
import { Database } from '@nozbe/watermelondb';

describe('flush', () => {
  let database: Database;

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  test('drains a queue depth of 2 that a bare setImmediate misses', async () => {
    database = createTestDatabase();
    let firstDone = false;
    let secondDone = false;

    // Two database.write calls back-to-back, neither awaited here -- the
    // second genuinely queues behind the first in WatermelonDB's WorkQueue,
    // which is exactly the fire-and-forget shape un-awaited effect executors
    // (e.g. onCompleteSession) produce.
    database.write(async () => {
      firstDone = true;
    });
    database.write(async () => {
      secondDone = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(firstDone).toBe(true);
    // The exact miss flush() exists to fix: a write queued behind another
    // isn't due until the *next* event-loop iteration's timers phase, past
    // where a single setImmediate already resolved.
    expect(secondDone).toBe(false);

    await flush();
    expect(secondDone).toBe(true);
  });
});
