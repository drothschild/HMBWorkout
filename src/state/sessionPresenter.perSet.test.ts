/**
 * #276 Phase 3 — the session reads the plan set by set.
 *
 * Kept apart from `sessionPresenter.test.ts` because its fixtures are the
 * opposite shape: every entry here carries a real `sets` list and deliberately
 * WRONG aggregate counts, so a reader that still consults `warmupSets` /
 * `targetSets` cannot pass. The sibling file's count-shaped fixtures stay
 * meaningful — they exercise the derivation seam that Phase 6 removes.
 */

import { computeSetPrefill, createSessionPresenter, deriveSetPosition } from './sessionPresenter';
import type { RoutineEntry, RoutineSet, SessionState } from '@/engine/types';

/**
 * RAMP: three warmups at ascending loads, then four working sets in a rep
 * range. The real Hevy payload for Bench Press (Dumbbell). The aggregate model
 * can hold only the number 3 for the warmups, so any regression to counts
 * collapses the ramp to a single weight.
 */
export const RAMP: RoutineSet[] = [
  { setType: 'warmup', reps: 5, weightKg: 9.07 },
  { setType: 'warmup', reps: 5, weightKg: 11.34 },
  { setType: 'warmup', reps: 3, weightKg: 18.14 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
];

/**
 * INTERLEAVE: no count pair reproduces this order. `warmupSets: 2` expands to
 * [w, w, n]; `warmupSets: 1` to [w, n, n]. The old `setIndex - warmupSets + 1`
 * arithmetic gives "Set 0" at index 2.
 */
export const INTERLEAVE: RoutineSet[] = [
  { setType: 'warmup', reps: 5 },
  { setType: 'normal', reps: 8 },
  { setType: 'warmup', reps: 5 },
];

export function perSetEntry(sets: RoutineSet[], over: Partial<RoutineEntry> = {}): RoutineEntry {
  return {
    idx: 0,
    exerciseId: 'bench-press-dumbbell',
    kind: 'strength',
    // Deliberately unrepresentative aggregates — see the file docstring.
    warmupSets: 99,
    targetSets: 99,
    targetReps: 99,
    targetDurationSeconds: 0,
    restSeconds: 120,
    supersetGroup: '',
    sets,
    ...over,
  };
}

export function perSetState(
  entries: RoutineEntry[],
  over: Partial<SessionState> = {}
): SessionState {
  return {
    sessionId: 'session-ramp',
    routineId: 'routine-ramp',
    phase: 'warmup',
    exerciseIndex: 0,
    setIndex: 0,
    startedAtMs: 1_700_000_000_000,
    loggedSets: [],
    entries,
    prePausePhase: '',
    ...over,
  };
}

describe('deriveSetPosition (#276 AC3.3)', () => {
  test('counts within the run of same-typed sets on INTERLEAVE', () => {
    const entry = perSetEntry(INTERLEAVE);
    const at = (setIndex: number) => deriveSetPosition(perSetState([entry], { setIndex }), entry);

    expect(at(0)).toEqual({ isWarmupSet: true, setNumber: 1, totalOfType: 2 });
    // The count arithmetic gives setNumber 0 here for warmupSets 2, and
    // "Warmup 2" for warmupSets 3. Neither is "Set 1".
    expect(at(1)).toEqual({ isWarmupSet: false, setNumber: 1, totalOfType: 1 });
    expect(at(2)).toEqual({ isWarmupSet: true, setNumber: 2, totalOfType: 2 });
  });

  test('RAMP: the third warmup is 3 of 3 and the first working set is 1 of 4', () => {
    const entry = perSetEntry(RAMP);

    expect(deriveSetPosition(perSetState([entry], { setIndex: 2 }), entry)).toEqual({
      isWarmupSet: true,
      setNumber: 3,
      totalOfType: 3,
    });
    expect(deriveSetPosition(perSetState([entry], { setIndex: 3 }), entry)).toEqual({
      isWarmupSet: false,
      setNumber: 1,
      totalOfType: 4,
    });
  });

  test('returns null when there is no current entry', () => {
    expect(deriveSetPosition(perSetState([]), undefined)).toBeNull();
  });

  test('EMPTY: an entry prescribing nothing reports a zero denominator, not a crash', () => {
    const entry = perSetEntry([], { warmupSets: 0, targetSets: 0, targetReps: 0 });
    expect(deriveSetPosition(perSetState([entry]), entry)).toEqual({
      isWarmupSet: false,
      setNumber: 1,
      totalOfType: 0,
    });
  });

  test('an out-of-range setIndex reports a zero denominator rather than inventing one', () => {
    // Reachable through `hydrate`, which no rule validates (convention 5).
    const entry = perSetEntry([{ setType: 'warmup', reps: 5 }]);
    expect(deriveSetPosition(perSetState([entry], { setIndex: 4 }), entry)).toEqual({
      isWarmupSet: false,
      setNumber: 1,
      totalOfType: 0,
    });
  });

  test('reads the counts when the entry predates per-set (rehydrated state)', () => {
    const legacy: RoutineEntry = {
      idx: 0,
      exerciseId: 'ex-1',
      kind: 'strength',
      warmupSets: 1,
      targetSets: 3,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 90,
      supersetGroup: '',
    };
    expect(deriveSetPosition(perSetState([legacy], { setIndex: 2 }), legacy)).toEqual({
      isWarmupSet: false,
      setNumber: 2,
      totalOfType: 3,
    });
  });
});

describe('setPositionLabel and isLastSetOfExercise, per-set (#276 AC3.4, AC3.6)', () => {
  const present = (entry: RoutineEntry, setIndex: number) =>
    createSessionPresenter(perSetState([entry], { setIndex }), jest.fn(async () => null));

  test('AC3.4: RAMP renders "Warmup 2 of 3" and "Set 1 of 4"', () => {
    const entry = perSetEntry(RAMP);
    expect(present(entry, 1).setPositionLabel).toBe('Warmup 2 of 3');
    expect(present(entry, 3).setPositionLabel).toBe('Set 1 of 4');
    expect(present(entry, 6).setPositionLabel).toBe('Set 4 of 4');
  });

  test('AC3.4: totalSetsForEntry is the list length, not the aggregate sum', () => {
    // The fixture's counts sum to 198; the list is 7 long.
    expect(present(perSetEntry(RAMP), 0).totalSetsForEntry).toBe(7);
  });

  test('AC3.3: INTERLEAVE renders "Warmup 1 of 2", "Set 1 of 1", "Warmup 2 of 2"', () => {
    const entry = perSetEntry(INTERLEAVE);
    expect(present(entry, 0).setPositionLabel).toBe('Warmup 1 of 2');
    expect(present(entry, 1).setPositionLabel).toBe('Set 1 of 1');
    expect(present(entry, 2).setPositionLabel).toBe('Warmup 2 of 2');
  });

  test('AC3.5: EMPTY suppresses the label entirely', () => {
    const entry = perSetEntry([], { warmupSets: 0, targetSets: 0 });
    const presenter = present(entry, 0);
    expect(presenter.setPositionLabel).toBe('');
    expect(presenter.totalSetsForEntry).toBe(0);
  });

  test('AC3.6: isLastSetOfExercise is setIndex === sets.length - 1 on RAMP', () => {
    const entry = perSetEntry(RAMP);
    expect(present(entry, 5).isLastSetOfExercise).toBe(false);
    expect(present(entry, 6).isLastSetOfExercise).toBe(true);
  });

  test('AC3.6: MISMATCH — the shorter partner’s own last set is true at round 1', () => {
    // Member A prescribes 3 sets, member B 2. B is visited at rounds 0 and 1
    // and dropped thereafter; round 1 IS B's last set even though the group
    // continues for A's third round (engine convention 9).
    const memberA = perSetEntry(
      [
        { setType: 'normal', reps: 8 },
        { setType: 'normal', reps: 8 },
        { setType: 'normal', reps: 8 },
      ],
      { idx: 0, exerciseId: 'member-a', supersetGroup: 'G5' }
    );
    const memberB = perSetEntry(
      [
        { setType: 'normal', reps: 12 },
        { setType: 'normal', reps: 12 },
      ],
      { idx: 1, exerciseId: 'member-b', supersetGroup: 'G5' }
    );

    const atB = (setIndex: number) =>
      createSessionPresenter(
        perSetState([memberA, memberB], { exerciseIndex: 1, supersetPosition: 1, setIndex }),
        jest.fn(async () => null)
      );

    expect(atB(0).isLastSetOfExercise).toBe(false);
    expect(atB(1).isLastSetOfExercise).toBe(true);
    // A is still going at the same shared round number.
    const atA = createSessionPresenter(
      perSetState([memberA, memberB], { exerciseIndex: 0, supersetPosition: 0, setIndex: 1 }),
      jest.fn(async () => null)
    );
    expect(atA.isLastSetOfExercise).toBe(false);
  });

  test('AC3.6: EMPTY is never the last set (there is no set to be last)', () => {
    expect(present(perSetEntry([], { warmupSets: 0, targetSets: 0 }), 0).isLastSetOfExercise).toBe(
      false
    );
  });

  test('currentSetDurationSeconds is the current set’s own target, not the entry’s', () => {
    const entry = perSetEntry(
      [
        { setType: 'normal', durationSeconds: 30 },
        { setType: 'normal', durationSeconds: 45 },
      ],
      { kind: 'stretch', targetDurationSeconds: 999 }
    );
    expect(present(entry, 0).currentSetDurationSeconds).toBe(30);
    expect(present(entry, 1).currentSetDurationSeconds).toBe(45);
  });

  test('currentSetDurationSeconds is undefined for a set that prescribes none', () => {
    expect(present(perSetEntry(RAMP), 0).currentSetDurationSeconds).toBeUndefined();
    expect(
      present(perSetEntry([], { warmupSets: 0, targetSets: 0 }), 0).currentSetDurationSeconds
    ).toBeUndefined();
  });

  test('the routine-description gate skips a leading empty-set entry', () => {
    // startingExerciseIndex must find the first entry the engine can land on,
    // which under per-set is the first with a non-empty list.
    const ghost = perSetEntry([], { idx: 0, exerciseId: 'ghost', warmupSets: 0, targetSets: 0 });
    const real = perSetEntry(RAMP, { idx: 1, exerciseId: 'real' });
    const presenter = createSessionPresenter(
      perSetState([ghost, real], { exerciseIndex: 1 }),
      jest.fn(async () => null),
      undefined,
      undefined,
      { name: 'Push', notes: 'Ramp the warmups.' }
    );
    expect(presenter.routineNotes).toBe('Ramp the warmups.');
  });
});

/**
 * THE NEW PRECEDENCE (#276 AC3.7–AC3.9). Three terms became two, and the
 * middle term moved from the exercise to the set.
 *
 *   weight   1. this session's own last set for this exercise
 *            2. THE CURRENT SET'S OWN target_weight_kg   <- was a per-exercise
 *                                                           prescription
 *            3. cross-session history
 *            (no terminal — a plan with no load prefills no weight)
 *
 *   reps     1. this session's own last set for this exercise
 *            2. cross-session history
 *            3. the current set's own target_reps
 *
 *   duration 1. this session's own last set (duration-based entries only)
 *            2. the current set's own target_duration_seconds
 *
 * `prescribedSets` is the caller's FRESH read of `routine_sets`, indexed by
 * `setIndex` here so the index arithmetic is under test. It is not taken off
 * engine state on purpose: see `routineSetPlans.ts`.
 */
describe('computeSetPrefill, per-set (#276 AC3.7–AC3.9)', () => {
  const ramp = () => perSetEntry(RAMP);
  const prescribedRamp = RAMP.map((set) => ({ targetWeightKg: set.weightKg }));

  test('AC3.7: RAMP at index 1 prefills 11.34 kg — not 9.07 and not 22.68', () => {
    const prefill = computeSetPrefill(
      perSetState([ramp()], { setIndex: 1 }),
      undefined,
      prescribedRamp
    );
    // 11.34 kg → 25 lb; 9.07 → 20 lb; 22.68 → 50 lb.
    expect(prefill).toEqual({ reps: 5, weightLbs: 25 });
  });

  test('AC3.7: every index of RAMP gets its own load, not one value for all seven', () => {
    const weights = RAMP.map(
      (_set, setIndex) =>
        computeSetPrefill(perSetState([ramp()], { setIndex }), undefined, prescribedRamp)?.weightLbs
    );
    expect(weights).toEqual([20, 25, 40, 50, 50, 50, 50]);
  });

  test('AC3.7: reps come from the current set too — the ramp’s third warmup is 3', () => {
    expect(
      computeSetPrefill(perSetState([ramp()], { setIndex: 2 }), undefined, prescribedRamp)?.reps
    ).toBe(3);
  });

  test('AC3.8 rank 1: this session’s own last set outranks the prescribed set', () => {
    const state = perSetState([ramp()], {
      setIndex: 3,
      loggedSets: [
        {
          exerciseId: 'bench-press-dumbbell',
          setType: 'working',
          reps: 6,
          weightKg: 27.22, // 60 lb — the athlete went up
          durationSeconds: null,
          rpe: null,
        },
      ],
    });

    expect(computeSetPrefill(state, undefined, prescribedRamp)).toEqual({
      reps: 6,
      weightLbs: 60,
    });
  });

  test('AC3.8 rank 2: the prescribed set outranks cross-session history for weight', () => {
    const history = { reps: 12, weightLbs: 35 };
    expect(
      computeSetPrefill(perSetState([ramp()], { setIndex: 3 }), history, prescribedRamp)
    ).toEqual({
      // Weight is the plan's; reps still come from what the athlete does.
      reps: 12,
      weightLbs: 50,
    });
  });

  test('AC3.9: a set with no target_weight_kg falls through to history', () => {
    // Null weight on set 2 of 3, the middle one.
    const entry = perSetEntry([
      { setType: 'normal', reps: 8, weightKg: 40 },
      { setType: 'normal', reps: 8 },
      { setType: 'normal', reps: 8, weightKg: 45 },
    ]);
    const prescribed = [{ targetWeightKg: 40 }, { targetWeightKg: undefined }, { targetWeightKg: 45 }];
    const history = { reps: 10, weightLbs: 95 };

    expect(computeSetPrefill(perSetState([entry], { setIndex: 1 }), history, prescribed)).toEqual({
      reps: 10,
      weightLbs: 95,
    });
    // The neighbours still take their own prescription.
    expect(
      computeSetPrefill(perSetState([entry], { setIndex: 2 }), history, prescribed)?.weightLbs
    ).toBe(99); // 45 kg
  });

  test('AC3.9: a null (not undefined) prescribed weight is absent too', () => {
    const entry = perSetEntry([{ setType: 'normal', reps: 8 }]);
    expect(
      computeSetPrefill(perSetState([entry]), { reps: 10, weightLbs: 95 }, [
        { targetWeightKg: null },
      ])
    ).toEqual({ reps: 10, weightLbs: 95 });
  });

  test('AC3.8 rank 3: with no prescription and no history, the set’s own reps are the terminal', () => {
    const entry = perSetEntry([{ setType: 'normal', reps: 12 }]);
    expect(computeSetPrefill(perSetState([entry]))).toEqual({ reps: 12 });
  });

  test('a rep range prefills its lower bound, never the max', () => {
    expect(computeSetPrefill(perSetState([ramp()], { setIndex: 3 }))).toEqual({ reps: 8 });
  });

  test('duration entries prefill the current set’s own duration', () => {
    const entry = perSetEntry(
      [
        { setType: 'normal', durationSeconds: 30 },
        { setType: 'normal', durationSeconds: 60 },
      ],
      { kind: 'stretch', targetDurationSeconds: 999 }
    );
    expect(computeSetPrefill(perSetState([entry], { setIndex: 1 }))).toEqual({
      durationSeconds: 60,
    });
  });

  test('a duration entry ignores a prescribed load', () => {
    const entry = perSetEntry([{ setType: 'normal', durationSeconds: 30 }], { kind: 'cardio' });
    expect(computeSetPrefill(perSetState([entry]), undefined, [{ targetWeightKg: 40 }])).toEqual({
      durationSeconds: 30,
    });
  });

  test('EMPTY: an entry prescribing nothing prefills nothing', () => {
    const entry = perSetEntry([], { warmupSets: 0, targetSets: 0, targetReps: 0 });
    expect(computeSetPrefill(perSetState([entry]))).toBeUndefined();
  });

  test('an out-of-range setIndex prescribes nothing rather than reading set 0', () => {
    expect(computeSetPrefill(perSetState([ramp()], { setIndex: 99 }), undefined, prescribedRamp))
      .toBeUndefined();
  });
});
