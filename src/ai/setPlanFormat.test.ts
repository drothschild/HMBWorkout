/**
 * The one grammar every AI surface uses to say what a plan prescribes
 * (#276 Phase 4, AC4.11/AC4.12).
 *
 * RAMP is the discriminating fixture throughout: an implementation that
 * summarises to counts renders one weight where three are required.
 */

import type { RoutineSet } from '@/engine/types';
import type { RoutineSetEntry } from '@/db/repository';
import type { DraftSet } from './draftSchema';
import {
  formatDraftSetLine,
  planSetsFromDraftSets,
  planSetsFromRoutineSetEntries,
  planSetsFromRoutineSets,
  summarizePlanSets,
} from './setPlanFormat';

/** RAMP in db (`RoutineSetEntry`) shape — canonical kg, as stored. */
const RAMP_ROWS: RoutineSetEntry[] = [
  { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
  { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
  { setType: 'warmup', targetReps: 3, targetWeightKg: 18.14 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
];

/** The same ramp in engine (`RoutineSet`) shape. */
const RAMP_ENGINE: RoutineSet[] = [
  { setType: 'warmup', reps: 5, weightKg: 9.07 },
  { setType: 'warmup', reps: 5, weightKg: 11.34 },
  { setType: 'warmup', reps: 3, weightKg: 18.14 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
];

/** The same ramp as the coach would draft it — pounds, never kg. */
const RAMP_DRAFT: DraftSet[] = [
  { type: 'warmup', reps: 5, weightLbs: 20 },
  { type: 'warmup', reps: 5, weightLbs: 25 },
  { type: 'warmup', reps: 3, weightLbs: 40 },
  { type: 'normal', reps: 8, repsMax: 10, weightLbs: 50 },
  { type: 'normal', reps: 8, repsMax: 10, weightLbs: 50 },
  { type: 'normal', reps: 8, repsMax: 10, weightLbs: 50 },
  { type: 'normal', reps: 8, repsMax: 10, weightLbs: 50 },
];

describe('summarizePlanSets', () => {
  it('renders RAMP with all three warmup loads, distinct and in order', () => {
    const summary = summarizePlanSets(planSetsFromRoutineSetEntries(RAMP_ROWS));

    expect(summary).toBe(
      'warmup 5 reps @ 20lbs, warmup 5 reps @ 25lbs, warmup 3 reps @ 40lbs, 4 × 8-10 reps @ 50lbs'
    );
  });

  it('collapses only ADJACENT identical sets, so a ramp cannot be counted away', () => {
    // The discriminating half of the run-length rule. A grouper keyed on the
    // whole list rather than on runs renders "3 × warmup 5 reps @ 20lbs" here
    // and loses the 25 and the 40 entirely.
    const summary = summarizePlanSets(
      planSetsFromRoutineSetEntries([
        { setType: 'normal', targetReps: 8, targetWeightKg: 45.36 },
        { setType: 'normal', targetReps: 8, targetWeightKg: 22.68 },
        { setType: 'normal', targetReps: 8, targetWeightKg: 45.36 },
      ])
    );

    expect(summary).toBe('8 reps @ 100lbs, 8 reps @ 50lbs, 8 reps @ 100lbs');
  });

  it('reads the engine set shape to the same string as the database shape', () => {
    // AC4.12's surfaces are handed engine entries; AC4.11's is handed DB rows.
    // One grammar, or the coach reads two different descriptions of one plan.
    expect(summarizePlanSets(planSetsFromRoutineSets(RAMP_ENGINE))).toBe(
      summarizePlanSets(planSetsFromRoutineSetEntries(RAMP_ROWS))
    );
  });

  it('reads a draft in pounds to the same string, with no kg round trip', () => {
    expect(summarizePlanSets(planSetsFromDraftSets(RAMP_DRAFT))).toBe(
      summarizePlanSets(planSetsFromRoutineSetEntries(RAMP_ROWS))
    );
  });

  it('renders an exact rep count without a range', () => {
    expect(
      summarizePlanSets(planSetsFromRoutineSetEntries([{ setType: 'normal', targetReps: 8 }]))
    ).toBe('8 reps');
  });

  it('treats a repsMax equal to reps as an exact count, not a range', () => {
    // Hevy emits `rep_range: {start:5, end:5}` for exact prescriptions.
    expect(
      summarizePlanSets(
        planSetsFromRoutineSetEntries([{ setType: 'normal', targetReps: 5, targetRepsMax: 5 }])
      )
    ).toBe('5 reps');
  });

  it('renders a duration prescription', () => {
    expect(
      summarizePlanSets(
        planSetsFromRoutineSetEntries([{ setType: 'normal', targetDurationSeconds: 45 }])
      )
    ).toBe('45s');
  });

  it('renders a distance prescription', () => {
    expect(
      summarizePlanSets(
        planSetsFromRoutineSetEntries([{ setType: 'normal', targetDistanceM: 2000 }])
      )
    ).toBe('2000m');
  });

  it('names a set that prescribes nothing rather than rendering a blank', () => {
    expect(summarizePlanSets(planSetsFromRoutineSetEntries([{ setType: 'normal' }]))).toBe('1 set');
    expect(
      summarizePlanSets(
        planSetsFromRoutineSetEntries([{ setType: 'normal' }, { setType: 'normal' }])
      )
    ).toBe('2 sets');
  });

  it('is empty for an entry that prescribes no sets, so the caller can drop the segment', () => {
    expect(summarizePlanSets([])).toBe('');
  });

  it('treats a zero load as absent rather than rendering "@ 0lbs"', () => {
    // Layer two on the sentinel rule. `acceptDraft` refuses to write a 0 and
    // `prescribedSets`' aggregate fallback filters one out, but
    // `replaceRoutineSets` writes any defined value it is handed, so a 0 CAN
    // reach a routine_sets row from a non-AI caller. `computeSetPrefill`
    // already reads a non-positive weight as absent; this keeps the prompt's
    // reading of the same column identical to the prefill's.
    expect(
      summarizePlanSets(
        planSetsFromRoutineSetEntries([{ setType: 'normal', targetReps: 8, targetWeightKg: 0 }])
      )
    ).toBe('8 reps');

    expect(
      summarizePlanSets(planSetsFromRoutineSets([{ setType: 'normal', reps: 8, weightKg: 0 }]))
    ).toBe('8 reps');
  });

  it('treats a null load as absent — WatermelonDB never hands back undefined', () => {
    expect(
      summarizePlanSets(planSetsFromRoutineSets([{ setType: 'normal', reps: 8, weightKg: null }]))
    ).toBe('8 reps');
  });

  // #308: the read-back half of #281. DROP is the discriminating fixture —
  // three sets identical in every OTHER metric, differing only in their rest.
  // An implementation that omits rest from the grammar renders all three as one
  // collapsed run ("3 × 8 reps @ 50lbs"), which is precisely the string that
  // makes the coach re-emit a flattened drop set on the next revision.
  describe('per-set rest (#308)', () => {
    it('renders DROP with each set\'s own rest, refusing to collapse the run', () => {
      expect(
        summarizePlanSets(
          planSetsFromRoutineSetEntries([
            { setType: 'normal', targetReps: 8, targetWeightKg: 22.68, restSeconds: 0 },
            { setType: 'normal', targetReps: 8, targetWeightKg: 22.68, restSeconds: 0 },
            { setType: 'normal', targetReps: 8, targetWeightKg: 22.68, restSeconds: 90 },
          ])
        )
      ).toBe('2 × 8 reps @ 50lbs rest 0s, 8 reps @ 50lbs rest 90s');
    });

    it('renders a zero rest rather than dropping it as falsy — 0 is the override', () => {
      // The mutation this pins: `if (set.restSeconds)` instead of `!= null`.
      // A drop set's whole point is the 0, so a falsy guard erases exactly the
      // information the model needs and leaves the 90 looking like the pattern.
      expect(
        summarizePlanSets(planSetsFromRoutineSetEntries([{ setType: 'normal', restSeconds: 0 }]))
      ).toBe('rest 0s');

      expect(
        summarizePlanSets(planSetsFromRoutineSets([{ setType: 'normal', restSeconds: 0 }]))
      ).toBe('rest 0s');

      expect(summarizePlanSets(planSetsFromDraftSets([{ type: 'normal', restSeconds: 0 }]))).toBe(
        'rest 0s'
      );
    });

    it('says nothing for a set with no override — absent means "inherit the entry rest"', () => {
      // The entry-level rest is rendered once per LINE by formatExerciseLine.
      // Echoing it onto every set would tell the model each set carries an
      // override, which is the opposite error.
      expect(
        summarizePlanSets(planSetsFromRoutineSetEntries([{ setType: 'normal', targetReps: 8 }]))
      ).toBe('8 reps');

      expect(
        summarizePlanSets(planSetsFromRoutineSets([{ setType: 'normal', reps: 8, restSeconds: null }]))
      ).toBe('8 reps');
    });

    it('agrees across all three input shapes, as every other metric does', () => {
      const rows = summarizePlanSets(
        planSetsFromRoutineSetEntries([
          { setType: 'normal', targetReps: 8, targetWeightKg: 22.68, restSeconds: 0 },
          { setType: 'normal', targetReps: 6, targetWeightKg: 18.14, restSeconds: 90 },
        ])
      );

      expect(
        summarizePlanSets(
          planSetsFromRoutineSets([
            { setType: 'normal', reps: 8, weightKg: 22.68, restSeconds: 0 },
            { setType: 'normal', reps: 6, weightKg: 18.14, restSeconds: 90 },
          ])
        )
      ).toBe(rows);

      expect(
        summarizePlanSets(
          planSetsFromDraftSets([
            { type: 'normal', reps: 8, weightLbs: 50, restSeconds: 0 },
            { type: 'normal', reps: 6, weightLbs: 40, restSeconds: 90 },
          ])
        )
      ).toBe(rows);
    });
  });
});

describe('formatDraftSetLine', () => {
  it('numbers warmups and working sets in their own runs', () => {
    const lines = RAMP_DRAFT.map((set, index) => formatDraftSetLine(set, index, RAMP_DRAFT));

    expect(lines).toEqual([
      'Warmup 1 · 5 reps @ 20lbs',
      'Warmup 2 · 5 reps @ 25lbs',
      'Warmup 3 · 3 reps @ 40lbs',
      'Set 1 · 8-10 reps @ 50lbs',
      'Set 2 · 8-10 reps @ 50lbs',
      'Set 3 · 8-10 reps @ 50lbs',
      'Set 4 · 8-10 reps @ 50lbs',
    ]);
  });

  it('counts a position within its own type across an interleaved list', () => {
    // INTERLEAVE. An implementation numbering by array index gives
    // "Warmup 1, Set 2, Warmup 3".
    const sets: DraftSet[] = [
      { type: 'warmup' },
      { type: 'normal' },
      { type: 'warmup' },
    ];

    expect(sets.map((set, index) => formatDraftSetLine(set, index, sets))).toEqual([
      'Warmup 1',
      'Set 1',
      'Warmup 2',
    ]);
  });

  it('shows a per-set rest override on the preview row (#308)', () => {
    // The draft card is the last place the athlete sees the drop structure
    // before accepting it, and it reads the same grammar deliberately.
    const sets: DraftSet[] = [
      { type: 'normal', reps: 8, weightLbs: 50, restSeconds: 0 },
      { type: 'normal', reps: 8, weightLbs: 40 },
    ];

    expect(sets.map((set, index) => formatDraftSetLine(set, index, sets))).toEqual([
      'Set 1 · 8 reps @ 50lbs rest 0s',
      'Set 2 · 8 reps @ 40lbs',
    ]);
  });
});
