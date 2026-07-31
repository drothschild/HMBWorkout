import {
  computeSetPrefill,
  createSessionPresenter,
  currentExerciseHasLoggedSet,
  formatLoggedSetLine,
} from './sessionPresenter';
import { computeProgressionHint } from './progressionHintHelper';
import type { LoggedSet, SessionState } from '@/engine/types';

/**
 * Test: Session presenter logic
 *
 * Verifies AC2.2 (LogSet/SetDone dispatch) and AC9.1 (RPE rendering)
 * Note: Pure function tested in node project with direct calls
 */

describe('createSessionPresenter', () => {
  const createMockState = (): SessionState => ({
    sessionId: 'session-1',
    routineId: 'routine-1',
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 0,
    startedAtMs: Date.now() - 60000,
    loggedSets: [
      {
        exerciseId: 'ex-1',
        setType: 'warmup',
        reps: 10,
        weightKg: 20,
        durationSeconds: null,
        rpe: null,
      },
    ],
    entries: [
      {
        idx: 0,
        exerciseId: 'ex-1',
        kind: 'strength',
        warmupSets: 1,
        targetSets: 3,
        targetReps: 8,
        targetDurationSeconds: 0,
        restSeconds: 90,
        supersetGroup: '',
      },
    ],
    prePausePhase: '',
  });

  test('renders current exercise and logged sets with RPE when present', () => {
    const state = createMockState();
    state.loggedSets = [
      {
        exerciseId: 'ex-1',
        setType: 'working',
        reps: 8,
        weightKg: 25,
        durationSeconds: null,
        rpe: 7.5,
      },
      {
        exerciseId: 'ex-1',
        setType: 'working',
        reps: 7,
        weightKg: 25,
        durationSeconds: null,
        rpe: 8,
      },
    ];

    const mockDispatch = jest.fn();
    const presenter = createSessionPresenter(state, mockDispatch);

    expect(presenter.currentExerciseId).toBe('ex-1');
    expect(presenter.phase).toBe('working');
    expect(presenter.loggedSets).toHaveLength(2);
    expect(presenter.loggedSets[0].rpe).toBe(7.5);
    expect(presenter.loggedSets[1].rpe).toBe(8);
  });

  test('dispatches SetDone on skip-set action (advance without logging)', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onSkipSet();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'SetDone',
        nowMs: expect.any(Number),
      })
    );
  });

  describe('set position within the current entry', () => {
    // Mock entry: warmupSets 1, targetSets 3 → 4 positions in total

    test('exposes the warmup position while on a warmup set', () => {
      const state = createMockState();
      state.setIndex = 0;

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.isWarmupSet).toBe(true);
      expect(presenter.setNumber).toBe(1);
      expect(presenter.totalSetsForEntry).toBe(4);
      expect(presenter.setPositionLabel).toBe('Warmup 1 of 1');
    });

    test('exposes the working position once past the warmups', () => {
      const state = createMockState();
      state.setIndex = 1;

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.isWarmupSet).toBe(false);
      expect(presenter.setNumber).toBe(1);
      expect(presenter.totalSetsForEntry).toBe(4);
      expect(presenter.setPositionLabel).toBe('Set 1 of 3');
    });

    test('counts working sets within the entry, not globally', () => {
      const state = createMockState();
      state.setIndex = 3;

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.setPositionLabel).toBe('Set 3 of 3');
    });

    test('degrades to an empty label when there is no current entry', () => {
      const state = createMockState();
      state.exerciseIndex = 5; // Out of range

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.setPositionLabel).toBe('');
      expect(presenter.totalSetsForEntry).toBe(0);
      expect(presenter.setNumber).toBe(0);
      expect(presenter.isWarmupSet).toBe(false);
    });
  });

  test('dispatches LogSet with reps, weight, RPE, and the current time on logSet', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    // The input field carries lbs; the presenter converts to canonical kg
    // before the event crosses into the engine.
    presenter.onLogSet({
      reps: 8,
      weightLbs: 55,
      rpe: 7.5,
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'LogSet',
        reps: 8,
        weightKg: 24.95,
        rpe: 7.5,
        // One-tap logging: the engine advances on LogSet, so the event carries
        // the wall clock for rest-deadline math
        nowMs: expect.any(Number),
      })
    );
  });

  test('leaves the LogSet weight undefined when no weight was entered', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onLogSet({ reps: 8 });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'LogSet', reps: 8, weightKg: undefined })
    );
  });

  test('dispatches PauseSession on pause action', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onPause();

    expect(mockDispatch).toHaveBeenCalledWith({
      tag: 'PauseSession',
      nowMs: expect.any(Number),
    });
  });

  test('exposes rest countdown state while resting', () => {
    const state = createMockState();
    state.phase = 'resting';
    state.restDeadlineMs = 123456;

    const presenter = createSessionPresenter(state, jest.fn(async () => null));

    expect(presenter.isResting).toBe(true);
    expect(presenter.isRestPaused).toBe(false);
    expect(presenter.restDeadlineMs).toBe(123456);
    expect(presenter.restRemainingMs).toBeUndefined();
  });

  test('exposes frozen remainder when rest is paused (sentinel 0 = none)', () => {
    const state = createMockState();
    state.phase = 'paused';
    state.restDeadlineMs = 0; // Sentinel: deadline cleared while paused
    state.restRemainingMs = 45000;

    const presenter = createSessionPresenter(state, jest.fn(async () => null));

    expect(presenter.isResting).toBe(false);
    expect(presenter.isRestPaused).toBe(true);
    expect(presenter.restDeadlineMs).toBeUndefined();
    expect(presenter.restRemainingMs).toBe(45000);
  });

  test('paused without a frozen remainder is not a rest pause', () => {
    const state = createMockState();
    state.phase = 'paused';
    state.restRemainingMs = 0; // Sentinel: nothing frozen

    const presenter = createSessionPresenter(state, jest.fn(async () => null));

    expect(presenter.isRestPaused).toBe(false);
    expect(presenter.restRemainingMs).toBeUndefined();
  });

  test('dispatches SkipRest on skip-rest action', () => {
    const state = createMockState();
    state.phase = 'resting';
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onSkipRest();

    expect(mockDispatch).toHaveBeenCalledWith({ tag: 'SkipRest' });
  });

  test('dispatches RestElapsed with current time on rest elapsed', () => {
    const state = createMockState();
    state.phase = 'resting';
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onRestElapsed();

    expect(mockDispatch).toHaveBeenCalledWith({
      tag: 'RestElapsed',
      nowMs: expect.any(Number),
    });
  });

  describe('stretch cool-down', () => {
    test('exposes isStretching only for the stretching phase', () => {
      const state = createMockState();
      expect(createSessionPresenter(state, jest.fn()).isStretching).toBe(false);

      state.phase = 'stretching';
      expect(createSessionPresenter(state, jest.fn()).isStretching).toBe(true);
    });

    test('dispatches StopStretching on done-stretching action', () => {
      const state = createMockState();
      state.phase = 'stretching';
      const mockDispatch = jest.fn(async () => null);
      const presenter = createSessionPresenter(state, mockDispatch);

      presenter.onStopStretching();

      expect(mockDispatch).toHaveBeenCalledWith({ tag: 'StopStretching' });
    });
  });

  test('dispatches SkipExercise on skip action', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onSkipExercise();

    expect(mockDispatch).toHaveBeenCalledWith({
      tag: 'SkipExercise',
    });
  });

  test('dispatches FinishSession on finish action', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onFinishSession();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'FinishSession',
        nowMs: expect.any(Number),
      })
    );
  });

  describe('current exercise logged sets', () => {
    const set = (exerciseId: string, reps: number): LoggedSet => ({
      exerciseId,
      setType: 'working',
      reps,
      weightKg: 40,
      durationSeconds: null,
      rpe: null,
    });

    const twoExerciseState = (): SessionState => {
      const state = createMockState();
      state.entries = [
        state.entries[0],
        { ...state.entries[0], idx: 1, exerciseId: 'ex-2' },
      ];
      return state;
    };

    test('returns only the current exercise sets, newest first', () => {
      const state = twoExerciseState();
      state.loggedSets = [set('ex-1', 8), set('ex-2', 5), set('ex-1', 6)];

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.currentExerciseLoggedSets.map((s) => s.reps)).toEqual([6, 8]);
      expect(presenter.currentExerciseLoggedSets.every((s) => s.exerciseId === 'ex-1')).toBe(true);
    });

    test('is empty when only other exercises have sets', () => {
      const state = twoExerciseState();
      state.exerciseIndex = 1;
      state.loggedSets = [set('ex-1', 8), set('ex-1', 6)];

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.currentExerciseLoggedSets).toEqual([]);
    });

    test('drops the previous exercise sets after advancement', () => {
      const state = twoExerciseState();
      state.loggedSets = [set('ex-1', 8), set('ex-2', 5)];
      state.exerciseIndex = 1;

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.currentExerciseLoggedSets.map((s) => s.exerciseId)).toEqual(['ex-2']);
    });

    test('counts every set in the session, not just the current exercise', () => {
      const state = twoExerciseState();
      state.loggedSets = [set('ex-1', 8), set('ex-2', 5), set('ex-1', 6)];

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.loggedSetCount).toBe(3);
    });
  });

  describe('set input prefill', () => {
    const workingSet = (exerciseId: string, reps: number, weightKg: number): LoggedSet => ({
      exerciseId,
      setType: 'working',
      reps,
      weightKg,
      durationSeconds: null,
      rpe: null,
    });

    test('prefers the last in-session set of the current exercise over the history fallback', () => {
      const state = createMockState();
      state.loggedSets = [workingSet('ex-1', 8, 40), workingSet('ex-1', 6, 45)];

      const prefill = computeSetPrefill(state, { reps: 12, weightLbs: 100 });

      // Stored kg converts to display lbs on the way into the input: 45kg → 99lbs
      expect(prefill).toEqual({ reps: 6, weightLbs: 99 });
    });

    test('ignores sets logged for other exercises', () => {
      const state = createMockState();
      state.entries = [
        state.entries[0],
        { ...state.entries[0], idx: 1, exerciseId: 'ex-2' },
      ];
      state.exerciseIndex = 1;
      state.loggedSets = [workingSet('ex-2', 5, 60), workingSet('ex-1', 8, 40)];

      expect(computeSetPrefill(state)).toEqual({ reps: 5, weightLbs: 132.5 });
    });

    test('a duplicated exercise entry prefills from the first entry sets', () => {
      const state = createMockState();
      state.entries = [
        state.entries[0],
        { ...state.entries[0], idx: 1 }, // Same exerciseId listed twice
      ];
      state.exerciseIndex = 1;
      state.loggedSets = [workingSet('ex-1', 8, 40)];

      expect(computeSetPrefill(state)).toEqual({ reps: 8, weightLbs: 88 });
    });

    test('a warmup set prefills the next set', () => {
      const state = createMockState();
      // createMockState logs one warmup set: 10 reps at 20kg → 44lbs

      expect(computeSetPrefill(state)).toEqual({ reps: 10, weightLbs: 44 });
    });

    test('never prefills rpe, and a stored -1 sentinel does not leak', () => {
      const state = createMockState();
      state.loggedSets = [{ ...workingSet('ex-1', 8, 40), rpe: -1 }];

      const prefill = computeSetPrefill(state);

      expect(prefill).toEqual({ reps: 8, weightLbs: 88 });
      expect(prefill).not.toHaveProperty('rpe');
    });

    test('omits null metrics instead of coercing them to zero', () => {
      const state = createMockState();
      state.loggedSets = [
        { exerciseId: 'ex-1', setType: 'working', reps: 12, weightKg: null, durationSeconds: null, rpe: null },
      ];

      expect(computeSetPrefill(state)).toEqual({ reps: 12 });
    });

    test('a fully-empty logged set falls through to the history/target fallbacks', () => {
      const state = createMockState();
      state.loggedSets = [
        { exerciseId: 'ex-1', setType: 'working', reps: null, weightKg: null, durationSeconds: null, rpe: null },
      ];

      expect(computeSetPrefill(state, { reps: 5, weightLbs: 80 })).toEqual({ reps: 5, weightLbs: 80 });
      expect(computeSetPrefill(state)).toEqual({ reps: 8 }); // targetReps from the mock entry
    });

    test('a fully-empty duration set falls through to targetDurationSeconds', () => {
      const state = createMockState();
      state.entries[0].kind = 'stretch';
      state.entries[0].targetDurationSeconds = 60;
      state.loggedSets = [
        { exerciseId: 'ex-1', setType: 'stretch', reps: null, weightKg: null, durationSeconds: null, rpe: null },
      ];

      expect(computeSetPrefill(state)).toEqual({ durationSeconds: 60 });
    });

    test('duration entries prefill from the last in-session duration', () => {
      const state = createMockState();
      state.entries[0].kind = 'stretch';
      state.loggedSets = [
        { exerciseId: 'ex-1', setType: 'stretch', reps: null, weightKg: null, durationSeconds: 45, rpe: null },
      ];

      expect(computeSetPrefill(state)).toEqual({ durationSeconds: 45 });
    });

    test('duration entries fall back to targetDurationSeconds', () => {
      const state = createMockState();
      state.entries[0].kind = 'stretch';
      state.entries[0].targetDurationSeconds = 60;
      state.loggedSets = [];

      expect(computeSetPrefill(state)).toEqual({ durationSeconds: 60 });
    });

    test('strength entries fall back to history, then to targetReps', () => {
      const state = createMockState();
      state.loggedSets = [];

      // The history fallback is already in display lbs (the caller converts)
      expect(computeSetPrefill(state, { reps: 5, weightLbs: 80 })).toEqual({ reps: 5, weightLbs: 80 });
      expect(computeSetPrefill(state)).toEqual({ reps: 8 }); // targetReps from the mock entry
    });

    test('returns undefined when there is nothing to prefill', () => {
      const state = createMockState();
      state.loggedSets = [];
      state.entries[0].targetReps = 0;

      expect(computeSetPrefill(state)).toBeUndefined();
    });

    test('returns undefined when the exercise index is out of bounds', () => {
      const state = createMockState();
      state.exerciseIndex = 5;

      expect(computeSetPrefill(state)).toBeUndefined();
    });

    test('is not a presenter field — computeSetPrefill is the sole prefill contract', () => {
      const presenter = createSessionPresenter(createMockState(), jest.fn(async () => null));

      expect(presenter).not.toHaveProperty('setPrefill');
    });
  });

  describe('currentExerciseHasLoggedSet', () => {
    test('true when the current exercise has an in-session set', () => {
      // createMockState logs one warmup set for ex-1, the current exercise
      expect(currentExerciseHasLoggedSet(createMockState())).toBe(true);
    });

    test('false when only other exercises have sets', () => {
      const state = createMockState();
      state.entries = [
        state.entries[0],
        { ...state.entries[0], idx: 1, exerciseId: 'ex-2' },
      ];
      state.exerciseIndex = 1;

      expect(currentExerciseHasLoggedSet(state)).toBe(false);
    });

    test('false when the exercise index is out of bounds', () => {
      const state = createMockState();
      state.exerciseIndex = 5;

      expect(currentExerciseHasLoggedSet(state)).toBe(false);
    });
  });

  describe('exercise progress', () => {
    const widenToThreeEntries = (state: SessionState) => {
      state.entries = [0, 1, 2].map((idx) => ({
        idx,
        exerciseId: `ex-${idx + 1}`,
        kind: 'strength' as const,
        warmupSets: 0,
        targetSets: 3,
        targetReps: 8,
        targetDurationSeconds: 0,
        restSeconds: 90,
        supersetGroup: '',
      }));
      return state;
    };

    test('starts at zero completed out of the routine total', () => {
      const state = widenToThreeEntries(createMockState());
      state.exerciseIndex = 0;

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.totalExerciseCount).toBe(3);
      expect(presenter.completedExerciseCount).toBe(0);
      expect(presenter.exerciseProgress).toBe(0);
    });

    test('counts advanced-past exercises as completed (skips included)', () => {
      const state = widenToThreeEntries(createMockState());
      state.exerciseIndex = 1;

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.completedExerciseCount).toBe(1);
      expect(presenter.exerciseProgress).toBeCloseTo(1 / 3);
    });

    test('shows full progress at phase done even though the engine leaves the index at length-1', () => {
      const state = widenToThreeEntries(createMockState());
      state.phase = 'done';
      state.exerciseIndex = 2; // Natural completion does not advance past the last entry

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.completedExerciseCount).toBe(3);
      expect(presenter.exerciseProgress).toBe(1);
    });

    test('clamps a skip past the last exercise to the total', () => {
      const state = widenToThreeEntries(createMockState());
      state.exerciseIndex = 3; // SkipExercise on the last entry leaves the index out of bounds

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.completedExerciseCount).toBe(3);
      expect(presenter.exerciseProgress).toBe(1);
    });

    test('reports zero progress for an empty routine without dividing by zero', () => {
      const state = createMockState();
      state.entries = [];

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.totalExerciseCount).toBe(0);
      expect(presenter.completedExerciseCount).toBe(0);
      expect(presenter.exerciseProgress).toBe(0);
    });
  });

  describe('finish confirmation copy', () => {
    const secondEntry = {
      idx: 1,
      exerciseId: 'ex-2',
      kind: 'strength' as const,
      warmupSets: 0,
      targetSets: 3,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 90,
      supersetGroup: '',
    };

    test('reports logged sets and remaining planned exercises', () => {
      const state = createMockState();
      state.entries = [
        state.entries[0],
        secondEntry,
        { ...secondEntry, idx: 2, exerciseId: 'ex-3' },
      ];
      state.exerciseIndex = 1;
      state.loggedSets = Array.from({ length: 5 }, () => ({
        exerciseId: 'ex-1',
        setType: 'working' as const,
        reps: 8,
        weightKg: 25,
        durationSeconds: null,
        rpe: null,
      }));

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.finishConfirmation.title).toBe('Finish workout?');
      expect(presenter.finishConfirmation.message).toContain('5 sets');
      expect(presenter.finishConfirmation.message).toContain('2 planned exercises remain');
    });

    test('uses singular wording for one set and one remaining exercise', () => {
      const state = createMockState();
      state.exerciseIndex = 0;
      // createMockState logs exactly one set and has one entry

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.finishConfirmation.message).toContain('1 set');
      expect(presenter.finishConfirmation.message).not.toContain('1 sets');
      expect(presenter.finishConfirmation.message).toContain('1 planned exercise remains');
    });

    test('omits the remaining clause when no planned exercises remain', () => {
      const state = createMockState();
      state.exerciseIndex = 1; // Skipped past the only entry

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.finishConfirmation.message).not.toContain('remain');
      expect(presenter.finishConfirmation.message.length).toBeGreaterThan(0);
    });

    test('is stable and non-empty for a fresh session with nothing logged', () => {
      const state = createMockState();
      state.loggedSets = [];

      const presenter = createSessionPresenter(state, jest.fn(async () => null));

      expect(presenter.finishConfirmation.title.length).toBeGreaterThan(0);
      expect(presenter.finishConfirmation.message).toContain('0 sets');
    });
  });

  test('returns current entry for exerciseIndex', () => {
    const state = createMockState();
    const mockDispatch = jest.fn();
    const presenter = createSessionPresenter(state, mockDispatch);

    expect(presenter.currentEntry).toEqual(state.entries[0]);
  });

  test('handles pause/resume control based on phase', () => {
    const pausedState = createMockState();
    pausedState.phase = 'paused';

    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(pausedState, mockDispatch);

    expect(presenter.isPaused).toBe(true);

    presenter.onResume();

    expect(mockDispatch).toHaveBeenCalledWith({
      tag: 'Resume',
      nowMs: expect.any(Number),
    });
  });

  test('handles duration input for stretch/cardio entries', () => {
    const state = createMockState();
    state.entries[0].kind = 'stretch';
    state.loggedSets = [
      {
        exerciseId: 'ex-1',
        setType: 'stretch',
        reps: null,
        weightKg: null,
        durationSeconds: 30,
        rpe: null,
      },
    ];

    const mockDispatch = jest.fn();
    const presenter = createSessionPresenter(state, mockDispatch);

    expect(presenter.currentEntry).toBeDefined();
    expect(presenter.currentEntry!.kind).toBe('stretch');
    expect(presenter.loggedSets[0].durationSeconds).toBe(30);
  });

  describe('Phase 4 Task 3: Progression hint for strength exercises', () => {
    test('surfaces increase hint when all working sets have RPE ≤ 8', () => {
      const state = createMockState();
      state.loggedSets = [
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 10,
          weightKg: 20.0,
          durationSeconds: null,
          rpe: 6.5,
        },
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 10,
          weightKg: 20.0,
          durationSeconds: null,
          rpe: 7.0,
        },
      ];

      const mockDispatch = jest.fn();
      const hint = computeProgressionHint('ex-1', state.loggedSets, 'strength');
      const presenter = createSessionPresenter(state, mockDispatch, hint);

      expect(presenter.progressionHint).toBeDefined();
      expect(presenter.progressionHint?.toLowerCase()).toContain('increase');
      expect(presenter.progressionHint).toContain('5 lbs');
    });

    test('surfaces hold hint when any working set has RPE > 8', () => {
      const state = createMockState();
      state.loggedSets = [
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: null,
          rpe: 9.0,
        },
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 8,
          weightKg: 25.0,
          durationSeconds: null,
          rpe: 9.5,
        },
      ];

      const mockDispatch = jest.fn();
      const hint = computeProgressionHint('ex-1', state.loggedSets, 'strength');
      const presenter = createSessionPresenter(state, mockDispatch, hint);

      expect(presenter.progressionHint).toBeDefined();
      expect(presenter.progressionHint?.toLowerCase()).toContain('hold');
    });

    test('returns undefined hint for cardio/stretch exercises', () => {
      const state = createMockState();
      state.entries[0].kind = 'cardio';
      state.loggedSets = [
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: null,
          weightKg: null,
          durationSeconds: 300,
          rpe: null,
        },
      ];

      const mockDispatch = jest.fn();
      const hint = computeProgressionHint('ex-1', state.loggedSets, 'cardio');
      const presenter = createSessionPresenter(state, mockDispatch, hint);

      expect(presenter.progressionHint).toBeUndefined();
    });

    test('returns baseline hint when no working sets yet (warmup only)', () => {
      const state = createMockState();
      state.loggedSets = [
        {
          exerciseId: 'ex-1',
          setType: 'warmup',
          reps: 10,
          weightKg: 20,
          durationSeconds: null,
          rpe: null,
        },
      ];

      const mockDispatch = jest.fn();
      const hint = computeProgressionHint('ex-1', state.loggedSets, 'strength');
      const presenter = createSessionPresenter(state, mockDispatch, hint);

      expect(presenter.progressionHint).toBeDefined();
      expect(presenter.progressionHint).toContain('baseline');
    });
  });

  describe('abandoning the workout', () => {
    test('returns a promise from dispatch', async () => {
      const mockDispatch = jest.fn(async () => null);
      const presenter = createSessionPresenter(createMockState(), mockDispatch);

      const result = presenter.onAbandonSession();

      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    test('dispatches AbandonSession and nothing else', async () => {
      const mockDispatch = jest.fn(async () => null);
      const presenter = createSessionPresenter(createMockState(), mockDispatch);

      await presenter.onAbandonSession();

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({ tag: 'AbandonSession' });
    });

    test('does not finish the session', async () => {
      const mockDispatch = jest.fn(async () => null);
      const presenter = createSessionPresenter(createMockState(), mockDispatch);

      await presenter.onAbandonSession();

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ tag: 'FinishSession' })
      );
    });
  });

  describe('routine display', () => {
    const display = { name: 'Push Day', notes: 'Focus on bar speed today.' };

    test('exposes routine name and notes at the beginning of the workout', () => {
      const state = createMockState();
      state.loggedSets = [];

      const presenter = createSessionPresenter(
        state,
        jest.fn(),
        undefined,
        undefined,
        display
      );

      expect(presenter.routineName).toBe('Push Day');
      expect(presenter.routineNotes).toBe('Focus on bar speed today.');
    });

    test('hides the notes once a set has been logged, but keeps the name', () => {
      // createMockState carries one logged warmup set on the first exercise.
      const presenter = createSessionPresenter(
        createMockState(),
        jest.fn(),
        undefined,
        undefined,
        display
      );

      expect(presenter.routineNotes).toBeUndefined();
      expect(presenter.routineName).toBe('Push Day');
    });

    test('hides the notes past the first exercise even with nothing logged', () => {
      const state = createMockState();
      state.loggedSets = [];
      state.exerciseIndex = 1;

      const presenter = createSessionPresenter(
        state,
        jest.fn(),
        undefined,
        undefined,
        display
      );

      expect(presenter.routineNotes).toBeUndefined();
    });

    test('hides the notes when the session is done', () => {
      const state = createMockState();
      state.loggedSets = [];
      state.phase = 'done';

      const presenter = createSessionPresenter(
        state,
        jest.fn(),
        undefined,
        undefined,
        display
      );

      expect(presenter.routineNotes).toBeUndefined();
    });

    test('maps null notes to undefined instead of rendering them', () => {
      const state = createMockState();
      state.loggedSets = [];

      const presenter = createSessionPresenter(state, jest.fn(), undefined, undefined, {
        name: 'Push Day',
        notes: null,
      });

      expect(presenter.routineName).toBe('Push Day');
      expect(presenter.routineNotes).toBeUndefined();
    });

    test('leaves both undefined when no routine display is provided', () => {
      const state = createMockState();
      state.loggedSets = [];

      const presenter = createSessionPresenter(state, jest.fn());

      expect(presenter.routineName).toBeUndefined();
      expect(presenter.routineNotes).toBeUndefined();
    });
  });

  describe('exercise title resolution', () => {
    test('resolves the current exercise title from the titles map', () => {
      const presenter = createSessionPresenter(createMockState(), jest.fn(), undefined, {
        'ex-1': 'Demo Exercise',
      });

      expect(presenter.currentExerciseTitle).toBe('Demo Exercise');
    });

    test('falls back to the exercise id when no titles map is provided', () => {
      const presenter = createSessionPresenter(createMockState(), jest.fn());

      expect(presenter.currentExerciseTitle).toBe('ex-1');
    });

    test('falls back to the exercise id when the map has no entry for it', () => {
      const presenter = createSessionPresenter(createMockState(), jest.fn(), undefined, {
        'ex-other': 'Something Else',
      });

      expect(presenter.currentExerciseTitle).toBe('ex-1');
    });
  });
});

