import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const databaseSchema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'routines',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'exercises',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'kind', type: 'string' }, // 'strength' | 'cardio' | 'stretch'
        { name: 'muscle_group', type: 'string', isOptional: true },
        { name: 'equipment', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'routine_exercises',
      columns: [
        { name: 'routine_id', type: 'string', isIndexed: true },
        { name: 'exercise_id', type: 'string', isIndexed: true },
        { name: 'order', type: 'number' },
        { name: 'superset_group', type: 'string', isOptional: true },
        { name: 'warmup_sets', type: 'number' },
        { name: 'target_sets', type: 'number', isOptional: true },
        { name: 'target_reps', type: 'number', isOptional: true },
        { name: 'target_duration_seconds', type: 'number', isOptional: true },
        { name: 'rest_seconds', type: 'number', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'sessions',
      columns: [
        { name: 'routine_id', type: 'string', isIndexed: true },
        { name: 'started_at', type: 'number' },
        { name: 'ended_at', type: 'number', isOptional: true },
        { name: 'sync_status', type: 'string' },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'session_sets',
      columns: [
        { name: 'session_id', type: 'string', isIndexed: true },
        { name: 'routine_exercise_id', type: 'string', isIndexed: true },
        { name: 'set_type', type: 'string' }, // 'warmup' | 'working' | 'drop'
        { name: 'reps', type: 'number', isOptional: true },
        { name: 'weight_kg', type: 'number', isOptional: true },
        { name: 'duration_seconds', type: 'number', isOptional: true },
        { name: 'distance_m', type: 'number', isOptional: true },
        { name: 'rpe', type: 'number', isOptional: true },
        { name: 'position', type: 'number' }, // Monotonic ordering per session (deterministic)
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});
