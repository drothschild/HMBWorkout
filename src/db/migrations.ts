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
    {
      toVersion: 4,
      // v3 -> v4: sessions.sync_status is undeclared, not dropped. It tracked
      // whether a finished session had been posted to the Obsidian vault; the
      // bridge that consumed it is gone.
      //
      // The steps array is deliberately empty. WatermelonDB 0.28 ships no
      // column-removal step (destroyColumn is an upstream TODO), and official
      // guidance is to leave the unused column in the database and omit it from
      // the schema, which the adapters then ignore on read and write. The
      // generated DDL carries no type or NOT NULL constraint on it
      // (adapters/sqlite/encodeSchema emits bare `"col"`), so the leftover
      // column simply takes NULL on every subsequent insert.
      //
      // unsafeExecuteSql('ALTER TABLE ... DROP COLUMN') was considered and
      // rejected: raw-SQL transaction semantics in migrations are undocumented,
      // and the LokiJS adapter -- which backs both adapter.web.ts and every
      // test -- ignores SQL steps outright, so the platforms would diverge.
      //
      // The entry exists at all so `version` stays honest with the declaration
      // and the migration list has no gap, which schemaMigrations enforces.
      steps: [],
    },
  ],
});
