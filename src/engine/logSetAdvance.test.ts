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
import { createSessionPresenter } from '@/state/sessionPresenter';

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

describe('LogSet/SetDone dispatched while already resting', () => {
  // The phase guard on LogSet/SetDone excludes Idle/Done/Paused but not
  // Resting (e.g. logging a set early from the rest screen). Whatever
  // advance_after_set decides next, it must cancel the alert it's superseding
  // in every branch that clears restDeadlineMs — the same discipline
  // RestElapsed, SkipRest, and PauseSession already apply.

  it('cancels the pending rest alert when a mid-exercise set is logged early', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 20000,
        setIndex: 1,
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 3, restSeconds: 60 }]),
      })
    );

    await engine.dispatch({ tag: 'SetDone', nowMs: 15000 });

    expect(executors.onCancelRest).toHaveBeenCalled();
  });

  it('cancels the pending rest alert when a superset partner is reached early', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 20000,
        exerciseIndex: 0,
        setIndex: 0,
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 1, restSeconds: 90, supersetGroup: 'A' },
          { warmupSets: 0, targetSets: 1, restSeconds: 90, supersetGroup: 'A' },
        ]),
      })
    );

    await engine.dispatch(logSet(15000));

    expect(executors.onCancelRest).toHaveBeenCalled();
  });

  it('cancels the pending rest alert when the final set of the workout is logged early, before CompleteSession', async () => {
    const { calls, executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 20000,
        setIndex: 0,
        entries: makeEntries(1, [{ warmupSets: 0, targetSets: 1, restSeconds: 60 }]),
      })
    );

    const state = await engine.dispatch(logSet(15000));

    expect(state.phase).toBe('done');
    expect(executors.onCancelRest).toHaveBeenCalled();
    expect(calls).toEqual(['PersistSet', 'CancelRest', 'CompleteSession', 'Notify']);
  });

  it('cancels the pending rest alert when a landing skips a zero-set entry to reach the next exercise', async () => {
    // The fourth sibling exit alongside the three above (same-entry loop-back,
    // superset hand-off, workoutDone) — the group-exhausted branch's landing
    // on a later exercise, with no new rest configured. Left untested here it
    // would have no signal at all: mutating this exact effects list to []
    // still passes the rest of the suite.
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        phase: 'resting',
        restDeadlineMs: 20000,
        setIndex: 0,
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 1, restSeconds: 0 },
          { warmupSets: 0, targetSets: 0, restSeconds: 0 },
          { warmupSets: 0, targetSets: 1, restSeconds: 0 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(15000));

    expect(state.exerciseIndex).toBe(2);
    expect(state.phase).toBe('working');
    expect(executors.onCancelRest).toHaveBeenCalled();
  });
});

