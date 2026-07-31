import { createSessionPresenter } from './sessionPresenter';
import { computeProgressionHint } from './progressionHintHelper';
import type { SessionState } from '@/engine/types';

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

  test('dispatches SetDone on setDone action', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onSetDone();

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'SetDone',
        nowMs: expect.any(Number),
      })
    );
  });

  test('dispatches LogSet with reps, weight, and RPE on logSet', () => {
    const state = createMockState();
    const mockDispatch = jest.fn(async () => null);
    const presenter = createSessionPresenter(state, mockDispatch);

    presenter.onLogSet({
      reps: 8,
      weightKg: 25,
      rpe: 7.5,
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'LogSet',
        reps: 8,
        weightKg: 25,
        rpe: 7.5,
      })
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

  test('dispatches SkipRest on cancel-rest action', () => {
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
      expect(presenter.progressionHint).toContain('2.5');
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
});
