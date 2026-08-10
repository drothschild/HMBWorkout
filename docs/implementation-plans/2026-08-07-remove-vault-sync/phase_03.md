# Remove Vault Sync — Phase 3: Schema v4 and the always-deletable routine

**Goal:** Remove `sync_status` from the schema and every read site, and drop the delete guard it existed to serve.

**Architecture:** WatermelonDB has no column-removal migration step, so the column is **undeclared, not dropped** — removed from `appSchema`, left physically in existing SQLite files, and thereafter ignored. A `{ toVersion: 4, steps: [] }` entry keeps the migration list gapless so `version` stays honest. The delete guard that read the column goes with it, making every routine deletable.

**Tech Stack:** WatermelonDB 0.28.0 (SQLite on device, LokiJS in tests and on web), TypeScript, Jest.

**Scope:** Phase 3 of 4 from `docs/design-plans/2026-08-07-remove-vault-sync.md`.

**Depends on:** Phase 2 complete and merged.

**Codebase verified:** 2026-08-07 (codebase-investigator + direct reads of the WatermelonDB installed source).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### remove-vault-sync.AC2: No UI offers or mentions vault sync
- **remove-vault-sync.AC2.4 Success:** Deleting a routine that has a completed session succeeds with
  no error alert.

### remove-vault-sync.AC3: `sync_status` is gone from the schema and the code
- **remove-vault-sync.AC3.1 Success:** `src/db/schema.ts` declares `version: 4` and the `sessions`
  table has no `sync_status` column.
- **remove-vault-sync.AC3.2 Success:** `src/db/migrations.ts` contains a `toVersion: 4` entry that
  `schemaMigrations` accepts with an empty `steps` array.
- **remove-vault-sync.AC3.3 Success:** A database created fresh at v4 has no `sync_status` column,
  and `createSession` writes a session without one.
- **remove-vault-sync.AC3.4 Success:** The `Session` model has no `customSyncStatus` field.
- **remove-vault-sync.AC3.5 Success:** `deleteRoutine` deletes a routine referenced by a completed
  session, and `RoutineHasUnsyncedSessionsError` is no longer exported from `src/db/repository.ts`.
- **remove-vault-sync.AC3.6 Edge:** An existing v3 database opens at v4 without throwing. Data
  preservation across the upgrade is explicitly not required (pre-release app).

---

## Investigation findings

**The empty-steps migration is sound — a raised objection was checked and refuted.**

An external-dependency review flagged this phase as unsafe, arguing that `sync_status` is declared without `isOptional`, so the physical SQLite column would be `NOT NULL`; once undeclared, inserts would omit it and SQLite would reject them. **This was checked directly against the installed source and is wrong.**

`node_modules/@nozbe/watermelondb/src/adapters/sqlite/encodeSchema/index.js`:
```js
const standardColumns = `"id" primary key, "_changed", "_status"`
const encodeCreateTable = ({ name, columns }) => {
  const columnsSQL = [standardColumns]
    .concat(Object.keys(columns).map((column) => `"${column}"`))
    .join(', ')
  return `create table "${name}" (${columnsSQL});`
}
```
Columns are emitted as bare `"name"` — **no type, no constraint**. The only `not null` in the entire encoder is WatermelonDB's internal `local_storage` table. `addColumns` likewise emits `alter table "x" add "col";` with no constraint. `isOptional` is a JS-level concern (it drives `nullValue()` and RawRecord sanitization), never DDL. There is no constraint to violate: a leftover `sync_status` column simply receives NULL and is ignored.

Do not "fix" this with `unsafeExecuteSql('ALTER TABLE … DROP COLUMN …')`. The design rejected it for good reasons that still hold — raw-SQL transaction semantics in migrations are undocumented, and the LokiJS adapter (used by `adapter.web.ts` **and by every test**, via `createTestDatabase`) skips SQL steps entirely, so the platforms would diverge.

