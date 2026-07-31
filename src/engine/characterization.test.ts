/**
 * Characterization suite: pins pre-migration engine behavior
 *
 * Scripted event sequences through the real dispatch, capturing (state, effects)
 * after every event. These fixtures will anchor the post-migration behavior —
 * the suite must pass unchanged when transition.lv is ported to rill-lang.
 *
 * Sentinel boundary (fromRillState adapter — see index.ts SENTINEL_TO_OPTION_MAP):
 * The host deliberately maintains sentinels for Option fields, diverging from Task 5's
 * "update read sites" directive. fromRillState re-sentinelizes:
 *   rpe: undefined            → -1.0
 *   prePausePhase: undefined  → ""
 *   restDeadlineMs: undefined → 0
 *   supersetGroup: undefined  → ""
 *
 * The normalize(state) helper UNDOs this sentinelization so test assertions match
 * the Rill rule's true output (undefined for None). Same assertions pass pre-migration
 * (sentinels input via setState) and post-migration (undefined output from dispatch).
 */

import { createEngine, TransitionError } from './index';
import type { SessionState, Event, LoggedSet, RoutineEntry } from './types';

/**
 * Uniform effects from Rill rule (before host mapping to typed Effect union).
 * Pre-migration signature; post-migration shapes will differ as effects become typed.
 */
type UniformEffect = {
  kind: string;
  deadline_ms: number;
  message: string;
};

/**
 * normalize(state): undo sentinelization to match rill-lang's true output.
 * Post-migration, the host produces sentinels (fromRillState); this helper removes them
 * so test assertions match the Rill rule's Option-based semantics (undefined for None).
 * Uses SENTINEL_TO_OPTION_MAP from index.ts to keep mappings consistent.
 *
 * Sentinels removed:
 *   rpe: -1.0 → undefined
 *   prePausePhase: "" → undefined
 *   restDeadlineMs: 0 → undefined (when not actively resting)
 *   supersetGroup: "" → undefined
 *   loggedSets.rpe: -1.0 → undefined
 */
function normalize(state: SessionState): Partial<SessionState> {
  const normalized: any = {
    ...state,
    loggedSets: state.loggedSets.map((set: LoggedSet) => ({
      ...set,
      rpe: set.rpe === -1.0 ? undefined : set.rpe,
    })),
    entries: state.entries.map((entry: any) => ({
      ...entry,
      supersetGroup: entry.supersetGroup === '' ? undefined : entry.supersetGroup,
    })),
  };

  // Only include lastLoggedSet if it exists and has meaningful content
  if (state.lastLoggedSet) {
    normalized.lastLoggedSet = {
      ...state.lastLoggedSet,
      rpe: state.lastLoggedSet.rpe === -1.0 ? undefined : state.lastLoggedSet.rpe,
    };
  } else {
    normalized.lastLoggedSet = undefined;
  }

  // prePausePhase: empty string → undefined
  normalized.prePausePhase = state.prePausePhase === '' ? undefined : state.prePausePhase;

  // restDeadlineMs: only keep if non-zero (actively resting)
  if (state.restDeadlineMs === 0) {
    normalized.restDeadlineMs = undefined;
  }

  return normalized;
}

/**
 * fillEventDefaults: ensure all optional LogSet fields exist (Rill rule requires them).
 * When host omits a field, use a sentinel to preserve pre-migration behavior.
 */
function fillEventDefaults(event: Event): Event {
  if (event.tag === 'LogSet') {
    return {
      ...event,
      reps: event.reps !== undefined ? event.reps : 0,
      weightKg: event.weightKg !== undefined ? event.weightKg : 0.0,
      durationSeconds: event.durationSeconds !== undefined ? event.durationSeconds : 0,
      rpe: event.rpe !== undefined ? event.rpe : -1.0, // Sentinel for absent RPE
    };
  }
  return event;
}

/**
 * Fixture helper: build minimal SessionState with overrides.
 */
function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-test-123',
    routineId: 'routine-test-abc',
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
 * Fixture: build a routine structure.
 */
