import {
  formatPlannedSetLine,
  formatPlannedSetsSummary,
  formatRepRange,
  hasVaryingSets,
} from './plannedSetsFormat';
import type { RoutineSetEntry } from '@/db/repository';

/** RAMP: the real Hevy Bench Press (Dumbbell) payload, in canonical kg. */
const RAMP: RoutineSetEntry[] = [
  { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
  { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
  { setType: 'warmup', targetReps: 3, targetWeightKg: 18.14 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
  { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
];

describe('formatPlannedSetLine', () => {
  it('renders the ramp as three distinct ascending loads', () => {
    expect(RAMP.slice(0, 3).map((set, i) => formatPlannedSetLine(set, i, RAMP))).toEqual([
      'Warmup 1 · 5 × 20lbs',
      'Warmup 2 · 5 × 25lbs',
      'Warmup 3 · 3 × 40lbs',
    ]);
  });

  it('numbers working sets independently of warmups and renders a rep range', () => {
    expect(formatPlannedSetLine(RAMP[3], 3, RAMP)).toBe('Set 1 · 8–10 × 50lbs');
    expect(formatPlannedSetLine(RAMP[6], 6, RAMP)).toBe('Set 4 · 8–10 × 50lbs');
  });

  it('INTERLEAVE numbers each type by its own run, not by position', () => {
    const interleave: RoutineSetEntry[] = [
      { setType: 'warmup', targetReps: 5 },
      { setType: 'normal', targetReps: 8 },
      { setType: 'warmup', targetReps: 5 },
    ];
    expect(interleave.map((set, i) => formatPlannedSetLine(set, i, interleave))).toEqual([
      'Warmup 1 · 5 reps',
      'Set 1 · 8 reps',
      'Warmup 2 · 5 reps',
    ]);
  });

  it('renders a duration set as m:ss', () => {
    const timed: RoutineSetEntry[] = [{ setType: 'normal', targetDurationSeconds: 45 }];
    expect(formatPlannedSetLine(timed[0], 0, timed)).toBe('Set 1 · 0:45');
  });

  it('renders a distance set in metres', () => {
    const cardio: RoutineSetEntry[] = [{ setType: 'normal', targetDistanceM: 2000 }];
    expect(formatPlannedSetLine(cardio[0], 0, cardio)).toBe('Set 1 · 2000 m');
  });

  it('renders a load with no reps', () => {
    const loadOnly: RoutineSetEntry[] = [{ setType: 'normal', targetWeightKg: 22.68 }];
    expect(formatPlannedSetLine(loadOnly[0], 0, loadOnly)).toBe('Set 1 · 50lbs');
  });

  it('renders the bare position when the set prescribes no measurement at all', () => {
    const bare: RoutineSetEntry[] = [{ setType: 'normal' }];
    expect(formatPlannedSetLine(bare[0], 0, bare)).toBe('Set 1');
  });
});

describe('formatPlannedSetsSummary', () => {
  it('summarises RAMP as its warmup count plus its working prescription', () => {
    expect(formatPlannedSetsSummary(RAMP)).toBe('3 warmup + 4×8–10');
  });

  it('summarises a plain strength entry', () => {
    expect(
      formatPlannedSetsSummary([
        { setType: 'normal', targetReps: 5 },
        { setType: 'normal', targetReps: 5 },
        { setType: 'normal', targetReps: 5 },
      ])
    ).toBe('3×5');
  });

  it('summarises a timed entry by its duration', () => {
    expect(formatPlannedSetsSummary([{ setType: 'normal', targetDurationSeconds: 300 }])).toBe(
      '1×5:00'
    );
  });

  it('summarises an all-warmup entry without inventing a working set', () => {
    expect(
      formatPlannedSetsSummary([
        { setType: 'warmup', targetReps: 5 },
        { setType: 'warmup', targetReps: 5 },
      ])
    ).toBe('2 warmup');
  });

  it('returns the empty string for an entry that prescribes nothing', () => {
    // The screens hide the row on '' — no "0 sets", which reads as a bug.
    expect(formatPlannedSetsSummary([])).toBe('');
  });

  it('counts working sets even when they carry no reps', () => {
    expect(
      formatPlannedSetsSummary([{ setType: 'normal' }, { setType: 'normal' }])
    ).toBe('2 sets');
  });
});

describe('hasVaryingSets', () => {
  it('is true for RAMP — the case a one-line summary cannot represent', () => {
    expect(hasVaryingSets(RAMP)).toBe(true);
  });

  it('is false for a flat prescription, however many sets', () => {
    expect(
      hasVaryingSets([
        { setType: 'normal', targetReps: 8, targetWeightKg: 60 },
        { setType: 'normal', targetReps: 8, targetWeightKg: 60 },
        { setType: 'normal', targetReps: 8, targetWeightKg: 60 },
      ])
    ).toBe(false);
  });

  it('ignores set type — a warmup and a working set at the same numbers do not vary', () => {
    expect(
      hasVaryingSets([
        { setType: 'warmup', targetReps: 8 },
        { setType: 'normal', targetReps: 8 },
      ])
    ).toBe(false);
  });

  it('notices a difference in any single field', () => {
    const base = { setType: 'normal' as const, targetReps: 8, targetWeightKg: 60 };
    expect(hasVaryingSets([base, { ...base, targetReps: 6 }])).toBe(true);
    expect(hasVaryingSets([base, { ...base, targetWeightKg: 65 }])).toBe(true);
    expect(hasVaryingSets([base, { ...base, targetRepsMax: 10 }])).toBe(true);
    expect(hasVaryingSets([base, { ...base, targetDurationSeconds: 30 }])).toBe(true);
    expect(hasVaryingSets([base, { ...base, targetDistanceM: 100 }])).toBe(true);
  });

  it('is false for zero or one set', () => {
    // The empty case is not cosmetic: `routine/[id].tsx` calls this
    // unconditionally on `exercise.sets`, which is `[]` for every entry that
    // prescribes nothing, so a guard that lets an empty list through
    // dereferences `sets[0]` and crashes the routine screen.
    expect(() => hasVaryingSets([])).not.toThrow();
    expect(hasVaryingSets([])).toBe(false);
    expect(hasVaryingSets([{ setType: 'normal', targetReps: 8 }])).toBe(false);
  });
});

describe('formatReps collapses a degenerate range (#276)', () => {
  it('renders a single number when the range bounds are equal', () => {
    // `target_reps_max === target_reps` is a range of one. Rendering it as a
    // range gives "8–8", which reads as a mistake in the plan.
    expect(
      formatPlannedSetLine(
        { setType: 'normal', targetReps: 8, targetRepsMax: 8 },
        0,
        [{ setType: 'normal', targetReps: 8, targetRepsMax: 8 }]
      )
    ).toBe('Set 1 · 8 reps');
  });

  it('still renders a genuine range', () => {
    expect(
      formatPlannedSetLine(
        { setType: 'normal', targetReps: 8, targetRepsMax: 10 },
        0,
        [{ setType: 'normal', targetReps: 8, targetRepsMax: 10 }]
      )
    ).toBe('Set 1 · 8–10 reps');
  });
});

describe('the summary quotes the FIRST working set (#276)', () => {
  it('reports the first working set’s prescription, not the last', () => {
    // A drop-set shape: the working sets genuinely differ. Every other fixture
    // in this file has uniform working sets, which makes `working[0]` and
    // `working[working.length - 1]` interchangeable and the choice untestable.
    const sets: RoutineSetEntry[] = [
      { setType: 'warmup', targetReps: 10 },
      { setType: 'normal', targetReps: 8 },
      { setType: 'normal', targetReps: 6 },
      { setType: 'normal', targetReps: 4 },
    ];

    expect(formatPlannedSetsSummary(sets)).toBe('1 warmup + 3×8');
  });
});

/**
 * #311 — `formatRepRange` is the range formatter itself, lifted out of the
 * private `formatReps` so the session set logger can reuse it rather than
 * growing a second one. It answers a narrower question than `formatReps`: not
 * "what does this set prescribe" but "is this a range, and what does it read
 * as". Anything that is not a genuine range is '' — the empty-string-means-hide
 * convention every label builder in this codebase follows.
 */
describe('formatRepRange (#311)', () => {
  it('renders a genuine range with an en dash', () => {
    expect(formatRepRange(8, 10)).toBe('8–10');
  });

  it('returns "" for an exact prescription', () => {
    expect(formatRepRange(8, undefined)).toBe('');
    expect(formatRepRange(8, null)).toBe('');
  });

  it('returns "" for a degenerate range', () => {
    expect(formatRepRange(8, 8)).toBe('');
  });

  it('treats a non-positive bound as absent, never printing "8–0" or "0–10"', () => {
    expect(formatRepRange(8, 0)).toBe('');
    expect(formatRepRange(0, 10)).toBe('');
  });

  it('returns "" when there are no reps at all (a duration or distance set)', () => {
    expect(formatRepRange(undefined, undefined)).toBe('');
    expect(formatRepRange(null, 10)).toBe('');
  });

  it('is the same string the routine screen already prints', () => {
    // The anti-drift assertion: one formatter, two surfaces. If this file ever
    // grows a second `${lo}–${hi}` template, this stops holding.
    expect(
      formatPlannedSetLine({ setType: 'normal', targetReps: 8, targetRepsMax: 10 }, 0, [
        { setType: 'normal', targetReps: 8, targetRepsMax: 10 },
      ])
    ).toContain(formatRepRange(8, 10));
  });
});
