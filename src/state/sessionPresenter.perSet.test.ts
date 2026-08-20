/**
 * #276 Phase 3 — the session reads the plan set by set.
 *
 * Kept apart from `sessionPresenter.test.ts`: every entry here is built
 * directly from a real `sets` list, never from aggregate counts. As of
 * Phase 6, `RoutineEntry` has no `warmupSets`/`targetSets`/`targetReps`/
 * `targetDurationSeconds` fields at all — the derivation seam those fixtures
 * once guarded against is gone in both directions, so a reader that still
 * consulted the old fields could not even compile. The sibling file's
 * count-shaped fixtures stay meaningful by going through a `makeSets` helper
 * that expands counts into a list at fixture-construction time.
 */

import { computeSetPrefill, createSessionPresenter, deriveSetPosition } from './sessionPresenter';
import type { LoggedSet, RoutineEntry, RoutineSet, SessionState } from '@/engine/types';

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
    const entry = perSetEntry([]);
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

  // "reads the counts when the entry predates per-set (rehydrated state)"
  // deleted (#276 Phase 6): it existed to prove `deriveSetPosition` still
  // read a legacy, aggregate-only entry (no `sets` at all — the shape a
  // pre-#276 rehydrated session could hold) by falling back to
  // warmupSets/targetSets/targetReps. `RoutineEntry.sets` is REQUIRED now, so
  // that fixture shape does not type-check any more, and there is no
  // fallback left in `deriveSetPosition` for it to exercise — it reads
  // `entry.sets` directly and would throw on an entry missing the field,
  // not silently recover. Verified by temporarily forcing the fixture
  // through an `as unknown as RoutineEntry` cast: it throws `TypeError:
  // Cannot read properties of undefined (reading '2')` at
  // `sessionPresenter.ts`'s `sets[sessionState.setIndex]`, so the derivation
  // this test named is gone from the implementation, not just the type.
  //
  // This is a genuine finding, not a mechanical deletion: if a real device
  // still holds a session persisted before Phase 6, rehydrating it would hit
  // this exact crash rather than degrading gracefully. Whether that is
  // already mitigated elsewhere (a data migration, a hydrate-time guard) is
  // outside this test file's scope to fix — flagged here for a human to
  // confirm rather than silently dropped.
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
    const entry = perSetEntry([]);
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
    expect(present(perSetEntry([]), 0).isLastSetOfExercise).toBe(
      false
    );
  });

  test('currentSetDurationSeconds is the current set’s own target, not the entry’s', () => {
    const entry = perSetEntry(
      [
        { setType: 'normal', durationSeconds: 30 },
        { setType: 'normal', durationSeconds: 45 },
      ],
      { kind: 'stretch' }
    );
    expect(present(entry, 0).currentSetDurationSeconds).toBe(30);
    expect(present(entry, 1).currentSetDurationSeconds).toBe(45);
  });

  test('currentSetDurationSeconds is undefined for a set that prescribes none', () => {
    expect(present(perSetEntry(RAMP), 0).currentSetDurationSeconds).toBeUndefined();
    expect(
      present(perSetEntry([]), 0).currentSetDurationSeconds
    ).toBeUndefined();
  });

  test('the routine-description gate skips a leading empty-set entry', () => {
    // startingExerciseIndex must find the first entry the engine can land on,
    // which under per-set is the first with a non-EMPTY LIST — sets.length > 0.
    // The ghost's list is empty by construction, which is what makes it a
    // "ghost": findIndex must not stop at index 0, or it would decide the
    // session is not at its beginning and hide the routine description.
    // (Mutation M12 survived until this fixture said so, back when a mutant
    // could still fall back to summing aggregate counts instead of reading
    // sets.length — Phase 6 removed those fields from RoutineEntry entirely,
    // so that specific mutant can no longer even compile.)
    const ghost = perSetEntry([], { idx: 0, exerciseId: 'ghost' });
    expect(ghost.sets).toHaveLength(0);

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
 * THE NEW PRECEDENCE (#276 AC3.7–AC3.9, revised in review). The middle term
 * moved from the exercise to the set, and a new top term was added: a field
 * the plan changes AT THIS SET outranks everything.
 *
 *   weight   0. THE CURRENT SET'S OWN target_weight_kg, when it differs from
 *               the previous set's (at set 0: when the plan is per-set at all)
 *            1. this session's own last set for this exercise
 *            2. THE CURRENT SET'S OWN target_weight_kg   <- was a per-exercise
 *                                                           prescription
 *            3. cross-session history
 *            (no terminal — a plan with no load prefills no weight)
 *
 *   reps     0. the current set's own target_reps, on the same condition
 *            1. this session's own last set for this exercise
 *            2. cross-session history
 *            3. the current set's own target_reps
 *
 *   duration 0. the current set's own target_duration_seconds, same condition
 *            1. this session's own last set (duration-based entries only)
 *            2. the current set's own target_duration_seconds
 *
 * Rank 0 is decided FIELD BY FIELD. Comparing whole sets is not the same rule
 * and gets REPS_DROP wrong — see `sessionPrefillWalk.test.ts`, which walks all
 * three discriminating scenarios end to end.
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

  const wentUpTo = (weightKg: number, reps: number): LoggedSet => ({
    exerciseId: 'bench-press-dumbbell',
    setType: 'working',
    reps,
    weightKg,
    durationSeconds: null,
    rpe: null,
  });

  test('AC3.8 rank 1: this session’s own last set outranks a plan that intends no change', () => {
    // Index 4 of RAMP prescribes exactly what index 3 did (8 x 22.68), so the
    // plan asserts nothing here and the athlete's own 6 x 60 stands. This is
    // rank 1's whole reason for existing.
    const state = perSetState([ramp()], {
      setIndex: 4,
      loggedSets: [wentUpTo(27.22, 6)], // 60 lb — the athlete went up
    });

    expect(computeSetPrefill(state, undefined, prescribedRamp)).toEqual({
      reps: 6,
      weightLbs: 60,
    });
  });

  test('AC3.8 rank 0: a planned change at THIS set outranks the last set logged', () => {
    // Index 3 is where RAMP leaves the warmups: 3 x 18.14 becomes 8 x 22.68.
    // Both fields change, so both come from the plan even though the athlete
    // just logged something else. Without this the ramp flattens to set 0.
    const state = perSetState([ramp()], {
      setIndex: 3,
      loggedSets: [wentUpTo(27.22, 6)],
    });

    expect(computeSetPrefill(state, undefined, prescribedRamp)).toEqual({
      reps: 8,
      weightLbs: 50,
    });
  });

  test('AC3.8 rank 0 is field-wise: an unchanged field keeps the athlete’s value', () => {
    // The REPS DROP shape in miniature: the reps change at this set, the load
    // does not. A set-wise comparison would see "this set differs" and drag
    // the load back to the plan's, overwriting the athlete's deviation.
    const entry = perSetEntry([
      { setType: 'normal', reps: 8, weightKg: 22.68 },
      { setType: 'normal', reps: 8, weightKg: 22.68 },
      { setType: 'normal', reps: 6, weightKg: 22.68 },
    ]);
    const prescribed = [
      { targetWeightKg: 22.68 },
      { targetWeightKg: 22.68 },
      { targetWeightKg: 22.68 },
    ];
    const state = perSetState([entry], {
      setIndex: 2,
      loggedSets: [wentUpTo(20.41, 8)], // 45 lb — the athlete came down
    });

    expect(computeSetPrefill(state, undefined, prescribed)).toEqual({
      reps: 6,
      weightLbs: 45,
    });
  });

  test('AC3.8 rank 2: the prescribed set outranks cross-session history for weight', () => {
    // Index 4 again: the plan intends no change there, so rank 0 is silent and
    // the original two-term asymmetry is what is under test.
    const history = { reps: 12, weightLbs: 35 };
    expect(
      computeSetPrefill(perSetState([ramp()], { setIndex: 4 }), history, prescribedRamp)
    ).toEqual({
      // Weight is the plan's; reps still come from what the athlete does.
      reps: 12,
      weightLbs: 50,
    });
  });

  test('AC3.8 rank 0 vs history: a per-set plan owns its own reps on set 0', () => {
    // No previous set to compare against, so the tie-break is whether the plan
    // is per-set at all. RAMP is, so its 5 reps beat last week's 12.
    const history = { reps: 12, weightLbs: 35 };
    expect(
      computeSetPrefill(perSetState([ramp()], { setIndex: 0 }), history, prescribedRamp)
    ).toEqual({ reps: 5, weightLbs: 20 });
  });

  test('a UNIFORM plan still defers to history for reps on set 0', () => {
    // The zero-regression half of the same rule: an aggregate-derived list is
    // uniform in every field, so rank 0 never fires on one and the documented
    // weight/reps asymmetry survives untouched for every routine in the app.
    const flat = perSetEntry([
      { setType: 'normal', reps: 8, weightKg: 83.91 },
      { setType: 'normal', reps: 8, weightKg: 83.91 },
      { setType: 'normal', reps: 8, weightKg: 83.91 },
    ]);
    const prescribed = [
      { targetWeightKg: 83.91 },
      { targetWeightKg: 83.91 },
      { targetWeightKg: 83.91 },
    ];
    const history = { reps: 12, weightLbs: 175 };

    expect(
      computeSetPrefill(perSetState([flat], { setIndex: 0 }), history, prescribed)
    ).toEqual({ reps: 12, weightLbs: 185 });
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
    // The entry's OWN set carries a load and the DB read says null — the one
    // fixture in this file where the two sources disagree, which is precisely
    // the disagreement the fresh-DB-read decision exists to handle. Everywhere
    // else `prescribedRamp` is derived from RAMP, so a reader that took the
    // load off engine state would pass unnoticed. `updateRoutineExerciseExerciseId`
    // clears the DB column on a swap while the engine keeps `entry.sets`
    // intact, so 50 lb here is the outgoing exercise's stale prescription.
    const entry = perSetEntry([{ setType: 'normal', reps: 8, weightKg: 22.68 }]);
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
      { kind: 'stretch' }
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
    const entry = perSetEntry([]);
    expect(computeSetPrefill(perSetState([entry]))).toBeUndefined();
  });

  test('an out-of-range setIndex prescribes nothing rather than reading set 0', () => {
    expect(computeSetPrefill(perSetState([ramp()], { setIndex: 99 }), undefined, prescribedRamp))
      .toBeUndefined();
  });

  // ---- An explicit 0 in a routine_sets column ------------------------------
  // `getRoutineSets` filters only `null`, and `entrySetsFromRows` passes the
  // value through unchanged (unlike the count path, where `setsFromCounts`
  // maps 0 to undefined), so a literal 0 reaches the planned set intact. A
  // prefilled 0 is then silently dropped on dispatch — the bug class this
  // function's docstring says it has already produced twice — so every metric
  // guard here must be `> 0`, not `!= null`.

  test('a planned set with 0 reps prefills no reps at all', () => {
    const entry = perSetEntry([{ setType: 'normal', reps: 0 }]);
    expect(computeSetPrefill(perSetState([entry]))).toBeUndefined();
  });

  test('a planned set with a 0 duration prefills no duration at all', () => {
    const entry = perSetEntry([{ setType: 'normal', durationSeconds: 0 }], {
      kind: 'stretch',
    });
    expect(computeSetPrefill(perSetState([entry]))).toBeUndefined();
  });

  test('a planned load of 0 is no prescription, not a prescribed zero', () => {
    const entry = perSetEntry([{ setType: 'normal', reps: 8 }]);
    expect(
      computeSetPrefill(perSetState([entry]), undefined, [{ targetWeightKg: 0 }])
    ).toEqual({ reps: 8 });
  });
});

describe('the presenter’s own per-set guards (#276)', () => {
  const present = (entry: RoutineEntry, setIndex: number) =>
    createSessionPresenter(perSetState([entry], { setIndex }), jest.fn(async () => null));

  test('an out-of-range setIndex suppresses the label even though the list is non-empty', () => {
    // The `hydrate` shape (engine convention 5): a session persisted by an
    // older build comes back sitting past the end of its own list. The guard
    // is `totalOfType > 0` rather than `sets.length > 0` precisely so this
    // renders nothing; reading the list length instead renders "Set 1 of 0",
    // the exact string the guard exists to prevent.
    const entry = perSetEntry(RAMP);
    const presenter = present(entry, 99);

    expect(presenter.totalSetsForEntry).toBe(7);
    expect(presenter.setPositionLabel).toBe('');
  });

  test('a 0-second planned duration gives the stopwatch no target', () => {
    const entry = perSetEntry(
      [
        { setType: 'normal', durationSeconds: 0 },
        { setType: 'normal', durationSeconds: 45 },
      ],
      { kind: 'stretch' }
    );

    expect(present(entry, 0).currentSetDurationSeconds).toBeUndefined();
    expect(present(entry, 1).currentSetDurationSeconds).toBe(45);
  });
});

/**
 * #311 — the prescribed rep range, shown to the athlete while they perform the
 * set.
 *
 * The range already renders on routine detail and workout history, both via
 * `plannedSetsFormat`. The one surface that never showed it is the one where
 * it matters: `computeSetPrefill` types the range's LOWER BOUND into the reps
 * input (`sessionPresenter.ts` R5) and its own comment calls `repsMax`
 * "guidance for the athlete" — guidance nothing displayed.
 *
 * The label is derived HERE rather than in `SetLogger.tsx` because
 * `src/components` is invisible to every jest project (AGENTS.md Testing
 * gotchas): a branch written in the component would have no cover at all.
 */
describe('setRepRangeLabel (#311)', () => {
  const present = (entry: RoutineEntry, setIndex: number) =>
    createSessionPresenter(perSetState([entry], { setIndex }), jest.fn(async () => null));

  test('a working set in a range names the range', () => {
    // RAMP's working sets are 8–10. The en dash is the one from
    // `plannedSetsFormat.formatRepRange`, not a second formatter: a duplicated
    // range format is how the session screen and the routine screen drift into
    // printing the same plan two different ways.
    expect(present(perSetEntry(RAMP), 3).setRepRangeLabel).toBe('Target 8–10 reps');
    expect(present(perSetEntry(RAMP), 6).setRepRangeLabel).toBe('Target 8–10 reps');
  });

  test('a fixed-reps set shows nothing extra', () => {
    // RAMP's warmups prescribe exact reps (5, 5, 3) with no `repsMax`. The reps
    // input is already prefilled with that number, so a "Target 5 reps" line
    // would restate the input directly above it.
    expect(present(perSetEntry(RAMP), 0).setRepRangeLabel).toBe('');
    expect(present(perSetEntry(RAMP), 2).setRepRangeLabel).toBe('');
  });

  test('a degenerate range collapses to nothing, never "8–8"', () => {
    const entry = perSetEntry([{ setType: 'normal', reps: 8, repsMax: 8 }]);
    expect(present(entry, 0).setRepRangeLabel).toBe('');
  });

  test('a zero upper bound is absence, not a bound — never "8–0"', () => {
    // Engine convention 8: the shell reads sentinels, not Options, and a plain
    // null check passes 0 straight through to the UI. `repsMax` is documented
    // as staying honestly absent across the Rill boundary, so this is layer-2
    // defense — the same standing this file's other out-of-range guards have.
    const entry = perSetEntry([{ setType: 'normal', reps: 8, repsMax: 0 }]);
    expect(present(entry, 0).setRepRangeLabel).toBe('');
  });

  test('a zero lower bound renders nothing rather than "0–10"', () => {
    const entry = perSetEntry([{ setType: 'normal', reps: 0, repsMax: 10 }]);
    expect(present(entry, 0).setRepRangeLabel).toBe('');
  });

  test('an entry prescribing zero sets renders nothing', () => {
    // AGENTS.md Boundaries, "a routine entry may plan zero sets": no display
    // path may build a label out of a plan that is not there.
    expect(present(perSetEntry([]), 0).setRepRangeLabel).toBe('');
  });

  test('an out-of-range setIndex renders nothing', () => {
    // The `hydrate` shape (engine convention 5) — a session persisted by an
    // older build comes back sitting past the end of its own list.
    expect(present(perSetEntry(RAMP), 99).setRepRangeLabel).toBe('');
  });

  test('a duration-based entry renders nothing even if its set carries a range', () => {
    // A stretch/cardio entry has no reps input at all — SetLogger shows the
    // stopwatch and a Duration field. `computeSetPrefill` already refuses to
    // fill reps for these (`planAssertsReps = !isDurationBased && ...`); the
    // label follows the same rule rather than captioning an input that is not
    // on screen.
    const entry = perSetEntry(
      [{ setType: 'normal', reps: 8, repsMax: 10, durationSeconds: 45 }],
      { kind: 'stretch' }
    );
    expect(present(entry, 0).setRepRangeLabel).toBe('');
  });

  test('a distance-only set renders nothing', () => {
    const entry = perSetEntry([{ setType: 'normal', distanceM: 400 }]);
    expect(present(entry, 0).setRepRangeLabel).toBe('');
  });

  test('renders nothing when there is no current entry at all', () => {
    const presenter = createSessionPresenter(perSetState([]), jest.fn(async () => null));
    expect(presenter.setRepRangeLabel).toBe('');
  });
});
