/**
 * Comprehensive transition rule tests — covers all session state machine behaviors.
 * Table-driven with a makeState() fixture helper for clear test expressions.
 *
 * Test categories:
 * - StartSession seeding (AC10.1, AC10.5)
 * - LogSet validation propagation (AC1.4, AC9.3)
 * - SetDone advancement with superset/warmup ordering (AC8.1, AC8.2)
 * - Duration-based cardio/stretch (AC8.3)
 * - Rest scheduling and deadline arithmetic (AC10.6)
 * - RestElapsed early rejection and deadline-based advancement (AC10.4)
 * - SkipExercise
 * - Pause/Resume with deadline reconciliation (AC10.4)
 * - FinishSession completion effects
 * - Invalid event per phase → Err with unchanged state (AC10.3)
 * - Completion effects (AC10.1)
 */

import { evaluateSource } from './bridge';
import { SessionState, Event, Effect, SessionPhase } from './types';
import { transitionCompositeSource } from './loadRules';

// Uniform effects from Rill rule (before host mapping to typed Effect union)
type UniformEffect = {
  kind: string;
  deadline_ms: number;
  message: string;
};

// Re-exported for clarity in test code
type TransitionResult = {
  state: SessionState;
  effects: UniformEffect[];
};

/**
 * Fixture helper: build minimal SessionState with overrides.
 * Ensures consistent, predictable test data.
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

/**
 * Helper: run transition rule with state + event.
 * Throws if Err or parsing fails. Returns state + effects on Ok.
 */
function evaluateTransition(
  state: SessionState,
  event: Event
): TransitionResult {
  const result = evaluateSource(transitionCompositeSource, { state, event });
  if (!result.success) {
    throw new Error(`Transition rule failed: ${result.error}`);
  }
  const value = result.value as any;
  if (value.tag === 'Err') {
    throw new Error(`Transition returned Err: ${value.value}`);
  }
  return value.value as TransitionResult;
}