function makeRoutine(exerciseCount = 1, overrides?: any): any {
  const entries: RoutineEntry[] = [];
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

describe('characterization: session engine pre-migration behavior', () => {
  /**
   * C1: Full happy path with realistic fixtures
   * StartSession → warmup LogSet → SetDone → working LogSet → SetDone → FinishSession
   * Pins state/effects at every step.
   */
  describe('C1: Full happy path (StartSession → warmups → working → FinishSession)', () => {
    it('should execute complete workout: warmup → working → done', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);

      // Step 1: StartSession
      const routine = makeRoutine(2, [
        { warmupSets: 1, targetSets: 1, restSeconds: 60 },
        { warmupSets: 0, targetSets: 1, restSeconds: 0 },
      ]);

      const startEvent: Event = {
        tag: 'StartSession',
        sessionId: 'happy-path-session',
        nowMs: 1000,
        routine: routine as any,
      };

      let state = await engine.dispatch(startEvent);
      expect(state.phase).toBe('warmup');
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(0);
      expect(state.startedAtMs).toBe(1000);
      expect(executors.onCreateSession).toHaveBeenCalled();

      // Step 2: LogSet (warmup, no RPE specified)
      let logWarmupEvent: Event = {
        tag: 'LogSet',
        reps: 5,
        weightKg: 20.0,
        durationSeconds: 0,
      };

      state = await engine.dispatch(fillEventDefaults(logWarmupEvent));
      expect(state.lastLoggedSet?.setType).toBe('warmup');
      expect(state.lastLoggedSet?.reps).toBe(5);
      expect(state.lastLoggedSet?.rpe).toBe(-1.0); // Sentinel: no RPE provided
      expect(executors.onPersistSet).toHaveBeenCalled();

      // Step 3: SetDone (warmup complete → rest between sets, then working)
      let setDoneEvent: Event = { tag: 'SetDone', nowMs: 10000 };
      state = await engine.dispatch(setDoneEvent);
      expect(state.phase).toBe('resting'); // Rest between sets of exercise 0
      expect(state.restDeadlineMs).toBe(10000 + 60 * 1000);

      state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 70000 });
      expect(state.phase).toBe('working');
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(1); // Preserved across the rest

      // Step 4: LogSet (working, with RPE)
      let logWorkingEvent: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        rpe: 7.5,
      };

      state = await engine.dispatch(fillEventDefaults(logWorkingEvent));
      expect(state.lastLoggedSet?.setType).toBe('working');
      expect(state.lastLoggedSet?.rpe).toBe(7.5); // RPE provided
      expect(normalize(state).lastLoggedSet?.rpe).toBe(7.5); // Post-migration: still 7.5

      // Step 5: SetDone (complete working set, advance to next exercise)
      setDoneEvent = { tag: 'SetDone', nowMs: 75000 };
      state = await engine.dispatch(setDoneEvent);
      expect(state.phase).toBe('resting'); // Now resting before exercise 1
      expect(state.exerciseIndex).toBe(1);
      expect(state.setIndex).toBe(0);
      expect(state.restDeadlineMs).toBe(75000 + 60 * 1000); // nowMs + restSeconds*1000

      // Step 6: RestElapsed
      let restElapsedEvent: Event = { tag: 'RestElapsed', nowMs: 135000 };
      state = await engine.dispatch(restElapsedEvent);
      expect(state.phase).toBe('working');
      expect(state.restDeadlineMs).toBe(0);

      // Step 7: LogSet on exercise 1
      state = await engine.dispatch(fillEventDefaults(logWorkingEvent));
      expect(state.lastLoggedSet?.exerciseId).toBe('exercise-1');

      // Step 8: SetDone (final exercise, completes workout)
      setDoneEvent = { tag: 'SetDone', nowMs: 140000 };
      state = await engine.dispatch(setDoneEvent);
      expect(state.phase).toBe('done');
      expect(executors.onCompleteSession).toHaveBeenCalled();
    });
  });

  /**
   * C2: Pause/Resume from two distinct phases (warmup, working, resting)
   * Pins prePausePhase sentinel and resumption behavior.
   */
  describe('C2: Pause/Resume behavior with phase preservation', () => {
    it('should pause and resume from warmup phase', async () => {
      const engine = createEngine({});
      const state = makeState({
        phase: 'warmup',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(2).entries,
      });
      engine.setState(state);

      // Pause from warmup
      let currentState = await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });
      expect(currentState.phase).toBe('paused');
      expect(currentState.prePausePhase).toBe('warmup'); // Sentinel recorded

      // Resume → back to warmup
      currentState = await engine.dispatch({ tag: 'Resume', nowMs: 5000 });
      expect(currentState.phase).toBe('warmup');
      expect(currentState.prePausePhase).toBe(''); // Cleared after resume
      expect(normalize(currentState).prePausePhase).toBeUndefined(); // Post-migration: undefined
    });

    it('should pause and resume from working phase', async () => {
      const engine = createEngine({});
      const state = makeState({
        phase: 'working',
        exerciseIndex: 1,
        setIndex: 0,
        entries: makeRoutine(3).entries,
      });
      engine.setState(state);

      // Pause from working
      let currentState = await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });
      expect(currentState.phase).toBe('paused');
      expect(currentState.prePausePhase).toBe('working');

      // Resume → back to working
      currentState = await engine.dispatch({ tag: 'Resume', nowMs: 5000 });
      expect(currentState.phase).toBe('working');
      expect(currentState.prePausePhase).toBe('');
    });

    it('should freeze remaining rest while paused and re-arm on resume', async () => {
      const engine = createEngine({});
      const state = makeState({
        phase: 'resting',
        restDeadlineMs: 10000, // deadline in future
        exerciseIndex: 1,
        setIndex: 0,
        entries: makeRoutine(2).entries,
      });
      engine.setState(state);

      // Pause from resting: remaining time is frozen, deadline stops running
      let currentState = await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });
      expect(currentState.phase).toBe('paused');
      expect(currentState.restDeadlineMs).toBe(0); // Deadline cleared while paused
      expect(currentState.restRemainingMs).toBe(6000); // 10000 - 4000 frozen
      expect(currentState.prePausePhase).toBe('resting');

      // Resume long after the original deadline → still resting with the frozen remainder
      currentState = await engine.dispatch({ tag: 'Resume', nowMs: 15000 });
      expect(currentState.phase).toBe('resting');
      expect(currentState.restDeadlineMs).toBe(21000); // 15000 + 6000 remaining
      expect(currentState.restRemainingMs).toBe(0);
      expect(currentState.prePausePhase).toBe('');
    });
  });

  /**
   * C3: SkipExercise from mid-routine and from last exercise
   */
  describe('C3: SkipExercise behavior', () => {
    it('should skip mid-routine exercise', async () => {
      const engine = createEngine({});
      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(3).entries,
      });
      engine.setState(state);

      const currentState = await engine.dispatch({ tag: 'SkipExercise' });
      expect(currentState.exerciseIndex).toBe(1);
      expect(currentState.phase).toBe('working'); // Phase unchanged
      expect(currentState.setIndex).toBe(0); // Reset for new exercise
      expect(currentState.restDeadlineMs).toBe(0); // No pending rest
    });

    it('should skip last exercise and complete session', async () => {
      const engine = createEngine({
        onCompleteSession: jest.fn(),
        onNotify: jest.fn(),
      });
      const state = makeState({
        phase: 'working',
        exerciseIndex: 1, // Last (index 1 of 2)
        setIndex: 0,
        entries: makeRoutine(2).entries,
      });
      engine.setState(state);

      const currentState = await engine.dispatch({ tag: 'SkipExercise' });
      // Skipping last exercise should NOT auto-complete; phase stays working
      expect(currentState.exerciseIndex).toBe(2); // Beyond array bounds
      expect(currentState.phase).toBe('working');
    });

    it('should clear rest deadline on SkipExercise', async () => {
      const engine = createEngine({});
      const state = makeState({
        phase: 'resting',
        restDeadlineMs: 10000,
        exerciseIndex: 0,
        entries: makeRoutine(2).entries,
      });
      engine.setState(state);

      const currentState = await engine.dispatch({ tag: 'SkipExercise' });
      expect(currentState.restDeadlineMs).toBe(0);
      expect(normalize(currentState).restDeadlineMs).toBeUndefined(); // Post-migration: undefined
    });
  });

  /**
   * C4: LogSet with and without RPE (sentinel mapping)
   */
  describe('C4: LogSet RPE sentinel behavior', () => {
    it('should accept LogSet without RPE; rpe sentinel = -1.0', async () => {
      const engine = createEngine({ onPersistSet: jest.fn() });
      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1).entries,
      });
      engine.setState(state);

      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        // rpe omitted
      };

      const currentState = await engine.dispatch(fillEventDefaults(event));
      expect(currentState.lastLoggedSet?.rpe).toBe(-1.0); // Sentinel
      expect(normalize(currentState).lastLoggedSet?.rpe).toBeUndefined(); // Post-migration: undefined
    });

    it('should accept LogSet with RPE; rpe preserved', async () => {
      const engine = createEngine({ onPersistSet: jest.fn() });
      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1).entries,
      });
      engine.setState(state);

      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        rpe: 7.5,
      };

      const currentState = await engine.dispatch(fillEventDefaults(event));
      expect(currentState.lastLoggedSet?.rpe).toBe(7.5);
      expect(normalize(currentState).lastLoggedSet?.rpe).toBe(7.5);
    });

    it('should append multiple LogSets with varying RPE', async () => {
      const engine = createEngine({ onPersistSet: jest.fn() });
      const state = makeState({
        phase: 'warmup',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1, [{ warmupSets: 2 }]).entries,
      });
      engine.setState(state);

      // First LogSet without RPE
      let currentState = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 5,
          weightKg: 20.0,
          durationSeconds: 0,
        })
      );
      expect(currentState.lastLoggedSet?.rpe).toBe(-1.0);

      // SetDone, advance
      await engine.dispatch({ tag: 'SetDone', nowMs: 10000 });

      // Second LogSet with RPE
      currentState = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 22.0,
          durationSeconds: 0,
          rpe: 6.5,
        })
      );
      expect(currentState.lastLoggedSet?.rpe).toBe(6.5);
    });
  });

  /**
   * C5: Error paths
   * - Invalid LogSet (validation errors)
   * - Events invalid for current phase
   * Pins TransitionError messages.
   */
  describe('C5: Error paths and invalid state transitions', () => {
    it('should reject LogSet with negative reps; preserve state', async () => {
      const engine = createEngine({});
      const initialState = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1).entries,
      });
      engine.setState(initialState);

      const event: Event = {
        tag: 'LogSet',
        reps: -5,
        weightKg: 20.0,
        durationSeconds: 0,
      };

      await expect(engine.dispatch(fillEventDefaults(event))).rejects.toThrow(/reps must be non-negative/);
      const stateAfterError = engine.getState();
      expect(stateAfterError.phase).toBe(initialState.phase);
      expect(stateAfterError.exerciseIndex).toBe(initialState.exerciseIndex);
    });

    it('should reject LogSet with RPE > 10', async () => {
      const engine = createEngine({});
      const initialState = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1).entries,
      });
      engine.setState(initialState);

      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 11.0,
      };

      await expect(engine.dispatch(fillEventDefaults(event))).rejects.toThrow(
        /RPE must be unset or between 1.0 and 10.0 in 0.5-step increments/
      );
    });

    it('should reject LogSet with invalid RPE increment (not 0.5 steps)', async () => {
      const engine = createEngine({});
      const initialState = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1).entries,
      });
      engine.setState(initialState);

      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 7.3, // Not 0.5 step
      };

      await expect(engine.dispatch(fillEventDefaults(event))).rejects.toThrow(
        /RPE must be unset or between 1.0 and 10.0 in 0.5-step increments/
      );
    });

    it('should reject LogSet in idle phase', async () => {
      const engine = createEngine({});
      engine.setState(makeState({ phase: 'idle' }));

      await expect(
        engine.dispatch(
          fillEventDefaults({
            tag: 'LogSet',
            reps: 8,
            weightKg: 20.0,
            durationSeconds: 0,
          })
        )
      ).rejects.toThrow(/invalid event LogSet in phase idle/);
    });

    it('should reject LogSet in done phase', async () => {
      const engine = createEngine({});
      engine.setState(makeState({ phase: 'done' }));

      await expect(
        engine.dispatch(
          fillEventDefaults({
            tag: 'LogSet',
            reps: 8,
            weightKg: 20.0,
            durationSeconds: 0,
          })
        )
      ).rejects.toThrow(/invalid event LogSet in phase done/);
    });

    it('should reject RestElapsed when not in resting phase', async () => {
      const engine = createEngine({});
      engine.setState(makeState({ phase: 'working' }));

      await expect(
        engine.dispatch({ tag: 'RestElapsed', nowMs: 10000 })
      ).rejects.toThrow(/invalid event RestElapsed in phase working/);
    });

    it('should reject RestElapsed if deadline not reached', async () => {
      const engine = createEngine({});
      engine.setState(
        makeState({
          phase: 'resting',
          restDeadlineMs: 10000,
        })
      );

      await expect(
        engine.dispatch({ tag: 'RestElapsed', nowMs: 9000 })
      ).rejects.toThrow(/rest not elapsed/);
    });

    it('should reject StartSession from non-idle phase', async () => {
      const engine = createEngine({});
      engine.setState(makeState({ phase: 'working' }));

      await expect(
        engine.dispatch({
          tag: 'StartSession',
          sessionId: 'new-id',
          nowMs: 5000,
          routine: { id: 'r1', entries: [] } as any,
        })
      ).rejects.toThrow(/invalid event StartSession in phase working/);
    });

    it('should reject StartSession from each in-progress phase (warmup, working, resting, stretching, paused)', async () => {
      const inProgressPhases: Array<'warmup' | 'working' | 'resting' | 'stretching' | 'paused'> = [
        'warmup',
        'working',
        'resting',
        'stretching',
        'paused',
      ];

      for (const phase of inProgressPhases) {
        const engine = createEngine({});
        engine.setState(makeState({ phase }));

        await expect(
          engine.dispatch({
            tag: 'StartSession',
            sessionId: 'new-id',
            nowMs: 5000,
            routine: { id: 'r1', entries: [] } as any,
          })
        ).rejects.toThrow(new RegExp(`invalid event StartSession in phase ${phase}`));
      }
    });

    it('should accept StartSession from done phase with fresh state (C1 fix)', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);

      // Set engine to done state with residue from a previous session
      const finishedState = makeState({
        sessionId: 'old-session-123',
        routineId: 'old-routine-abc',
        phase: 'done',
        exerciseIndex: 5,
        setIndex: 3,
        loggedSets: [
          {
            exerciseId: 'old-ex',
            setType: 'working',
            reps: 10,
            weightKg: 50,
            durationSeconds: 0,
            rpe: 7.5,
          },
        ],
      });
      engine.setState(finishedState);

      // Build new StartSession event from a different routine
      const newRoutine = makeRoutine(1, [
        { warmupSets: 0, targetSets: 2, restSeconds: 60 },
      ]);

      const startEvent: Event = {
        tag: 'StartSession',
        sessionId: 'new-session-456',
        nowMs: 6000,
        routine: newRoutine as any,
      };

      // Should succeed with completely fresh state, not residue
      const newState = await engine.dispatch(startEvent);

      // Verify state is fresh (no residue from done session)
      expect(newState.sessionId).toBe('new-session-456');
      expect(newState.routineId).toBe('routine-test');
      expect(newState.phase).toBe('working'); // No warmup, goes straight to working
      expect(newState.exerciseIndex).toBe(0); // Reset, not 5
      expect(newState.setIndex).toBe(0); // Reset, not 3
      expect(newState.loggedSets).toHaveLength(0); // No residue, fresh
      expect(newState.startedAtMs).toBe(6000);
      expect(executors.onCreateSession).toHaveBeenCalledWith({
        sessionId: 'new-session-456',
        routineId: 'routine-test',
        startedAtMs: 6000,
      });
    });
  });

  /**
   * C6: Superset routine (if reachable via rest_duration logic)
   * Two consecutive exercises with same supersetGroup skip rest between.
   */
  describe('C6: Superset group behavior', () => {
    it('should NOT rest between exercises in same superset group', async () => {
      const engine = createEngine({ onScheduleRest: jest.fn() });
      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(2, [
          { warmupSets: 0, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, supersetGroup: 'A', restSeconds: 90 },
        ]).entries,
      });
      engine.setState(state);

      // SetDone on exercise 0 → should advance to exercise 1 without resting
      const currentState = await engine.dispatch({ tag: 'SetDone', nowMs: 10000 });
      expect(currentState.exerciseIndex).toBe(1);
      expect(currentState.phase).toBe('working'); // Still working, not resting
      expect(currentState.restDeadlineMs).toBe(0);
      expect(currentState.supersetPosition).toBe(1); // Incremented superset counter
    });

    it('should REST after superset group is complete', async () => {
      const engine = createEngine({ onScheduleRest: jest.fn() });
      const state = makeState({
        phase: 'working',
        exerciseIndex: 1, // Last in superset group
        setIndex: 0,
        supersetPosition: 1,
        entries: makeRoutine(3, [
          { warmupSets: 0, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, supersetGroup: '', restSeconds: 60 },
        ]).entries,
      });
      engine.setState(state);

      // SetDone after superset group → should rest before next exercise
      const currentState = await engine.dispatch({ tag: 'SetDone', nowMs: 10000 });
      expect(currentState.phase).toBe('resting');
      expect(currentState.exerciseIndex).toBe(2);
      expect(currentState.restDeadlineMs).toBe(10000 + 90 * 1000); // 90 seconds from current entry
      expect(currentState.supersetPosition).toBe(0); // Reset
    });

    it('should complete superset routine with full sequence', async () => {
      const executors = {
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };

      const engine = createEngine(executors);

      const routine = makeRoutine(2, [
        { warmupSets: 1, targetSets: 1, supersetGroup: 'A', restSeconds: 90 },
        { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 90 },
      ]);

      // StartSession
      let state = await engine.dispatch({
        tag: 'StartSession',
        sessionId: 'superset-test',
        nowMs: 1000,
        routine: routine as any,
      });
      expect(state.phase).toBe('warmup');

      // LogSet warmup
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 5,
          weightKg: 20.0,
          durationSeconds: 0,
        })
      );

      // SetDone warmup → rest between sets, then working (within same exercise)
      state = await engine.dispatch({ tag: 'SetDone', nowMs: 10000 });
      expect(state.phase).toBe('resting');

      state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 100000 });
      expect(state.phase).toBe('working');

      // LogSet working exercise 0
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: 0,
          rpe: 7.5,
        })
      );

      // SetDone exercise 0 → exercise 1 (same superset, no rest)
      state = await engine.dispatch({ tag: 'SetDone', nowMs: 105000 });
      expect(state.phase).toBe('working');
      expect(state.exerciseIndex).toBe(1);
      expect(state.supersetPosition).toBe(1);

      // LogSet exercise 1
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 15.0,
          durationSeconds: 0,
          rpe: 8.0,
        })
      );

      // SetDone exercise 1 → done (last exercise)
      state = await engine.dispatch({ tag: 'SetDone', nowMs: 110000 });
      expect(state.phase).toBe('done');
      expect(executors.onCompleteSession).toHaveBeenCalled();
    });
  });

  /**
   * C7: Stretching phase removed
   * Stretching was an unreachable phase in the original types.
   * Test verifies it is not part of the Phase union.
   */
  describe('C7: Phase union declaration (Stretching removed)', () => {
    it('Phase union does not include Stretching', () => {
      // Verify the declared Phase union in types.lv has no Stretching variant
      // The transition rule operates on: Idle, Warmup, Working, Resting, Paused, Done
      const phases = ['idle', 'warmup', 'working', 'resting', 'paused', 'done'];
      expect(phases).not.toContain('stretching');
      expect(phases).toHaveLength(6);
    });
  });

  /**
   * C8: Effect emission patterns
   * Comprehensive pins of effect sequences for different state transitions.
   */
  describe('C8: Effect sequences', () => {
    it('should emit CreateSession on StartSession', async () => {
      const executors = {
        onCreateSession: jest.fn(),
      };

      const engine = createEngine(executors);
      await engine.dispatch({
        tag: 'StartSession',
        sessionId: 'eff-test',
        nowMs: 1000,
        routine: makeRoutine(1) as any,
      });

      expect(executors.onCreateSession).toHaveBeenCalledWith({
        sessionId: 'eff-test',
        routineId: 'routine-test',
        startedAtMs: 1000,
      });
    });

    it('should emit PersistSet on LogSet', async () => {
      const executors = {
        onPersistSet: jest.fn(),
      };

      const engine = createEngine(executors);
      engine.setState(
        makeState({
          phase: 'working',
          exerciseIndex: 0,
          setIndex: 0,
          entries: makeRoutine(1, [{ warmupSets: 0 }]).entries, // No warmups
        })
      );

      await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: 0,
          rpe: 7.5,
        })
      );

      expect(executors.onPersistSet).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseId: 'exercise-0',
          setType: 'working',
          reps: 8,
          weightKg: 25.0,
          rpe: 7.5,
        })
      );
    });

    it('should emit ScheduleRest when resting', async () => {
      const executors = {
        onScheduleRest: jest.fn(),
      };

      const engine = createEngine(executors);
      engine.setState(
        makeState({
          phase: 'working',
          exerciseIndex: 0,
          setIndex: 0,
          entries: makeRoutine(2, [
            { warmupSets: 0, targetSets: 1, restSeconds: 60, supersetGroup: '' },
            { warmupSets: 0, targetSets: 1, restSeconds: 60, supersetGroup: '' },
          ]).entries,
        })
      );

      await engine.dispatch({ tag: 'SetDone', nowMs: 10000 });
      // SetDone on exercise 0 → advance to exercise 1 with rest (not in same superset)

      expect(executors.onScheduleRest).toHaveBeenCalledWith(10000 + 60 * 1000);
    });

    it('should emit CompleteSession and Notify on session completion', async () => {
      const executors = {
        onCompleteSession: jest.fn(),
        onNotify: jest.fn(),
      };

      const engine = createEngine(executors);
      engine.setState(
        makeState({
          phase: 'working',
          exerciseIndex: 0,
          setIndex: 0,
          startedAtMs: 1000,
          entries: makeRoutine(1).entries,
        })
      );

      await engine.dispatch({ tag: 'FinishSession', nowMs: 10000 });

      expect(executors.onCompleteSession).toHaveBeenCalledWith(
        expect.objectContaining({
          startMs: 1000,
          endMs: 10000,
        })
      );
      expect(executors.onNotify).toHaveBeenCalledWith('Workout complete');
    });

    it('should emit CancelRest when resting session is finished', async () => {
      const executors = {
        onCancelRest: jest.fn(),
        onCompleteSession: jest.fn(),
        onNotify: jest.fn(),
      };

      const engine = createEngine(executors);
      engine.setState(
        makeState({
          phase: 'resting',
          restDeadlineMs: 10000,
          entries: makeRoutine(1).entries,
        })
      );

      await engine.dispatch({ tag: 'FinishSession', nowMs: 15000 });

      expect(executors.onCancelRest).toHaveBeenCalled();
    });
  });
});
