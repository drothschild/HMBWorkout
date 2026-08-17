// pattern: Imperative Shell (the DB read); `entrySetsFromRows` is pure.
/**
 * The shell's view of a routine entry's prescription (#276 Phase 3).
 *
 * Two jobs, deliberately in one module so they cannot drift:
 *
 *  - `entrySetsFromRows` turns `routine_sets` rows into the engine's
 *    `RoutineSet[]`, falling back to the aggregate columns while the
 *    derivation seam lives (Phase 6 deletes the fallback). Every shell reader
 *    that asks "what does this entry prescribe?" — `startSessionFromRoutine`,
 *    `routineListPresenter`, `routineDetailPresenter` — goes through it, so the
 *    "can this routine start?" question has exactly one answer.
 *  - `getPrescribedSetsForEntry` reads one entry's prescription back out of the
 *    database, FRESH, for the session screen's prefill.
 *
 * That freshness is load-bearing and is why the prefill does not simply read
 * the set list off engine state. `updateRoutineExerciseExerciseId` clears every
 * `target_weight_kg` on an exercise swap (AGENTS.md's swap rule), but the
 * engine's `ReplaceExercise` leaves the entry's `sets` untouched by design
 * (#276 AC2.11) — so a prefill sourced from engine state would hand the
 * substitute the outgoing exercise's whole ramp, which is the exact
 * stale-prescription bug the clear exists to prevent, multiplied across a list.
 * Reading the DB after `exerciseReplaceStore.routineRevision` bumps is what
 * makes the clear visible to the running session.
 */

import { Database, Q } from '@nozbe/watermelondb';
import type { RoutineSet } from '@/engine/types';
import { getRoutineSets, type RoutineSetEntry } from '@/db/repository';
import { setsFromCounts } from '@/engine/entrySets';

/** The aggregate columns as WatermelonDB hands them back (`null` when unset). */
export interface RoutineExerciseCounts {
  warmup_sets?: number | null;
  target_sets?: number | null;
  target_reps?: number | null;
  target_duration_seconds?: number | null;
}

/**
 * A routine entry's prescribed sets in engine shape.
 *
 * DERIVATION SEAM (#276, deleted in Phase 6): a row with no `routine_sets`
 * behind it falls back to its aggregate counts. `upsertRoutine` writes both
 * halves, so a routine authored by the coach never takes this path; the
 * test-only `upsertRoutineExercise` and hand-built fixtures write counts alone
 * and still need to mean something until the contract phase.
 *
 * A row that HAS prescribed sets is taken at its word, counts ignored — the
 * list is authoritative the moment it exists, which is what lets a warmup ramp
 * (three distinct loads under one `warmup_sets: 3`) survive.
 */
export function entrySetsFromRows(
  rows: readonly RoutineSetEntry[],
  counts: RoutineExerciseCounts
): RoutineSet[] {
  return prescribedSets(rows, counts).map((row) => ({
    setType: row.setType,
    reps: row.targetReps,
    repsMax: row.targetRepsMax,
    weightKg: row.targetWeightKg,
    durationSeconds: row.targetDurationSeconds,
    distanceM: row.targetDistanceM,
  }));
}

/**
 * The same resolution in DB (`RoutineSetEntry`) shape, for the presenters that
 * render a plan rather than hand one to the engine. One function so the
 * "does this entry prescribe anything?" question has one answer everywhere.
 */
export function prescribedSets(
  rows: readonly RoutineSetEntry[],
  counts: RoutineExerciseCounts
): RoutineSetEntry[] {
  if (rows.length > 0) return [...rows];

  return setsFromCounts(fromColumns(counts)).map((set) => {
    const entry: RoutineSetEntry = { setType: set.setType };
    if (set.reps != null) entry.targetReps = set.reps;
    if (set.durationSeconds != null) entry.targetDurationSeconds = set.durationSeconds;
    return entry;
  });
}

/** True when the entry prescribes at least one set — the shell's "active" test. */
export function rowHasPrescribedSets(
  rows: readonly RoutineSetEntry[],
  counts: RoutineExerciseCounts
): boolean {
  return prescribedSets(rows, counts).length > 0;
}

function fromColumns(counts: RoutineExerciseCounts) {
  return {
    warmupSets: counts.warmup_sets ?? 0,
    targetSets: counts.target_sets ?? 0,
    targetReps: counts.target_reps ?? 0,
    targetDurationSeconds: counts.target_duration_seconds ?? 0,
  };
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
 * Returns `[]` when the entry is gone or prescribes nothing. The aggregate
 * fallback is deliberately NOT applied here: this feeds the prefill's load
 * lookup, and an aggregate row has no per-set load to offer, so expanding it
 * would only manufacture empty sets.
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
