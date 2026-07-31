/**
 * Exercise-question context: the description half.
 *
 * The routine entry the engine hands back carries only exerciseId/kind
 * (`RoutineEntry` in `rules/types.lv` strips everything else), so the
 * exercise's own user-authored `description`, if any, has to be resolved
 * shell-side — the same way `getExerciseTitles` (`src/db/repository.ts`)
 * resolves titles.
 */

import { Database } from '@nozbe/watermelondb';

/**
 * The exercise's user-authored description, or null when there is none, or
 * the exercise no longer exists — the same "absent" convention
 * `getExerciseTitles` uses for a stale id.
 *
 * @param database The database instance
 * @param exerciseId The exercise the athlete tapped the question button on
 */
export async function loadExerciseDescription(
  database: Database,
  exerciseId: string
): Promise<string | null> {
  try {
    const exercise = await database.get('exercises').find(exerciseId);
    return (exercise as { description?: string | null }).description ?? null;
  } catch {
    // Exercise no longer exists; nothing to describe.
    return null;
  }
}
