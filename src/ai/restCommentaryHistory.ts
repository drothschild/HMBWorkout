/**
 * The commentary prompt's history half.
 *
 * Reuses `getExerciseWorkingSetHistory` rather than querying itself, so the
 * rest-screen coach reads exactly what the AI coach's history section reads:
 * working sets only (warmups excluded), most recent first.
 */

import { Database } from '@nozbe/watermelondb';
import { getExerciseWorkingSetHistory } from '@/db/repository';
import SessionSet from '@/db/models/SessionSet';
import {
  REST_COMMENTARY_HISTORY_SETS,
  type RestCommentaryHistorySet,
} from './restCommentaryPrompt';

/**
 * The UTC day a set was logged, derived the way `contextBuilder` dates the same
 * sets — one view of a workout should not disagree with another about its date.
 * `created_at` is non-optional on local writes; the guard is defensive.
 */
function loggedDate(set: SessionSet): string | null {
  const createdAtMs = (set as any)._raw.created_at;

  return typeof createdAtMs === 'number' && createdAtMs > 0
    ? new Date(createdAtMs).toISOString().split('T')[0]
    : null;
}

/**
 * Recent working sets for one exercise, flattened to plain JSON so the prompt
 * builder and the commentary store stay free of WatermelonDB models (and
 * testable without a database).
 *
 * @param database The database instance
 * @param exerciseId The exercise the remark is about — the one the completed
 *   set was performed on for the `lastSet` shape, the one coming up for
 *   `upNext`. `restCommentaryTarget` resolves which; this loader only follows
 *   the id it is handed, so the history always belongs to the exercise being
 *   discussed.
 * @returns At most REST_COMMENTARY_HISTORY_SETS sets, most recent first
 */
export async function loadRestCommentaryHistory(
  database: Database,
  exerciseId: string
): Promise<RestCommentaryHistorySet[]> {
  const sets = await getExerciseWorkingSetHistory(database, exerciseId);

  return sets.slice(0, REST_COMMENTARY_HISTORY_SETS).map((set) => ({
    reps: set.reps,
    weightKg: set.weightKg,
    durationSeconds: set.durationSeconds,
    rpe: set.rpe,
    loggedDate: loggedDate(set),
  }));
}
