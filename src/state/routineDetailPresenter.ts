import { Database, Q } from '@nozbe/watermelondb';

export interface ExerciseDetail {
  exerciseId: string;
  title: string;
  order: number;
  warmupSets?: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
  kind: string;
}

export interface SupersetGroupDetail {
  label: string;
  exercises: ExerciseDetail[];
}

export interface RoutineDetail {
  id: string;
  name: string;
  supersetGroups: SupersetGroupDetail[];
  standaloneExercises: ExerciseDetail[];
}

/**
 * Query a routine's details including exercises, superset groupings, and targets.
 * Returns null if routine doesn't exist.
 */
export async function routineDetailPresenter(
  db: Database,
  routineId: string
): Promise<RoutineDetail | null> {
  try {
    const routine = await db.get('routines').find(routineId);

    const routineExercises = (await db
      .get('routine_exercises')
      .query(Q.where('routine_id', routineId))
      .fetch()) as any[];

    // Sort by order
    routineExercises.sort((a, b) => a._raw.order - b._raw.order);

    // Get exercise details
    const exerciseMap = new Map<string, { title: string; kind: string }>();
    const exerciseIds = [...new Set(routineExercises.map((re) => re._raw.exercise_id))];

    for (const exId of exerciseIds) {
      const exercise = await db.get('exercises').find(exId);
      exerciseMap.set(exId, {
        title: (exercise as any).title,
        kind: (exercise as any)._raw.kind,
      });
    }

    // Group by superset
    const supersetGroups: Map<string, ExerciseDetail[]> = new Map();
    const standaloneExercises: ExerciseDetail[] = [];

    for (const re of routineExercises) {
      const exerciseId = re._raw.exercise_id;
      const exerciseInfo = exerciseMap.get(exerciseId);

      const detail: ExerciseDetail = {
        exerciseId,
        title: exerciseInfo?.title || exerciseId,
        order: re._raw.order,
        warmupSets: re._raw.warmup_sets,
        targetSets: re._raw.target_sets,
        targetReps: re._raw.target_reps,
        targetDurationSeconds: re._raw.target_duration_seconds,
        restSeconds: re._raw.rest_seconds,
        kind: exerciseInfo?.kind || 'strength',
      };

      const supersetLabel = re._raw.superset_group;
      if (supersetLabel) {
        if (!supersetGroups.has(supersetLabel)) {
          supersetGroups.set(supersetLabel, []);
        }
        supersetGroups.get(supersetLabel)!.push(detail);
      } else {
        standaloneExercises.push(detail);
      }
    }

    // Convert superset groups to array
    const supersetGroupsArray: SupersetGroupDetail[] = Array.from(supersetGroups.entries()).map(
      ([label, exercises]) => ({
        label,
        exercises,
      })
    );

    return {
      id: routineId,
      name: (routine as any).name,
      supersetGroups: supersetGroupsArray,
      standaloneExercises,
    };
  } catch (error) {
    // Routine not found or error accessing
    return null;
  }
}
