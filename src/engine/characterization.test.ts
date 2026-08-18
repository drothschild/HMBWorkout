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
 * nowMs (used by LogSet's merged advancement for rest-deadline math) defaults
 * to 0 for tests that don't assert on deadlines.
 */
type LogSetInput = Omit<Extract<Event, { tag: 'LogSet' }>, 'nowMs'> & { nowMs?: number };

function fillEventDefaults(event: LogSetInput | Event): Event {
  if (event.tag === 'LogSet') {
    return {
      ...event,
      reps: event.reps !== undefined ? event.reps : 0,
      weightKg: event.weightKg !== undefined ? event.weightKg : 0.0,
      durationSeconds: event.durationSeconds !== undefined ? event.durationSeconds : 0,
      rpe: event.rpe !== undefined ? event.rpe : -1.0, // Sentinel for absent RPE
      nowMs: event.nowMs !== undefined ? event.nowMs : 0,
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
 * Aggregate counts -> ordered set list. Mirrors the deleted setsFromCounts
 * (`src/engine/entrySets.ts`, removed in #276 Phase 6) so these count-shaped
 * fixtures keep their original behaviour under the required `sets` field.
 */
function countsToSets(counts: {
  warmupSets: number;
  targetSets: number;
  targetReps: number;
  targetDurationSeconds: number;
}): RoutineEntry['sets'] {
  const reps = counts.targetReps > 0 ? counts.targetReps : undefined;
  const durationSeconds = counts.targetDurationSeconds > 0 ? counts.targetDurationSeconds : undefined;
  const make = (setType: 'warmup' | 'normal') => ({ setType, reps, durationSeconds });
  return [
    ...Array.from({ length: Math.max(0, counts.warmupSets) }, () => make('warmup')),
    ...Array.from({ length: Math.max(0, counts.targetSets) }, () => make('normal')),
  ];
}

/**
 * Fixture: build a routine structure.
 */
function makeRoutine(exerciseCount = 1, overrides?: any): any {
  const entries: RoutineEntry[] = [];
  for (let i = 0; i < exerciseCount; i++) {
    const override = overrides?.[i] ?? {};
    const warmupSets = override.warmupSets ?? (i === 0 ? 1 : 0);
    const targetSets = override.targetSets ?? 1;
    const targetReps = override.targetReps ?? 8;
    const targetDurationSeconds = override.targetDurationSeconds ?? 0;
    const { warmupSets: _w, targetSets: _t, targetReps: _r, targetDurationSeconds: _d, ...rest } = override;
    entries.push({
      idx: i,
      exerciseId: `exercise-${i}`,
      kind: 'strength',
      restSeconds: 60,
      supersetGroup: '',
      sets: countsToSets({ warmupSets, targetSets, targetReps, targetDurationSeconds }),
      ...rest,
    });
  }
  return { id: 'routine-test', entries };
}

describe('characterization: session engine pre-migration behavior', () => {
  /**
   * C1: Full happy path with realistic fixtures
   * StartSession → warmup LogSet → working LogSet → final LogSet → done.
   * One-tap logging: each LogSet records the set and advances the position.
   */
  describe('C1: Full happy path (StartSession → warmups → working → done)', () => {
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

      // Step 2: LogSet (warmup, no RPE) — records and enters the between-sets rest
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 5,
          weightKg: 20.0,
          durationSeconds: 0,
          nowMs: 10000,
        })
      );
      expect(state.lastLoggedSet?.setType).toBe('warmup');
      expect(state.lastLoggedSet?.reps).toBe(5);
      expect(state.lastLoggedSet?.rpe).toBe(-1.0); // Sentinel: no RPE provided
      expect(executors.onPersistSet).toHaveBeenCalled();
      expect(state.phase).toBe('resting'); // Rest between sets of exercise 0
      expect(state.restDeadlineMs).toBe(10000 + 60 * 1000);

      state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 70000 });
      expect(state.phase).toBe('working');
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(1); // Preserved across the rest

      // Step 3: LogSet (working, with RPE) — final set of exercise 0, advances to exercise 1
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: 0,
          rpe: 7.5,
          nowMs: 75000,
        })
      );
      expect(state.lastLoggedSet?.setType).toBe('working');
      expect(state.lastLoggedSet?.rpe).toBe(7.5); // RPE provided
      expect(normalize(state).lastLoggedSet?.rpe).toBe(7.5); // Post-migration: still 7.5
      expect(state.phase).toBe('resting'); // Now resting before exercise 1
      expect(state.exerciseIndex).toBe(1);
      expect(state.setIndex).toBe(0);
      expect(state.restDeadlineMs).toBe(75000 + 60 * 1000); // nowMs + restSeconds*1000

      // Step 4: RestElapsed
      let restElapsedEvent: Event = { tag: 'RestElapsed', nowMs: 135000 };
      state = await engine.dispatch(restElapsedEvent);
      expect(state.phase).toBe('working');
      expect(state.restDeadlineMs).toBe(0);

      // Step 5: LogSet on exercise 1 — final set of the final exercise completes the workout
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: 0,
          rpe: 7.5,
          nowMs: 140000,
        })
      );
      expect(state.lastLoggedSet?.exerciseId).toBe('exercise-1');
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

      const event: LogSetInput = {
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

      const event: LogSetInput = {
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

    it('should append consecutive LogSets with varying RPE (each log advances)', async () => {
      const engine = createEngine({ onPersistSet: jest.fn() });
      const state = makeState({
        phase: 'warmup',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeRoutine(1, [{ warmupSets: 2, restSeconds: 0 }]).entries,
      });
      engine.setState(state);

      // First LogSet without RPE — advances to the second warmup set
      let currentState = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 5,
          weightKg: 20.0,
          durationSeconds: 0,
        })
      );
      expect(currentState.lastLoggedSet?.rpe).toBe(-1.0);
      expect(currentState.setIndex).toBe(1);

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
      expect(currentState.loggedSets).toHaveLength(2);
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

      const event: LogSetInput = {
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

      const event: LogSetInput = {
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

      const event: LogSetInput = {
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

    it('should reject RestElapsed where no rest could just have ended', async () => {
      // Amended post-migration: RestElapsed became benign in warmup/working — a
      // straggler countdown tick after a foreground reconcile recovered the
      // phase (see appForegrounded.test.ts) — so the rejection pin moved to a
      // phase where a rest cannot just have ended on its own.
      const engine = createEngine({});
      engine.setState(makeState({ phase: 'paused' }));

      await expect(
        engine.dispatch({ tag: 'RestElapsed', nowMs: 10000 })
      ).rejects.toThrow(/invalid event RestElapsed in phase paused/);
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

    it('should reject StartSession from each in-progress phase (warmup, working, resting, paused)', async () => {
      const inProgressPhases: ('warmup' | 'working' | 'resting' | 'paused')[] = [
        'warmup',
        'working',
        'resting',
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
   * C6: Superset routine
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

      // Uneven pair on purpose: A carries a warmup set B doesn't (A: 1 warmup
      // + 1 working = 2 total; B: 1 working = 1 total). advance_after_set
      // tracks each member's own exhaustion, so B is skipped once it's done
      // (round 1 onward) while A keeps round-robining with itself alone —
      // every prescribed set gets logged, none silently dropped.
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

      // LogSet A's warmup set → hop to B immediately (same round, no rest)
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 5,
          weightKg: 20.0,
          durationSeconds: 0,
          nowMs: 10000,
        })
      );
      expect(state.loggedSets[0].setType).toBe('warmup');
      expect(state.phase).toBe('working');
      expect(state.exerciseIndex).toBe(1);
      expect(state.supersetPosition).toBe(1);

      // LogSet B's only set (round 0, B's total) → B is now exhausted, so the
      // round loops back to A alone, with rest (B's restSeconds)
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: 0,
          rpe: 7.5,
          nowMs: 15000,
        })
      );
      expect(state.phase).toBe('resting');
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(1);
      expect(state.restDeadlineMs).toBe(15000 + 90 * 1000);

      state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 15000 + 91 * 1000 });
      // Round 1 for A is its working set (round 1 >= A's 1 warmup set)
      expect(state.phase).toBe('working');
      expect(state.exerciseIndex).toBe(0);

      // LogSet A's working set (its last) → B has no set left at round 1
      // either, so the whole group — and here, the whole workout — is done
      state = await engine.dispatch(
        fillEventDefaults({
          tag: 'LogSet',
          reps: 8,
          weightKg: 15.0,
          durationSeconds: 0,
          rpe: 8.0,
          nowMs: 110000,
        })
      );
      expect(state.phase).toBe('done');
      expect(state.loggedSets).toHaveLength(3); // A's 2 sets + B's 1 — nothing dropped
      expect(executors.onCompleteSession).toHaveBeenCalled();
    });

    it('should alternate every set, not exhaust one exercise before its partner', async () => {
      const engine = createEngine({ onScheduleRest: jest.fn() });

      // Two-member group, 3 sets each. A correct superset does A1,B1,rest,
      // A2,B2,rest,A3,B3 — never A1,A2,A3 followed by B1,B2,B3.
      const routine = makeRoutine(2, [
        { warmupSets: 0, targetSets: 3, supersetGroup: 'A', restSeconds: 60 },
        { warmupSets: 0, targetSets: 3, supersetGroup: 'A', restSeconds: 60 },
      ]);

      let state = await engine.dispatch({
        tag: 'StartSession',
        sessionId: 'alternate-test',
        nowMs: 0,
        routine: routine as any,
      });
      expect(state.exerciseIndex).toBe(0);

      // A1 → B1, immediately, no rest.
      state = await engine.dispatch(fillEventDefaults({ tag: 'SetDone', nowMs: 1000 }));
      expect(state.exerciseIndex).toBe(1);
      expect(state.setIndex).toBe(0);
      expect(state.phase).toBe('working');

      // B1 → rest, then back to A for round 2 (not B2 — the round is done).
      state = await engine.dispatch(fillEventDefaults({ tag: 'SetDone', nowMs: 2000 }));
      expect(state.phase).toBe('resting');
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(1);

      state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 62000 });
      expect(state.phase).toBe('working');
      expect(state.exerciseIndex).toBe(0);

      // A2 → B2, immediately, no rest.
      state = await engine.dispatch(fillEventDefaults({ tag: 'SetDone', nowMs: 63000 }));
      expect(state.exerciseIndex).toBe(1);
      expect(state.setIndex).toBe(1);
      expect(state.phase).toBe('working');

      // B2 → rest, then back to A for round 3.
      state = await engine.dispatch(fillEventDefaults({ tag: 'SetDone', nowMs: 64000 }));
      expect(state.phase).toBe('resting');
      expect(state.exerciseIndex).toBe(0);
      expect(state.setIndex).toBe(2);

      state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 124000 });
      expect(state.phase).toBe('working');

      // A3 → B3, immediately, no rest.
      state = await engine.dispatch(fillEventDefaults({ tag: 'SetDone', nowMs: 125000 }));
      expect(state.exerciseIndex).toBe(1);
      expect(state.setIndex).toBe(2);
      expect(state.phase).toBe('working');

      // B3 → workout complete (last set of the last exercise).
      state = await engine.dispatch(fillEventDefaults({ tag: 'SetDone', nowMs: 126000 }));
      expect(state.phase).toBe('done');
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
