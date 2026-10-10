import { Model } from '@nozbe/watermelondb';
import { text, readonly, date } from '@nozbe/watermelondb/decorators';

export type ExerciseKind = 'strength' | 'cardio' | 'stretch';

export default class Exercise extends Model {
  static table = 'exercises';

  @text('title') title!: string;
  @text('kind') kind!: ExerciseKind;
  @text('muscle_group') muscleGroup?: string;
  @text('equipment') equipment?: string;
  @text('description') description?: string | null;
  @text('image_path') imagePath!: string | null;
  @text('image_source') imageSource!: string | null;
  @text('youtube_demo_url') youtubeDemoUrl!: string | null;
  @readonly @date('created_at') createdAt!: Date;
}
