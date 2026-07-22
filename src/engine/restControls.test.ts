/**
 * Rest-timer controls: SkipRest (cancel rest early) and pause/resume that
 * freezes the remaining rest time instead of letting the wall-clock deadline
 * keep running while paused.
 */

import { createEngine } from './index';
import { SessionState, RoutineEntry } from './types';

function makeEntries(count = 2): RoutineEntry[] {
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