describe('Superset groups with mismatched set counts', () => {
  it('completes all prescribed sets even when members have different total counts', async () => {
    const { executors, summaries } = makeRecordingExecutors();
    const engine = createEngine(executors);
    // A has 2 warmups + 3 working = 5 total
    // B has 0 warmups + 3 working = 3 total
    engine.setState(
      makeState({
        phase: 'warmup',
        entries: makeEntries(2, [
          { warmupSets: 2, targetSets: 3, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 3, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    // Round 1: A1(warmup), B1(working), A2(warmup), B2(working)
    let state = await engine.dispatch(logSet(1000)); // A warmup 1
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);
    expect(state.supersetPosition).toBe(1);

    state = await engine.dispatch(logSet(2000)); // B working 1
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);
    expect(state.supersetPosition).toBe(0);

    state = await engine.dispatch(logSet(3000)); // A warmup 2
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(1);

    state = await engine.dispatch(logSet(4000)); // B working 2
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(2);

    // Round 2: A3(working), B3(working)
    state = await engine.dispatch(logSet(5000)); // A working 1
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(2);

    state = await engine.dispatch(logSet(6000)); // B working 3
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(3);

    // Round 3: A still has sets (5 total), B is exhausted (3 total)
    // A working 2 (round 3)
    state = await engine.dispatch(logSet(7000));
    expect(state.loggedSets).toHaveLength(7);

    // A working 3 (round 3, final set for A)
    state = await engine.dispatch(logSet(8000));
    expect(state.loggedSets).toHaveLength(8);
    expect(state.phase).toBe('done');

    // Verify all sets logged
    expect(summaries).toHaveLength(1);
    expect(summaries[0].setsLogged).toBe(8);
    expect(summaries[0].loggedSets).toHaveLength(8);
  });

  it('handles group with one member having zero target sets', async () => {
    const { executors, summaries } = makeRecordingExecutors();
    const engine = createEngine(executors);
    // A has 0 warmups + 3 working = 3 total
    // B has 0 warmups + 0 working = 0 total (empty exercise in group)
    engine.setState(
      makeState({
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 3, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 0, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    // A 1: B has nothing to do at any round (0 < 0 is never true), so it's
    // never visited — A loops back to itself every round.
    let state = await engine.dispatch(logSet(1000));
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);

    // A 2: same pattern
    state = await engine.dispatch(logSet(2000));
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(2);

    // A 3: final set for A. B was never active for any round, so the group
    // (and here, the whole two-entry workout) completes immediately — B is
    // never something the user has to "get to" and skip past.
    state = await engine.dispatch(logSet(3000));
    expect(state.phase).toBe('done');
    expect(state.loggedSets).toHaveLength(3);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].setsLogged).toBe(3);
  });

  it('tracks isLastSetOfExercise correctly through mismatched superset rounds', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    // A has 2 warmups + 3 working = 5 total
    // B has 0 warmups + 3 working = 3 total
    engine.setState(
      makeState({
        phase: 'warmup',
        entries: makeEntries(2, [
          { warmupSets: 2, targetSets: 3, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 3, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    const mockDispatch = jest.fn();

    // Round 1: A1(warmup), B1(working), A2(warmup), B2(working)
    let state = await engine.dispatch(logSet(1000)); // A warmup 1
    expect(state.exerciseIndex).toBe(1);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(false); // B has 3 total, at index 0

    state = await engine.dispatch(logSet(2000)); // B working 1
    expect(state.exerciseIndex).toBe(0);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(false); // A has 5 total, at index 1

    state = await engine.dispatch(logSet(3000)); // A warmup 2
    expect(state.exerciseIndex).toBe(1);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(false); // B has 3 total, at index 1

    state = await engine.dispatch(logSet(4000)); // B working 2
    expect(state.exerciseIndex).toBe(0);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(false); // A has 5 total, at index 2

    // Round 2: A3(working), B3(working) — B reaches its last set while A continues
    state = await engine.dispatch(logSet(5000)); // A working 1
    expect(state.exerciseIndex).toBe(1);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(true); // B has 3 total, at index 2 (LAST)

    state = await engine.dispatch(logSet(6000)); // B working 3 (last set for B)
    expect(state.exerciseIndex).toBe(0);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(false); // A has 5 total, at index 3

    // Round 3: A still has sets left (5 total), B is exhausted (3 total)
    state = await engine.dispatch(logSet(7000)); // A working 2
    expect(state.exerciseIndex).toBe(0);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(true); // A has 5 total, at index 4

    // A working 3 (final set for A, final set overall)
    state = await engine.dispatch(logSet(8000));
    expect(state.exerciseIndex).toBe(0);
    expect(createSessionPresenter(state, mockDispatch).isLastSetOfExercise).toBe(true); // A has 5 total, at index 4 (LAST) — but phase is done
    expect(state.phase).toBe('done');
  });
});

// A zero-set entry (warmupSets + targetSets === 0) is never active at any
// round (round < 0 is never true), so it must never be landed on — not just
// never LOOPED BACK to, which the group above already gets right. These pin
// the "landing on a fresh entry/group" sites: StartSession, and
// advance_after_set's group-exhausted branch that moves to the next entry.
describe('Zero-set entries are skipped when landed on fresh, not just when looped back to', () => {
  it('StartSession skips a standalone zero-set entries[0], landing directly on entries[1]', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);

    const state = await engine.dispatch({
      tag: 'StartSession',
      sessionId: 'session-zero-standalone',
      nowMs: 1000,
      routine: {
        id: 'routine-zero-standalone',
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 0, restSeconds: 60 },
          { warmupSets: 0, targetSets: 2, restSeconds: 60 },
        ]),
      },
    } as any);

    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);
    expect(state.phase).toBe('working');
    expect(state.loggedSets).toHaveLength(0);
  });

  it('StartSession skips a zero-set entry that is the first member of its own group, landing on its active partner', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);

    const state = await engine.dispatch({
      tag: 'StartSession',
      sessionId: 'session-zero-first-of-group',
      nowMs: 1000,
      routine: {
        id: 'routine-zero-first-of-group',
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 0, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 1, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
        ]),
      },
    } as any);

    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);
    // The landing member's true offset within the group (1), not 0 — proves
    // supersetPosition is tracked from the group's real start, not the index
    // we happened to skip from.
    expect(state.supersetPosition).toBe(1);
    // Derived from the landing entry's own warmupSets, not entries[0]'s.
    expect(state.phase).toBe('warmup');
    expect(state.loggedSets).toHaveLength(0);
  });

  it('StartSession rejects a routine where every entry plans zero total sets', async () => {
    // Not the "instant completion" arm this once was: CreateSession and
    // CompleteSession in the same dispatch has no ordering guarantee the
    // shell can honor (the store assigns currentSessionState only after
    // dispatch returns), so a real store either strands the new session row
    // forever or re-completes whatever the PREVIOUS session was — including
    // a duplicate HealthKit export. Rejecting outright, the same way an
    // empty routine already is, avoids the hazard entirely.
    const { executors, summaries } = makeRecordingExecutors();
    const engine = createEngine(executors);

    await expect(
      engine.dispatch({
        tag: 'StartSession',
        sessionId: 'session-all-zero',
        nowMs: 1000,
        routine: {
          id: 'routine-all-zero',
          entries: makeEntries(2, [
            { warmupSets: 0, targetSets: 0, restSeconds: 60 },
            { warmupSets: 0, targetSets: 0, restSeconds: 60 },
          ]),
        },
      } as any)
    ).rejects.toThrow(/routine has no entry with any sets to perform/);

    expect(executors.onCreateSession).not.toHaveBeenCalled();
    expect(summaries).toHaveLength(0);
  });

  it('advance_after_set skips a standalone zero-set entry reached via the next-group branch', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        setIndex: 1, // about to log the final set of entries[0]
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 2, restSeconds: 0 },
          { warmupSets: 0, targetSets: 0, restSeconds: 0 },
          { warmupSets: 0, targetSets: 1, restSeconds: 60 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(1000)); // final set of entries[0]
    expect(state.exerciseIndex).toBe(2);
    expect(state.setIndex).toBe(0);
    expect(state.loggedSets).toHaveLength(1);
  });

  it('advance_after_set skips a zero-set entry that is the first member of the next group', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        setIndex: 1, // about to log the final set of entries[0]
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 2, restSeconds: 0 },
          { warmupSets: 0, targetSets: 0, supersetGroup: 'B', restSeconds: 0 },
          { warmupSets: 0, targetSets: 2, supersetGroup: 'B', restSeconds: 0 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(1000)); // final set of entries[0]
    expect(state.exerciseIndex).toBe(2);
    expect(state.setIndex).toBe(0);
    expect(state.supersetPosition).toBe(1);
    expect(state.loggedSets).toHaveLength(1);
  });

  it('skips two consecutive entirely-zero groups to land on the first active entry after them', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        setIndex: 1, // about to log the final set of entries[0]
        entries: makeEntries(4, [
          { warmupSets: 0, targetSets: 2, restSeconds: 0 },
          { warmupSets: 0, targetSets: 0, restSeconds: 0 },
          { warmupSets: 0, targetSets: 0, supersetGroup: 'B', restSeconds: 0 },
          { warmupSets: 0, targetSets: 3, supersetGroup: 'B', restSeconds: 0 },
        ]),
      })
    );

    let state = await engine.dispatch(logSet(1000)); // final set of entries[0]
    expect(state.exerciseIndex).toBe(3);
    expect(state.setIndex).toBe(0);
    expect(state.supersetPosition).toBe(1);
    expect(state.loggedSets).toHaveLength(1);

    // The whole reason groupStart is tracked (not just the index skipped
    // from) is so THIS advance_after_set call rederives groupStartIdx as
    // exerciseIndex(3) - supersetPosition(1) = 2 — entries[2]'s true
    // position, the actual start of group B — rather than mistaking
    // entries[3] for its own group's start. Logging entries[3]'s remaining
    // two sets proves it: each loops back to itself (group B has no other
    // active member), and the third exhausts it and completes the workout,
    // rather than landing somewhere wrong or erroring.
    state = await engine.dispatch(logSet(2000));
    expect(state.exerciseIndex).toBe(3);
    expect(state.setIndex).toBe(1);

    state = await engine.dispatch(logSet(3000));
    expect(state.exerciseIndex).toBe(3);
    expect(state.setIndex).toBe(2);

    state = await engine.dispatch(logSet(4000));
    expect(state.phase).toBe('done');
    expect(state.loggedSets).toHaveLength(4);
    expect(state.loggedSets.map((s) => s.exerciseId)).toEqual([
      'exercise-0',
      'exercise-3',
      'exercise-3',
      'exercise-3',
    ]);
  });

  it('does not drop the prescribed rest when a landing skips ahead to an entry that reuses an earlier group label', async () => {
    // Group labels are only required to be contiguous, not unique routine-wide
    // (h.group_end_idx already treats a non-adjacent label repeat as a new
    // group). A landing that now skips a zero-set entry in between must not
    // mistake that label reuse for "still the same superset" and drop the
    // rest — entries[0] and entries[2] both use label 'A', but entries[1]
    // (label 'B') separates them into two unrelated one-member groups.
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 60 },
          { warmupSets: 0, targetSets: 0, supersetGroup: 'B', restSeconds: 0 },
          { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(1000)); // final (only) set of entries[0]
    expect(state.exerciseIndex).toBe(2);
    expect(state.setIndex).toBe(0);
    expect(state.phase).toBe('resting');
    expect(state.restDeadlineMs).toBe(1000 + 60 * 1000);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(61000);
  });
});

