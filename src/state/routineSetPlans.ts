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
  /**
   * The row's coach-prescribed load. An aggregate row DOES carry one — this is
   * the column `acceptDraft` writes today — and it applies to every set the
   * counts expand into, which is exactly what the pre-#276 per-exercise
   * prescription did with it.
   */
  target_weight_kg?: number | null;
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

  // The row's own prescribed load rides along on every derived set. It is the
  // one thing an aggregate row genuinely knows about load, and dropping it is
  // how Phase 3 silently killed the coach-prescribed weight for every routine
  // in the app (`acceptDraft` writes this column and no `routine_sets` rows
  // until Phase 4). A uniform load across a uniform list reproduces the
  // pre-#276 behaviour exactly — that code applied the one value to every set.
  const load = (counts.target_weight_kg ?? 0) > 0 ? (counts.target_weight_kg as number) : undefined;

  return setsFromCounts(fromColumns(counts)).map((set) => {
    const entry: RoutineSetEntry = { setType: set.setType };
    if (set.reps != null) entry.targetReps = set.reps;
    if (set.durationSeconds != null) entry.targetDurationSeconds = set.durationSeconds;
    if (load != null) entry.targetWeightKg = load;
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
 * Returns `[]` when the entry is gone or prescribes nothing.
 *
 * The aggregate fallback IS applied, through the same `prescribedSets` every
 * other shell reader uses. An earlier version declined it, reasoning that "an
 * aggregate row has no per-set load to offer" — which is false: the row's own
 * `target_weight_kg` is precisely a load, it is the column `acceptDraft`
 * writes, and until Phase 4 gives `acceptDraft` a `sets` list it is the ONLY
 * place a coach's prescription lives. Declining the fallback here therefore did
 * not avoid manufacturing empty sets; it deleted the prescribed-weight prefill
 * for every routine in the app.
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

  return getPrescribedSetsForRow(database, row.id, (row as any)._raw);
}

/**
 * The same resolution keyed by `routine_exercises` row id, for readers that
 * already hold one (the finished-workout detail screen).
 *
 * `counts` is the row's raw columns when the caller already has them; omitted,
 * the row is looked up. A row that no longer exists prescribes nothing.
 */
export async function getPrescribedSetsForRow(
  database: Database,
  routineExerciseId: string,
  counts?: RoutineExerciseCounts
): Promise<RoutineSetEntry[]> {
  const rows = await getRoutineSets(database, routineExerciseId);
  if (counts) return prescribedSets(rows, counts);

  const found = await database
    .get('routine_exercises')
    .query(Q.where('id', routineExerciseId))
    .fetch();
  const row = found[0];
  if (!row) return prescribedSets(rows, {});

  return prescribedSets(rows, (row as any)._raw);
}