**Confirmed against the installed WatermelonDB 0.28.0 source:**
- ✓ `steps: []` passes validation — `Schema/migrations/index.js:68-70` asserts `Array.isArray(steps) && steps.every(…)`, and `[].every(…)` is `true`.
- ✓ Gapless `toVersion` is enforced (`index.js:84-92`); a v4 entry directly after v3 passes.
- ✓ No column-removal step builder exists in this version. `destroyColumn` is a TODO in the source.
- ✓ On SQLite, zero steps encode to `''`, `exec('')` is a clean no-op, and `userVersion` is still set to 4. On LokiJS the step loop simply doesn't iterate and the version is still bumped.

**Confirmed in this repo:**
- ✓ `src/db/schema.ts:4` — `version: 3`. `src/db/schema.ts:48` — `{ name: 'sync_status', type: 'string' }`.
- ✓ `src/db/migrations.ts` — v2 entry lines 12–23, v3 entry lines 24–42. The v3 comment ("Nullable, and deliberately not backfilled…") is the house style to match: explain *why*, not *what*.
- ✓ `src/db/models/Session.ts:16` — `@text('sync_status') customSyncStatus!: string;`
- ✓ `src/db/repository.ts` — `createSession` 64–82 (writes `'local'` at **line 76**); `deleteSession` comment 255–276 (sync_status at 271); `deleteRoutine` comment 1237–1274 (sync_status at 1254, `@throws` at 1272); `deleteRoutine` body 1275–1309 (guard at **1295–1303**, the read at **1296**); `RoutineHasUnsyncedSessionsError` class **1310–1319**.
- ✓ `src/db/migrations.test.ts` exists — **line 11 pins `expect(databaseSchema.version).toBe(3)`** and must be updated. v2→v3 test at 75–87 is the template for the new case.

**✗ Design gap 1 — `src/state/startSessionFromRoutine.integration.test.ts:183` breaks, and the design never mentions this file.**
It asserts `expect((session as any).customSyncStatus).toBe('local')`. `src/state` **is** jest-covered, so this fails the moment `createSession` stops writing the field. Task 3 fixes it.

**✗ Design gap 2 — `src/export/exportService.ts:145` reads the field, and `tsc` will NOT catch it.**
```ts
customSyncStatus: (session as any).customSyncStatus,
```
The `as any` cast means removing the model field produces **no compile error** — it silently passes `undefined` into a slot typed `customSyncStatus: string`. Task 3 makes this explicit rather than leaving latent rot.

**+ Additional finding — `serializeSession` declares `customSyncStatus` but never reads it.**
`src/interop/serialize.ts:157` has `customSyncStatus: string;` in the parameter type; the function body never touches it (the only other hits, lines 211/213, are comments). ~21 fixture sites across `src/interop/__tests__/serialize.test.ts` and `roundtrip.test.ts` pass `customSyncStatus: 'local'`.

**Decision: leave `src/interop` completely alone.** Removing the vestigial field would be tidier, but it would edit `src/interop/serialize.ts` plus ~21 fixture sites, directly contradicting AC4.1's "`src/interop/` and `src/export/` exist **unchanged**". The field is inert. Removing it belongs to whatever follow-up work replaces the export path, not to this deletion.

**That decision has a cost, and it is accepted knowingly rather than overlooked.** Holding `src/interop` unchanged strands three things inside it that will be stale by the end of Phase 2:

- `src/interop/parse.ts:159` cites `defaultTargetSetsForDurationLine in sync/syncService.ts` — a function deleted in Phase 2.
- `src/interop/parse.ts:301` refers to "the Phase 7 sync" as a consumer.
- `src/interop/test-helpers.ts` (`DEFAULT_VAULT_SYNC_DIR`, `HMB_VAULT_SYNC_DIR`), `src/interop/migrate.test.ts:22`, and `src/interop/__tests__/test-helpers.test.ts:5,12,15,16` still read a live Obsidian vault `_sync` directory. They skip when the directory is absent, so they stay green — but a change whose stated end state is "nothing describes a bridge that no longer exists" is leaving a vault-reading jest suite in place.

**None of this is fixed in this change**, because every fix edits `src/interop` and AC4.1 forbids it. The tension is real: AC4.1 ("unchanged") and Phase 4's goal ("no document asserts something the code no longer does") cannot both be fully satisfied inside `src/interop`. AC4.1 wins, because the whole point of keeping the module is that the future export work inherits it intact and can clean it up in the same pass that rewires it. **Record this in the PR description** so it reads as a deferred decision rather than an oversight, and so whoever picks up the Excel backup work knows these four sites are waiting.

