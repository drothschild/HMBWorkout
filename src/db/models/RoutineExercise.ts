import { Model, Query } from '@nozbe/watermelondb';
import { field, text, relation, children } from '@nozbe/watermelondb/decorators';
import type RoutineSet from './RoutineSet';

export default class RoutineExercise extends Model {
  static table = 'routine_exercises';

  static associations = {
    routines: { type: 'belongs_to' as const, key: 'routine_id' },
    exercises: { type: 'belongs_to' as const, key: 'exercise_id' },
    routine_sets: { type: 'has_many' as const, foreignKey: 'routine_exercise_id' },
  };

  @field('routine_id') routineId!: string;
  @field('exercise_id') exerciseId!: string;
  @field('order') order!: number;
  @text('superset_group') supersetGroup?: string;
  @field('warmup_sets') warmupSets!: number;
  @field('target_sets') targetSets?: number;
  @field('target_reps') targetReps?: number;
  @field('target_duration_seconds') targetDurationSeconds?: number;
  @field('rest_seconds') restSeconds?: number;
  @field('target_weight_kg') targetWeightKg?: number;
  @text('notes') notes?: string;

  /**
   * The entry's PRESCRIBED sets (#276, schema v6). Unordered as returned —
   * `routine_sets.order` is the 0-based position, and `getRoutineSets` in
   * ../repository.ts is the reader that sorts by it.
   *
   * The aggregate columns above are still written and still read during the
   * expand phases; they are derived from this list by `upsertRoutine`, and
   * undeclared in Phase 6.
   */
  @children('routine_sets') sets!: Query<RoutineSet>;
}
