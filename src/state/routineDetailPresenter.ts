import { Database, Q } from '@nozbe/watermelondb';
import { getRoutineSets, normalizeNotes, type RoutineSetEntry } from '@/db/repository';
import { groupBySupersetRuns } from '@/domain/supersetGrouping';
import { rowHasPrescribedSets } from './routineSetPlans';

export interface ExerciseDetail {
  /** Unique routine_exercises row id — the only stable identity when a routine repeats an exercise. */
  routineExerciseId: string;
  exerciseId: string;
  title: string;
  order: number;
  /**
   * The entry's ordered prescription (#276): one element per planned set, each
   * with its own type, reps (or rep range), load and duration. THIS is the
   * plan, and as of #276 Phase 6 the only one — the four aggregate count
   * fields and the per-exercise `targetWeightKg` that used to sit below it are
   * gone with their columns.
   *
   * A warmup ramp is three entries here with three different
   * `targetWeightKg` values — the shape the aggregate columns could only
   * record as the number 3.
   *
   * `[]` means the entry prescribes nothing, which is a real and renderable
   * state, not a missing lookup.
   */
  sets: RoutineSetEntry[];
  restSeconds?: number;
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
   * True if at least one exercise (superset or standalone) prescribes at least
   * one set — the engine's own definition of "active" (h.next_active_landing /
   * h.next_active_idx, whose predicate is `length(entry.sets) > 0` since #276).
   * False here means starting this routine is refused by
   * `startSessionFromRoutine`, same as having no exercises at all — and it is
   * refused through the same `rowHasPrescribedSets`, so the two cannot drift.
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

    // One `routine_sets` read per entry, up front, so `toDetail` stays sync
    // and the grouping below is unchanged.
    const setsByRow = new Map<string, RoutineSetEntry[]>();
    for (const re of routineExercises) {
      setsByRow.set(re.id, await getRoutineSets(db, re.id));
    }

    const toDetail = (re: any): ExerciseDetail => {
      const exerciseId = re._raw.exercise_id;
      const exerciseInfo = exerciseMap.get(exerciseId);
      const prescribed = setsByRow.get(re.id) ?? [];

      return {
        routineExerciseId: re.id,
        exerciseId,
        title: exerciseInfo?.title || exerciseId,
        order: re._raw.order,
        sets: prescribed,
        restSeconds: re._raw.rest_seconds,
        kind: exerciseInfo?.kind || 'strength',
        description: exerciseInfo?.description ?? null,
      };
    };

    // Build an order-preserving item list. The contiguity rule itself lives in
    // `@/domain/supersetGrouping` (#278) — a superset item is a *contiguous
    // run* of rows sharing a label, so a later run reusing an earlier label
    // comes back as a new, distinct run instead of merging into it, and a row
    // with no label (null, absent, or the engine's '' sentinel) comes back as
    // a singleton run whose label is null.
    const items: RoutineDetailItem[] = groupBySupersetRuns<any, string>(
      routineExercises,
      (re) => re._raw.superset_group
    ).map((run) =>
      run.label === null
        ? { type: 'exercise', exercise: toDetail(run.members[0]) }
        : { type: 'superset', label: run.label, exercises: run.members.map(toDetail) }
    );

    const supersetGroupsArray: SupersetGroupDetail[] = items
      .filter((item): item is { type: 'superset'; label: string; exercises: ExerciseDetail[] } =>
        item.type === 'superset'
      )
      .map((item) => ({ label: item.label, exercises: item.exercises }));

    const standaloneExercises: ExerciseDetail[] = items
      .filter((item): item is { type: 'exercise'; exercise: ExerciseDetail } => item.type === 'exercise')
      .map((item) => item.exercise);

    const hasActiveExercise = routineExercises.some((re) =>
      rowHasPrescribedSets(setsByRow.get(re.id) ?? [])
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