describe('formatLoggedSetLine', () => {
  const baseSet: LoggedSet = {
    exerciseId: 'ex-1',
    setType: 'working',
    reps: 8,
    weightKg: 25,
    durationSeconds: null,
    rpe: 7.5,
  };

  test('renders reps, weight in display lbs, and RPE when all are present', () => {
    // Stored 25kg renders as 55lbs (nearest 0.5 lb)
    expect(formatLoggedSetLine(baseSet)).toBe('8 x 55lbs RPE: 7.5');
  });

  test('omits unset weight and the -1 RPE sentinel', () => {
    expect(
      formatLoggedSetLine({ ...baseSet, reps: 60, weightKg: undefined, rpe: -1 })
    ).toBe('60 reps');
  });

  test('omits null metrics, keeping only the weight', () => {
    expect(formatLoggedSetLine({ ...baseSet, reps: null, rpe: null })).toBe('55lbs');
  });

  test('renders a stretch set from its own duration', () => {
    expect(
      formatLoggedSetLine({
        exerciseId: 'ex-1',
        setType: 'stretch',
        reps: null,
        weightKg: null,
        durationSeconds: 30,
        rpe: null,
      })
    ).toBe('30s');
  });

  test('appends RPE to a cardio set when logged', () => {
    expect(
      formatLoggedSetLine({
        exerciseId: 'ex-1',
        setType: 'cardio',
        reps: null,
        weightKg: null,
        durationSeconds: 300,
        rpe: 6,
      })
    ).toBe('300s RPE: 6');
  });

  test('falls back to a dash when the set has no metrics at all', () => {
    expect(
      formatLoggedSetLine({
        exerciseId: 'ex-1',
        setType: 'working',
        reps: undefined,
        weightKg: undefined,
        durationSeconds: undefined,
        rpe: undefined,
      })
    ).toBe('—');
  });
});
