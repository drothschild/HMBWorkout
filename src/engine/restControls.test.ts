/**
 * Rest-timer controls: SkipRest (cancel rest early) and pause/resume that
 * freezes the remaining rest time instead of letting the wall-clock deadline
 * keep running while paused.
 */

import { createEngine } from './index';
import type { SessionState, RoutineEntry } from './types';

function makeEntries(count = 2, overrides?: Partial<RoutineEntry>[]): RoutineEntry[] {
  const entries: RoutineEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      idx: i,
      exerciseId: `exercise-${i}`,
      kind: 'strength',
      warmupSets: 0,
      targetSets: 1,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 60,
      supersetGroup: '',
      ...overrides?.[i],
    });
  }
  return entries;
}

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-rest-controls',
    routineId: 'routine-rest-controls',
    phase: 'idle',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: 0,
    loggedSets: [],
    lastLoggedSet: undefined,
    startedAtMs: 1000,
    prePausePhase: '',
    entries: makeEntries(),
    ...overrides,
  };
}

function makeExecutors() {
  return {
    onCreateSession: jest.fn(),
    onScheduleRest: jest.fn(),
    onCancelRest: jest.fn(),
    onNotify: jest.fn(),
    onPersistSet: jest.fn(),
    onCompleteSession: jest.fn(),
  };
}

describe('SkipRest: cancel the rest timer early', () => {
  it('should end rest immediately and return to working', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10000, exerciseIndex: 1 })
    );

    const state = await engine.dispatch({ tag: 'SkipRest' });

    expect(state.phase).toBe('working');
    expect(state.restDeadlineMs).toBe(0); // Sentinel: no active deadline
    expect(state.setIndex).toBe(0);
    expect(executors.onCancelRest).toHaveBeenCalled();
  });

  it('should cancel a paused rest timer and return to working, unpaused', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10000, exerciseIndex: 1 })
    );

    await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });
    const state = await engine.dispatch({ tag: 'SkipRest' });

    expect(state.phase).toBe('working');
    expect(state.restRemainingMs).toBe(0);
    expect(state.prePausePhase).toBe('');
  });

  it('should reject SkipRest outside the resting phase', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ phase: 'working' }));

    await expect(engine.dispatch({ tag: 'SkipRest' })).rejects.toThrow();
  });
});

describe('SetDone mid-exercise: rest between sets of the same exercise', () => {
  const entries = () =>
    makeEntries(2, [{ warmupSets: 1, targetSets: 2, restSeconds: 60 }]);

  it('should enter resting for the entry rest duration when more sets remain', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'working', exerciseIndex: 0, setIndex: 1, entries: entries() })
    );

    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });

    expect(state.phase).toBe('resting');
    expect(state.setIndex).toBe(2); // Advanced to the upcoming set
    expect(state.restDeadlineMs).toBe(65000); // 5000 + 60s
    expect(executors.onScheduleRest).toHaveBeenCalledWith(65000);
  });

  it('should not rest between sets when the entry has no rest configured', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeState({
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 1,
        entries: makeEntries(2, [{ warmupSets: 0, targetSets: 3, restSeconds: 0 }]),
      })
    );

    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });

    expect(state.phase).toBe('working');
    expect(state.setIndex).toBe(2);
    expect(state.restDeadlineMs).toBe(0);
  });

  it('should return to working with the set index preserved when rest elapses', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeState({ phase: 'working', exerciseIndex: 0, setIndex: 1, entries: entries() })
    );

    await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });
    const state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 65000 });

    expect(state.phase).toBe('working');
    expect(state.setIndex).toBe(2); // NOT reset to 0
  });

  it('should return to warmup when the upcoming set is still a warmup set', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeState({
        phase: 'warmup',
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeEntries(2, [{ warmupSets: 2, targetSets: 1, restSeconds: 60 }]),
      })
    );

    await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });
    const state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 65000 });

    expect(state.phase).toBe('warmup');
    expect(state.setIndex).toBe(1);
  });

  it('should preserve the upcoming set when rest is cancelled early', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeState({ phase: 'working', exerciseIndex: 0, setIndex: 1, entries: entries() })
    );

    await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });
    const state = await engine.dispatch({ tag: 'SkipRest' });

    expect(state.phase).toBe('working');
    expect(state.setIndex).toBe(2);
  });
});

describe('PauseSession during rest: freeze the remaining time', () => {
  it('should freeze remaining rest time and cancel the scheduled alert', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10000, exerciseIndex: 1 })
    );

    const state = await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });

    expect(state.phase).toBe('paused');
    expect(state.prePausePhase).toBe('resting');
    expect(state.restDeadlineMs).toBe(0); // Deadline no longer running
    expect(state.restRemainingMs).toBe(6000); // 10000 - 4000 frozen
    expect(executors.onCancelRest).toHaveBeenCalled();
  });

  it('should re-arm the deadline from the frozen remainder on resume', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10000, exerciseIndex: 1 })
    );

    await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });
    const state = await engine.dispatch({ tag: 'Resume', nowMs: 20000 });

    expect(state.phase).toBe('resting');
    expect(state.restDeadlineMs).toBe(26000); // 20000 + 6000 remaining
    expect(state.restRemainingMs).toBe(0); // Sentinel: nothing frozen
    expect(executors.onScheduleRest).toHaveBeenCalledWith(26000);
  });

  it('should not freeze anything when pausing outside rest', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState({ phase: 'working' }));

    const state = await engine.dispatch({ tag: 'PauseSession', nowMs: 4000 });

    expect(state.phase).toBe('paused');
    expect(state.restRemainingMs).toBe(0);
    expect(executors.onCancelRest).not.toHaveBeenCalled();

    const resumed = await engine.dispatch({ tag: 'Resume', nowMs: 5000 });
    expect(resumed.phase).toBe('working');
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
  });
});

describe('Resume during resting: relaunch reconciliation', () => {
  // A process kill mid-rest (not paused) rehydrates Resting with its
  // wall-clock deadline intact but no cancelable alert in the new process.
  // The boot rehydrate (rehydrateActiveSession) dispatches Resume for exactly
  // this phase and Paused, so Resume is where the engine must reconcile:
  // re-arm a live rest, recover the phase from an expired one. The UI's
  // Resume buttons render only while paused, so this arm is boot-only.

  it('should re-arm the rest alert when the deadline is still in the future', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10000, exerciseIndex: 1 })
    );

    const state = await engine.dispatch({ tag: 'Resume', nowMs: 4000 });

    // The deadline is wall-clock, so it survives unchanged; only the alert is
    // re-armed for the process that lost it.
    expect(state.phase).toBe('resting');
    expect(state.restDeadlineMs).toBe(10000);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(10000);
  });

  it('should recover to working when the deadline expired while the process was dead', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10000, exerciseIndex: 1 })
    );

    const state = await engine.dispatch({ tag: 'Resume', nowMs: 25000 });

    expect(state.phase).toBe('working');
    expect(state.restDeadlineMs).toBe(0); // Sentinel: no active deadline
    expect(executors.onCancelRest).toHaveBeenCalled();
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
  });

  it('should recover to warmup when the upcoming set is still a warmup set', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 10000,
        exerciseIndex: 0,
        setIndex: 1,
        entries: makeEntries(2, [{ warmupSets: 2, targetSets: 1, restSeconds: 60 }]),
      })
    );

    // nowMs == deadline counts as elapsed, matching RestElapsed's guard.
    const state = await engine.dispatch({ tag: 'Resume', nowMs: 10000 });

    expect(state.phase).toBe('warmup');
    expect(state.setIndex).toBe(1); // Position preserved, phase recovered from it
  });
});