describe('Phase recovery across a superset hop when a partner has its own warmup', () => {
  it('derives phase from the landing entry, not the entry being left', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    // A: no warmup, 2 working sets. B: 1 warmup + 1 working = 2 total.
    engine.setState(
      makeState({
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 1, targetSets: 1, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    // A1 (working, A has no warmup) hops to B — B's round 0 is its warmup.
    let state = await engine.dispatch(logSet(1000));
    expect(state.loggedSets[0].setType).toBe('working');
    expect(state.exerciseIndex).toBe(1);
    expect(state.phase).toBe('warmup');

    // B's warmup set loops back to A for round 1 — A has no warmup, so
    // landing there must read 'working', not carry over B's 'warmup'.
    state = await engine.dispatch(logSet(2000));
    expect(state.loggedSets[1].setType).toBe('warmup');
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);
    expect(state.phase).toBe('working');

    // A2 (A's final set) hops to B's round 1 — past B's 1 warmup set, so
    // this lands as B's working set.
    state = await engine.dispatch(logSet(3000));
    expect(state.loggedSets[2].setType).toBe('working');
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(1);
    expect(state.phase).toBe('working');

    // B's working set is its last — group and workout both complete.
    state = await engine.dispatch(logSet(4000));
    expect(state.loggedSets[3].setType).toBe('working');
    expect(state.phase).toBe('done');
    expect(state.loggedSets).toHaveLength(4);
  });

  it('a loop-back can land on a member still inside its own warmup sets', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    // A: 2 warmup + 1 working = 3 total. B: 0 warmup + 3 working = 3 total.
    // Deriving the loop-back's phase from the entry being LEFT (B, always
    // working) rather than the entry being LANDED ON (A) would read
    // 'working' here instead of the correct 'warmup'.
    engine.setState(
      makeState({
        phase: 'warmup',
        entries: makeEntries(2, [
          { warmupSets: 2, targetSets: 1, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 3, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    // A's warmup 1 of 2 hops to B.
    let state = await engine.dispatch(logSet(1000));
    expect(state.loggedSets[0].setType).toBe('warmup');
    expect(state.exerciseIndex).toBe(1);
    expect(state.phase).toBe('working');

    // B's working 1 of 3 loops back to A for round 1 — A is still in its
    // own warmup (round 1 < A's 2 warmup sets), so this must read 'warmup'.
    state = await engine.dispatch(logSet(2000));
    expect(state.loggedSets[1].setType).toBe('working');
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);
    expect(state.phase).toBe('warmup');
    expect(state.loggedSets[1].exerciseId).toBe('exercise-1');
  });
});

describe('Phase derivation when advancing to a genuinely different exercise', () => {
  it('reads the next entry\'s own warmup status, not the previous entry\'s last phase', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    // Two standalone (non-superset) entries. A has no warmup, so its own
    // phase is 'working' right up to its last set. B has a warmup. Base
    // behavior carried A's 'working' phase over onto B; the round-robin
    // rewrite instead derives B's phase from B's own warmupSets.
    engine.setState(
      makeState({
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 1, supersetGroup: '', restSeconds: 0 },
          { warmupSets: 1, targetSets: 1, supersetGroup: '', restSeconds: 0 },
        ]),
      })
    );

    const state = await engine.dispatch(logSet(1000));
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);
    expect(state.phase).toBe('warmup');
  });
});

