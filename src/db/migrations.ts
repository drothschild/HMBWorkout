import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

/**
 * Schema migrations, keyed by the schema version they migrate *to*. Bump
 * `version` in ./schema.ts and add a matching step here every time a column
 * or table changes — otherwise an existing install upgrading in place has no
 * migration path and WatermelonDB's adapter setup throws/crashes instead of
 * upgrading the local database.
 */
export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        // v1 -> v2: exercises gain an optional, user-authored description.
        // Nullable so existing rows (and the AI accept path, which never
        // writes one) stay valid with no backfill required.
        addColumns({
          table: 'exercises',
          columns: [{ name: 'description', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        // v2 -> v3: a session set records which exercise it was performed as.
        // Before this, exercise identity resolved only through
        // routine_exercises.exercise_id — a permanent row that ReplaceExercise
        // now re-points, which would silently re-attribute every past
        // session's history to the substitute.
        //
        // Nullable, and deliberately not backfilled: existing rows keep
        // resolving through the join, and updateRoutineExerciseExerciseId
        // stamps a row's own sets with its outgoing exercise id, inside the
        // same transaction, before re-pointing it. History is therefore frozen
        // exactly when it is about to become ambiguous, and never before.
        addColumns({
          table: 'session_sets',
          columns: [{ name: 'exercise_id', type: 'string', isOptional: true, isIndexed: true }],
        }),
      ],
    },
  ],
});
