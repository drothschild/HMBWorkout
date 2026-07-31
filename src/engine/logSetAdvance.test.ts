/**
 * One-tap logging: LogSet records the set AND advances the position.
 *
 * Board items 14 + 12: LogSet folds SetDone's advancement in, so each entry
 * accepts exactly warmupSets + targetSets log actions (over-logging becomes
 * structurally impossible) and finishing the last set advances — or completes
 * the workout — without a second tap. SetDone survives as the explicit
 * "advance without logging" event (Skip Set).
 */

import { createEngine } from './index';
import type { SessionState, RoutineEntry } from './types';

function makeEntries(count = 1, overrides?: Partial<RoutineEntry>[]): RoutineEntry[] {
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
    sessionId: 'session-logset-advance',
    routineId: 'routine-logset-advance',
    phase: 'working',
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

/** Executors that record the invocation order of every effect. */
function makeRecordingExecutors() {
  const calls: string[] = [];
  const summaries: any[] = [];
  return {
    calls,
    summaries,
    executors: {
      onCreateSession: jest.fn(() => {
        calls.push('CreateSession');
      }),
      onScheduleRest: jest.fn(() => {
        calls.push('ScheduleRest');
      }),
      onCancelRest: jest.fn(() => {
        calls.push('CancelRest');
      }),
      onNotify: jest.fn(() => {
        calls.push('Notify');
      }),
      onPersistSet: jest.fn(() => {
        calls.push('PersistSet');
      }),
      onCompleteSession: jest.fn((summary: any) => {
        calls.push('CompleteSession');
        summaries.push(summary);
      }),
    },
  };
}

const logSet = (nowMs: number, overrides?: Record<string, number>) =>
  ({
    tag: 'LogSet',
    reps: 8,
    weightKg: 25.0,
    durationSeconds: 0,
    rpe: -1.0,
    nowMs,
    ...overrides,
  }) as any;

describe('LogSet records and advances (one-tap logging)', () => {
  it('mid-exercise with rest configured: persists, advances setIndex, enters resting', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 3, restSeconds: 60 }]),
      })
    );

    const state = await engine.dispatch(logSet(5000));

    expect(state.loggedSets).toHaveLength(1);
    expect(state.loggedSets[0].setType).toBe('working');
    expect(executors.onPersistSet).toHaveBeenCalledTimes(1);
    expect(state.setIndex).toBe(1);
    expect(state.phase).toBe('resting');
    expect(state.restDeadlineMs).toBe(5000 + 60 * 1000);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(65000);
  });

  it('crossing the warmup boundary without rest flips warmup to working', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'warmup',
        entries: makeEntries(1, [{ warmupSets: 1, targetSets: 2, restSeconds: 0 }]),
      })
    );

    const state = await engine.dispatch(logSet(5000, { reps: 5, weightKg: 20.0 }));

    expect(state.loggedSets[0].setType).toBe('warmup');
    expect(state.setIndex).toBe(1);
    expect(state.phase).toBe('working');
  });

  it('final set of an entry advances to the next exercise with rest', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        setIndex: 1,
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 2, restSeconds: 90 },
          { warmupSets: 0, targetSets: 1, restSeconds: 60 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(10000));

    expect(state.loggedSets).toHaveLength(1);
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);
    expect(state.phase).toBe('resting');
    expect(state.restDeadlineMs).toBe(10000 + 90 * 1000);
  });

  it('final set of a superset partner chains to the next exercise without rest', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 90 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(10000));

    expect(state.exerciseIndex).toBe(1);
    expect(state.phase).toBe('working');
    expect(state.supersetPosition).toBe(1);
    expect(state.restDeadlineMs).toBe(0);
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
  });

  it('final set of the final entry completes the workout: PersistSet before CompleteSession, Notify last', async () => {
    const { calls, summaries, executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 1, restSeconds: 60 }]),
      })
    );

    const state = await engine.dispatch(logSet(20000, { rpe: 7.5 }));

    expect(state.phase).toBe('done');
    expect(calls).toEqual(['PersistSet', 'CompleteSession', 'Notify']);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].endMs).toBe(20000);
    expect(summaries[0].setsLogged).toBe(1);
    // The summary must include the set logged by this very dispatch
    expect(summaries[0].loggedSets).toHaveLength(1);
    expect(summaries[0].loggedSets[0].rpe).toBe(7.5);
  });

  it('caps each entry at warmupSets + targetSets log actions', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'warmup',
        entries: makeEntries(1, [{ warmupSets: 1, targetSets: 2, restSeconds: 0 }]),
      })
    );

    let state = await engine.dispatch(logSet(1000));
    state = await engine.dispatch(logSet(2000));
    state = await engine.dispatch(logSet(3000));
    expect(state.phase).toBe('done');
    expect(state.loggedSets).toHaveLength(3);

    // A fourth log action has nowhere to go: the workout is complete
    await expect(engine.dispatch(logSet(4000))).rejects.toThrow(
      /invalid event LogSet in phase done/
    );
    expect(engine.getState().loggedSets).toHaveLength(3);
  });

  it('rejects an invalid set without advancing anything', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 2, restSeconds: 60 }]),
      })
    );

    await expect(engine.dispatch(logSet(5000, { reps: -5 }))).rejects.toThrow(
      /reps must be non-negative/
    );

    const state = engine.getState();
    expect(state.setIndex).toBe(0);
    expect(state.phase).toBe('working');
    expect(state.loggedSets).toHaveLength(0);
  });
});

describe('SetDone remains advance-without-logging (Skip Set)', () => {
  it('advances the position without appending or persisting a set', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 3, restSeconds: 60 }]),
      })
    );

    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });

    expect(state.setIndex).toBe(1);
    expect(state.phase).toBe('resting');
    expect(state.loggedSets).toHaveLength(0);
    expect(executors.onPersistSet).not.toHaveBeenCalled();
  });

  it('agrees with LogSet on completion: skipping the final set completes the workout', async () => {
    const { calls, executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 1, restSeconds: 60 }]),
      })
    );

    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 20000 });

    expect(state.phase).toBe('done');
    expect(calls).toEqual(['CompleteSession', 'Notify']);
  });
});
