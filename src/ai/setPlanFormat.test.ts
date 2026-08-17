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
});
