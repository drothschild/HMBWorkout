import { createSessionPresenter } from './sessionPresenter';
import { SessionState } from '@/engine/types';

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


});
