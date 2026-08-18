import {
  schemaMigrations,
  addColumns,
  createTable,
} from '@nozbe/watermelondb/Schema/migrations';

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
    {
      toVersion: 5,
      steps: [
        // v4 -> v5: a routine entry can carry a coach-prescribed target load.
        //
        // NOTE: this is a real addColumns step, unlike v4's deliberately empty
        // one. v4 *undeclared* a column (WatermelonDB 0.28 ships no removal
        // step); v5 *adds* one, which has a first-class builder. Copying v4's
        // empty-steps shape here would leave every upgrading install with a
        // schema declaring a column its database does not have.
        //
        // Nullable and deliberately not backfilled, the same as v2's
        // exercises.description and v3's session_sets.exercise_id: an entry with
        // no prescription is the ordinary case, and the prefill's precedence
        // chain is unchanged when the column is null.
        addColumns({
          table: 'routine_exercises',
          columns: [{ name: 'target_weight_kg', type: 'number', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        // v5 -> v6: a routine entry's plan becomes an ordered list of
        // prescribed sets (#276). The aggregate columns on routine_exercises
        // can record "3 warmup sets" but not the ramp 9.07 -> 11.34 -> 18.14
        // kg, and a back-fill in the lossy direction is impossible: every
        // routine reconstructed from a count would be a flat ramp that lies
        // about the plan.
        //
        // THIS ENTRY DID NOT EXIST WHILE THE SCHEMA WAS AT v6, AND THAT WAS THE
        // POINT. Bumping the schema past migrations.maxVersion makes
        // stepsForMigration return null, which both adapters treat as "reset":
        // they log "Migrations not available for this version range, resetting
        // database instead" and set up from schema
        // (adapters/sqlite/index.js:132,
        // adapters/lokijs/worker/DatabaseDriver.js:354). The wipe was the
        // framework's own documented fallback, it was deliberate, the user
        // accepted it on #276, and src/state/schemaResetNotice.ts is what told
        // them it had happened.
        //
        // It happened once. The entry exists now because v7 needs a gapless
        // list to reach it — schemaMigrations refuses a gap — and because
        // withholding a second time would destroy the routines rebuilt after
        // that wipe.
        //
        // A REAL createTable, not v4's empty steps. Every install that exists
        // in practice is already on v6 and runs only the 6 -> 7 step, so for
        // them this entry is pure gap-filler; but an install that somehow never
        // saw v6 would otherwise arrive at v7 with a schema declaring a table
        // its database does not have — a crash on first query rather than a
        // wipe. migrationV6ToV7.test.ts walks that path end to end.
        //
        // Frozen at the v6 shape. A later change to routine_sets belongs in a
        // NEW entry; editing this one rewrites history for anyone still
        // upgrading through it. migrations.test.ts asserts both halves — this
        // literal, and its agreement with schema.ts today — so a schema edit
        // that forgets its migration goes red here.
        createTable({
          name: 'routine_sets',
          columns: [
            { name: 'routine_exercise_id', type: 'string', isIndexed: true },
            { name: 'order', type: 'number' },
            { name: 'set_type', type: 'string' },
            { name: 'target_reps', type: 'number', isOptional: true },
            { name: 'target_reps_max', type: 'number', isOptional: true },
            { name: 'target_weight_kg', type: 'number', isOptional: true },
            { name: 'target_duration_seconds', type: 'number', isOptional: true },
            { name: 'target_distance_m', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      // v6 -> v7: routine_exercises' five aggregate columns — warmup_sets,
      // target_sets, target_reps, target_duration_seconds, target_weight_kg —
      // are undeclared, not dropped. routine_sets has been the authoritative
      // plan since v6; this removes the representation it replaced.
      //
      // The steps array is empty for exactly v4's reason: WatermelonDB 0.28
      // ships no column-removal step, and official guidance is to leave the
      // physical column in the database and omit it from the schema, which the
      // adapters then ignore on read and write. See the v4 entry above for the
      // full reasoning, including why unsafeExecuteSql was rejected — LokiJS
      // ignores SQL steps outright, so the platforms would diverge.
      //
      // Unlike v4, this entry is also load-bearing for a version it does not
      // itself change: without it the list is gapped at 6, and schemaMigrations
      // throws "Migrations must be listed without gaps, or duplicates" at
      // MODULE INIT. That check is gated on NODE_ENV !== 'production'
      // (Schema/migrations/index.js:82), so it is a Debug-only crash — the same
      // asymmetry ./adapterMigrations.ts exists to remove — and a module-init
      // throw lands before RuleErrorScreen can render (engine convention 4).
      steps: [],
    },
    {
      toVersion: 8,
      steps: [
        // v7 -> v8: a prescribed set can carry its own rest_seconds, overriding
        // the entry-level default (#281). This is what makes a drop set
        // expressible — zero rest between drops, full rest after the last —
        // which routine_exercises.rest_seconds alone cannot say.
        //
        // A REAL addColumns step, NON-destructive, unlike #276's v6 bump. There
        // is nothing to wipe: every routine_sets row written since v6 must
        // survive, and the column is nullable and deliberately not backfilled
        // (the same contract as v2's exercises.description, v3's
        // session_sets.exercise_id and v5's routine_exercises.target_weight_kg).
        // A null rest_seconds means the set inherits the exercise default, which
        // is exactly how every pre-v8 set behaves — so the resolution
        // (completedSet.restSeconds ?? currentEntry.restSeconds) leaves every
        // existing routine unchanged. migrationV7ToV8.test.ts drives a populated
        // v7 database across the upgrade and asserts the rows survive.
        addColumns({
          table: 'routine_sets',
          columns: [{ name: 'rest_seconds', type: 'number', isOptional: true }],
        }),
      ],
    },
  ],
});