**+ Additional finding — dropping the guard also makes a routine deletable mid-session. This is safe.**
The old guard read `customSyncStatus === 'local'`, which is the default from `createSession`, so it blocked deletion while *any* referencing session existed — including one still in progress (test at `repository.test.ts:537–559`). Removing it permits deleting a routine underneath a running workout. That does not strand the session: engine state carries `entries` inside the session state itself (AGENTS.md engine convention 5), so a live session never re-reads the routine row, and `deleteRoutine` deliberately retains `routine_exercises` as history carriers, so logged-set attribution survives. Worth knowing, not worth guarding.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Undeclare `sync_status` at schema v4

**Verifies:** remove-vault-sync.AC3.1, remove-vault-sync.AC3.2

**Files:**
- Modify: `src/db/schema.ts` (line 4, line 48)
- Modify: `src/db/migrations.ts` (append after the v3 entry at line 42)

**Implementation:**

1. `src/db/schema.ts` line 4: `version: 3` → `version: 4`.
2. `src/db/schema.ts` line 48: delete `{ name: 'sync_status', type: 'string' },` from the `sessions` table columns.
3. `src/db/migrations.ts`: add a v4 entry after the v3 one, inside the `migrations` array. Match the file's established comment style — the v3 entry explains *why* its column is nullable and unbackfilled, so this one must explain why its steps array is empty:

```ts
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
```

Do not change the `import` on line 1 — `addColumns` is still used by v2 and v3.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors. In particular, `schemaMigrations` must accept the new entry — a validation failure here throws at module load and would surface immediately.

**Commit:** `feat(db): undeclare sessions.sync_status at schema v4`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update the migration tests for v4

**Verifies:** remove-vault-sync.AC3.1, remove-vault-sync.AC3.2, remove-vault-sync.AC3.6

**Files:**
- Modify: `src/db/migrations.test.ts` (line 11; add a case after the v2→v3 test at 75–87)

**Implementation:**

1. Line 11 currently reads `expect(databaseSchema.version).toBe(3)` inside a test named for the v3 column. Update the value to `4` and rename the test to describe the v4 change.

**Testing:**
Model the new case on the existing v2→v3 test at lines 75–87, which uses `stepsForMigration({ migrations, fromVersion, toVersion })`.

- **remove-vault-sync.AC3.2:** `stepsForMigration({ migrations, fromVersion: 3, toVersion: 4 })` returns an **empty array** — and, importantly, does not throw. This is the test that pins the deliberate emptiness; without it a future contributor "fixing" the empty array by deleting the entry would break the gapless-version invariant silently.
- **remove-vault-sync.AC3.6:** `stepsForMigration({ migrations, fromVersion: 3, toVersion: 4 })` does not throw — the v3→v4 upgrade path resolves. Note this is the honest limit of what the node suite can prove: tests run on LokiJS via `createTestDatabase()`, so a *real* SQLite v3→v4 open is only verified by the simulator pass in Task 7. Say so in a comment on the test rather than implying more coverage than exists.
- **remove-vault-sync.AC3.1:** assert the `sessions` table schema in `databaseSchema` has no `sync_status` column. Read it off `databaseSchema.tables.sessions.columns` rather than re-deriving it.

Keep the existing test at 89–96 pinning that the web adapter carries the exact `migrations` object — it is unaffected and still valuable.

**Verification:**
```bash
npm test -- src/db/migrations.test.ts
```
Expected: all pass, including the three new/updated assertions.

**Commit:** `test(db): pin schema v4 and the empty v3->v4 migration`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Remove `customSyncStatus` from the model and every reader

**Verifies:** remove-vault-sync.AC3.3, remove-vault-sync.AC3.4

**Files:**
- Modify: `src/db/models/Session.ts` (line 16)
- Modify: `src/db/repository.ts` (JSDoc line 58; `createSession` write at line 75)
- Modify: `src/export/exportService.ts` (line 145)
- Modify: `src/db/repository.test.ts` (line 41; `markSessionSynced` helper 383–390; assertion line 482)
- Modify: `src/state/startSessionFromRoutine.integration.test.ts` (line 183)

