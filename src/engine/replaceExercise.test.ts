/**
 * ReplaceExercise: swap the exercise of the entry the athlete is currently
 * facing, without disturbing its targets, warmups, rest, kind or superset
 * grouping — alternates change identity only.
 *
 * The rule is the authority on when a swap is legal. Two guards carry the
 * weight:
 *
 *  - `setIndex == 0` — nothing has been recorded against this entry yet. Both
 *    LogSet and SetDone advance setIndex, and it resets to 0 on every entry
 *    change, so it is an exactly entry-scoped "untouched" test. Matching
 *    `loggedSets` by exerciseId would not be: a routine may list the same
 *    movement twice, and the second entry would inherit the first's veto.
 *  - `idx == exerciseIndex` — the choice is about the entry on screen. The
 *    alternates arrive from a network round-trip, so the workout may have
 *    advanced underneath the picker; a stale pick must be rejected, not
 *    applied to whatever entry happens to be current now.
 */

import { createEngine } from './index';
import type { RoutineEntry, SessionState } from './types';

function makeEntries(count = 3): RoutineEntry[] {
  const entries: RoutineEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      idx: i,
      exerciseId: `exercise-${i}`,
      kind: 'strength',
      // warmupSets: 1, targetSets: 3, targetReps: 8, targetDurationSeconds: 0
      sets: [
        { setType: 'warmup', reps: 8 },
        { setType: 'normal', reps: 8 },
        { setType: 'normal', reps: 8 },
        { setType: 'normal', reps: 8 },
      ],
      restSeconds: 90,
      supersetGroup: '',
    });
  }
  return entries;
}

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-replace',
    routineId: 'routine-replace',
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: 0,
    restRemainingMs: 0,
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
    onDiscardSession: jest.fn(),
  };
}

describe('ReplaceExercise: swapping the current exercise', () => {
  it('swaps only the targeted entry’s exerciseId', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 1 }));

    const state = await engine.dispatch({
      tag: 'ReplaceExercise',
      idx: 1,
      exerciseId: 'incline-db-press',
    });

    expect(state.entries[1].exerciseId).toBe('incline-db-press');
    expect(state.entries[0].exerciseId).toBe('exercise-0');
    expect(state.entries[2].exerciseId).toBe('exercise-2');
  });

  it('leaves the entry’s prescription untouched — alternates change identity only', async () => {
    const engine = createEngine(makeExecutors());
    const before = makeState({
      exerciseIndex: 0,
      entries: [
        {
          idx: 0,
          exerciseId: 'barbell-bench-press',
          kind: 'strength',
          restSeconds: 150,
          supersetGroup: 'A',
          sets: [
            { setType: 'warmup', reps: 6 },
            { setType: 'warmup', reps: 6 },
            { setType: 'normal', reps: 6 },
            { setType: 'normal', reps: 6 },
            { setType: 'normal', reps: 6 },
            { setType: 'normal', reps: 6 },
          ],
        },
      ],
    });
    engine.setState(before);

    const state = await engine.dispatch({
      tag: 'ReplaceExercise',
      idx: 0,
      exerciseId: 'dumbbell-floor-press',
    });

    // The prescription is an ordered set list (#276 Phase 6) that the rule
    // rebuilds with only `exerciseId` changed — the rest of the entry,
    // including `sets`, survives the swap untouched.
    expect(state.entries[0]).toEqual({
      idx: 0,
      exerciseId: 'dumbbell-floor-press',
      kind: 'strength',
      restSeconds: 150,
      supersetGroup: 'A',
      sets: [
        { setType: 'warmup', reps: 6 },
        { setType: 'warmup', reps: 6 },
        { setType: 'normal', reps: 6 },
        { setType: 'normal', reps: 6 },
        { setType: 'normal', reps: 6 },
        { setType: 'normal', reps: 6 },
      ],
    });
  });

  it('preserves the rest of the session state', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(
      makeState({
        exerciseIndex: 2,
        loggedSets: [
          {
            exerciseId: 'exercise-0',
            setType: 'working',
            reps: 8,
            weightKg: 60,
            durationSeconds: undefined,
            rpe: 7,
          },
        ],
      })
    );

    const state = await engine.dispatch({
      tag: 'ReplaceExercise',
      idx: 2,
      exerciseId: 'cable-fly',
    });

    expect(state.phase).toBe('working');
    expect(state.exerciseIndex).toBe(2);
    expect(state.setIndex).toBe(0);
    expect(state.sessionId).toBe('session-replace');
    expect(state.routineId).toBe('routine-replace');
    expect(state.loggedSets).toHaveLength(1);
    expect(state.loggedSets[0].exerciseId).toBe('exercise-0');
  });

  it('re-derives idx as array position, so the rebuilt list stays 0-based order', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 1, entries: makeEntries(4) }));

    const state = await engine.dispatch({
      tag: 'ReplaceExercise',
      idx: 1,
      exerciseId: 'goblet-squat',
    });

    expect(state.entries.map((entry) => entry.idx)).toEqual([0, 1, 2, 3]);
    expect(state.entries).toHaveLength(4);
  });

  it('emits no effects — the swap is state-only', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState());

    await engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'push-up' });

    expect(executors.onPersistSet).not.toHaveBeenCalled();
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
    expect(executors.onCancelRest).not.toHaveBeenCalled();
    expect(executors.onNotify).not.toHaveBeenCalled();
    expect(executors.onCompleteSession).not.toHaveBeenCalled();
    expect(executors.onDiscardSession).not.toHaveBeenCalled();
    expect(executors.onCreateSession).not.toHaveBeenCalled();
  });

  it('leaves the state JSON-serializable, so it survives persist and rehydrate', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 1 }));

    const state = await engine.dispatch({
      tag: 'ReplaceExercise',
      idx: 1,
      exerciseId: 'romanian-deadlift',
    });

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('applies during warmup too — nothing is committed until a set lands', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ phase: 'warmup' }));

    const state = await engine.dispatch({
      tag: 'ReplaceExercise',
      idx: 0,
      exerciseId: 'band-pull-apart',
    });

    expect(state.entries[0].exerciseId).toBe('band-pull-apart');
    expect(state.phase).toBe('warmup');
  });
});

