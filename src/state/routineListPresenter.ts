import { Database, Q } from '@nozbe/watermelondb';
import { getRoutineSets } from '@/db/repository';
import { rowHasPrescribedSets } from './routineSetPlans';

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

    let hasActiveExercise = false;
    for (const re of routineExercises) {
      if (rowHasPrescribedSets(await getRoutineSets(db, re.id), re._raw)) {
        hasActiveExercise = true;
        break;
      }
    }

    result.push({
      id: routineId,
      name: routine.name,
      exerciseCount: routineExercises.length,
      hasActiveExercise,
    });
  }

  return result;
}
