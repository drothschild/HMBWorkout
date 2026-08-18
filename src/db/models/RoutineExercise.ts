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
  @field('rest_seconds') restSeconds?: number;
  @text('notes') notes?: string;

  /**
   * The entry's PRESCRIBED sets — the whole plan, as of schema v7 (#276).
   * Unordered as returned; `routine_sets.order` is the 0-based position, and
   * `getRoutineSets` in ../repository.ts is the reader that sorts by it.
   *
   * The five aggregate fields that used to sit above this — `warmupSets`,
   * `targetSets`, `targetReps`, `targetDurationSeconds`, `targetWeightKg` —
   * are gone with their columns. A getter for an undeclared column would
   * return `undefined` on every row rather than fail, so leaving one behind is
   * a silent read of nothing; that is why they come out here and not just from
   * schema.ts.
   */
  @children('routine_sets') sets!: Query<RoutineSet>;
}
