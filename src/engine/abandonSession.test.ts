/**
 * AbandonSession: the engine-side decision to throw an in-progress workout away.
 *
 * Abandon is not completion. It must never emit CompleteSession (which drives
 * the HealthKit export); it emits DiscardSession so the
 * shell can delete the session and its sets outright, and it returns the engine
 * to a clean Idle state so a new session can start immediately afterwards.
 */

import { createEngine } from './index';
import { SessionState, Event } from './types';

type Executors = Parameters<typeof createEngine>[0];

function makeExecutors(overrides?: Partial<Executors>) {
  return {
    onCreateSession: jest.fn(),
    onScheduleRest: jest.fn(),
    onCancelRest: jest.fn(),
    onNotify: jest.fn(),
    onPersistSet: jest.fn(),
    onCompleteSession: jest.fn(),
    onDiscardSession: jest.fn(),
    ...overrides,
  };
}

function makeEntry(overrides?: Partial<SessionState['entries'][number]>) {
  return {
    idx: 0,
    exerciseId: 'ex-1',
    kind: 'strength' as const,
    warmupSets: 1,
    targetSets: 3,
    targetReps: 8,
    targetDurationSeconds: 0,
    restSeconds: 90,
    supersetGroup: '',
    ...overrides,
  };
}

/** A mid-workout state with real logged work in it, parameterised by phase. */
function makeInProgressState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-abandon-1',
    routineId: 'routine-1',
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 1,
    supersetPosition: 0,
    restDeadlineMs: 0,
    restRemainingMs: 0,
    prePausePhase: '',
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
    lastLoggedSet: undefined,
    startedAtMs: 1000,
    entries: [makeEntry()],
    ...overrides,
  };
}

const ABANDON: Event = { tag: 'AbandonSession' };

describe('AbandonSession — accepted from every in-progress phase', () => {
  const inProgressPhases: SessionState['phase'][] = [
    'warmup',
    'working',
    'resting',
    'paused',
  ];

  it.each(inProgressPhases)('returns the engine to idle from %s', async (phase) => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeInProgressState({ phase }));

    const newState = await engine.dispatch(ABANDON);

    expect(newState.phase).toBe('idle');
  });

  it.each(inProgressPhases)('emits DiscardSession for the abandoned session id from %s', async (phase) => {
    const onDiscardSession = jest.fn();
    const engine = createEngine(makeExecutors({ onDiscardSession }));
    engine.setState(makeInProgressState({ phase }));

    await engine.dispatch(ABANDON);

    expect(onDiscardSession).toHaveBeenCalledWith('session-abandon-1');
  });

  it.each(inProgressPhases)('never completes the session from %s', async (phase) => {
    const onCompleteSession = jest.fn();
    const onNotify = jest.fn();
    const engine = createEngine(makeExecutors({ onCompleteSession, onNotify }));
    engine.setState(makeInProgressState({ phase }));

    await engine.dispatch(ABANDON);

    // CompleteSession is the effect that triggers the HealthKit export. Abandon
    // firing it would silently publish a discarded workout.
    expect(onCompleteSession).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('clears all session identity and logged work off the state', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeInProgressState({ exerciseIndex: 2, setIndex: 3, supersetPosition: 1 }));

    const newState = await engine.dispatch(ABANDON);

    expect(newState.sessionId).toBe('');
    expect(newState.routineId).toBe('');
    expect(newState.loggedSets).toEqual([]);
    expect(newState.entries).toEqual([]);
    expect(newState.exerciseIndex).toBe(0);
    expect(newState.setIndex).toBe(0);
    expect(newState.supersetPosition).toBe(0);
    expect(newState.startedAtMs).toBe(0);
  });

  it('stays JSON-serializable so a kill after abandon rehydrates nothing live', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeInProgressState({ phase: 'resting', restDeadlineMs: 99_000 }));

    const newState = await engine.dispatch(ABANDON);

    const roundTripped = JSON.parse(JSON.stringify(newState));
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(newState)));
    expect(roundTripped.phase).toBe('idle');
    expect(roundTripped.sessionId).toBe('');
  });
});

describe('AbandonSession — armed rest timers', () => {
  it('cancels a running rest timer when abandoning mid-rest', async () => {
    const onCancelRest = jest.fn();
    const engine = createEngine(makeExecutors({ onCancelRest }));
    engine.setState(makeInProgressState({ phase: 'resting', restDeadlineMs: 99_000 }));

    await engine.dispatch(ABANDON);

    // A scheduled rest notification would otherwise fire for a workout that no
    // longer exists.
    expect(onCancelRest).toHaveBeenCalled();
  });

  it('does not cancel rest when no timer is armed', async () => {
    const onCancelRest = jest.fn();
    const engine = createEngine(makeExecutors({ onCancelRest }));
    engine.setState(makeInProgressState({ phase: 'working', restDeadlineMs: 0 }));

    await engine.dispatch(ABANDON);

    expect(onCancelRest).not.toHaveBeenCalled();
  });

  it('clears a rest remainder frozen by an earlier pause', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeInProgressState({ phase: 'paused', restRemainingMs: 45_000, prePausePhase: 'resting' })
    );

    const newState = await engine.dispatch(ABANDON);

    expect(newState.restDeadlineMs).toBe(0);
    expect(newState.restRemainingMs).toBe(0);
    expect(newState.prePausePhase).toBe('');
  });
});

describe('AbandonSession — phases that reject it', () => {
  it('rejects abandoning when there is no session (idle)', async () => {
    const onDiscardSession = jest.fn();
    const engine = createEngine(makeExecutors({ onDiscardSession }));
    engine.setState(makeInProgressState({ phase: 'idle' }));

    await expect(engine.dispatch(ABANDON)).rejects.toThrow(
      'invalid event AbandonSession in phase idle'
    );
    expect(onDiscardSession).not.toHaveBeenCalled();
  });

  it('rejects abandoning a session that already completed (done)', async () => {
    const onDiscardSession = jest.fn();
    const engine = createEngine(makeExecutors({ onDiscardSession }));
    engine.setState(makeInProgressState({ phase: 'done' }));

    // A done session is already written and exported; removing it is a
    // different operation from abandoning one in progress.
    await expect(engine.dispatch(ABANDON)).rejects.toThrow(
      'invalid event AbandonSession in phase done'
    );
    expect(onDiscardSession).not.toHaveBeenCalled();
  });

  it('preserves the prior state when the abandon is rejected', async () => {
    const engine = createEngine(makeExecutors());
    const doneState = makeInProgressState({ phase: 'done' });
    engine.setState(doneState);

    await expect(engine.dispatch(ABANDON)).rejects.toThrow();

    expect(engine.getState()).toEqual(doneState);
  });
});

describe('AbandonSession — the engine is reusable afterwards', () => {
  it('accepts a brand new StartSession immediately after an abandon', async () => {
    const onCreateSession = jest.fn();
    const engine = createEngine(makeExecutors({ onCreateSession }));
    engine.setState(makeInProgressState());

    await engine.dispatch(ABANDON);

    const started = await engine.dispatch({
      tag: 'StartSession',
      sessionId: 'session-after-abandon',
      nowMs: 7000,
      routine: { id: 'routine-2', entries: [makeEntry({ exerciseId: 'ex-2' })] },
    });

    expect(started.sessionId).toBe('session-after-abandon');
    expect(started.phase).toBe('warmup');
    expect(started.loggedSets).toEqual([]);
    expect(onCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-after-abandon' })
    );
  });
});
