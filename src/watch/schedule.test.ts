/**
 * Schedule projection: the phone dry-runs the real engine to produce the flat,
 * ordered list of stops a routine will walk through, and ships it to the watch.
 *
 * This is the load-bearing claim of the watch companion architecture
 * (docs/design-plans/2026-08-04-watchos-companion.md): `advance_after_set`
 * depends only on `entries`, `setIndex`, `exerciseIndex` and `supersetPosition`
 * — never on the *values* logged — so the stop sequence is a pure function of
 * the routine. If that is false, the watch cannot render a plan ahead of time
 * and capture+replay does not work.
 */

import { projectSchedule } from './schedule';
import type { RoutineInput } from './schedule';
import { createEngine } from '../engine';

/**
 * Walk the engine the way a real user does — `LogSet`, with values that change
 * on every set. If advancement depended on any logged value, this sequence
 * would diverge from the `SetDone`-driven projection. That divergence is the
 * one thing that would invalidate the whole capture+replay architecture, so
 * this is the highest-value assertion in the file.
 */
async function walkByLogging(routine: RoutineInput): Promise<string[]> {
  const engine = createEngine({});
  let state = await engine.dispatch({
    tag: 'StartSession',
    sessionId: 'real-walk',
    nowMs: 0,
    routine,
  });

  const visited: string[] = [];
  let guard = 0;
  while (state.phase !== 'done' && guard < 1000) {
    guard++;
    if (state.phase === 'resting') {
      state = await engine.dispatch({ tag: 'SkipRest' });
      continue;
    }
    const e = state.entries[state.exerciseIndex];
    visited.push(`${e.exerciseId}:${state.phase}:${state.setIndex + 1}`);
    state = await engine.dispatch({
      tag: 'LogSet',
      reps: 3 + (guard % 7),
      weightKg: 20 + guard * 2.5,
      rpe: 6 + (guard % 4),
      nowMs: 0,
    });
  }
  return visited;
}

const positionOf = (s: { exerciseId: string; phase: string; setNumber: number }) =>
  `${s.exerciseId}:${s.phase}:${s.setNumber}`;

/** Deterministic LCG — many routine shapes without adding a fast-check dependency. */
function makeRandomRoutine(seed: number): RoutineInput {
  let x = seed;
  const next = (n: number) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x % n;
  };
  const entryCount = 1 + next(5);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    const targetSets = next(4); // deliberately allows 0 — convention 10 territory
    entries.push(
      entry({
        exerciseId: `ex-${i}`,
        warmupSets: next(3),
        targetSets,
        targetReps: 1 + next(12),
        restSeconds: next(2) === 0 ? 0 : 30 + next(90),
        // contiguous runs sharing a label form a superset group
        supersetGroup: next(3) === 0 ? `g${Math.floor(i / 2)}` : '',
      })
    );
  }
  return { id: `r-seed-${seed}`, entries };
}

function entry(overrides: Partial<RoutineInput['entries'][number]> = {}) {
  return {
    exerciseId: 'squat',
    kind: 'strength' as const,
    warmupSets: 0,
    targetSets: 3,
    targetReps: 5,
    targetDurationSeconds: 0,
    restSeconds: 90,
    supersetGroup: '',
    ...overrides,
  };
}

