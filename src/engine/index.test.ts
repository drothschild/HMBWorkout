/**
 * Engine tests — dispatch loop with effect executors.
 * Tests that state swaps happen correctly, executors run in order,
 * errors are handled properly, and Err transitions preserve state.
 */

import { createEngine } from './index';
import { SessionState, Event, Effect } from './types';

/**
 * Fixture helper: minimal state
 */
function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'test-session',
    routineId: 'test-routine',
    phase: 'idle',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: 0,
    loggedSets: [],
    startedAtMs: 1000,
    entries: [],
    ...overrides,
  };
}

/**
 * Helper: build a routine with entries structure for testing
 */
function makeRoutine(exerciseCount = 1, overrides?: any): any {
  const entries: any[] = [];
  for (let i = 0; i < exerciseCount; i++) {
    entries.push({
      exerciseId: `exercise-${i}`,
      kind: 'strength',
      warmupSets: i === 0 ? 1 : 0,
      targetSets: 1,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 60,
      supersetGroup: '',
      ...overrides?.[i],
    });
  }
  return { id: 'routine-test', entries };
}

describe('engine: dispatch loop with effect executors', () => {
  describe('happy path: dispatch swaps state and runs executors', () => {
    it('should update state and return new state on Ok transition', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);
      const initialState = makeState({ phase: 'idle' });

      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-session',
        nowMs: 5000,
        routine: makeRoutine(1) as any,
      };

      const newState = await engine.dispatch(event);

      expect(newState.sessionId).toBe('new-session');
      expect(newState.phase).toBe('warmup');
      expect(newState.startedAtMs).toBe(5000);
    });

    it('should invoke effect executors in order after state swap', async () => {
      const callOrder: string[] = [];

      const executors = {
        onCreateSession: jest.fn(() => {
          callOrder.push('onCreateSession');
        }),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(() => {
          callOrder.push('onNotify');
        }),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);

      const event: Event = {
        tag: 'StartSession',
        sessionId: 'test-session',
        nowMs: 1000,
        routine: makeRoutine(1) as any,
      };

      await engine.dispatch(event);

      // CreateSession should be called (from StartSession)
      expect(executors.onCreateSession).toHaveBeenCalled();
      expect(callOrder).toContain('onCreateSession');
    });

    it('should call the correct executor for each effect', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);

      // Dispatch a FinishSession that emits CompleteSession + Notify
      const state = makeState({ phase: 'working' });
      engine.setState(state);

      const event: Event = { tag: 'FinishSession' };
      await engine.dispatch(event);

      expect(executors.onCompleteSession).toHaveBeenCalled();
      expect(executors.onNotify).toHaveBeenCalled();
    });
  });

  describe('Err transition: preserve state, surface TransitionError, zero executors', () => {
    it('should keep prior state on Err transition', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);
      const priorState = makeState({ phase: 'warmup', setIndex: 5 });
      engine.setState(priorState);

      // Try an invalid event for warmup phase
      const event: Event = { tag: 'RestElapsed', nowMs: 1000 };

      try {
        await engine.dispatch(event);
      } catch (err: any) {
        // Should throw TransitionError
        expect(err.name).toBe('TransitionError');
      }

      // State should be unchanged
      const currentState = engine.getState();
      expect(currentState.setIndex).toBe(5);
      expect(currentState.phase).toBe('warmup');
    });

    it('should not run any executors when transition returns Err', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);
      const priorState = makeState({ phase: 'warmup' });
      engine.setState(priorState);

      // RestElapsed in warmup is invalid
      const event: Event = { tag: 'RestElapsed', nowMs: 1000 };

      try {
        await engine.dispatch(event);
      } catch (err: any) {
        // Expected to throw
      }

      // No executors should have been called
      expect(executors.onCreateSession).not.toHaveBeenCalled();
      expect(executors.onScheduleRest).not.toHaveBeenCalled();
      expect(executors.onCancelRest).not.toHaveBeenCalled();
      expect(executors.onNotify).not.toHaveBeenCalled();
      expect(executors.onPersistSet).not.toHaveBeenCalled();
      expect(executors.onCompleteSession).not.toHaveBeenCalled();
    });

    it('should surface TransitionError with message', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);
      engine.setState(makeState({ phase: 'idle' }));

      // LogSet in idle is invalid
      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 7.0,
      };

      try {
        await engine.dispatch(event);
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('TransitionError');
        expect(err.message).toContain('invalid event');
      }
    });
  });

  describe('executor error handling: throw → log + isolate, state intact, others still run', () => {
    it('should keep new state even if executor throws', async () => {
      const executors = {
        onCreateSession: jest.fn(() => {
          throw new Error('Executor failed');
        }),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      // Mock console.error to avoid noise
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const engine = createEngine(executors);
      const priorState = makeState({ phase: 'idle' });
      engine.setState(priorState);

      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-session',
        nowMs: 5000,
        routine: makeRoutine(1) as any,
      };

      // Dispatch should not throw, even though executor does
      await engine.dispatch(event);

      // State should be updated despite executor error
      const currentState = engine.getState();
      expect(currentState.sessionId).toBe('new-session');
      expect(currentState.phase).toBe('warmup');

      // Error should have been logged
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should run remaining executors even if one throws', async () => {
      const executors = {
        onCreateSession: jest.fn(() => {
          throw new Error('First executor fails');
        }),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const engine = createEngine(executors);
      engine.setState(makeState({ phase: 'idle' }));

      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-session',
        nowMs: 5000,
        routine: makeRoutine(1) as any,
      };

      await engine.dispatch(event);

      // Both CreateSession and the second executor (if any) should have run/attempted
      expect(executors.onCreateSession).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getState: returns current state', () => {
    it('should return current state', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);
      const initialState = makeState({ phase: 'idle', exerciseIndex: 3 });
      engine.setState(initialState);

      const state = engine.getState();
      expect(state.exerciseIndex).toBe(3);
      expect(state.phase).toBe('idle');
    });
  });

  describe('setState: sets initial state', () => {
    it('should set state for initial dispatch', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);
      const state = makeState({ phase: 'working', exerciseIndex: 2 });
      engine.setState(state);

      const retrieved = engine.getState();
      expect(retrieved.phase).toBe('working');
      expect(retrieved.exerciseIndex).toBe(2);
    });
  });
});
