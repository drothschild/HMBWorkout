import { Model } from '@nozbe/watermelondb';
import { text, readonly, date } from '@nozbe/watermelondb/decorators';

export default class Routine extends Model {
  static table = 'routines';

  @text('name') name!: string;
  @text('notes') notes?: string;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}
