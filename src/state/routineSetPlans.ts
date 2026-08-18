// pattern: Imperative Shell (the DB read); `entrySetsFromRows` is pure.
/**
 * The shell's view of a routine entry's prescription (#276).
 *
 * Two jobs, deliberately in one module so they cannot drift:
 *
 *  - `entrySetsFromRows` turns `routine_sets` rows into the engine's
 *    `RoutineSet[]`. Every shell reader that asks "what does this entry
 *    prescribe?" — `startSessionFromRoutine`, `routineListPresenter`,
 *    `routineDetailPresenter` — goes through it, so the "can this routine
 *    start?" question has exactly one answer.
 *  - `getPrescribedSetsForEntry` reads one entry's prescription back out of the
 *    database, FRESH, for the session screen's prefill.
 *
 * Through Phases 3–5 both of those fell back to the aggregate columns when an
 * entry had no `routine_sets` rows behind it. Phase 6 deleted the fallback with
 * the columns: `routine_sets` is the only representation of a plan, and an
 * entry with no rows prescribes nothing. That is a real, renderable state
 * (engine convention 10), not a missing lookup — do not reintroduce a default
 * that manufactures a set nobody wrote.
 *
 * The freshness of the second reader is load-bearing and is why the prefill
 * does not simply read the set list off engine state.
 * `updateRoutineExerciseExerciseId` clears every `target_weight_kg` on an
 * exercise swap (AGENTS.md's swap rule), but the engine's `ReplaceExercise`
 * leaves the entry's `sets` untouched by design (#276 AC2.11) — so a prefill
 * sourced from engine state would hand the substitute the outgoing exercise's
 * whole ramp, which is the exact stale-prescription bug the clear exists to
 * prevent, multiplied across a list. Reading the DB after
 * `exerciseReplaceStore.routineRevision` bumps is what makes the clear visible
 * to the running session.
 */

import { Database, Q } from '@nozbe/watermelondb';
import type { RoutineSet } from '@/engine/types';
import { getRoutineSets, type RoutineSetEntry } from '@/db/repository';

/**
 * A routine entry's prescribed sets in engine shape.
 *
 * A straight mapping now that the rows are the whole plan. It stays a named
 * function rather than an inline `.map` because it is the single place the DB
 * column names meet the engine's field names, and a reader that spelled that
 * mapping itself is how the two drift.
 */
export function entrySetsFromRows(rows: readonly RoutineSetEntry[]): RoutineSet[] {
  return rows.map((row) => ({
    setType: row.setType,
    reps: row.targetReps,
    repsMax: row.targetRepsMax,
    weightKg: row.targetWeightKg,
    durationSeconds: row.targetDurationSeconds,
    distanceM: row.targetDistanceM,
  }));
}

/** True when the entry prescribes at least one set — the shell's "active" test. */
export function rowHasPrescribedSets(rows: readonly RoutineSetEntry[]): boolean {
  return rows.length > 0;
}

/**
 * One entry's prescribed sets, read fresh from the database, keyed by the
 * entry's 0-based `order`.
 *
 * `order` is what the engine carries as `RoutineEntry.idx`
 * (`startSessionFromRoutine`: "Use DB order directly, NOT loop counter"), so a
 * caller holding an engine entry can look its prescription up without resolving
 * a row id. Keying on `exercise_id` would be wrong — a routine may list the same
 * exercise twice with different prescriptions.
 *
 * Returns `[]` when the entry is gone or prescribes nothing.
 */
export async function getPrescribedSetsForEntry(
  database: Database,
  routineId: string,
  order: number
): Promise<RoutineSetEntry[]> {
  const rows = await database
    .get('routine_exercises')
    .query(Q.and(Q.where('routine_id', routineId), Q.where('order', order)))
    .fetch();

  const row = rows[0];
  if (!row) return [];

  return getRoutineSets(database, row.id);
}

/**
 * The same resolution keyed by `routine_exercises` row id, for readers that
 * already hold one (the finished-workout detail screen).
 *
 * A row that no longer exists prescribes nothing — and so does a row that
 * exists with no sets, which is why this no longer needs to distinguish the
 * two. Through Phase 5 it took an optional `counts` argument so a caller
 * holding the raw row could avoid a second lookup for the aggregate fallback;
 * with no fallback there is nothing to look up.
 */
export async function getPrescribedSetsForRow(
  database: Database,
  routineExerciseId: string
): Promise<RoutineSetEntry[]> {
  return getRoutineSets(database, routineExerciseId);
}
