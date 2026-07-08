import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation, children } from '@nozbe/watermelondb/decorators';

export default class Session extends Model {
  static table = 'sessions';

  static associations = {
    routines: { type: 'belongs_to' as const, key: 'routine_id' },
    session_sets: { type: 'has_many' as const, foreignKey: 'session_id' },
  };

  @field('routine_id') routineId!: string;
  @readonly @date('started_at') startedAt!: Date;
  @readonly @date('ended_at') endedAt?: Date;
  @text('sync_status') customSyncStatus!: string;
  @readonly @date('created_at') createdAt!: Date;

  @children('session_sets') sessionSets: any;
}
