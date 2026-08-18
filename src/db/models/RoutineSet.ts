import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

/**
 * One PRESCRIBED set within a routine entry (#276, schema v6).
 *
 * The plan, not the performance: `SessionSet` records what was actually done.
 * The two `set_type` vocabularies are deliberately different — a prescription
 * is 'warmup' | 'normal' (what Hevy authors), a logged set is
 * 'warmup' | 'working' | 'stretch' | 'cardio' (what the engine stamps).
 *
 * Nothing references these rows. `session_sets.routine_exercise_id` points at
 * the parent `routine_exercises` row, whose id must survive a routine edit;
 * these rows carry no such duty, so `upsertRoutine` replaces an entry's whole
 * list rather than reconciling it.
 */
export type RoutineSetType = 'warmup' | 'normal';

export default class RoutineSet extends Model {
  static table = 'routine_sets';

  static associations = {
    routine_exercises: { type: 'belongs_to' as const, key: 'routine_exercise_id' },
  };

  @field('routine_exercise_id') routineExerciseId!: string;
  /** 0-based position within the exercise. */
  @field('order') order!: number;
  @text('set_type') setType!: RoutineSetType;
  @field('target_reps') targetReps?: number;
  /** Set only for a genuine range; absent means `target_reps` is exact. */
  @field('target_reps_max') targetRepsMax?: number;
  /** Canonical kg. The coach speaks lbs; conversion stays at the accept edge. */
  @field('target_weight_kg') targetWeightKg?: number;
  @field('target_duration_seconds') targetDurationSeconds?: number;
  @field('target_distance_m') targetDistanceM?: number;
  /**
   * Per-set rest override (#281, schema v8). Absent means the set inherits
   * `routine_exercises.rest_seconds`; present overrides it. A drop set uses it
   * to say "0 rest between drops, full rest after the last".
   */
  @field('rest_seconds') restSeconds?: number;
}
