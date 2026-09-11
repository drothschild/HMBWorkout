import { Database, Q } from '@nozbe/watermelondb';
import type Exercise from '@/db/models/Exercise';
import { getRoutineSets } from '@/db/repository';
import { rowHasPrescribedSets } from './routineSetPlans';

/** Most exercise thumbnails a Routines tab card shows (#335). */
export const ROUTINE_THUMBNAIL_LIMIT = 4;

export interface RoutineListItem {
  id: string;
  name: string;
  exerciseCount: number;
  /**
   * True if at least one exercise prescribes at least one set — matching the
   * engine's own definition of "active" (h.next_active_landing /
   * h.next_active_idx, whose predicate is `length(entry.sets) > 0` since #276).
   * A routine can have exercises yet still be unstartable if every one of them
   * prescribes nothing. Those rows are historical — imported before
   * upsertRoutine's zero-total default existed, and now unhealable since vault
   * import is gone (AGENTS.md's zero-planned-set Boundaries rule).
   *
   * The question is asked through the same `rowHasPrescribedSets` that
   * `startSessionFromRoutine` builds its own guard on, so this flag and that
   * guard cannot disagree about which routines are startable.
   */
  hasActiveExercise: boolean;
  /**
   * Up to ROUTINE_THUMBNAIL_LIMIT relative image paths (#335): distinct by
   * exercise, in routine order, exercises without an image skipped.
   */
  thumbnailPaths: string[];
}

/**
 * Query all routines from the database and format them for the UI.
 * Includes exercise count for each routine.
 * Routines are sorted by creation order (created_at, ascending).
 */
export async function routineListPresenter(db: Database): Promise<RoutineListItem[]> {
  const routines = (await db.get('routines').query(Q.sortBy('created_at', Q.asc)).fetch()) as any[];

  const result: RoutineListItem[] = [];

  for (const routine of routines) {
    const routineId = routine.id;
    const routineExercises = (await db
      .get('routine_exercises')
      .query(Q.where('routine_id', routineId))
      .fetch()) as any[];

    // The query returns rows unsorted; "routine order" for the thumbnails needs
    // the `order` column, as routineDetailPresenter does.
    routineExercises.sort((a, b) => a._raw.order - b._raw.order);

    let hasActiveExercise = false;
    for (const re of routineExercises) {
      if (rowHasPrescribedSets(await getRoutineSets(db, re.id))) {
        hasActiveExercise = true;
        break;
      }
    }

    result.push({
      id: routineId,
      name: routine.name,
      exerciseCount: routineExercises.length,
      hasActiveExercise,
      thumbnailPaths: await readThumbnailPaths(
        db,
        routineExercises.map((re) => re._raw.exercise_id as string)
      ),
    });
  }

  return result;
}

/**
 * The card's thumbnail strip (#335), from exercise ids already in routine
 * order. An id is marked seen whether or not it has an image — distinct by
 * EXERCISE, not by path — and a row whose exercise no longer exists is skipped.
 */
async function readThumbnailPaths(
  db: Database,
  orderedExerciseIds: readonly string[]
): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const exerciseId of orderedExerciseIds) {
    if (paths.length >= ROUTINE_THUMBNAIL_LIMIT) break;
    if (seen.has(exerciseId)) continue;
    seen.add(exerciseId);

    try {
      const exercise = (await db.get('exercises').find(exerciseId)) as Exercise;
      if (exercise.imagePath) paths.push(exercise.imagePath);
    } catch {
      // Exercise no longer exists; no thumbnail for it.
    }
  }

  return paths;
}