**The two edits `tsc` cannot catch are in this task.** Both readers below go through `as any` casts, so a clean type check proves nothing. Make them by hand and confirm with the grep in Verification.

**Implementation:**

1. `src/db/models/Session.ts` line 16 — delete `@text('sync_status') customSyncStatus!: string;`. Check whether `text` is still used by another field in the file before removing it from the decorator import on line 2 (`engineState` on line 15 uses it, so it almost certainly stays).
2. `src/db/repository.ts` line 75 — delete `session.customSyncStatus = 'local';` from `createSession`. Line 58 of its JSDoc says "The session is created with syncStatus = 'local' by default." — delete that sentence.
3. `src/export/exportService.ts` line 145 — currently `customSyncStatus: (session as any).customSyncStatus,`. The model field is gone, so this now silently passes `undefined` into a slot the serializer types as `string`. `src/interop/serialize.ts` is deliberately not being changed (see findings), so the field must still be supplied. Replace it with a literal and a comment stating why:
   ```ts
   // serializeSession still declares this field but never reads it; the model
   // dropped it at schema v4. Supplied as a literal to satisfy the type.
   customSyncStatus: 'local',
   ```
   This is the one line of `src/export` this change touches. It is a deliberate, narrow deviation from the design's "`src/export` untouched" wording — leaving the line reading a field that no longer exists would be strictly worse. Flag it in the PR description.
4. `src/db/repository.test.ts`:
   - line 41 — delete `expect((session as any).customSyncStatus).toBe('local');`. Keep the rest of that test; it also asserts the session was created and retrievable, which is AC3.3's real content.
   - lines 383–390 — delete the `markSessionSynced` helper entirely. It writes `record._raw.sync_status = 'synced'` to a column that no longer exists in the schema.
   - **The helper has THREE callers, not one.** Verified: `476`, `498`, and `591`. All three must go before the helper can be deleted, or the phase does not compile:
     - **476** — with the `customSyncStatus` assertion at 482 (below).
     - **498** — inside the "allows deletion when every referencing session is already synced" test. Task 5 step 4 handles this one; do not double-edit it.
     - **591** — inside a *different* test entirely, about routine deletion preserving exercise history (`// End and sync the session` at 589). This one has no sync assertion attached — the call merely set up state that no longer means anything. **Delete the call and the comment at 589; keep the whole surrounding test**, which asserts history survives routine deletion and is unrelated to sync.
   - line 482 — delete `expect((survivorSession as any).customSyncStatus).toBe('synced');` and the `await markSessionSynced('session-del-4')` call at 476 that set it up. The surrounding test asserts the session row survives routine deletion, which stays true and stays valuable.
5. `src/state/startSessionFromRoutine.integration.test.ts` line 183 — delete `expect((session as any).customSyncStatus).toBe('local');`. The preceding assertion on `routineId` (line 182) still proves the session row was written correctly.

**Testing:**
No new test is needed for AC3.4 — the field's absence is structural, and the model has no behavior to exercise. AC3.3's "createSession writes a session without one" is covered by the surviving assertions in `repository.test.ts` (session created and retrievable) plus Task 2's schema assertion. Do not add a test that inspects `_raw` for the absence of a key; it would pin LokiJS internals rather than behavior.

**Verification:**
```bash
grep -rn "customSyncStatus\|sync_status\|markSessionSynced" src
```
Expected: hits **only** in `src/interop/serialize.ts:157` (the inert declared field), `src/interop/serialize.ts:211,213` (comments), the ~21 `src/interop/__tests__/` fixture sites, and the single literal you just wrote in `src/export/exportService.ts:145`. **No hits in `src/db/`, `src/state/`, or `src/app/`, and no `markSessionSynced` anywhere.**

```bash
npm test -- src/db src/state src/export
```
Expected: all pass.

**Commit:** `feat(db): drop customSyncStatus from the Session model`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Remove the delete guard and its error type

**Verifies:** remove-vault-sync.AC2.4, remove-vault-sync.AC3.5

**Files:**
- Modify: `src/db/repository.ts` (guard 1295–1303; error class 1310–1319; `@throws` line 1272)
- Modify: `src/app/(tabs)/routines.tsx` (import line 11; catch arm 114–118)

