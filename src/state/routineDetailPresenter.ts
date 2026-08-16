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
  /**
   * Coach-prescribed target load in canonical kg, or absent. Rendered in lbs at
   * the display edge (formatWeightLbs) — never carried in lbs.
   */
  targetWeightKg?: number;
  kind: string;
  description: string | null;
}

export interface SupersetGroupDetail {
  label: string;
  exercises: ExerciseDetail[];
}

/**
 * An order-preserving view of a routine's rows: a standalone exercise, or a
 * contiguous run of entries sharing a `superset_group` label (engine
 * convention 9). A superset item occupies the position of its first member.
 *
 * Per `helpers.lv`'s `h.group_end_idx` docstring, labels are contiguous but
 * NOT routine-unique — a later run can legitimately reuse an earlier run's
 * label. Two `items` entries can therefore share a `label` while remaining
 * distinct groups; never merge same-label items that aren't adjacent.
 */
export type RoutineDetailItem =
  | { type: 'superset'; label: string; exercises: ExerciseDetail[] }
  | { type: 'exercise'; exercise: ExerciseDetail };

export interface RoutineDetail {
  id: string;
  name: string;
  /** Routine-level description (the routines.notes column); null when absent. */
  notes: string | null;
  /** Ascending `order`, superset runs occupying their first member's position. */
  items: RoutineDetailItem[];
  /**
   * Derived from `items`, kept for `src/ai/contextBuilder.ts`. Its first site
   * (`routinesSection`) flattens and re-sorts by `exercise.order` regardless
   * of grouping, so that reshaping is behavior-preserving there. Its second
   * site (`historySection`) builds a title `Map` with no re-sort, so
   * insertion order can shift when a superset label is reused non-adjacently
   * — cosmetic prompt-line reordering only (the new order is routine order),
   * never a content change. Do not read these for display ordering — they
   * discard routine order across the two buckets. Use `items` instead.
   */
  supersetGroups: SupersetGroupDetail[];
  standaloneExercises: ExerciseDetail[];
  /**
   * True if at least one exercise (superset or standalone) plans a nonzero
   * total (warmupSets + targetSets) — the engine's own definition of
   * "active" (h.next_active_landing / h.next_active_idx, transition.lv).
   * False here means starting this routine is refused by
   * `startSessionFromRoutine`, same as having no exercises at all.
   */
  hasActiveExercise: boolean;
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

    // Build an order-preserving item list: a superset item is a *contiguous
    // run* of rows sharing a label — walking the order-sorted rows and only
    // extending the most-recently-pushed item when it is a superset with the
    // same label keeps that contiguity, so a later run reusing an earlier
    // label starts a new, distinct item instead of merging into it.
    const items: RoutineDetailItem[] = [];

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
        targetWeightKg: re._raw.target_weight_kg,
        kind: exerciseInfo?.kind || 'strength',
        description: exerciseInfo?.description ?? null,
      };

      const supersetLabel = re._raw.superset_group;
      if (supersetLabel) {
        const lastItem = items[items.length - 1];
        if (lastItem?.type === 'superset' && lastItem.label === supersetLabel) {
          lastItem.exercises.push(detail);
        } else {
          items.push({ type: 'superset', label: supersetLabel, exercises: [detail] });
        }
      } else {
        items.push({ type: 'exercise', exercise: detail });
      }
    }

    const supersetGroupsArray: SupersetGroupDetail[] = items
      .filter((item): item is { type: 'superset'; label: string; exercises: ExerciseDetail[] } =>
        item.type === 'superset'
      )
      .map((item) => ({ label: item.label, exercises: item.exercises }));

    const standaloneExercises: ExerciseDetail[] = items
      .filter((item): item is { type: 'exercise'; exercise: ExerciseDetail } => item.type === 'exercise')
      .map((item) => item.exercise);

    const hasActiveExercise = routineExercises.some(
      (re) => (re._raw.warmup_sets || 0) + (re._raw.target_sets || 0) > 0
    );

    return {
      id: routineId,
      name: (routine as any).name,
      // Whitespace-only notes normalize to null, matching the exercise
      // description convention, so read sites can treat null as "absent".
      notes: normalizeNotes((routine as any).notes as string | undefined),
      items,
      supersetGroups: supersetGroupsArray,
      standaloneExercises,
      hasActiveExercise,
    };
  } catch (error) {
    // Routine not found or error accessing
    return null;
  }
}
