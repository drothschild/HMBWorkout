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
  /**
   * How many sets this entry prescribes — the length of its own set list,
   * which as of #276 Phase 6 is the only thing it could be.
   *
   * Worth knowing why this was once a subtle read: through Phases 2–5 an entry
   * also carried aggregate counts that `fromRillState` re-derived FROM the
   * list, so reading the list and summing the counts agreed by construction on
   * engine-produced state and no test could tell them apart. The counts are
   * gone, so the equivalence is gone with them.
   */
  totalSets: number;
  /**
   * The prescription for THIS set, not a single value repeated across the
   * entry (#276). On a warmup ramp the three warmups legitimately differ.
   */
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds: number;
  supersetGroup?: string;
  // Note: exerciseTitle is not included here because the engine (convention 6)
  // does not carry exercise metadata. The shell must join titles via
  // getExerciseTitles() in src/db/repository.ts.
}

/**
 * Upper bound on dry-run loop iterations. Guards against a rule change making the
 * walk non-terminating (e.g., stuck in resting with SkipRest looping forever).
 * A real routine produces vastly fewer iterations than this.
 */
const MAX_ITERATIONS = 1000;

/** Absent-not-sentinel: the engine uses 0 for "no target", the wire contract omits it. */
function optionalCount(value: number): number | undefined {
  return value === 0 ? undefined : value;
}

function stopFrom(state: SessionState, ordinal: number): Stop {
  if (state.exerciseIndex < 0 || state.exerciseIndex >= state.entries.length) {
    throw new Error(
      `stopFrom: exercise index out of bounds (${state.exerciseIndex} of ${state.entries.length} entries)`
    );
  }
  if (state.phase !== 'warmup' && state.phase !== 'working') {
    throw new Error(
      `stopFrom: unexpected phase '${state.phase}' (expected 'warmup' or 'working')`
    );
  }
  const entry = state.entries[state.exerciseIndex];
  const sets = entry.sets;
  // The set being stopped at. `setIndex` is a shared round number inside a
  // superset group, and a member is visited once per round up to its own list
  // length (engine convention 9), so it indexes that member's own list
  // directly.
  const plannedSet = sets[state.setIndex];
  return {
    ordinal,
    exerciseId: entry.exerciseId,
    phase: state.phase,
    setNumber: state.setIndex + 1,
    totalSets: sets.length,
    targetReps: optionalCount(plannedSet?.reps ?? 0),
    targetDurationSeconds: optionalCount(plannedSet?.durationSeconds ?? 0),
    restSeconds: entry.restSeconds,
    supersetGroup: entry.supersetGroup === '' ? undefined : entry.supersetGroup,
  };
}

/**
 * Walk `routine` through the engine and record every stop.
 *
 * Throws if the engine refuses to start the routine. Two cases:
 * - Empty entries: engine throws "TransitionError: index 0 out of bounds"
 * - Every entry with an empty set list: engine throws "routine has no entry with any sets to perform"
 * These differ from shell-side rejection messages. Callers should handle these engine-level errors.
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
  let iterations = 0;
  while (state.phase !== 'done' && iterations < MAX_ITERATIONS) {
    iterations++;
    if (state.phase === 'resting') {
      state = await engine.dispatch({ tag: 'SkipRest' });
      continue;
    }
    stops.push(stopFrom(state, stops.length));
    state = await engine.dispatch({ tag: 'SetDone', nowMs: 0 });
  }

  if (state.phase !== 'done') {
    throw new Error(
      `projectSchedule: walk did not terminate within ${MAX_ITERATIONS} iterations (routine ${routine.id})`
    );
  }

  return stops;
}
