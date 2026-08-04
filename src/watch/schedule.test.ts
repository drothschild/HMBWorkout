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
});