describe('ReplaceExercise: guards', () => {
  it('rejects once a set has been recorded against the entry', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ setIndex: 1 }));

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'pec-deck' })
    ).rejects.toThrow(/set has already been recorded/);
  });

  it('leaves the entries untouched when the recorded-set guard rejects', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ setIndex: 2 }));

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'pec-deck' })
    ).rejects.toThrow();

    expect(engine.getState().entries[0].exerciseId).toBe('exercise-0');
  });

  it('rejects a stale pick that names an entry other than the current one', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 1 }));

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'pec-deck' })
    ).rejects.toThrow(/current exercise/);
  });

  it('rejects an empty exerciseId', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState());

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: '' })
    ).rejects.toThrow(/exerciseId/);
  });

  it('rejects an index past the end of the entries list', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 9 }));

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 9, exerciseId: 'pec-deck' })
    ).rejects.toThrow();
  });

  it.each(['idle', 'done', 'resting', 'paused'] as const)(
    'rejects in phase %s',
    async (phase) => {
      const engine = createEngine(makeExecutors());
      engine.setState(makeState({ phase }));

      await expect(
        engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'pec-deck' })
      ).rejects.toThrow(new RegExp(`invalid event ReplaceExercise in phase ${phase}`));
    }
  );
});

describe('ReplaceExercise: setIndex==0 guard stays sound across a superset hop', () => {
  function makeSupersetEntries(): RoutineEntry[] {
    return [
      {
        idx: 0,
        exerciseId: 'exercise-a',
        kind: 'strength',
        // warmupSets: 0, targetSets: 2, targetReps: 8, targetDurationSeconds: 0
        sets: [
          { setType: 'normal', reps: 8 },
          { setType: 'normal', reps: 8 },
        ],
        restSeconds: 0,
        supersetGroup: 'X',
      },
      {
        idx: 1,
        exerciseId: 'exercise-b',
        kind: 'strength',
        // warmupSets: 0, targetSets: 2, targetReps: 8, targetDurationSeconds: 0
        sets: [
          { setType: 'normal', reps: 8 },
          { setType: 'normal', reps: 8 },
        ],
        restSeconds: 0,
        supersetGroup: 'X',
      },
    ];
  }

  it('accepts a swap on a partner reached only via a same-round hop (genuinely untouched)', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 0, setIndex: 0, entries: makeSupersetEntries() }));

    // A1 hands off to B for the same round — B has never been logged.
    const afterHop = await engine.dispatch({ tag: 'LogSet', reps: 8, weightKg: 20, nowMs: 1000 });
    expect(afterHop.exerciseIndex).toBe(1);
    expect(afterHop.setIndex).toBe(0);

    const state = await engine.dispatch({ tag: 'ReplaceExercise', idx: 1, exerciseId: 'exercise-c' });
    expect(state.entries[1].exerciseId).toBe('exercise-c');
  });

  it('rejects a swap on a member with real logged history from an earlier round', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState(makeState({ exerciseIndex: 0, setIndex: 0, entries: makeSupersetEntries() }));

    // A1 -> hop to B (round 0). B1 -> loop back to A for round 1: A now has
    // one real logged set even though setIndex reset to a shared value.
    await engine.dispatch({ tag: 'LogSet', reps: 8, weightKg: 20, nowMs: 1000 });
    const backOnA = await engine.dispatch({ tag: 'LogSet', reps: 8, weightKg: 25, nowMs: 2000 });
    expect(backOnA.exerciseIndex).toBe(0);
    expect(backOnA.setIndex).toBe(1);
    expect(backOnA.loggedSets).toHaveLength(2);

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'exercise-c' })
    ).rejects.toThrow(/set has already been recorded/);
  });
});

describe('ReplaceExercise: the swapped exercise is what the session then logs', () => {
  it('logs the replacement’s id, not the original’s', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState({
        entries: [
          {
            idx: 0,
            exerciseId: 'barbell-row',
            kind: 'strength',
            // warmupSets: 0, targetSets: 3, targetReps: 10, targetDurationSeconds: 0
            sets: [
              { setType: 'normal', reps: 10 },
              { setType: 'normal', reps: 10 },
              { setType: 'normal', reps: 10 },
            ],
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      })
    );

    await engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'chest-supported-row' });
    const state = await engine.dispatch({
      tag: 'LogSet',
      reps: 10,
      weightKg: 40,
      nowMs: 2000,
    });

    expect(state.loggedSets[0].exerciseId).toBe('chest-supported-row');
    expect(executors.onPersistSet).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 'chest-supported-row' })
    );
  });
});
