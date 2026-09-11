> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Schema migrations (`src/db`)

**Bumping `databaseSchema.version` without a matching migration entry WIPES the
user's database, silently.** This is not a crash and not a bug — it is
WatermelonDB's own documented fallback, and #276 Phase 1 used it deliberately. Know
the mechanism before you touch either file.

`stepsForMigration` returns `null` when `fromVersion < minVersion || toVersion >
maxVersion`, and `null` is precisely the signal both adapters branch on to reset:
they log `Migrations not available for this version range, resetting database
instead` and set up from schema (`adapters/sqlite/index.js:132`,
`adapters/lokijs/worker/DatabaseDriver.js:354`). No `unsafeResetDatabase` call is
involved. **The only trace is a `logger.warn`** — nothing user-facing, so the user
opens the app to find their routines gone with no explanation. That is why
`src/state/schemaResetNotice.ts` exists: it restates WatermelonDB's own predicate
(rather than approximating it) to decide whether to tell them, and `_layout.tsx`
renders the banner. Its decision cannot live in the database, because the database is
the thing that was destroyed — it rides in the settings blob.

Three traps, each verified by execution rather than by reading:

1. **`[]` and `null` are both falsy and both mean "no steps to run", and the
   adapters treat them oppositely.** `[]` migrates; `null` resets. Any assertion
   about a migration path must distinguish them — a `toBeFalsy` or a `toEqual([])`
   alone passes under `null`.
2. **A gapped list throws at MODULE INIT.** `schemaMigrations` refuses one
   (`Migrations must be listed without gaps, or duplicates`), so bumping from 5 to 7
   needs a `toVersion: 6` entry as well as a `toVersion: 7` one. The check is gated
   on `NODE_ENV !== 'production'` (`Schema/migrations/index.js:82`), making it a
   Debug-only crash — and a module-init throw lands before `RuleErrorScreen` can
   render (engine convention 4).
3. **The same `NODE_ENV` asymmetry applies to the wipe itself.**
   `validateAdapter` (`adapters/common.js:30` — `:29` is the neighbouring
   "Migrations can't be newer than schema" invariant) asserts `maxVersion ===
   schema.version` in non-production builds and throws `Missing migration` from the
   adapter *constructor*, before any reset can run. So a Release build wiped as
   designed while a Debug build crashed at boot. `migrationsForAdapter`
   (`adapterMigrations.ts`) is the gate that removes the divergence: it withholds
   the migrations object entirely when coverage and schema disagree, which both
   adapters treat identically to an uncovered range (`if (!migrations) return
   null`). **Today it is a pass-through and should stay one.**

Removing a column is `steps: []` plus deleting it from `schema.ts` —
**undeclare, don't drop.** WatermelonDB 0.28 ships no `destroyColumn`, and the
adapters ignore a physical column the schema omits. v4 (`sessions.sync_status`) and
v7 (`routine_exercises`' five aggregates) both do this. Two consequences: the data is
still in the file, so a later re-declaration recovers it; and `unsafeExecuteSql('ALTER
TABLE … DROP COLUMN')` is rejected because LokiJS ignores SQL steps outright and the
platforms would diverge.

`migrationV6ToV7.test.ts` is the pattern for proving any of this: two WatermelonDB
opens sharing one `LokiMemoryAdapter` via `_testLokiAdapter`, so the second open is a
real upgrade of the first database. It asserts both outcomes — data surviving a
covered upgrade, and data destroyed when the migrations are withheld — because a
harness that can only observe one of them proves nothing.

The schema is at **v10**. v9 (#335, `exercises.image_path` + `exercises.image_source`)
is a non-destructive `addColumns` bump like v8, proved by `migrationV8ToV9.test.ts`
on the same two-open harness; LokiJS ignores column declarations, so the step's
*presence* is pinned separately in `migrations.test.ts`.

v10 (#332) adds nullable `sessions.diary_entry`, `selfie_path`, and `debrief_ready`.
`workoutDiaryMigration.test.ts` verifies the exact addColumns step and a populated
v9-to-v10 Loki reopen with logged data preserved. Native SQLite upgrade remains
human QA. `src/db/workoutDiary.ts` writes only completed sessions; completion is
first-writer-wins inside one database writer. Selfie paths are relative to the
app documents folder and never sent in coach prompts.

[Back to reference index](README.md)
