import { Model } from '@nozbe/watermelondb';
import { text, readonly, date } from '@nozbe/watermelondb/decorators';

export type ExerciseKind = 'strength' | 'cardio' | 'stretch';

export default class Exercise extends Model {
  static table = 'exercises';

  @text('title') title!: string;
  @text('kind') kind!: ExerciseKind;
  @text('muscle_group') muscleGroup?: string;
  @text('equipment') equipment?: string;
  @readonly @date('created_at') createdAt!: Date;
}
