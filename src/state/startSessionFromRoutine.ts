import { Database, Q } from '@nozbe/watermelondb';
import { Event, RoutineEntry, ExerciseKind } from '@/engine/types';

/**
 * Build a StartSession event from a routine in the database.
 * Loads routine_exercises, maps them to RoutineEntry format (with idx field),
 * and returns the event payload ready to dispatch.
 *
 * @param db Database instance
 * @param routineId ID of routine to start
 * @param sessionId ID for new session
 * @returns StartSession event (tag already set)
 * @throws Error if routine not found
 */
export async function startSessionFromRoutine(
  db: Database,
  routineId: string,
  sessionId: string
): Promise<Event & { tag: 'StartSession' }> {
  // Load routine
  const routine = await db.get('routines').find(routineId);

  // Load routine_exercises for this routine
  const routineExercises = (await db
    .get('routine_exercises')
    .query(Q.where('routine_id', routineId))
    .fetch()) as any[];

  // Sort by order
  routineExercises.sort((a, b) => a._raw.order - b._raw.order);

  // Build entries with idx field
  // CRITICAL: idx MUST match re._raw.order from database (canonical 0-based)
  // for onPersistSet to find the routine_exercise row by (routine_id, order: entry.idx)
  const entries: RoutineEntry[] = [];

  for (const re of routineExercises) {
    // Load exercise to get kind
    const exercise = await db.get('exercises').find(re._raw.exercise_id);

    const kind = (exercise as any)._raw.kind as ExerciseKind;

    entries.push({
      idx: re._raw.order, // Use DB order directly, NOT loop counter
      exerciseId: re._raw.exercise_id,
      kind,
      warmupSets: re._raw.warmup_sets || 0,
      targetSets: re._raw.target_sets || 0,
      targetReps: re._raw.target_reps || 0,
      targetDurationSeconds: re._raw.target_duration_seconds || 0,
      restSeconds: re._raw.rest_seconds || 0,
      supersetGroup: re._raw.superset_group || '',
    });
  }

  return {
    tag: 'StartSession',
    sessionId,
    nowMs: Date.now(),
    routine: {
      id: routineId,
      name: (routine as any).name,
      entries,
    },
  };
}
