/**
 * Schedule projection — the phone dry-runs the real engine to produce the flat,
 * ordered list of stops a routine walks through, for the watch to render.
 *
 * Why this is sound: `advance_after_set` (engine/rules/transition.lv) depends
 * only on `entries`, `setIndex`, `exerciseIndex` and `supersetPosition` — never
 * on the values logged (engine convention 9). The stop sequence is therefore a
 * pure function of the routine, and the watch can be handed the whole plan up
 * front without ever deciding anything itself.
 *
 * The dry run uses the REAL engine with no executors. `createEngine` reaches
 * every executor through `?.`, so an empty table makes every effect a no-op:
 * nothing is persisted, no rest is scheduled, no session is created. Driving it
 * with `SetDone` rather than `LogSet` is deliberate — `SetDone` advances
 * identically but emits no `PersistSet`, which is exactly the "advance without
 * logging" walk this projection needs.
 */

import { createEngine } from '../engine';
import type { RoutineEntry, SessionState } from '../engine/types';

/** A routine entry as callers author it — `idx` is host-assigned, never by hand. */
export type RoutineEntryInput = Omit<RoutineEntry, 'idx'>;

export interface RoutineInput {
  id: string;
  entries: RoutineEntryInput[];
}

/** One position the workout stops at: a single set of a single exercise. */
export interface Stop {
  /** 0-based position in the schedule. The join key for replayed captures. */
  ordinal: number;
  exerciseId: string;
  phase: 'warmup' | 'working';
  /** 1-based set number within this entry (a shared round number in a superset). */
  setNumber: number;
  /** warmupSets + targetSets for this entry. */
  totalSets: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds: number;
  supersetGroup?: string;
}

/**
 * Upper bound on dry-run iterations. Guards against a rule change making the
 * walk non-terminating; a real routine produces vastly fewer stops than this.
 */
const MAX_STOPS = 1000;

/** Absent-not-sentinel: the engine uses 0 for "no target", the wire contract omits it. */
function optionalCount(value: number): number | undefined {
  return value === 0 ? undefined : value;
}

function stopFrom(state: SessionState, ordinal: number): Stop {
  const entry = state.entries[state.exerciseIndex];
  return {
    ordinal,
    exerciseId: entry.exerciseId,
    phase: state.phase === 'warmup' ? 'warmup' : 'working',
    setNumber: state.setIndex + 1,
    totalSets: entry.warmupSets + entry.targetSets,
    targetReps: optionalCount(entry.targetReps),
    targetDurationSeconds: optionalCount(entry.targetDurationSeconds),
    restSeconds: entry.restSeconds,
    supersetGroup: entry.supersetGroup === '' ? undefined : entry.supersetGroup,
  };
}

/**
 * Walk `routine` through the engine and record every stop.
 *
 * Throws whatever the engine throws — a routine the engine refuses to start
 * (empty, or every entry planning zero sets) has no schedule, and saying so
 * loudly matches `startSessionFromRoutine`'s existing rejection rather than
 * handing the watch an empty plan.
 */
export async function projectSchedule(routine: RoutineInput): Promise<Stop[]> {
  const engine = createEngine({});
  let state = await engine.dispatch({
    tag: 'StartSession',
    sessionId: 'schedule-dry-run',
    nowMs: 0,
    routine,
  });

  const stops: Stop[] = [];
  while (state.phase !== 'done' && stops.length < MAX_STOPS) {
    if (state.phase === 'resting') {
      state = await engine.dispatch({ tag: 'SkipRest' });
      continue;
    }
    stops.push(stopFrom(state, stops.length));
    state = await engine.dispatch({ tag: 'SetDone', nowMs: 0 });
  }

  if (state.phase !== 'done') {
    throw new Error(
      `projectSchedule: walk did not terminate within ${MAX_STOPS} stops (routine ${routine.id})`
    );
  }

  return stops;
}