**Implementation:**

1. `src/db/repository.ts` — in `deleteRoutine`, delete **lines 1290–1303**: the `referencingSessions` query (1290–1293), the `hasUnsyncedSession` computation (1295–1297), and the `throw` (1298–1303). The Files list above cites 1295–1303 for the *guard proper*; the query at 1290–1293 exists only to feed it and goes too — 1290–1303 is the range to delete. What remains inside the `database.write` is the routine lookup, the not-found throw, and `database.batch(routine.prepareDestroyPermanently())`.
2. Delete the `RoutineHasUnsyncedSessionsError` class and its JSDoc (lines 1310–1319), and the `@throws RoutineHasUnsyncedSessionsError …` line from `deleteRoutine`'s JSDoc (line 1272). Keep the `@throws Error if the routine does not exist` line — that behavior survives.
3. Check whether `Session` and `Q` are still used elsewhere in `repository.ts` after the query is deleted; they almost certainly are, but do not leave an unused import for lint to catch.
4. `src/app/(tabs)/routines.tsx` — line 11, narrow the import to `import { deleteRoutine } from '@/db/repository';`. Then collapse the catch arm at 114–118: delete the `if (error instanceof RoutineHasUnsyncedSessionsError) { Alert.alert('Cannot delete routine', 'This routine has a workout that hasn\'t synced to your vault yet. Sync first, then delete.') } else {` wrapper, keeping only the `console.error('Failed to delete routine:', error)` fallback that was in the `else`. This also removes a user-facing vault string, which Phase 4's AC2.7 sweep re-verifies.

**Testing:** covered by Task 5, which inverts the two tests that asserted the guard.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
grep -rn "RoutineHasUnsyncedSessionsError" src
```
Expected: **no output.**

**Commit:** `feat(db): make every routine deletable`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Invert the routine-deletion tests

**Verifies:** remove-vault-sync.AC2.4, remove-vault-sync.AC3.5

**Files:**
- Modify: `src/db/repository.test.ts` (import line 3; tests at 505–535 and 537–559; the already-synced test around 470–483)

**Implementation:**

1. Line 3 — remove `RoutineHasUnsyncedSessionsError` from the import.
2. **Test at 505–535** ("blocks deletion when a local unsynced finished session references the routine, and deletes nothing"). This is the direct inverse of the new behavior and is the primary AC3.5 / AC2.4 test. Rewrite it, keeping its setup verbatim (routine + exercise + created + ended session) and replacing the expectations:
   - `await deleteRoutine(database, 'routine-del-6')` resolves rather than rejecting.
   - The routine row is **gone** — `database.get('routines').find('routine-del-6')` rejects, or query-by-id returns `[]`. Use the query form to match the file's existing style at `repository.ts:1283`.
   - The `routine_exercises` row **survives** (still length 1). This is the load-bearing half: `deleteRoutine` retains those rows as history carriers, and the old test already asserted it. Keep that assertion — it guards the behavior the guard removal must not disturb.
   - Rename the test to describe the new behavior, e.g. "deletes a routine referenced by a completed session, retaining routine_exercises as history carriers".
3. **Test at 537–559** ("blocks deletion when an in-progress session references the routine"). Same inversion: deletion now succeeds. Rewrite the expectations the same way and rename. Add a short comment recording that this is deliberate and safe — a live session carries its own `entries` in engine state and never re-reads the routine row (AGENTS.md engine convention 5). Also delete the stale `// Not ended: still in progress. sync_status defaults to 'local'.` comment at line 549.
4. **Test around 470–483** ("allows deletion when a session is already synced"). Its premise — that *synced* sessions do not block deletion — no longer distinguishes anything, since nothing blocks deletion. Task 3 already removed its `markSessionSynced` call and its `customSyncStatus` assertion. What remains duplicates the rewritten test at 505–535. Delete it, and delete the sibling at 485+ ("allows deletion when every referencing session is already synced") if it is left asserting the same thing. Check both before removing — do not delete a test that still asserts something distinct about multiple referencing sessions; if it does, keep it and just drop the sync framing.

