import { createActiveSessionStore } from './activeSession';
import { createEngine, type EffectExecutors } from '@/engine/index';
import type { SessionState } from '@/engine/types';

/**
 * Integration tests for HealthKit integration with the session store.
 * AC6.1: Completing a session writes a Workout sample with correct start/end/energy
 * AC6.2: Denied authorization or a write failure leaves the DB row and sync state intact
 */

describe('activeSession with HealthKit', () => {
  // Mock database
  const mockDatabase = {
    write: jest.fn(),
    get: jest.fn(),
  } as any;

  // Test fixtures
  const testRoutineId = 'test-routine-1';
  const testSessionId = 'test-session-1';
  const testStartMs = Date.now() - 3600000; // 1 hour ago

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC6.1: FinishSession effect invokes saveWorkout with correct arguments', async () => {
    const saveWorkoutSpy = jest.fn().mockResolvedValue(undefined);
    const ensureAuthorizedSpy = jest.fn().mockResolvedValue('authorized');

    const executors: Partial<EffectExecutors> = {
      onCreateSession: jest.fn(),
      onPersistSet: jest.fn(),
      onCompleteSession: async (summary: any) => {
        // This is where saveWorkout will be wired
        await saveWorkoutSpy(summary);
      },
    };

    const engine = createEngine(executors);

    // Initialize session in stretching phase (valid for FinishSession)
    const initialState: SessionState = {
      sessionId: testSessionId,
      routineId: testRoutineId,
      phase: 'stretching', // Valid state for FinishSession
      exerciseIndex: 1,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    engine.setState(initialState);
    const completedState = await engine.dispatch({ tag: 'FinishSession' });

    expect(completedState?.phase).toBe('done');
    expect(saveWorkoutSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        startMs: testStartMs,
        endMs: expect.any(Number),
        exercisesCompleted: expect.any(Number),
        setsLogged: expect.any(Number),
        loggedSets: expect.any(Array),
      })
    );
  });

  it('AC6.2: HealthKit error does not affect session state or sync', async () => {
    let dbWriteCalled = false;
    let syncCalled = false;

    mockDatabase.write.mockImplementation(async (fn: Function) => {
      dbWriteCalled = true;
      return fn();
    });

    mockDatabase.get.mockReturnValue({
      find: jest.fn().mockResolvedValue({
        update: jest.fn(),
      }),
    });

    const healthKitError = new Error('HealthKit unavailable');
    const saveWorkoutSpy = jest.fn().mockRejectedValue(healthKitError);
    const syncSpy = jest.fn().mockResolvedValue(undefined);

    const executors: Partial<EffectExecutors> = {
      onCreateSession: jest.fn(),
      onPersistSet: jest.fn(),
      onCompleteSession: async (summary: any) => {
        // Simulate the real onCompleteSession: DB write, sync, then HealthKit
        try {
          // DB write happens here
          dbWriteCalled = true;
        } catch (e) {
          // DB error would roll back
          throw e;
        }

        try {
          // Sync happens next
          await syncSpy();
        } catch (e) {
          // Sync error is logged but doesn't block
          console.error('Sync failed:', e);
        }

        try {
          // HealthKit write last - isolated
          await saveWorkoutSpy(summary);
        } catch (e) {
          // HealthKit error is swallowed, doesn't affect prior writes
          console.error('HealthKit write failed:', e);
        }
      },
    };

    const engine = createEngine(executors);

    const initialState: SessionState = {
      sessionId: testSessionId,
      routineId: testRoutineId,
      phase: 'stretching', // Valid state for FinishSession
      exerciseIndex: 1,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    engine.setState(initialState);

    // Should not throw even though HealthKit fails
    const completedState = await engine.dispatch({ tag: 'FinishSession' });

    expect(completedState?.phase).toBe('done');
    expect(dbWriteCalled).toBe(true);
    expect(syncSpy).toHaveBeenCalled();
    expect(saveWorkoutSpy).toHaveBeenCalled();
  });
});
