import { Database, Q } from '@nozbe/watermelondb';

export interface RoutineListItem {
  id: string;
  name: string;
  exerciseCount: number;
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

    result.push({
      id: routineId,
      name: routine.name,
      exerciseCount: routineExercises.length,
    });
  }

  return result;
}
