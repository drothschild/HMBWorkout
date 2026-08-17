import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const databaseSchema = appSchema({
  version: 6,
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
        { name: 'description', type: 'string', isOptional: true }, // user-authored; AI accept path never sets this
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
        // A coach-prescribed target load for this entry, in canonical kg.
        // Nullable and never backfilled: an absent prescription is the normal
        // case and must leave the SetLogger's history-derived prefill exactly
        // as it was. lbs exists only at the UI and prompt edges
        // (src/state/weightUnits.ts).
        { name: 'target_weight_kg', type: 'number', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },
      ],
    }),
    // A routine entry's ordered list of PRESCRIBED sets (#276, schema v6). One
    // row per set the plan asks for, which is the shape a warmup ramp needs and
    // the aggregate columns on routine_exercises cannot express: they can record
    // "3 warmup sets" but not 9.07 → 11.34 → 18.14 kg.
    //
    // Distinct from session_sets, which records what was actually PERFORMED.
    // The two set_type vocabularies differ deliberately: here it is
    // 'warmup' | 'normal' (what Hevy prescribes), there it is
    // 'warmup' | 'working' | 'stretch' | 'cardio' (what the engine logs).
    //
    // Nothing references these rows, so upsertRoutine replaces an entry's whole
    // list rather than reconciling it row by row — unlike routine_exercises,
    // whose ids session_sets.routine_exercise_id depends on.
    tableSchema({
      name: 'routine_sets',
      columns: [
        { name: 'routine_exercise_id', type: 'string', isIndexed: true },
        { name: 'order', type: 'number' }, // 0-based, within the exercise
        { name: 'set_type', type: 'string' }, // 'warmup' | 'normal'
        { name: 'target_reps', type: 'number', isOptional: true },
        // Present only for a genuine range: target_reps alone is an exact
        // prescription. Hevy emits rep_range {start:5,end:5} for exact ones, and
        // collapsing that to a bare target_reps is lossless.
        { name: 'target_reps_max', type: 'number', isOptional: true },
        // Canonical kg, as on routine_exercises. The coach speaks lbs; the one
        // write-side conversion stays at the AI accept boundary.
        { name: 'target_weight_kg', type: 'number', isOptional: true },
        { name: 'target_duration_seconds', type: 'number', isOptional: true },
        // No aggregate ancestor. Added because Hevy sends distance_meters and
        // the column costs nothing once a set table exists.
        { name: 'target_distance_m', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'sessions',
      columns: [
        { name: 'routine_id', type: 'string', isIndexed: true },
        { name: 'started_at', type: 'number' },
        { name: 'ended_at', type: 'number', isOptional: true },
        { name: 'engine_state', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'session_sets',
      columns: [
        { name: 'session_id', type: 'string', isIndexed: true },
        { name: 'routine_exercise_id', type: 'string', isIndexed: true },
        // Which exercise this set was actually performed as, recorded at log
        // time. routine_exercise_id names a permanent row whose exercise_id is
        // mutable (ReplaceExercise), so the row cannot be the identity of
        // record — a swap would rewrite every past session's history through
        // it. Optional because rows written before v3 have no recorded
        // identity; those fall back to the routine_exercises join, and
        // updateRoutineExerciseExerciseId freezes them before it re-points.
        { name: 'exercise_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'set_type', type: 'string' }, // 'warmup' | 'working' | 'stretch' | 'cardio'
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