describe('projectSchedule', () => {
  it('emits one stop per planned set of a single-exercise routine', async () => {
    const routine: RoutineInput = { id: 'r1', entries: [entry()] };

    const stops = await projectSchedule(routine);

    expect(stops).toHaveLength(3);
    expect(stops[0]).toMatchObject({
      ordinal: 0,
      exerciseId: 'squat',
      phase: 'working',
      setNumber: 1,
      totalSets: 3,
      targetReps: 5,
      restSeconds: 90,
    });
    expect(stops.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(stops.map((s) => s.ordinal)).toEqual([0, 1, 2]);
  });

  it('round-robins a superset group instead of finishing one exercise first', async () => {
    const routine: RoutineInput = {
      id: 'r-superset',
      entries: [
        entry({ exerciseId: 'bench', targetSets: 2, supersetGroup: 'A' }),
        entry({ exerciseId: 'row', targetSets: 2, supersetGroup: 'A' }),
      ],
    };

    const stops = await projectSchedule(routine);

    expect(stops.map((s) => `${s.exerciseId}${s.setNumber}`)).toEqual([
      'bench1',
      'row1',
      'bench2',
      'row2',
    ]);
    // Verify supersetGroup is propagated to stops (surviving mutant: supersetGroup: undefined)
    expect(stops.every((s) => s.supersetGroup === 'A')).toBe(true);
  });

  it('marks warmup sets as warmup and the rest as working', async () => {
    const routine: RoutineInput = {
      id: 'r-warmup',
      entries: [entry({ warmupSets: 2, targetSets: 2 })],
    };

    const stops = await projectSchedule(routine);

    expect(stops.map((s) => s.phase)).toEqual(['warmup', 'warmup', 'working', 'working']);
    expect(stops.every((s) => s.totalSets === 4)).toBe(true);
  });

  it('never lands on a zero-set entry (engine convention 10)', async () => {
    const routine: RoutineInput = {
      id: 'r-zero',
      entries: [
        entry({ exerciseId: 'ghost', warmupSets: 0, targetSets: 0 }),
        entry({ exerciseId: 'real', targetSets: 2 }),
      ],
    };

    const stops = await projectSchedule(routine);

    expect(stops.map((s) => s.exerciseId)).toEqual(['real', 'real']);
  });

  it('omits absent targets rather than emitting the engine sentinel 0', async () => {
    const routine: RoutineInput = {
      id: 'r-duration',
      entries: [
        entry({
          exerciseId: 'plank',
          kind: 'stretch',
          targetSets: 1,
          targetReps: 0,
          targetDurationSeconds: 45,
          restSeconds: 0,
          supersetGroup: '',
        }),
      ],
    };

    const [stop] = await projectSchedule(routine);

    expect(stop.targetReps).toBeUndefined();
    expect(stop.targetDurationSeconds).toBe(45);
    expect(stop.supersetGroup).toBeUndefined();
    // Verify restSeconds: 0 is preserved (0 is not a sentinel for rest, it's a real value)
    // Surviving mutant: optionalCount(entry.restSeconds) as number
    expect(stop.restSeconds).toBe(0);
  });

  it('propagates the engine rejection for a routine with nothing to do', async () => {
    const routine: RoutineInput = {
      id: 'r-all-zero',
      entries: [entry({ warmupSets: 0, targetSets: 0 })],
    };

    await expect(projectSchedule(routine)).rejects.toThrow(/no entry with any sets to perform/);
  });

  it('rejects an empty routine with no entries', async () => {
    const routine: RoutineInput = {
      id: 'r-empty',
      entries: [],
    };

    await expect(projectSchedule(routine)).rejects.toThrow(/out of bounds/);
  });

  it('handles superset members with mismatched set counts (AC2.2)', async () => {
    const routine: RoutineInput = {
      id: 'r-mismatched',
      entries: [
        entry({ exerciseId: 'bench', targetSets: 4, supersetGroup: 'A' }),
        entry({ exerciseId: 'row', targetSets: 2, supersetGroup: 'A' }),
      ],
    };

    const stops = await projectSchedule(routine);

    // Verify round-robin order with mismatched counts
    expect(stops.map((s) => `${s.exerciseId}#${s.setNumber}`)).toEqual([
      'bench#1',
      'row#1',
      'bench#2',
      'row#2',
      'bench#3',
      'bench#4',
    ]);
    // Each member must know its own totalSets, not the max
    expect(stops[0]).toMatchObject({ exerciseId: 'bench', totalSets: 4 });
    expect(stops[1]).toMatchObject({ exerciseId: 'row', totalSets: 2 });
    expect(stops[4]).toMatchObject({ exerciseId: 'bench', totalSets: 4 });
  });

  it('projects the same positions the engine visits when sets are really logged', async () => {
    let compared = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const routine = makeRandomRoutine(seed);

      let expected: string[];
      try {
        expected = await walkByLogging(routine);
      } catch {
        // engine refuses this routine; the projection must refuse it too
        await expect(projectSchedule(routine)).rejects.toThrow(/no entry with any sets to perform/);
        continue;
      }

      const stops = await projectSchedule(routine);
      expect(stops.map(positionOf)).toEqual(expected);
      compared++;
    }
    // Anti-vacuity guard: without this the loop passes trivially if every seed
    // lands in the rejection branch. Measured across 60 seeds: 57 compared,
    // 183 positions, 39 routines with any label, 9 with real adjacent groups,
    // 5 with mismatched per-member set counts (2 with two active members).
    expect(compared).toBeGreaterThan(30);
  }, 30000);

  // ---- #276 Phase 3: the projection reads the set list --------------------

  describe('per-set plan (#276)', () => {
    /** RAMP: three warmups at ascending loads, then four working sets. */
    const RAMP = [
      { setType: 'warmup' as const, reps: 5, weightKg: 9.07 },
      { setType: 'warmup' as const, reps: 5, weightKg: 11.34 },
      { setType: 'warmup' as const, reps: 3, weightKg: 18.14 },
      { setType: 'normal' as const, reps: 8, weightKg: 22.68 },
      { setType: 'normal' as const, reps: 8, weightKg: 22.68 },
      { setType: 'normal' as const, reps: 8, weightKg: 22.68 },
      { setType: 'normal' as const, reps: 8, weightKg: 22.68 },
    ];

    it('totalSets is the entry’s list length, not the aggregate sum', async () => {
      const stops = await projectSchedule({
        id: 'r-ramp',
        // Aggregates that disagree with the list, so a reader still summing
        // them reports 4 rather than 7.
        entries: [entry({ warmupSets: 1, targetSets: 3, sets: RAMP })],
      });

      expect(stops).toHaveLength(7);
      expect(stops.every((s) => s.totalSets === 7)).toBe(true);
    });

    it('each stop carries its own set’s target reps, not one value for the entry', async () => {
      const stops = await projectSchedule({
        id: 'r-ramp',
        entries: [entry({ warmupSets: 3, targetSets: 4, targetReps: 99, sets: RAMP })],
      });

      expect(stops.map((s) => s.targetReps)).toEqual([5, 5, 3, 8, 8, 8, 8]);
      expect(stops.map((s) => s.phase)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'working',
        'working',
        'working',
        'working',
      ]);
    });

    it('INTERLEAVE: the phase per stop follows the set’s own type', async () => {
      const stops = await projectSchedule({
        id: 'r-interleave',
        entries: [
          entry({
            warmupSets: 2,
            targetSets: 1,
            sets: [
              { setType: 'warmup', reps: 5 },
              { setType: 'normal', reps: 8 },
              { setType: 'warmup', reps: 5 },
            ],
          }),
        ],
      });

      expect(stops.map((s) => s.phase)).toEqual(['warmup', 'working', 'warmup']);
      expect(stops.map((s) => s.totalSets)).toEqual([3, 3, 3]);
    });

    it('a duration entry reports its own set’s duration per stop', async () => {
      const stops = await projectSchedule({
        id: 'r-duration',
        entries: [
          entry({
            exerciseId: 'plank',
            kind: 'stretch',
            warmupSets: 0,
            targetSets: 2,
            targetReps: 0,
            targetDurationSeconds: 999,
            sets: [
              { setType: 'normal', durationSeconds: 30 },
              { setType: 'normal', durationSeconds: 45 },
            ],
          }),
        ],
      });

      expect(stops.map((s) => s.targetDurationSeconds)).toEqual([30, 45]);
      expect(stops.map((s) => s.targetReps)).toEqual([undefined, undefined]);
    });
  });
});
