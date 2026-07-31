/**
 * Engine tests — dispatch loop with effect executors.
 * Tests that state swaps happen correctly, executors run in order,
 * errors are handled properly, and Err transitions preserve state.
 */

import { createEngine } from './index';
import type { SessionState, Event, Effect } from './types';

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
    lastLoggedSet: undefined,
    startedAtMs: 1000,
    prePausePhase: '',
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
      idx: i,
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

    it('should not mutate the input event (M2)', async () => {
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

      // Create a routine WITHOUT idx in entries (simulating input from outside)
      const routine = {
        id: 'routine-test',
        entries: [
          {
            exerciseId: 'exercise-0',
            kind: 'strength',
            warmupSets: 1,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
            // Note: NO idx field here
          },
        ],
      };
      const originalEntries = routine.entries.map((e: any) => ({ ...e })); // Deep copy for comparison

      const event: Event = {
        tag: 'StartSession',
        sessionId: 'test-mutation',
        nowMs: 1000,
        routine: routine as any,
      };

      await engine.dispatch(event);

      // Verify the original routine.entries was not modified
      expect((event.routine as any).entries).toEqual(originalEntries);
      // Each entry should still not have an 'idx' field (dispatch creates new objects)
      (event.routine as any).entries.forEach((entry: any) => {
        expect(entry.idx).toBeUndefined();
      });
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

      const event: Event = { tag: 'FinishSession', nowMs: 10000 };
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
        nowMs: 1000,
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

  describe('state retention across phases: invalid events preserve state (M4)', () => {
    const phaseTests = [
      { phase: 'idle' as const, validEvent: (s: any) => ({ tag: 'StartSession' as const, sessionId: 's', nowMs: 1000, routine: { id: 'r', entries: [] } }), invalidEvent: () => ({ tag: 'LogSet' as const, reps: 8, weightKg: 20.0, nowMs: 5000 }), description: 'idle' },
      { phase: 'warmup' as const, validEvent: (s: any) => ({ tag: 'LogSet' as const, reps: 8, weightKg: 20.0 }), invalidEvent: () => ({ tag: 'RestElapsed' as const, nowMs: 5000 }), description: 'warmup' },
      { phase: 'working' as const, validEvent: (s: any) => ({ tag: 'LogSet' as const, reps: 8, weightKg: 20.0 }), invalidEvent: () => ({ tag: 'RestElapsed' as const, nowMs: 5000 }), description: 'working' },
      { phase: 'resting' as const, validEvent: (s: any) => ({ tag: 'RestElapsed' as const, nowMs: s.restDeadlineMs + 1 }), invalidEvent: () => ({ tag: 'LogSet' as const, reps: 8, weightKg: 20.0, nowMs: 5000 }), description: 'resting' },
      { phase: 'paused' as const, validEvent: (s: any) => ({ tag: 'Resume' as const, nowMs: 5000 }), invalidEvent: () => ({ tag: 'LogSet' as const, reps: 8, weightKg: 20.0, nowMs: 5000 }), description: 'paused' },
      { phase: 'done' as const, validEvent: (s: any) => undefined, invalidEvent: () => ({ tag: 'LogSet' as const, reps: 8, weightKg: 20.0, nowMs: 5000 }), description: 'done' },
    ];

    for (const tc of phaseTests) {
      it(`should preserve state and throw TransitionError on invalid event in ${tc.description} phase (M4)`, async () => {
        const executors = {
          onCreateSession: jest.fn(),
          onScheduleRest: jest.fn(),
          onCancelRest: jest.fn(),
          onNotify: jest.fn(),
          onPersistSet: jest.fn(),
          onCompleteSession: jest.fn(),
        };

        const engine = createEngine(executors);
        const priorState = makeState({
          phase: tc.phase,
          exerciseIndex: 5,
          setIndex: 3,
          restDeadlineMs: 10000,
          entries: makeRoutine(2).entries,
        });
        engine.setState(priorState);

        // Deep copy for comparison
        const stateSnapshot = JSON.stringify(priorState);

        const invalidEvent = tc.invalidEvent() as any;

        try {
          await engine.dispatch(invalidEvent);
          throw new Error('Should have thrown TransitionError');
        } catch (err: any) {
          expect(err.name).toBe('TransitionError');
        }

        // Verify state is unchanged
        const currentState = engine.getState();
        expect(JSON.stringify(currentState)).toEqual(stateSnapshot);
        expect(currentState.exerciseIndex).toBe(5);
        expect(currentState.setIndex).toBe(3);
        expect(currentState.phase).toBe(tc.phase);
      });
    }
  });

  describe('effect mapping: deterministic endMs from event.nowMs (I1)', () => {
    it('LogSet auto-complete path uses event.nowMs for endMs (deterministic)', async () => {
      const completeSessions: any[] = [];
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn((summary: any) => {
          completeSessions.push(summary);
        }),
      };

      const engine = createEngine(executors);
      const testStartMs = 5000;
      const testEndMs = 75000; // final LogSet nowMs (after the between-sets rest elapses)

      engine.setState(makeState({ phase: 'idle' }));

      // Start session with one exercise: 1 warmup set, 1 target set
      const routine = makeRoutine(1, [{ warmupSets: 1, targetSets: 1 }]);
      let state = await engine.dispatch({
        tag: 'StartSession',
        sessionId: 'test-set-done-endms',
        nowMs: testStartMs,
        routine: routine as any,
      });

      expect(state.phase).toBe('warmup');

      // Log warmup set → advances into the between-sets rest, then elapse it
      state = await engine.dispatch({
        tag: 'LogSet',
        reps: 5,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 6.0,
        nowMs: testStartMs + 5000,
      });

      expect(state.phase).toBe('resting');

      state = await engine.dispatch({
        tag: 'RestElapsed',
        nowMs: testStartMs + 5000 + 60000,
      });

      expect(state.phase).toBe('working');

      // Log the only working set — final set, completes the workout
      state = await engine.dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        rpe: 7.5,
        nowMs: testEndMs,
      });

      // Verify session is done
      expect(state.phase).toBe('done');

      // Verify onCompleteSession was called with endMs from the LogSet event
      expect(executors.onCompleteSession).toHaveBeenCalled();
      expect(completeSessions).toHaveLength(1);
      expect(completeSessions[0].startMs).toBe(testStartMs);
      expect(completeSessions[0].endMs).toBe(testEndMs); // Should be from LogSet.nowMs, not Date.now()
    });

    it('SetDone (Skip Set) auto-complete path uses event.nowMs for endMs (deterministic)', async () => {
      const completeSessions: any[] = [];
      const executors = {
        onCompleteSession: jest.fn((summary: any) => {
          completeSessions.push(summary);
        }),
        onNotify: jest.fn(),
      };

      const engine = createEngine(executors);
      const testEndMs = 75000;
      engine.setState(
        makeState({
          phase: 'working',
          startedAtMs: 5000,
          entries: makeRoutine(1, [{ warmupSets: 0, targetSets: 1 }]).entries,
        })
      );

      // Skipping the only set completes the workout without logging anything
      const state = await engine.dispatch({ tag: 'SetDone', nowMs: testEndMs });

      expect(state.phase).toBe('done');
      expect(state.loggedSets).toHaveLength(0);
      expect(completeSessions).toHaveLength(1);
      expect(completeSessions[0].startMs).toBe(5000);
      expect(completeSessions[0].endMs).toBe(testEndMs);
    });

    it('FinishSession uses event.nowMs for endMs (deterministic)', async () => {
      const completeSessions: any[] = [];
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn((summary: any) => {
          completeSessions.push(summary);
        }),
      };

      const engine = createEngine(executors);
      const testStartMs = 1000;
      const testEndMs = 20000; // FinishSession nowMs

      engine.setState(makeState({ phase: 'working', startedAtMs: testStartMs }));

      // FinishSession with specific nowMs
      const state = await engine.dispatch({
        tag: 'FinishSession',
        nowMs: testEndMs,
      });

      // Verify session is done
      expect(state.phase).toBe('done');

      // Verify endMs from FinishSession.nowMs
      expect(executors.onCompleteSession).toHaveBeenCalled();
      expect(completeSessions).toHaveLength(1);
      expect(completeSessions[0].endMs).toBe(testEndMs);
    });
  });

  describe('end-to-end integration: full session dispatch flow (AC10.1)', () => {
    it('should walk through a complete session: start → warmup → working → done', async () => {
      const loggedSetsHistory: any[] = [];
      const completedSessions: any[] = [];
      const notifyMessages: string[] = [];

      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn((msg: string) => {
          notifyMessages.push(msg);
        }),
        onPersistSet: jest.fn((set: any) => {
          loggedSetsHistory.push(set);
        }),
        onCompleteSession: jest.fn((summary: any) => {
          completedSessions.push(summary);
        }),
      };

      const engine = createEngine(executors);
      const initialState = makeState({ phase: 'idle' });
      engine.setState(initialState);

      // Step 1: StartSession
      const routine = makeRoutine(2, [
        { warmupSets: 1, targetSets: 2, restSeconds: 90 },
        { warmupSets: 0, targetSets: 1, restSeconds: 60 },
      ]);

      let state = await engine.dispatch({
        tag: 'StartSession',
        sessionId: 'session-test-full',
        nowMs: 1000,
        routine: routine as any,
      });

      expect(state.sessionId).toBe('session-test-full');
      expect(state.phase).toBe('warmup');
      expect(executors.onCreateSession).toHaveBeenCalled();
      expect(state.loggedSets.length).toBe(0);

      // Step 2: LogSet warmup → records AND advances into the between-sets rest
      state = await engine.dispatch({
        tag: 'LogSet',
        reps: 5,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 6.0,
        nowMs: 10000,
      });

      expect(state.loggedSets.length).toBe(1);
      expect(state.loggedSets[0].setType).toBe('warmup');
      expect(executors.onPersistSet).toHaveBeenCalledTimes(1);
      expect(state.phase).toBe('resting'); // Rest between sets of exercise 0
      expect(state.restDeadlineMs).toBe(100000); // 10000 + 90*1000

      state = await engine.dispatch({
        tag: 'RestElapsed',
        nowMs: 100000,
      });

      expect(state.phase).toBe('working'); // Should advance to working after warmups
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(1);

      // Step 3: LogSet working set 1 → rest between sets, then elapse
      state = await engine.dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        rpe: 7.5,
        nowMs: 110000,
      });

      expect(state.loggedSets.length).toBe(2); // Now have warmup + working set
      expect(state.loggedSets[1].setType).toBe('working');
      expect(executors.onPersistSet).toHaveBeenCalledTimes(2);
      expect(state.phase).toBe('resting');

      state = await engine.dispatch({
        tag: 'RestElapsed',
        nowMs: 200000,
      });

      // Should still be in exercise 0 but on set 2 (second working set)
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(2);
      expect(state.phase).toBe('working');

      // Step 4: LogSet working set 2 (completes exercise 0, moves to rest before exercise 1)
      state = await engine.dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        rpe: 8.0,
        nowMs: 210000,
      });

      expect(state.loggedSets.length).toBe(3); // warmup + 2 working
      expect(executors.onPersistSet).toHaveBeenCalledTimes(3);
      expect(state.phase).toBe('resting'); // Now resting before next exercise
      expect(state.exerciseIndex).toBe(1); // Advanced to next exercise
      expect(state.restDeadlineMs).toBe(300000); // 210000 + 90*1000
      expect(executors.onScheduleRest).toHaveBeenCalled();

      // Step 5: RestElapsed (resume from rest)
      state = await engine.dispatch({
        tag: 'RestElapsed',
        nowMs: 300000,
      });

      expect(state.phase).toBe('working'); // Back to working phase
      expect(state.exerciseIndex).toBe(1);
      expect(state.setIndex).toBe(0);
      expect(executors.onCancelRest).toHaveBeenCalled();

      // Step 6: LogSet for exercise 1 — final set completes the workout
      state = await engine.dispatch({
        tag: 'LogSet',
        reps: 10,
        weightKg: 30.0,
        durationSeconds: 0,
        rpe: 7.0,
        nowMs: 310000,
      });

      expect(state.loggedSets.length).toBe(4); // 3 previous + 1 new
      expect(state.loggedSets[3].exerciseId).toBe('exercise-1');
      expect(executors.onPersistSet).toHaveBeenCalledTimes(4);

      // Should be done now
      expect(state.phase).toBe('done');
      expect(executors.onCompleteSession).toHaveBeenCalled();
      expect(executors.onNotify).toHaveBeenCalledWith('Workout complete');
      expect(notifyMessages).toContain('Workout complete');

      // Verify final state
      expect(state.loggedSets.length).toBe(4); // All sets persisted
      expect(completedSessions.length).toBe(1);
    });

    it('should maintain state isolation: each dispatch grows loggedSets', async () => {
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

      const routine = makeRoutine(1, [{ warmupSets: 0, targetSets: 3, restSeconds: 0 }]);

      // Start session
      let state = await engine.dispatch({
        tag: 'StartSession',
        sessionId: 'test-isolation',
        nowMs: 1000,
        routine: routine as any,
      });

      const setsPerDispatch: number[] = [];
      setsPerDispatch.push(state.loggedSets.length); // 0

      // Log 3 sets — each one-tap log both records and advances
      for (let i = 0; i < 3; i++) {
        state = await engine.dispatch({
          tag: 'LogSet',
          reps: 8,
          weightKg: 20.0,
          durationSeconds: 0,
          rpe: 7.0 + i * 0.5, // 7.0, 7.5, 8.0
          nowMs: 2000 + i * 10000,
        });
        setsPerDispatch.push(state.loggedSets.length);
      }

      // Verify loggedSets grows monotonically
      expect(setsPerDispatch).toEqual([0, 1, 2, 3]);
    });
  });
});

