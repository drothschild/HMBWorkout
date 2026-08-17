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
    // v5 -> v6: THERE IS DELIBERATELY NO ENTRY HERE WHILE THE SCHEMA IS AT v6.
    // The omission is the mechanism. Do not add one to "fix" the wipe.
    //
    // This prohibition expires at Phase 6, which MUST add one — see the Phase 6
    // note at the end of this comment. The two are not in conflict: adding an
    // entry now defeats the wipe, and adding one then is what ends it.
    //
    // #276 moves a routine entry from a per-exercise aggregate to a per-set
    // list (the routine_sets table added in schema.ts at v6). A back-fill is
    // impossible in the lossy direction: the count `3` cannot be turned back
    // into the warmup ramp 9.07 → 11.34 → 18.14 kg, so every routine
    // reconstructed from aggregates would be a flat ramp that lies about the
    // plan. Losing the stored routines is accepted (the user said so on #276);
    // a half-migrated database carrying aggregate routines with no routine_sets
    // rows would be worse, because nothing downstream would ever notice.
    //
    // Bumping the schema past migrations.maxVersion makes stepsForMigration
    // return null (Schema/migrations/stepsForMigration.js: `toVersion >
    // maxVersion`), and both adapters treat null as "reset": they log
    // "Migrations not available for this version range, resetting database
    // instead" and set up from schema (adapters/sqlite/index.js:132,
    // adapters/lokijs/worker/DatabaseDriver.js:354). The wipe is the
    // framework's own documented fallback and needs no unsafeResetDatabase.
    //
    // Two consequences the code around this acts on:
    //
    //  1. It is SILENT — a logger.warn, nothing user-facing. src/state/
    //     schemaResetNotice.ts decides when to tell the user, and _layout.tsx
    //     shows it.
    //  2. The fallback is unreachable in a Debug build on its own. Whenever
    //     NODE_ENV is not 'production', validateAdapter
    //     (adapters/common.js:29) asserts `maxVersion === schema.version` and
    //     throws "Missing migration" straight out of the adapter constructor,
    //     before any reset can run. src/db/adapterMigrations.ts is the gate
    //     that keeps dev and production on the same path.
    //
    // migrations.test.ts pins the null, so adding an entry here goes red.
    //
    // PHASE 6 MUST ADD A toVersion: 6 ENTRY *AND* A toVersion: 7 ENTRY.
    //
    // Phase 6 bumps the schema to v7, and schemaMigrations refuses a gapped
    // list: a lone toVersion: 7 entry throws "Migrations must be listed without
    // gaps, or duplicates" at MODULE INIT, in every non-production build only
    // (the check is gated on NODE_ENV, exactly like validateAdapter above).
    // Leaving the migrations withheld at v7 instead is not the way out either —
    // that resets the database a second time and destroys whatever the user
    // rebuilt after this wipe. Both readings were executed; both are real.
    //
    // The toVersion: 6 entry should carry the real createTable for
    // routine_sets, mirroring schema.ts, rather than steps: []. The numbered
    // note at the end of ./adapterMigrations.ts has the full reasoning and the
    // exact failure text.
    //
    // When that lands, migrations.test.ts's AC1.7 pins — `maxVersion === 5` and
    // the "null for every upgrade path into v6" loop — go red BY DESIGN.
    // Rewrite them for the new coverage; do not delete them.
  ],
});