**Testing:**
Tests must verify each AC listed above:
- **remove-vault-sync.AC3.5 / AC2.4:** a routine referenced by a **completed** session deletes successfully, and `RoutineHasUnsyncedSessionsError` is no longer importable from `src/db/repository.ts` (the import removal in step 1 is itself the compile-time proof).
- Retention of `routine_exercises` after deletion, so logged history stays reachable.

**Verification:**
```bash
npm test -- src/db/repository.test.ts
```
Expected: all pass. Confirm the two rewritten tests actually **assert deletion succeeded** — a test that merely stops expecting a throw would pass vacuously if `deleteRoutine` silently no-opped.

**Commit:** `test(db): routines with sessions are now deletable`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Rewrite the comment blocks that explain themselves via `syncNow()`

**Verifies:** remove-vault-sync.AC5.7 (claimed in Phase 4, satisfied here)

**Files:**
- Modify: `src/db/repository.ts` (`deleteSession` comment 255–276; `deleteRoutine` comment 1237–1274; **`upsertRoutine` comment 1157–1162**)

All three blocks justify their semantics in terms of a sync layer that no longer exists. They are long and load-bearing — they explain *why* rows are retained and *why* a default fires — so rewrite rather than delete.

**Implementation:**

0. **`upsertRoutine`, lines 1157–1162** — the code-level twin of AC5.4, and the one that no grep in this plan would have caught (it says "sync-layer" and "layer 1", never "syncNow" or "sync_status"). Currently:
   ```
   // Defense-in-depth: default targetSets to 1 for entries that would otherwise
   // be zero-total (no warmupSets and no targetSets). This catches any zero-total
   // entries that make it through without being defaulted upstream (sync-layer or
   // AI accept-path), ensuring the engine always has at least one set to visit.
   // The condition matches layer 1 (sync/syncService.ts): key on "no warmup + no target"
   // regardless of whether targetDurationSeconds is set or not.
   ```
   There is no layer 1 and no sync-layer any more — this *is* the only layer, which is precisely what AC5.4 asserts for AGENTS.md. Rewrite so it says so: `upsertRoutine` is the sole enforcer of the zero-total default, it fires only when `targetSets` is absent (never on an explicit `0`, which `validateRoutineDraft` rejects upstream), and the condition keys on "no warmup + no target" regardless of `targetDurationSeconds`. Drop "Defense-in-depth" — with one layer, the phrase is now false.

1. **`deleteSession` (255–276).** Remove the "Local-only / vault / bridge" paragraph (258–263) and the `sync_status='local'` clause from the atomicity note (271). What must survive, restated without sync:
   - it removes on-device rows only, and the HealthKit export written at completion is unaffected;
   - it refuses to delete an in-progress session (no `endedAt`) — the active session must go through the engine's abandon path;
   - check-and-delete is one critical section inside a single writer transaction via `database.batch`, so an app kill mid-loop cannot leave a truncated session.
2. **`deleteRoutine` (1237–1274).** Delete the "Sync safety guard" paragraph (1253–1261) entirely — the guard is gone. Delete the closing paragraph (1266–1268) about vault markdown surviving and "Import Routines" re-creating the routine; that path no longer exists. Keep, unchanged in substance:
   - what is deleted (routine row only) vs retained (`routine_exercises`, sessions, `session_sets`, exercises);
   - **why** `routine_exercises` are retained — `session_sets.routine_exercise_id` points through them to logged history, and destroying them would orphan `getExerciseWorkingSetHistory`;
   - that presenters filter by `routine_id` so orphan rows never reach the UI;
   - that exercises are global and never touched;
   - the atomicity note.

Do not shorten these into one-liners. AGENTS.md's Boundaries section treats the retention rule as load-bearing, and the reasoning is the only thing preventing a future contributor from "tidying up" the orphan rows.

**Verification:**
```bash
grep -n "syncNow\|sync_status\|vault\|bridge\|Import Routines\|synced\|sync-layer\|layer 1\|syncService\|Defense-in-depth" src/db/repository.ts
```
Expected: **no output.** The last four patterns exist because the original grep — keyed on the vocabulary of the *deleted feature* — could not see the `upsertRoutine` comment, which describes the same dead layer in different words. Any sweep in this change should be read with that failure mode in mind.