describe('Three-member superset groups', () => {
  it('correctly alternates all three members for multiple rounds', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
        ]),
      })
    );

    // Round 1: A1 set 1, A2 set 1, A3 set 1
    let state = await engine.dispatch(logSet(1000)); // A1 set 1
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);

    state = await engine.dispatch(logSet(2000)); // A2 set 1
    expect(state.exerciseIndex).toBe(2);
    expect(state.setIndex).toBe(0);

    state = await engine.dispatch(logSet(3000)); // A3 set 1
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);

    // Round 2: A1 set 2, A2 set 2, A3 set 2
    state = await engine.dispatch(logSet(4000)); // A1 set 2
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(1);

    state = await engine.dispatch(logSet(5000)); // A2 set 2
    expect(state.exerciseIndex).toBe(2);
    expect(state.setIndex).toBe(1);

    state = await engine.dispatch(logSet(6000)); // A3 set 2
    expect(state.phase).toBe('done');

    // 6 sets total
    expect(state.loggedSets).toHaveLength(6);
  });
});

describe('Superset group followed by standalone exercise', () => {
  it('transitions correctly from group to next entry', async () => {
    const { executors } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, targetSets: 1, supersetGroup: 'A', restSeconds: 90 },
          { warmupSets: 0, targetSets: 1, supersetGroup: '', restSeconds: 60 },
        ]),
      })
    );

    let state = await engine.dispatch(logSet(1000)); // A1 set 1
    expect(state.exerciseIndex).toBe(1);

    state = await engine.dispatch(logSet(2000)); // A2 set 1
    // Should now move to exercise 2 (standalone)
    expect(state.exerciseIndex).toBe(2);
    expect(state.phase).toBe('resting');
    // Rest between superset group and next exercise
    expect(state.restDeadlineMs).toBe(2000 + 90 * 1000);

    const restState = await engine.dispatch({ tag: 'RestElapsed', nowMs: 2000 + 91 * 1000 });
    expect(restState.phase).toBe('working');
    expect(restState.exerciseIndex).toBe(2);
    expect(restState.setIndex).toBe(0);
  });
});

