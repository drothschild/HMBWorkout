import { createActiveSessionStore } from './activeSession';
import type { HealthKitDeps } from './activeSession';
import type { SessionState } from '@/engine/types';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import { createSession } from '@/db/repository';
import { Database } from '@nozbe/watermelondb';

/**
 * Integration tests for session store with real DB and injected dependencies.
 * AC6.1: Completing a session calls saveWorkoutSample with correct summary args (deterministic times from event.nowMs)
 * AC6.2: HealthKit errors don't prevent session state transition to done (DB write complete before HealthKit isolation)
 */

describe('activeSession store — HealthKit isolation and real DB integration', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('AC6.1: FinishSession with non-throwing HealthKit calls saveWorkoutSample with correct start/end times from event.nowMs', async () => {
    const testStartMs = 1000;
    const testEndMs = 10000;

    // Create injected HealthKit that does NOT throw
    const saveWorkoutSampleSpy = jest.fn(async (activityType: number, quantities: any[], startDate: Date, endDate: Date) => {
      // Verify it receives the correct times (converted from ms to Date objects)
      expect(startDate.getTime()).toBe(testStartMs);
      expect(endDate.getTime()).toBe(testEndMs);
    });

    const healthKitDeps: HealthKitDeps = {
      ensureAuthorized: jest.fn(async () => 'authorized'),
      requestAuthorization: jest.fn(async () => true),
      saveWorkoutSample: saveWorkoutSampleSpy,
    } as any;

    const store = createActiveSessionStore(
      database,
      {
        onCreateSession: jest.fn(),
        onPersistSet: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
      },
      healthKitDeps
    );

    // Create session in DB
    await createSession(database, {
      sessionId: 'session-ac6-1',
      routineId: 'routine-1',
      startedAtMs: testStartMs,
    });

    const initialState: SessionState = {
      sessionId: 'session-ac6-1',
      routineId: 'routine-1',
      phase: 'working',
      exerciseIndex: 0,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 8,
          weightKg: 50,
          durationSeconds: null,
          rpe: 8,
        },
      ],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    store.getState().hydrate(initialState);
    const result = await store.getState().dispatch({ tag: 'FinishSession', nowMs: testEndMs });

    // Verify state transitioned to done
    expect(result?.phase).toBe('done');

    // Flush microtasks and timers to allow async HealthKit write to complete
    await flush();

    // Verify saveWorkoutSample was called (checked in spy callback above)
    expect(saveWorkoutSampleSpy).toHaveBeenCalled();
  });

  it('AC6.2: HealthKit throwing does not prevent state transition to done (DB write complete, HealthKit isolated)', async () => {
    const testStartMs = 1000;
    const testEndMs = 10000;

    // Create injected HealthKit that THROWS
    const saveWorkoutSampleSpy = jest.fn(async () => {
      throw new Error('HealthKit write failed');
    });

    const healthKitDeps: HealthKitDeps = {
      ensureAuthorized: jest.fn(async () => 'authorized'),
      requestAuthorization: jest.fn(async () => true),
      saveWorkoutSample: saveWorkoutSampleSpy,
    } as any;

    const store = createActiveSessionStore(
      database,
      {
        onCreateSession: jest.fn(),
        onPersistSet: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
      },
      healthKitDeps
    );

    // Create session in DB
    const sessionId = 'session-ac6-2';
    await createSession(database, {
      sessionId,
      routineId: 'routine-2',
      startedAtMs: testStartMs,
    });

    const initialState: SessionState = {
      sessionId,
      routineId: 'routine-2',
      phase: 'working',
      exerciseIndex: 0,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    store.getState().hydrate(initialState);

    // Suppress console.error output for this test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // Set up unhandledRejection listener to ensure nothing slips through
    const unhandledRejections: PromiseRejectionEvent[] = [];
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event);
    };
    process.on('unhandledRejection', rejectionHandler);

    try {
      // Should not throw despite HealthKit error
      const result = await store.getState().dispatch({ tag: 'FinishSession', nowMs: testEndMs });

      // State should still transition to done
      expect(result?.phase).toBe('done');

      // Flush microtasks and timers to allow async HealthKit write to complete
      await flush();

      // Verify HealthKit was attempted (threw, but isolated)
      expect(saveWorkoutSampleSpy).toHaveBeenCalled();

      // Verify DB write happened: query the session and check ended_at is set
      const session = await database.get('sessions').find(sessionId) as any;
      expect(session._raw.ended_at).toBeDefined();
      expect(session._raw.ended_at).toBeGreaterThan(0);

      // Flush microtasks and timers again to catch any late-arriving promise rejections
      await flush();

      // Verify no unhandledRejection fired
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', rejectionHandler);
      consoleSpy.mockRestore();
    }
  });
});