```bash
npm test -- src/db/repository.test.ts
```
Expected: still passes (comments only — this is a guard against an accidental code edit).

**Commit:** `docs(db): restate delete semantics without the sync queue`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Verify the phase, including a real SQLite upgrade

**Verifies:** remove-vault-sync.AC2.4, remove-vault-sync.AC3.3, remove-vault-sync.AC3.6

**Files:** none — this task only runs and observes.

**Step 1: Full verification**
```bash
npm test
```
```bash
npx tsc --noEmit
```
```bash
npm run lint
```
Expected: all pass.

**Step 2: Confirm the survivors are still untouched**
```bash
git diff --stat main -- src/interop
```
Expected: **no output** — `src/interop` is unchanged (AC4.1 still holds).

```bash
git diff --stat main -- src/export
```
Expected: exactly one file — `exportService.ts` — with **3 insertions and 1 deletion** (the two-line explanatory comment plus the replacement literal, replacing the old field read). Anything more means scope crept.

**On AC4.1's wording.** The criterion says `src/interop/` and `src/export/` "exist **unchanged**". After this task that is literally false for `src/export`, by exactly the diff above. The deviation is deliberate and argued in Design gap 2 — leaving the line reading a field the model no longer has would be strictly worse. Read AC4.1 as *"unchanged except the one flagged line in `exportService.ts:145`, and both suites still green."* `src/interop` remains unchanged in the literal sense. State this restatement in the PR description so an end-of-change reviewer checking AC4.1 as written does not read a failure.

**Step 3: The real v3→v4 upgrade (AC3.6)**

This is the step the test suite **cannot** do. `createTestDatabase()` uses LokiJS; only a device or simulator exercises the SQLite migration path, and AC3.6 is specifically about an existing v3 database opening at v4.

1. Before installing the new build, back up the existing on-device database so the pre-upgrade state is real and recoverable:
   ```bash
   xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer --domain-identifier com.davidr.hmbworkout --source Documents --destination <dir>
   ```
   On the simulator, locate the app container and copy `hmbworkout.db` aside instead.
2. Install the new build **over** the existing one — do not uninstall first. Uninstalling destroys the v3 database and turns this into a fresh-install test, which proves nothing about AC3.6.
3. Launch. The app must open without throwing. A migration failure surfaces as a WatermelonDB adapter error at startup.
4. Confirm the pre-existing sessions still appear in History. (Data preservation is explicitly *not* required by AC3.6 — the app is pre-release — but if it survives, say so, and if it does not, record what was lost rather than treating it as a failure.)
5. Complete a **new** session on the upgraded database. This is the specific case the refuted NOT NULL objection predicted would crash. It must succeed and appear in History. This is the strongest available evidence for AC3.3 on real SQLite.

**Step 4: Fresh install (AC3.3)**

Uninstall, reinstall, and confirm a database created fresh at v4 works: start a routine, log sets, complete the session, see it in History.

**Step 5: Deletable routine (AC2.4)**

With a completed session on record, delete its routine from the Routines tab. Expected: it deletes with **no error alert**. Then confirm the History entry for that session is still present and still renders — that is the `routine_exercises` retention working. Screenshot both.

**Done when:** all three commands pass, both `git diff --stat` checks match, and the upgrade, fresh-install, and deletion passes are complete with screenshots.
<!-- END_TASK_7 -->

---

## Phase exit criteria

- `npm test`, `npx tsc --noEmit`, `npm run lint` all pass (**AC6.1, AC6.2, AC6.3** — asserted at every phase boundary rather than claimed by one phase's AC Coverage section, matching how the design scopes them).
- `grep -rn "customSyncStatus\|sync_status\|markSessionSynced" src` hits only `src/interop` (unchanged, inert) and the single literal in `src/export/exportService.ts`.
- `grep -rn "RoutineHasUnsyncedSessionsError" src` returns nothing.
- `git diff --stat main -- src/interop` is empty; `-- src/export` is one file, 3 insertions / 1 deletion.
- An existing v3 database opened at v4 without throwing, and a new session completed on it.
- A routine with a completed session deleted with no alert, and its history survived.

`main` is green and mergeable. Only copy and documentation remain.
