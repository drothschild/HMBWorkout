import { Database, Q } from '@nozbe/watermelondb';

export interface RoutineListItem {
  id: string;
  name: string;
  exerciseCount: number;
  /**
   * True if at least one exercise plans a nonzero total (warmupSets +
   * targetSets) — matching the engine's own definition of "active"
   * (h.next_active_landing / h.next_active_idx, transition.lv). A routine
   * can have exercises yet still be unstartable if every one carries no
   * target_sets. Those rows are historical — imported before upsertRoutine's
   * zero-total default existed, and now unhealable since vault import is gone
   * (AGENTS.md's zero-planned-set Boundaries rule).
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

    const hasActiveExercise = routineExercises.some(
      (re) => (re._raw.warmup_sets || 0) + (re._raw.target_sets || 0) > 0
    );

    result.push({
      id: routineId,
      name: routine.name,
      exerciseCount: routineExercises.length,
      hasActiveExercise,
    });
  }

  return result;
}
