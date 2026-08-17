import { entrySets, setsFromCounts } from './entrySets';
import type { RoutineEntry } from './types';

/** A count-shaped entry with no `sets` — what a pre-#276 shell path produces. */
function countEntry(over: Partial<RoutineEntry> = {}): RoutineEntry {
  return {
    idx: 0,
    exerciseId: 'bench-press',
    kind: 'strength',
    warmupSets: 0,
    targetSets: 0,
    targetReps: 0,
    targetDurationSeconds: 0,
    restSeconds: 90,
    supersetGroup: '',
    ...over,
  };
}

describe('setsFromCounts', () => {
  it('expands warmups then normals, carrying the single plan value onto each', () => {
    expect(setsFromCounts({ warmupSets: 2, targetSets: 3, targetReps: 8 })).toEqual([
      { setType: 'warmup', reps: 8, durationSeconds: undefined },
      { setType: 'warmup', reps: 8, durationSeconds: undefined },
      { setType: 'normal', reps: 8, durationSeconds: undefined },
      { setType: 'normal', reps: 8, durationSeconds: undefined },
      { setType: 'normal', reps: 8, durationSeconds: undefined },
    ]);
  });

  it('treats a 0 target as unset rather than as a prescribed zero', () => {
    // Nothing plans zero reps; 0 is the shell's "absent" for these columns.
    expect(setsFromCounts({ warmupSets: 0, targetSets: 1, targetReps: 0, targetDurationSeconds: 0 })).toEqual([
      { setType: 'normal', reps: undefined, durationSeconds: undefined },
    ]);
  });

  it('carries a duration target', () => {
    expect(setsFromCounts({ targetSets: 1, targetDurationSeconds: 45 })).toEqual([
      { setType: 'normal', reps: undefined, durationSeconds: 45 },
    ]);
  });

  it('expands a zero total to an empty list', () => {
    expect(setsFromCounts({ warmupSets: 0, targetSets: 0, targetReps: 12 })).toEqual([]);
  });
});

describe('entrySets', () => {
  it('returns the entry’s own list when it has one', () => {
    const sets = [
      { setType: 'warmup' as const, reps: 5, weightKg: 9.07 },
      { setType: 'normal' as const, reps: 8, weightKg: 22.68 },
    ];
    expect(entrySets(countEntry({ warmupSets: 9, targetSets: 9, sets }))).toBe(sets);
  });

  it('honours an explicitly empty list rather than falling back to counts', () => {
    // A DB-built entry that genuinely prescribes nothing must not be resurrected
    // by stale aggregate columns.
    expect(entrySets(countEntry({ warmupSets: 3, targetSets: 4, sets: [] }))).toEqual([]);
  });

  it('falls back to the counts when the entry predates per-set (rehydrated state)', () => {
    expect(entrySets(countEntry({ warmupSets: 1, targetSets: 2, targetReps: 6 }))).toEqual([
      { setType: 'warmup', reps: 6, durationSeconds: undefined },
      { setType: 'normal', reps: 6, durationSeconds: undefined },
      { setType: 'normal', reps: 6, durationSeconds: undefined },
    ]);
  });

  it('returns [] for an undefined entry', () => {
    expect(entrySets(undefined)).toEqual([]);
  });

  it('carries INTERLEAVE, which no count pair can express', () => {
    // [warmup, normal, warmup]: warmupSets 2 / targetSets 1 expands to
    // [warmup, warmup, normal] and warmupSets 1 / targetSets 2 to
    // [warmup, normal, normal]. Neither is the input.
    const sets = [
      { setType: 'warmup' as const, reps: 5 },
      { setType: 'normal' as const, reps: 8 },
      { setType: 'warmup' as const, reps: 5 },
    ];
    expect(entrySets(countEntry({ sets })).map((set) => set.setType)).toEqual([
      'warmup',
      'normal',
      'warmup',
    ]);
    expect(setsFromCounts({ warmupSets: 2, targetSets: 1 }).map((s) => s.setType)).not.toEqual([
      'warmup',
      'normal',
      'warmup',
    ]);
    expect(setsFromCounts({ warmupSets: 1, targetSets: 2 }).map((s) => s.setType)).not.toEqual([
      'warmup',
      'normal',
      'warmup',
    ]);
  });
});
