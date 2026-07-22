import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export type SetType = 'warmup' | 'working' | 'drop';

export default class SessionSet extends Model {
  static table = 'session_sets';

  static associations = {
    sessions: { type: 'belongs_to' as const, key: 'session_id' },
    routine_exercises: { type: 'belongs_to' as const, key: 'routine_exercise_id' },
  };

  @field('session_id') sessionId!: string;
  @field('routine_exercise_id') routineExerciseId!: string;
  @text('set_type') setType!: SetType;
  @field('reps') reps?: number;
  @field('weight_kg') weightKg?: number;
  @field('duration_seconds') durationSeconds?: number;
  @field('distance_m') distanceM?: number;
  @field('position') position!: number;
  @readonly @date('created_at') createdAt!: Date;
}
