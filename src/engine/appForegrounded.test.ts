/**
 * AppForegrounded: the shell dispatches this blind on every OS foreground with
 * a workout in progress. The engine — the only synchronous authority on phase —
 * decides what it means: mid-rest it reconciles the wall-clock deadline exactly
 * like the boot-time Resume arm (re-arm a live rest, recover the phase from an
 * expired one); in every other phase it is a benign no-op. Late RestElapsed
 * ticks from the session screen's countdown are likewise benign in the phases a
 * reconciled rest lands in, so the foreground reconcile and the countdown can
 * race in either order without an engine rejection reaching the error banner.
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
      // warmupSets: 0, targetSets: 1, targetReps: 8, targetDurationSeconds: 0
      sets: [{ setType: 'normal', reps: 8 }],
      restSeconds: 60,
      supersetGroup: '',
      ...overrides?.[i],
    });
  }
  return entries;
}

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-app-foregrounded',
    routineId: 'routine-app-foregrounded',
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

describe('AppForegrounded: mid-rest deadline reconciliation', () => {
  it('recovers the phase from position and cancels the alert when the deadline expired in the background', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10_000, exerciseIndex: 1, setIndex: 0 })
    );

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 50_000 });

    // setIndex 0 of a 0-warmup entry → working, same recovery RestElapsed makes
    expect(state.phase).toBe('working');
    expect(state.restDeadlineMs).toBe(0); // Sentinel: no active deadline
    expect(executors.onCancelRest).toHaveBeenCalled();
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
  });

  it('recovers into warmup when the position is still inside the warmup sets', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 10_000,
        exerciseIndex: 0,
        setIndex: 1,
        entries: makeEntries(2, [
          {
            sets: [
              { setType: 'warmup', reps: 8 },
              { setType: 'warmup', reps: 8 },
              { setType: 'normal', reps: 8 },
            ],
          },
        ]),
      })
    );

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 50_000 });

    expect(state.phase).toBe('warmup');
    expect(state.restDeadlineMs).toBe(0);
    expect(executors.onCancelRest).toHaveBeenCalled();
  });

  it('re-arms the rest alert and keeps resting when the deadline is still live', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 90_000, exerciseIndex: 1 })
    );

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 30_000 });

    expect(state.phase).toBe('resting');
    expect(state.restDeadlineMs).toBe(90_000);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(90_000);
    expect(executors.onCancelRest).not.toHaveBeenCalled();
  });
});

describe('AppForegrounded: benign no-op outside resting', () => {
  it('never un-pauses a deliberately paused session, even with a frozen rest waiting', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'paused',
        restRemainingMs: 42_000,
        prePausePhase: 'working',
        exerciseIndex: 1,
      })
    );

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 500_000 });

    // Contrast with Resume, which would thaw the frozen rest: foregrounding the
    // app is not the user asking to resume.
    expect(state.phase).toBe('paused');
    expect(state.restRemainingMs).toBe(42_000);
    expect(state.prePausePhase).toBe('working');
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
    expect(executors.onCancelRest).not.toHaveBeenCalled();
  });

  it('is a no-op mid-set (working)', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState({ phase: 'working', exerciseIndex: 1 }));

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 500_000 });

    expect(state.phase).toBe('working');
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
    expect(executors.onCancelRest).not.toHaveBeenCalled();
  });

  it('is a no-op with no workout in progress (idle), not an engine rejection', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState({ phase: 'idle' }));

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 500_000 });

    expect(state.phase).toBe('idle');
  });
});

describe('RestElapsed: a straggler tick after the rest was already reconciled is benign', () => {
  // The session screen's countdown dispatches RestElapsed from a closure with a
  // local latch. On foreground, its pending tick and the AppForegrounded
  // reconcile race in unspecified order — whichever lands second must not turn
  // the recovered phase into a red error banner.
  it('is a no-op in working after a foreground reconcile already ended the rest', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({ phase: 'resting', restDeadlineMs: 10_000, exerciseIndex: 1 })
    );
    await engine.dispatch({ tag: 'AppForegrounded', nowMs: 50_000 });

    const state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 50_100 });

    expect(state.phase).toBe('working');
    expect(state.restDeadlineMs).toBe(0);
    // The reconcile's CancelRest already fired; the straggler adds nothing.
    expect(executors.onCancelRest).toHaveBeenCalledTimes(1);
  });

  it('is a no-op in warmup after a foreground reconcile recovered into warmup', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 10_000,
        exerciseIndex: 0,
        setIndex: 1,
        entries: makeEntries(2, [
          {
            sets: [
              { setType: 'warmup', reps: 8 },
              { setType: 'warmup', reps: 8 },
              { setType: 'normal', reps: 8 },
            ],
          },
        ]),
      })
    );
    await engine.dispatch({ tag: 'AppForegrounded', nowMs: 50_000 });

    const state = await engine.dispatch({ tag: 'RestElapsed', nowMs: 50_100 });

    expect(state.phase).toBe('warmup');
    expect(executors.onCancelRest).toHaveBeenCalledTimes(1);
  });

  it('still rejects RestElapsed where no rest could just have ended (idle)', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState({ phase: 'idle' }));

    await expect(
      engine.dispatch({ tag: 'RestElapsed', nowMs: 50_000 })
    ).rejects.toThrow('invalid event RestElapsed in phase idle');
  });
});