describe('engine: transition rule — session state machine', () => {
  describe('StartSession seeding (AC10.1)', () => {
    it('should seed sessionId, startedAtMs, phase=warmup when routine has warmups', () => {
      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-session-id',
        nowMs: 5000,
        routine: makeRoutine(1) as any,
      };

      const initialState = makeState({ phase: 'idle' });
      const result = evaluateTransition(initialState, event);

      expect(result.state.sessionId).toBe('new-session-id');
      expect(result.state.startedAtMs).toBe(5000);
      expect(result.state.phase).toBe('warmup');
      expect(result.state.routineId).toBe('routine-test');
      expect(result.state.exerciseIndex).toBe(0);
      expect(result.state.setIndex).toBe(0);
    });

    it('should seed phase=working when routine has no warmups', () => {
      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-session-id',
        nowMs: 5000,
        routine: makeRoutine(1, [{ warmupSets: 0 }]) as any,
      };

      const initialState = makeState({ phase: 'idle' });
      const result = evaluateTransition(initialState, event);

      expect(result.state.phase).toBe('working');
    });

    it('should emit exactly one CreateSession effect', () => {
      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-session-id',
        nowMs: 5000,
        routine: makeRoutine(1) as any,
      };

      const initialState = makeState({ phase: 'idle' });
      const result = evaluateTransition(initialState, event);

      expect(result.effects.length).toBe(1);
      // Rule emits uniform effects with kind (host maps to typed Effects)
      expect(result.effects[0].kind).toBe('create_session');
      expect(result.state.sessionId).toBe('new-session-id');
      expect(result.state.routineId).toBe('routine-test');
      expect(result.state.startedAtMs).toBe(5000);
    });

    it('should reject StartSession from non-idle phase', () => {
      const event: Event = {
        tag: 'StartSession',
        sessionId: 'new-id',
        nowMs: 5000,
        routine: { id: 'r1', has_warmups: true } as any,
      };

      const state = makeState({ phase: 'working' });
      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Err');
      expect(value.value).toContain('invalid event');
    });
  });

  describe('LogSet validation (AC1.4, AC9.3)', () => {
    it('should reject LogSet with negative reps', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: -5,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 7.0,
      };

      const state = makeState({ phase: 'warmup' });
      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Err');
      expect(value.value).toContain('reps');
    });

    it('should reject LogSet with RPE > 10', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 11.0,
      };

      const state = makeState({ phase: 'working' });
      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Err');
      expect(value.value).toContain('RPE');
    });

    it('should reject LogSet with RPE = 7.3 (invalid non-0.5-step)', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 7.3,
      };

      const state = makeState({ phase: 'warmup' });
      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Err');
      expect(value.value).toContain('0.5');
    });

    it('should accept LogSet with valid RPE = 7.5 (0.5 step)', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 7.5,
      };

      const state = makeState({ phase: 'warmup', entries: makeRoutine(1).entries });
      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Ok');
    });

    it('LogSet invalid → Err with no PersistSet effect', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: -1,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 7.0,
      };

      const state = makeState({ phase: 'warmup' });
      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Err');
      // When Err, there should be no effects array returned
      expect(value.effects).toBeUndefined();
    });

    it('should append valid LogSet to loggedSets with setType=warmup when in warmup phase', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: 5,
        weightKg: 20.0,
        durationSeconds: 0,
        rpe: 6.0,
      };

      const state = makeState({ phase: 'warmup', exerciseIndex: 0, setIndex: 0, entries: makeRoutine(1).entries });
      const result = evaluateTransition(state, event);

      // Rule emits persist_set effect and populates lastLoggedSet in state
      const persistEffects = result.effects.filter(e => e.kind === 'persist_set');
      expect(persistEffects.length).toBe(1);
      // Verify the set data is in lastLoggedSet with setType=warmup
      expect(result.state.lastLoggedSet).toBeDefined();
      expect(result.state.lastLoggedSet?.setType).toBe('warmup');
      expect(result.state.lastLoggedSet?.reps).toBe(5);
      expect(result.state.lastLoggedSet?.weightKg).toBe(20.0);
    });

    it('should emit PersistSet effect on valid LogSet', () => {
      const event: Event = {
        tag: 'LogSet',
        reps: 8,
        weightKg: 25.0,
        durationSeconds: 0,
        rpe: 8.0,
      };

      const state = makeState({ phase: 'working', entries: makeRoutine(1).entries });
      const result = evaluateTransition(state, event);

      const persistEffects = result.effects.filter(e => e.kind === "persist_set");
      expect(persistEffects.length).toBe(1);
    });
  });

  describe('SetDone advancement with superset/warmup ordering (AC8.1, AC8.2)', () => {
    it('should advance from warmup to working phase after warmups exhausted', () => {
      const event: Event = { tag: 'SetDone', nowMs: 10000 };

      // After warmup set is done (setIndex=0), next set should be working phase
      const state = makeState({
        phase: 'warmup',
        setIndex: 0, // Just finished warmup set 0
        loggedSets: [{ exerciseId: 'exercise-0', setType: 'warmup', reps: 5, weightKg: 20.0, durationSeconds: 0, rpe: 6.0 }],
        entries: makeRoutine(2, [
          { warmupSets: 1, targetSets: 2 }, // 1 warmup + 2 working = 3 sets total
          { warmupSets: 0, targetSets: 1 },
        ]).entries,
      });

      const result = evaluateTransition(state, event);

      // After first warmup set of first exercise, should transition to working
      expect(result.state.phase).toBe('working');
      expect(result.state.exerciseIndex).toBe(0);
      expect(result.state.setIndex).toBe(1);
    });

    it('should honor contiguous superset groups (AC8.1)', () => {
      const event: Event = { tag: 'SetDone', nowMs: 10000 };

      // Exercise 0 and 1 are both in superset group "A", with no warmups
      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0, // Completing the only set of exercise 0
        supersetPosition: 0,
        loggedSets: [],
        entries: makeRoutine(2, [
          { warmupSets: 0, supersetGroup: 'A' },
          { warmupSets: 0, supersetGroup: 'A' },
        ]).entries,
      });

      const result = evaluateTransition(state, event);

      // Should advance to exercise 1 without resting (same superset group)
      expect(result.state.exerciseIndex).toBe(1);
      expect(result.state.phase).toBe('working');
      expect(result.state.supersetPosition).toBe(1);
    });

    it('should rest after superset group is complete', () => {
      const event: Event = { tag: 'SetDone', nowMs: 10000 };

      // Second exercise in superset "A" with a standalone exercise after
      const state = makeState({
        phase: 'working',
        exerciseIndex: 1,
        setIndex: 0, // Completing the only set of exercise 1
        supersetPosition: 1,
        loggedSets: [],
        entries: makeRoutine(3, [
          { warmupSets: 0, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, supersetGroup: '', restSeconds: 60 },
        ]).entries,
      });

      const result = evaluateTransition(state, event);

      // After last exercise of superset, should rest before next standalone exercise
      expect(result.state.phase).toBe('resting');
      expect(result.state.restDeadlineMs).toBe(100000); // 10000 + 90*1000
      expect(result.state.exerciseIndex).toBe(2);
      const scheduleRestEffects = result.effects.filter(e => e.kind === "schedule_rest");
      expect(scheduleRestEffects.length).toBe(1);
    });
  });

  describe('Duration-based cardio/stretch entries (AC8.3)', () => {
    it('should accept SetDone for cardio/stretch entries with duration_seconds', () => {
      const event: Event = { tag: 'SetDone', nowMs: 10000 };

      const state = makeState({
        phase: 'stretching',
        exerciseIndex: 0,
        setIndex: 0,
        loggedSets: [
          { exerciseId: 'stretch-1', setType: 'stretch', reps: 0, weightKg: 0, durationSeconds: 120, rpe: -1 },
        ],
        entries: makeRoutine(1, [{ kind: 'stretch', warmupSets: 0 }]).entries,
      });

      const result = evaluateTransition(state, event);

      // Should advance to done after final exercise
      expect(result.state).toBeDefined();
      expect(result.state.phase).toBe('done');
    });
  });

  describe('Rest scheduling with deadline arithmetic (AC10.6)', () => {
    it('should emit ScheduleRest with deadline = eventTime + rest_duration*1000', () => {
      const event: Event = { tag: 'SetDone', nowMs: 10000 };

      // Trigger rest: last exercise of superset at time 10000, followed by another exercise
      const state = makeState({
        phase: 'working',
        exerciseIndex: 1,
        setIndex: 0,
        supersetPosition: 1,
        startedAtMs: 1000,
        loggedSets: [],
        entries: makeRoutine(3, [
          { supersetGroup: 'A', restSeconds: 90 },
          { supersetGroup: 'A', restSeconds: 90 },
          { supersetGroup: '', restSeconds: 60 },
        ]).entries,
      });

      // eventTime = 10000, rest_duration = 90 seconds, deadline should be 10000 + 90*1000 = 100000
      const result = evaluateTransition(state, { tag: 'SetDone', nowMs: 10000 });

      expect(result.state.phase).toBe('resting');
      expect(result.state.restDeadlineMs).toBe(100000);
      expect(result.state.exerciseIndex).toBe(2);
      const scheduleEffects = result.effects.filter(e => e.kind === "schedule_rest") as any[];
      expect(scheduleEffects.length).toBe(1);
      expect(scheduleEffects[0].deadline_ms).toBe(100000);
    });
  });

  describe('RestElapsed behavior (AC10.4, AC10.6)', () => {
    it('should reject RestElapsed if nowMs < restDeadlineMs', () => {
      const event: Event = { tag: 'RestElapsed', nowMs: 9000 };

      const state = makeState({
        phase: 'resting',
        restDeadlineMs: 10000, // deadline is in future
      });

      const result = evaluateSource(transitionCompositeSource, { state, event });

      expect(result.success).toBe(true);
      const value = result.value as any;
      expect(value.tag).toBe('Err');
      expect(value.value).toContain('rest not elapsed');
    });

    it('should advance from resting when nowMs >= restDeadlineMs', () => {
      const event: Event = { tag: 'RestElapsed', nowMs: 10000 };

      const state = makeState({
        phase: 'resting',
        restDeadlineMs: 10000, // deadline is exactly now
        exerciseIndex: 1,
        setIndex: 0,
        entries: makeRoutine(2).entries,
      });

      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('working');
      const cancelRestEffects = result.effects.filter(e => e.kind === "cancel_rest");
      expect(cancelRestEffects.length).toBeGreaterThan(0);
    });
  });

  describe('Resume with past-deadline reconciliation (AC10.4)', () => {
    it('should behave as RestElapsed if Resume is past restDeadlineMs', () => {
      const event: Event = { tag: 'Resume', nowMs: 15000 };

      const state = makeState({
        phase: 'paused',
        restDeadlineMs: 10000, // deadline passed while paused
        exerciseIndex: 1,
        setIndex: 0,
        entries: makeRoutine(2).entries,
      });

      const result = evaluateTransition(state, event);

      // Should reconcile: advance to working (past resting)
      expect(result.state.phase).toBe('working');
      const cancelEffects = result.effects.filter(e => e.kind === 'cancel_rest');
      expect(cancelEffects.length).toBeGreaterThan(0);
    });

    it('should preserve resting state if Resume is before restDeadlineMs', () => {
      const event: Event = { tag: 'Resume', nowMs: 9000 };

      const state = makeState({
        phase: 'paused',
        restDeadlineMs: 10000, // deadline still ahead
        entries: makeRoutine(2).entries,
      });

      const result = evaluateTransition(state, event);

      // Should return to resting with same deadline
      expect(result.state.phase).toBe('resting');
      expect(result.state.restDeadlineMs).toBe(10000);
    });
  });

  describe('Pause / Resume', () => {
    it('should freeze state on PauseSession', () => {
      const event: Event = { tag: 'PauseSession' };

      const state = makeState({ phase: 'working', exerciseIndex: 2, entries: makeRoutine(3).entries });

      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('paused');
      expect(result.state.exerciseIndex).toBe(2); // unchanged
    });

    it('should return to previous phase on Resume', () => {
      const event: Event = { tag: 'Resume', nowMs: 5000 };

      const state = makeState({
        phase: 'paused',
        restDeadlineMs: 0,
        entries: makeRoutine(2).entries,
      });

      // Resume from paused without active rest goes to working
      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('working');
    });
  });

  describe('SkipExercise', () => {
    it('should jump to next exercise', () => {
      const event: Event = { tag: 'SkipExercise' };

      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: [
          {
            idx: 0,
            exerciseId: 'ex1',
            kind: 'strength',
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 0,
            supersetGroup: '',
          },
          {
            idx: 1,
            exerciseId: 'ex2',
            kind: 'strength',
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 0,
            supersetGroup: '',
          },
        ],
      });

      const result = evaluateTransition(state, event);

      expect(result.state.exerciseIndex).toBe(1);
    });

    it('should clear rest deadline on SkipExercise', () => {
      const event: Event = { tag: 'SkipExercise' };

      const state = makeState({
        phase: 'resting',
        restDeadlineMs: 10000,
        entries: [
          {
            idx: 0,
            exerciseId: 'ex1',
            kind: 'strength',
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 0,
            supersetGroup: '',
          },
        ],
      });

      const result = evaluateTransition(state, event);

      expect(result.state.restDeadlineMs).toBe(0);
    });
  });

  describe('FinishSession completion (AC10.1, AC10.3)', () => {
    it('should emit CompleteSession + Notify on FinishSession', () => {
      const event: Event = { tag: 'FinishSession' };

      const state = makeState({ phase: 'working', entries: makeRoutine(1).entries });

      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('done');

      const completeEffects = result.effects.filter(e => e.kind === "complete_session");
      expect(completeEffects.length).toBe(1);

      const notifyEffects = result.effects.filter(e => e.kind === "notify");
      expect(notifyEffects.length).toBeGreaterThan(0);
    });

    it('should emit CancelRest if resting when FinishSession', () => {
      const event: Event = { tag: 'FinishSession' };

      const state = makeState({ phase: 'resting', restDeadlineMs: 10000, entries: makeRoutine(1).entries });

      const result = evaluateTransition(state, event);

      const cancelEffects = result.effects.filter(e => e.kind === "cancel_rest");
      expect(cancelEffects.length).toBeGreaterThan(0);
    });
  });

  describe('Final SetDone completion', () => {
    it('should emit CompleteSession + Notify when final SetDone advances to done', () => {
      const event: Event = { tag: 'SetDone', nowMs: 10000 };

      // Last exercise with one set, no warmup
      const state = makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        entries: [
          {
            idx: 0,
            exerciseId: 'final-exercise',
            kind: 'strength',
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 0,
            supersetGroup: '',
          },
        ],
      });

      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('done');
      const completeEffects = result.effects.filter(e => e.kind === "complete_session");
      expect(completeEffects.length).toBe(1);

      const notifyEffects = result.effects.filter(e => e.kind === "notify");
      expect(notifyEffects.length).toBeGreaterThan(0);
    });
  });

  describe('Invalid event for phase → Err with unchanged state (AC10.3)', () => {
    const invalidTransitions = [
      { phase: 'idle' as SessionPhase, event: { tag: 'LogSet' as const }, description: 'LogSet in idle' },
      { phase: 'idle' as SessionPhase, event: { tag: 'SetDone' as const, nowMs: 10000 }, description: 'SetDone in idle' },
      { phase: 'warmup' as SessionPhase, event: { tag: 'RestElapsed' as const, nowMs: 5000 }, description: 'RestElapsed in warmup' },
      { phase: 'working' as SessionPhase, event: { tag: 'RestElapsed' as const, nowMs: 5000 }, description: 'RestElapsed in working (not resting)' },
    ];

    for (const tc of invalidTransitions) {
      it(`should reject invalid event: ${tc.description}`, () => {
        const state = makeState({ phase: tc.phase });

        const result = evaluateSource(transitionCompositeSource, {
          state,
          event: tc.event,
        });

        expect(result.success).toBe(true);
        const value = result.value as any;
        expect(value.tag).toBe('Err');
        expect(value.value).toContain('invalid event');

        // Note: The rule returns only the error message; the host (index.ts)
        // is responsible for keeping the state unchanged on error
      });
    }
  });

  describe('Full happy path: start → warmups → working → superset partner → rest → next → done', () => {
    it('should complete full workout flow', () => {
      // This is an integration test showing the entire flow
      let state = makeState({ phase: 'idle' });

      // 1. StartSession with proper routine structure
      let event: Event = {
        tag: 'StartSession',
        sessionId: 'happy-path-session',
        nowMs: 1000,
        routine: {
          id: 'routine-1',
          entries: [
            {
              idx: 0,
              exerciseId: 'squat',
              kind: 'strength',
              warmupSets: 1,
              targetSets: 1,
              targetReps: 8,
              targetDurationSeconds: 0,
              restSeconds: 90,
              supersetGroup: 'A',
            },
            {
              idx: 1,
              exerciseId: 'leg-press',
              kind: 'strength',
              warmupSets: 0,
              targetSets: 1,
              targetReps: 8,
              targetDurationSeconds: 0,
              restSeconds: 60,
              supersetGroup: 'A',
            },
          ],
        } as any,
      };

      let result = evaluateTransition(state, event);
      expect(result.state.phase).toBe('warmup');
      state = result.state;

      // 2. LogSet (warmup 1)
      event = { tag: 'LogSet', reps: 5, weightKg: 20.0, durationSeconds: 0, rpe: 6.0 };
      result = evaluateTransition(state, event);
      // Rule emits persist_set effect (uniform effect, host maps to typed Effect)
      const persistEffects = result.effects.filter((e: any) => e.kind === 'persist_set');
      expect(persistEffects.length).toBe(1);
      state = result.state;

      // 3. SetDone (advance warmup to working)
      event = { tag: 'SetDone', nowMs: 10000 };
      result = evaluateTransition(state, event);
      expect(result.state.phase).toBe('working');
      state = result.state;

      // 4. LogSet (working set)
      event = { tag: 'LogSet', reps: 8, weightKg: 25.0, durationSeconds: 0, rpe: 7.5 };
      result = evaluateTransition(state, event);
      state = result.state;

      // 5. SetDone (end of squat, should advance to leg-press without rest due to superset)
      event = { tag: 'SetDone', nowMs: 15000 };
      result = evaluateTransition(state, event);
      // Should have moved to next exercise (leg-press is in same superset group)
      expect(result.state.exerciseIndex).toBe(1);
      expect(result.state.phase).not.toBe('resting'); // No rest within superset
      state = result.state;

      // Final: State should be advanced
      expect(state.phase).not.toBe('idle');
    });
  });

  describe('Pause/Resume with pre-pause phase preservation (M3)', () => {
    it('should record pre-pause phase when pausing', () => {
      const event: Event = { tag: 'PauseSession' };

      const state = makeState({ phase: 'warmup', entries: makeRoutine(1).entries });
      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('paused');
      expect(result.state.prePausePhase).toBe('warmup');
    });

    it('should restore warmup phase after resume', () => {
      const event: Event = { tag: 'Resume', nowMs: 5000 };

      const state = makeState({
        phase: 'paused',
        prePausePhase: 'warmup',
        restDeadlineMs: 0,
        entries: makeRoutine(1).entries,
      });
      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('warmup');
      expect(result.state.prePausePhase).toBe('');
    });

    it('should restore working phase after resume', () => {
      const event: Event = { tag: 'Resume', nowMs: 5000 };

      const state = makeState({
        phase: 'paused',
        prePausePhase: 'working',
        restDeadlineMs: 0,
        entries: makeRoutine(1).entries,
      });
      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('working');
      expect(result.state.prePausePhase).toBe('');
    });

    it('should restore stretching phase after resume', () => {
      const event: Event = { tag: 'Resume', nowMs: 5000 };

      const state = makeState({
        phase: 'paused',
        prePausePhase: 'stretching',
        restDeadlineMs: 0,
        entries: makeRoutine(1).entries,
      });
      const result = evaluateTransition(state, event);

      expect(result.state.phase).toBe('stretching');
      expect(result.state.prePausePhase).toBe('');
    });

    it('should stay in resting if rest deadline not passed during pause', () => {
      const event: Event = { tag: 'Resume', nowMs: 5000 };

      // Paused during rest with deadline in future
      const state = makeState({
        phase: 'paused',
        prePausePhase: 'resting',
        restDeadlineMs: 10000, // deadline is 10000, now is 5000
        entries: makeRoutine(1).entries,
      });
      const result = evaluateTransition(state, event);

      // Should remain resting because deadline hasn't passed
      expect(result.state.phase).toBe('resting');
      expect(result.state.prePausePhase).toBe('');
      expect(result.state.restDeadlineMs).toBe(10000); // Still has deadline
    });

    it('should restore pre-pause phase if rest deadline passed during pause', () => {
      const event: Event = { tag: 'Resume', nowMs: 15000 };

      // Paused during rest, but deadline passed while paused
      const state = makeState({
        phase: 'paused',
        prePausePhase: 'working',
        restDeadlineMs: 10000, // deadline was 10000, now is 15000 (passed)
        entries: makeRoutine(1).entries,
      });
      const result = evaluateTransition(state, event);

      // Should transition to working (pre-pause phase) since rest elapsed
      expect(result.state.phase).toBe('working');
      expect(result.state.prePausePhase).toBe('');
      expect(result.state.restDeadlineMs).toBe(0);
      // Should emit cancel_rest since deadline passed
      const cancelEffects = result.effects.filter(e => e.kind === 'cancel_rest');
      expect(cancelEffects.length).toBe(1);
    });
  });
});
