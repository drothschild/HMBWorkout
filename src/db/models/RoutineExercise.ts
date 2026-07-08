import { Model } from '@nozbe/watermelondb';
import { field, text, relation } from '@nozbe/watermelondb/decorators';

export default class RoutineExercise extends Model {
  static table = 'routine_exercises';

  static associations = {
    routines: { type: 'belongs_to' as const, key: 'routine_id' },
    exercises: { type: 'belongs_to' as const, key: 'exercise_id' },
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
  @text('notes') notes?: string;
}