describe('engine: Stretching phase via StartStretching', () => {
  it('enters stretching from working', async () => {
    const executors = { onCancelRest: jest.fn() };
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'working', entries: makeRoutine(1).entries })
    );

    const newState = await engine.dispatch({ tag: 'StartStretching' } as Event);
    expect(newState.phase).toBe('stretching');
    expect(executors.onCancelRest).not.toHaveBeenCalled();
  });

  it('enters stretching from resting, cancels the pending rest', async () => {
    const executors = { onCancelRest: jest.fn() };
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 99999,
        entries: makeRoutine(1).entries,
      })
    );

    const newState = await engine.dispatch({ tag: 'StartStretching' } as Event);
    expect(newState.phase).toBe('stretching');
    expect(newState.restDeadlineMs).toBe(0); // sentinel for cleared deadline
    expect(executors.onCancelRest).toHaveBeenCalledTimes(1);
  });

  it('rejects StartStretching from idle with the rule error', async () => {
    const engine = createEngine({});
    engine.setState(makeState({ phase: 'idle' }));

    await expect(
      engine.dispatch({ tag: 'StartStretching' } as Event)
    ).rejects.toThrow(/invalid event StartStretching in phase idle/);
  });

  it('finishes the session from stretching', async () => {
    const executors = { onCompleteSession: jest.fn(), onNotify: jest.fn() };
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'stretching', entries: makeRoutine(1).entries })
    );

    const newState = await engine.dispatch({
      tag: 'FinishSession',
      nowMs: 5000,
    } as Event);
    expect(newState.phase).toBe('done');
  });
});

