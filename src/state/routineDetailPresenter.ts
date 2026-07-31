import { Database, Q } from '@nozbe/watermelondb';
import { normalizeNotes } from '@/db/repository';

export interface ExerciseDetail {
  /** Unique routine_exercises row id — the only stable identity when a routine repeats an exercise. */
  routineExerciseId: string;
  exerciseId: string;
  title: string;
  order: number;
  warmupSets?: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
  kind: string;
  description: string | null;
}

export interface SupersetGroupDetail {
  label: string;
  exercises: ExerciseDetail[];
}

export interface RoutineDetail {
  id: string;
  name: string;
  /** Routine-level description (the routines.notes column); null when absent. */
  notes: string | null;
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
    const exerciseMap = new Map<string, { title: string; kind: string; description: string | null }>();
    const exerciseIds = [...new Set(routineExercises.map((re) => re._raw.exercise_id))];

    for (const exId of exerciseIds) {
      const exercise = await db.get('exercises').find(exId);
      exerciseMap.set(exId, {
        title: (exercise as any).title,
        kind: (exercise as any)._raw.kind,
        description: (exercise as any)._raw.description ?? null,
      });
    }

    // Group by superset
    const supersetGroups: Map<string, ExerciseDetail[]> = new Map();
    const standaloneExercises: ExerciseDetail[] = [];

    for (const re of routineExercises) {
      const exerciseId = re._raw.exercise_id;
      const exerciseInfo = exerciseMap.get(exerciseId);

      const detail: ExerciseDetail = {
        routineExerciseId: re.id,
        exerciseId,
        title: exerciseInfo?.title || exerciseId,
        order: re._raw.order,
        warmupSets: re._raw.warmup_sets,
        targetSets: re._raw.target_sets,
        targetReps: re._raw.target_reps,
        targetDurationSeconds: re._raw.target_duration_seconds,
        restSeconds: re._raw.rest_seconds,
        kind: exerciseInfo?.kind || 'strength',
        description: exerciseInfo?.description ?? null,
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
      // Whitespace-only notes normalize to null, matching the exercise
      // description convention, so read sites can treat null as "absent".
      notes: normalizeNotes((routine as any).notes as string | undefined),
      supersetGroups: supersetGroupsArray,
      standaloneExercises,
    };
  } catch (error) {
    // Routine not found or error accessing
    return null;
  }
}