describe('Pause/Resume mid-superset-round', () => {
  it('preserves position when pausing and resuming mid-round', async () => {
    const engine = createEngine({});
    engine.setState(
      makeState({
        entries: makeEntries(2, [
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 60 },
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 60 },
        ]),
      })
    );

    let state = await engine.dispatch(logSet(1000)); // A1 set 1
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);

    state = await engine.dispatch({ tag: 'PauseSession', nowMs: 2000 });
    expect(state.phase).toBe('paused');
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);

    state = await engine.dispatch({ tag: 'Resume', nowMs: 3000 });
    expect(state.phase).toBe('working');
    expect(state.exerciseIndex).toBe(1);
    expect(state.setIndex).toBe(0);

    state = await engine.dispatch(logSet(4000)); // A2 set 1
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);
  });
});

describe('FinishSession mid-superset-round', () => {
  it('correctly reports exercisesCompleted as distinct entries with logged sets', async () => {
    const { executors, summaries } = makeRecordingExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: makeEntries(3, [
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 2, supersetGroup: 'A', restSeconds: 0 },
          { warmupSets: 0, targetSets: 2, supersetGroup: '', restSeconds: 0 },
        ]),
      })
    );

    let state = await engine.dispatch(logSet(1000)); // A1 -> hop to B, exerciseIndex 1
    state = await engine.dispatch(logSet(2000)); // B1 -> loop back to A for round 2, exerciseIndex 0
    state = await engine.dispatch(logSet(3000)); // A2 -> hop to B again, exerciseIndex 1

    // Finish mid-round, sitting at exerciseIndex 1 (B) with two distinct
    // exercises (A and B) having logged sets. The raw exerciseIndex (1) would
    // undercount relative to the correct answer (2) — this is exactly the
    // non-monotonic-exerciseIndex case exercisesCompleted must not use.
    expect(state.exerciseIndex).toBe(1);
    state = await engine.dispatch({ tag: 'FinishSession', nowMs: 4000 });
    expect(state.phase).toBe('done');

    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    expect(summary.setsLogged).toBe(3);
    expect(summary.exercisesCompleted).toBe(2);
  });
});