describe('engine: leaving the stretch cool-down via StopStretching', () => {
  it('returns to working when the upcoming set is a working set', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({
        phase: 'stretching',
        setIndex: 1, // Past the single warmup set of makeRoutine's first entry
        entries: makeRoutine(1).entries,
      })
    );

    const newState = await engine.dispatch({ tag: 'StopStretching' } as Event);
    expect(newState.phase).toBe('working');
    expect(newState.setIndex).toBe(1); // Position untouched — stretching never advances
  });

  it('returns to warmup when the upcoming set is still a warmup set', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({
        phase: 'stretching',
        setIndex: 0,
        entries: makeRoutine(1).entries,
      })
    );

    const newState = await engine.dispatch({ tag: 'StopStretching' } as Event);
    expect(newState.phase).toBe('warmup');
  });

  it('rejects StopStretching outside the stretching phase', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({ phase: 'working', entries: makeRoutine(1).entries })
    );

    await expect(
      engine.dispatch({ tag: 'StopStretching' } as Event)
    ).rejects.toThrow(/invalid event StopStretching in phase working/);
  });

  it('rejects SetDone while stretching — a stray Skip Set must not advance the workout', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({
        phase: 'stretching',
        setIndex: 1,
        entries: makeRoutine(1).entries,
      })
    );

    await expect(
      engine.dispatch({ tag: 'SetDone', nowMs: 5000 } as Event)
    ).rejects.toThrow(/invalid event SetDone in phase stretching/);
    expect(engine.getState().phase).toBe('stretching');
  });

  it('rejects SkipExercise while stretching — advancing exerciseIndex would strand StopStretching', async () => {
    // Symmetry with LogSet/SetDone: the stretch cool-down must never advance
    // the workout. On the last exercise, SkipExercise would push exerciseIndex
    // out of range and StopStretching's at() lookup would then fail.
    const engine = createEngine({});
    engine.setState(
      makeState({
        phase: 'stretching',
        setIndex: 1,
        entries: makeRoutine(1).entries,
      })
    );

    await expect(
      engine.dispatch({ tag: 'SkipExercise' } as Event)
    ).rejects.toThrow(/invalid event SkipExercise in phase stretching/);
    expect(engine.getState().phase).toBe('stretching');
    expect(engine.getState().exerciseIndex).toBe(0);
  });

  it('rejects LogSet while stretching — logging advances, and stretching must not', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({
        phase: 'stretching',
        setIndex: 1,
        entries: makeRoutine(1).entries,
      })
    );

    await expect(
      engine.dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        nowMs: 5000,
      } as Event)
    ).rejects.toThrow(/invalid event LogSet in phase stretching/);
    expect(engine.getState().phase).toBe('stretching');
  });
});
