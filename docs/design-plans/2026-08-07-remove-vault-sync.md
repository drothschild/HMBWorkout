# Remove Vault Sync Design

## Summary

This design deletes the app's Obsidian vault-sync integration: the HTTP bridge client, the offline
sync queue, the settings fields and screens that configure it, and the `sync_status` tracking that
gates routine deletion. It also strips vault references from user-facing copy and from AGENTS.md.
What survives on purpose is the markdown serialization layer (`src/interop`) and the unused export
scaffolding (`src/export`) — both are left running and green so a future Excel-based backup path
can build on them without redoing the parsing and serialization work.

The approach is four independently-mergeable phases, each leaving `npm test` and `tsc --noEmit`
green: first de-wire every caller of `src/sync` (including a **dynamic**
`import('@/sync/syncService')` inside `onCompleteSession` that the compiler cannot see, making this
phase hand-audited rather than compiler-driven); then delete the sync modules and settings fields
outright; then drop the `sync_status` column from the WatermelonDB schema — via WatermelonDB's
undeclare-rather-than-drop convention, since column deletion is not a supported migration step —
and remove the delete-guard it existed to serve, making every routine deletable; and finally sweep
user-facing copy and documentation so nothing still describes a bridge that no longer exists. Two
responsibilities the sync layer quietly duplicated, a zero-set defaulting rule and a
null-normalization step, become solitary rather than redundant once it is gone, and the plan calls
out exactly where the remaining single owner needs its test coverage confirmed before the redundant
copy disappears.

## Definition of Done

1. **The HTTP bridge is gone from the app.** `src/sync/` (bridgeClient, syncService, and their four test files), `src/helpers/settingsActions.ts`, and the `baseUrl`/`token` fields on `BridgeSettings` are deleted. No code path posts to or reads from the Mac-side bridge.

2. **No UI offers or mentions vault sync.** The `settings/bridge.tsx` screen and its Settings-index row are deleted, the Routines tab's "Import Routines" button is deleted, and every user-facing string referencing the vault or syncing is removed or reworded — the session-abandon confirmation, the Today tab empty state, and the delete-routine error.

3. **`sessions.sync_status` is dropped at schema v4.** The column is removed from the `appSchema` declaration, not from existing SQLite tables — WatermelonDB 0.28 has no supported column-removal step (see Architecture). `Session.customSyncStatus`, `deleteRoutine`'s unsynced-session guard, and `RoutineHasUnsyncedSessionsError` are all removed — routines become always-deletable.

4. **`src/interop` and `src/export` survive untouched**, still compiling and still green, so a future export path (Excel or otherwise) can build on them.

5. **AGENTS.md drops the two-repo split, the Sync section, and the contract-mirroring rule.** `../workout-bridge` itself is left alone on disk.

6. **`npm test` and `npx tsc --noEmit` pass**, and a session completes end-to-end in the simulator with no sync errors.

**Out of scope:** Excel backup; wiring `src/export` to any UI; any replacement routine-authoring path (the AI Coach becomes the sole way to create routines, and that is accepted).

## Acceptance Criteria

### remove-vault-sync.AC1: The bridge is unreachable from the app
- **remove-vault-sync.AC1.1 Success:** Completing a session issues no network request to a bridge
  URL — the effect path writes the database and HealthKit only.
- **remove-vault-sync.AC1.2 Success:** `src/sync/` does not exist, and no file under `src/` imports
  `@/sync/…` either statically or dynamically.
- **remove-vault-sync.AC1.3 Success:** The settings type has no `baseUrl` or `token` field, and
  `getSettings()` returns an object without them.
- **remove-vault-sync.AC1.4 Edge:** A stored settings blob that still contains `baseUrl`/`token`
  loads without error, and those stale keys reach no read site.
- **remove-vault-sync.AC1.5 Success:** `src/helpers/settingsActions.ts` and its test no longer exist.

### remove-vault-sync.AC2: No UI offers or mentions vault sync
- **remove-vault-sync.AC2.1 Success:** The Settings index renders exactly one row ("AI") and offers
  no route to a bridge screen.
- **remove-vault-sync.AC2.2 Success:** `/settings/bridge` resolves to no screen.
- **remove-vault-sync.AC2.3 Success:** The Routines tab renders the AI Coach button and no "Import
  Routines" button.
- **remove-vault-sync.AC2.4 Success:** Deleting a routine that has a completed session succeeds with
  no error alert.
- **remove-vault-sync.AC2.5 Success:** The session-abandon confirmation conveys that the deletion is
  permanent without referencing a vault.
- **remove-vault-sync.AC2.6 Success:** The Today tab's no-routines empty state names the AI Coach as
  the only way to create a routine and does not mention import or the vault.
- **remove-vault-sync.AC2.7 Edge:** No user-visible string in `src/app/` or `src/components/`
  contains "vault", "sync", or "bridge".

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

### remove-vault-sync.AC4: The markdown layer survives intact
- **remove-vault-sync.AC4.1 Success:** `src/interop/` and `src/export/` exist unchanged and their
  test suites pass.
- **remove-vault-sync.AC4.2 Success:** `serializeRoutine`, `serializeSession`, `parseRoutine`, and
  `parseSession` remain exported and importable.
- **remove-vault-sync.AC4.3 Success:** `upsertRoutine` still defaults `targetSets` to 1 for an entry
  with absent `targetSets` and zero `warmupSets`, proven by a test that does not depend on `src/sync`.
- **remove-vault-sync.AC4.4 Failure:** `validateRoutineDraft` still rejects a draft with an explicit
  `targetSets: 0`.

### remove-vault-sync.AC5: Documentation matches the code
- **remove-vault-sync.AC5.1:** AGENTS.md contains no "Two-repo split" section, no "Sync (`src/sync`)"
  section, and no `src/sync/` entry under Structure.
- **remove-vault-sync.AC5.2:** AGENTS.md's Boundaries section no longer requires mirroring markdown
  contract changes into `../workout-bridge/src/contract.ts`.
- **remove-vault-sync.AC5.3:** AGENTS.md's interop section names `buildSessionSetLine`'s `!= null`
  guards as the sole null-normalization layer and no longer instructs "keep both layers."
- **remove-vault-sync.AC5.4:** AGENTS.md's zero-total defaulting passage names `upsertRoutine` as the
  only enforcing layer and drops the "redundant by construction" framing.
- **remove-vault-sync.AC5.5:** Engine convention 1 no longer cites vault sync as a driver of
  `CompleteSession`.
- **remove-vault-sync.AC5.6:** `jest.config.js`'s `testMatch` no longer lists `sync`.
- **remove-vault-sync.AC5.7:** `src/db/repository.ts`'s `deleteSession` and `deleteRoutine` comments
  no longer explain their semantics in terms of `syncNow()`.
- **remove-vault-sync.AC5.8:** AGENTS.md's "Last verified" date is updated.

### remove-vault-sync.AC6: Cross-cutting behaviors
- **remove-vault-sync.AC6.1:** `npm test` passes at every phase boundary.
- **remove-vault-sync.AC6.2:** `npx tsc --noEmit` reports no errors at every phase boundary.
- **remove-vault-sync.AC6.3:** `npm run lint` passes at every phase boundary.
- **remove-vault-sync.AC6.4:** In the simulator, a routine starts, sets log, the session completes
  with no sync-related console error, and the session appears in History.
- **remove-vault-sync.AC6.5:** In the simulator, Settings → AI opens and saves an API key, proving
  the `bridge_settings` storage key still resolves after the type rename.

## Glossary

- **Vault**: The user's Obsidian markdown vault — the external system this feature synced workout
  data to and from. Vault sync is the entire feature being removed.
- **Bridge (`../workout-bridge`)**: A separate Mac-side Node/vitest HTTP service, reached over
  Tailscale, that read and wrote the vault's `_sync/` folder on the app's behalf. This design
  deletes the app's client for it but leaves the bridge repo itself untouched.
- **WatermelonDB**: The on-device database library (SQLite-backed on iOS, LokiJS on web) that
  stores routines and sessions. Its schema/migration system is why `sync_status` is *undeclared*
  rather than dropped — WatermelonDB 0.28 has no supported "remove a column" migration step.
- **LokiJS**: The in-memory JavaScript database WatermelonDB uses as its web-platform adapter, in
  place of SQLite. Mentioned because it silently ignores raw-SQL migration steps, which is part of
  why `unsafeExecuteSql` was rejected as an option.
- **Schema migration (`schemaMigrations`, `toVersion`, `steps`)**: WatermelonDB's versioned
  mechanism for evolving the on-device database shape over app updates. Each release bumps
  `version` and adds a step describing the change; this design adds a v4 entry with deliberately
  empty steps.
- **`sync_status`**: The database column (on `sessions`) that tracked whether a completed session
  had been posted to the vault yet (`'local'` vs `'synced'`). Its removal is what makes every
  routine deletable, since the old delete-guard existed only to protect unsynced sessions.
- **Dynamic import**: A JavaScript/TypeScript `await import(...)` call resolved at runtime rather
  than compile time. Flagged here because `onCompleteSession` reaches the sync module this way, so
  `tsc` cannot catch a broken reference to it — the reason Phase 1 is hand-audited rather than
  compiler-verified.
- **`onCompleteSession`**: The shell-side function that runs when a workout session finishes,
  currently triggering the sync post, the HealthKit export, and a post-workout AI debrief in
  sequence. The design requires the sync step be removed without disturbing the order of the other
  two.
- **Markdown contract (`src/interop`)**: The app's shared serialization and parsing logic for the
  vault's markdown format (routines and sessions). It survives this change untouched, since it is
  the reusable piece the sync layer was built on top of, not the sync layer itself.
- **AI Coach**: The app's conversational, Anthropic-API-backed feature for authoring workout
  routines. It becomes the *only* way to create a routine once vault import is deleted.
- **HealthKit**: Apple's health-data framework, which the app writes completed workouts to
  (write-only, no reads). Unaffected by this change; called out only to confirm it is not reordered
  relative to the deleted sync step.
- **Zero-total defaulting**: A validation rule ensuring a routine entry that specifies only a
  duration (no explicit set count) still gets `targetSets` defaulted to 1, so it is not silently
  unstartable. Two copies of this rule currently exist (one in the deleted sync layer, one in
  `upsertRoutine`); the design requires confirming the surviving copy is actually tested before the
  other is deleted.
- **`testMatch` (jest.config.js)**: The glob pattern controlling which `src/` subdirectories jest
  treats as tests. Removing `sync` from this list is part of the deletion, since no code is left in
  that directory to test.

## Architecture

This is a deletion, not a construction. The architecture question is not what to build but what
each removal leaves behind, and which surviving code silently inherits a responsibility it did
not have before.

### What is removed

The Mac-side HTTP bridge is the *transport* layer of the vault integration. It comprises
`src/sync/bridgeClient.ts` (HTTP, with `BridgeUnreachable` vs `BridgeHttpError` failure types),
`src/sync/syncService.ts` (the offline queue: `syncNow` posts `sync_status='local'` sessions and
flips them to `'synced'`; `importRoutines` pulls vault routines), `src/helpers/settingsActions.ts`
(UI-facing wrappers), the `settings/bridge.tsx` screen, and the `baseUrl`/`token` settings fields.

### What survives, and why

`src/interop/` (the markdown contract: `format.ts`, `parse.ts`, `serialize.ts`) and `src/export/`
(`exportService.ts`, `exportPresenter.ts`) are untouched. `src/export` is already wired to no UI —
it was built under `docs/design-plans/2026-08-04-vault-export.md`, whose stated plan was that
bridge removal happens in a follow-up ticket. This is that ticket. Keeping both modules preserves
a working markdown serializer for the Excel backup work to build on or reference, at the cost of
carrying dead code. After Phase 2, `parse.ts` has no production consumer at all; only tests
(`src/export/exportService.test.ts`, `src/state/startSessionFromRoutine.integration.test.ts`)
import it. That is accepted, not an oversight.

### Three inherited responsibilities

Deleting `syncService.ts` transfers three obligations to code that currently shares them:

1. **Zero-total defaulting.** `defaultTargetSetsForDurationLine` (`src/sync/syncService.ts:24`)
   defaults a duration-based routine entry's `targetSets` to 1 when it is absent and `warmupSets`
   is 0, preventing an entry that plans zero sets from reaching the engine. `upsertRoutine`
   (`src/db/repository.ts`) applies the identical rule. AGENTS.md documents the sync-layer copy as
   "redundant by construction" because `upsertRoutine` sees every write either layer produces.
   That redundancy is what makes the deletion safe — but it also means the surviving layer becomes
   solitary, and the tests proving the rule (`src/sync/syncService.test.ts:732`) are the ones being
   deleted. Phase 2 must confirm `upsertRoutine`'s own tests cover the case before removing layer 1.

2. **Null normalization at the shell boundary.** `syncService.ts` maps DB rows to the serializer
   with `?? undefined`, because WatermelonDB returns `null` for unset optional columns while
   `buildSessionSetLine` guards on `!= null`. AGENTS.md instructs "keep both layers." After
   removal there is one layer, and the instruction is wrong as written.

3. **Session-completion side effects.** `onCompleteSession` (`src/state/activeSession.ts:207-233`)
   reaches sync through a **dynamic** `await import('@/sync/syncService')`. TypeScript cannot see
   through a dynamic import, so deleting the module produces a runtime failure at session
   completion rather than a compile error. This is the single highest-risk edit in the change and
   the reason Phase 1 exists as a separate, hand-audited phase rather than a compile-error sweep.

### Schema strategy

WatermelonDB 0.28.0 exports exactly four migration step builders — `schemaMigrations`,
`createTable`, `addColumns`, `unsafeExecuteSql` — verified against the installed
`Schema/migrations/index.d.ts`. The [official documentation](https://watermelondb.dev/docs/Advanced/Migrations)
states that deleting columns is "not yet implemented"; `destroyColumn` was merged upstream in
PR #1799 but has not shipped in a release. Official guidance is to leave unused columns in the
database and omit them from the schema definition, which WatermelonDB then ignores during CRUD.

The design therefore **undeclares** rather than drops:

- `src/db/schema.ts` — `version: 3 → 4`, `sessions.sync_status` column declaration deleted.
- `src/db/migrations.ts` — `{ toVersion: 4, steps: [] }`. An empty `steps` array passes
  `schemaMigrations`' validation (`Array.isArray(steps) && steps.every(...)`), verified against
  the installed source. The entry exists so `version` stays honest with the declaration and the
  migration list has no gap, which `schemaMigrations` enforces.

`unsafeExecuteSql('ALTER TABLE sessions DROP COLUMN sync_status;')` was considered and rejected:
transaction guarantees for raw SQL in migrations are undocumented (Nozbe/WatermelonDB issue #1835
is unanswered by maintainers), and the LokiJS adapter used by `adapter.web.ts` ignores SQL steps
entirely, so the two platforms would diverge. The gain would be cosmetic.

The app is pre-release, so preserving on-device data across the upgrade is explicitly not a
requirement. This removes the only high-consequence failure mode the migration would otherwise
carry.

### Settings storage

`src/state/settings.ts` persists a single JSON blob under the key `'bridge_settings'`. That blob
also holds `anthropicKey`, `openaiKey`, `aiGoals`, `aiEquipment`, `aiPersonality`, `profileAge`,
`profileExperience`, and `onboardingState`. **The storage key must not be renamed** — doing so
orphans every existing user's API key and resets onboarding. The TypeScript type name
`BridgeSettings` is already a misnomer per AGENTS.md and may be renamed freely; the on-disk key
may not.

No settings migration is needed. `loadSettings` merges with `cache = { ...cache, ...parsed }`, so
`baseUrl`/`token` keys in an existing blob survive as undeclared extras that no read site touches —
the same undeclare-don't-delete shape as the schema decision.

## Existing Patterns

Investigation confirms this design follows patterns already established in the codebase:

- **Phase-leaves-main-green.** Each phase is independently mergeable with `npm test` and
  `tsc --noEmit` passing, matching how prior multi-phase work in this repo is structured.
- **Undeclare-don't-delete for persisted data.** Schema migration v3 (`src/db/migrations.ts`)
  added `session_sets.exercise_id` as nullable and "deliberately not backfilled," letting existing
  rows resolve through the old path. The schema and settings decisions here are the mirror image
  of that same principle.
- **Injected dependencies at shell boundaries.** `onCompleteSession`'s `syncFn` parameter exists
  purely for test injection. Removing the sync call removes the parameter; the surrounding
  HealthKit write keeps its own `HealthKitSaveDeps` injection, which is unaffected.
- **Test placement follows `jest.config.js` `testMatch`.** The node project globs
  `src/{engine,db,interop,state,sync,health,helpers,ai,theme,watch,components,export}`. Removing
  `sync` from that list is part of the change. New tests land in `db` and `state`, both already
  covered.

Divergence: none. No new pattern is introduced.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: De-wire callers from sync

**Goal:** No code path reaches `src/sync`, while the module still exists. This isolates the
runtime-only hazard from the deletion.

**Components:**
- `src/state/activeSession.ts` — remove the dynamic-import sync block from `onCompleteSession`
  (lines ~207-233) and the `syncFn` parameter from `createActiveSessionStore`. Hand-audited, not
  compiler-driven: `tsc` cannot see a dynamic import. The HealthKit write and the post-workout
  debrief hook that follow it are unaffected and must remain in their current order.
- `src/app/(tabs)/routines.tsx` — delete the "Import Routines" button, the `importLabel`/
  `importing`/`importMessage`/`onImport` props on `EntryPointButtons`, and the `bridgeClient`/
  `syncService`/`settingsActions` imports. The AI Coach button remains.
- `src/app/(tabs)/settings/index.tsx` — delete the "Bridge & Sync" entry from the sections list
  and narrow the `href` union type. The two-level settings nav (`settings/_layout.tsx`) stays as
  it is.
- `src/app/(tabs)/settings/bridge.tsx` — delete the file.
- `src/state/activeSession.test.ts` and any test passing `syncFn` — update call sites.

**Dependencies:** None.

**Covers:** `remove-vault-sync.AC1.1`, `remove-vault-sync.AC2.1`, `remove-vault-sync.AC2.2`,
`remove-vault-sync.AC2.3`

**Done when:** `grep -rn "@/sync/" src --include=*.ts --include=*.tsx` returns matches only inside
`src/sync/` itself; `npm test` and `tsc --noEmit` pass; a session completes in the simulator with
no sync-related console output.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Delete the sync modules and settings fields

**Goal:** Remove the bridge code and its configuration surface.

**Components:**
- Delete `src/sync/` entirely — `bridgeClient.ts`, `syncService.ts`, `bridgeClient.test.ts`,
  `syncService.test.ts`, `syncService.integration.test.ts`, `abandonedSessionNeverSyncs.test.ts`,
  `unsyncedSessionSurvivesRoutineEdit.test.ts`.
- Delete `src/helpers/settingsActions.ts` and `src/helpers/settingsActions.test.ts`.
- `src/state/settings.ts` — remove `baseUrl` and `token` from the settings interface and
  `DEFAULT_SETTINGS`. Optionally rename the type `BridgeSettings → AppSettings` (with call-site
  updates in `src/state/coachOnboarding.ts` and elsewhere). **Do not change the `SETTINGS_KEY`
  value `'bridge_settings'`.**
- `src/state/settings.test.ts` — remove `baseUrl`/`token` assertions; add a case proving a stored
  blob containing legacy `baseUrl`/`token` keys loads without error.
- `src/ai/contextBuilder.test.ts` and sibling prompt tests (`alternatesPrompt.test.ts`,
  `exerciseQuestionStore.test.ts`, `restCommentaryStore.test.ts`, `exerciseReplaceStore.test.ts`) —
  the secret-leak regression asserts `baseUrl`/`token` never reach a prompt. Narrow those
  assertions to `anthropicKey`/`openaiKey` rather than deleting them; the guard keeps its purpose
  and loses only two subjects.
- `src/db/repository.test.ts` — verify `upsertRoutine`'s zero-total defaulting is covered here
  before the `defaultTargetSetsForDurationLine` tests are deleted with `syncService.test.ts`. Add
  the coverage if it is missing.
- `jest.config.js` — remove `sync` from the `testMatch` glob.

**Dependencies:** Phase 1.

**Covers:** `remove-vault-sync.AC1.2`, `remove-vault-sync.AC1.3`, `remove-vault-sync.AC1.4`,
`remove-vault-sync.AC1.5`, `remove-vault-sync.AC4.1`, `remove-vault-sync.AC4.2`,
`remove-vault-sync.AC4.3`, `remove-vault-sync.AC4.4`

**Done when:** `src/sync/` does not exist; `npm test` and `tsc --noEmit` pass; `src/interop` and
`src/export` suites still pass unchanged.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Schema v4 and the always-deletable routine

**Goal:** Remove `sync_status` from the schema and every read site, and drop the delete guard it
existed to serve.

**Components:**
- `src/db/schema.ts` — `version: 4`; delete the `sync_status` column from the `sessions` table.
- `src/db/migrations.ts` — add `{ toVersion: 4, steps: [] }` with a comment explaining that the
  empty steps array is deliberate, that WatermelonDB 0.28 has no column-removal step, and that the
  physical column is left in place and ignored.
- `src/db/models/Session.ts` — delete `customSyncStatus`.
- `src/db/repository.ts` — `createSession` stops writing `sync_status: 'local'`; delete
  `deleteRoutine`'s unsynced-session check and the exported `RoutineHasUnsyncedSessionsError`
  class; rewrite the `deleteSession` (~lines 258-271) and `deleteRoutine` (~lines 1254-1259)
  comment blocks, which currently explain their semantics purely in terms of `syncNow()`'s
  candidate selection.
- `src/app/(tabs)/routines.tsx` — remove the `RoutineHasUnsyncedSessionsError` import and its
  catch arm.
- `src/db/migrations.test.ts` — add a v3→v4 case.
- `src/db/repository.test.ts` — add a test asserting a routine referenced by a completed session
  is deletable (the inverse of the deleted `unsyncedSessionSurvivesRoutineEdit.test.ts`).

**Dependencies:** Phase 2.

**Covers:** `remove-vault-sync.AC2.4`, `remove-vault-sync.AC3.1`, `remove-vault-sync.AC3.2`,
`remove-vault-sync.AC3.3`, `remove-vault-sync.AC3.4`, `remove-vault-sync.AC3.5`,
`remove-vault-sync.AC3.6`

**Done when:** `npm test` and `tsc --noEmit` pass; a fresh simulator install starts a routine,
logs sets, completes the session, and shows it in History; a routine with a completed session
deletes without an alert.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: User-facing copy and documentation

**Goal:** No string or document asserts something the code no longer does.

**Components:**
- `src/app/session.tsx:404` — the abandon confirmation's "It will not be saved to your vault"
  clause carried the warning's weight; the replacement must convey permanence without it.
- `src/app/(tabs)/index.tsx:165` — the no-routines empty state drops "or import your routines from
  the vault," leaving the AI Coach as the only named path.
- `src/app/(tabs)/index.tsx:57-58` — the `useFocusEffect` rationale comment cites the vault import
  as a routine source.
- `AGENTS.md` — delete the "Two-repo split" and "Sync (`src/sync`)" sections, the `src/sync/`
  entry under Structure, and the Boundaries rule requiring mirroring into
  `../workout-bridge/src/contract.ts`. Rewrite three passages whose *content* changes: the interop
  section's "keep both layers" null-normalization instruction (one layer remains); the zero-total
  defaulting paragraph (`upsertRoutine` is now solitary, not redundant); and engine convention 1,
  which justifies `DiscardSession` by citing vault sync alongside the HealthKit export. Update
  "Last verified".

**Dependencies:** Phase 3.

**Covers:** `remove-vault-sync.AC2.5`, `remove-vault-sync.AC2.6`, `remove-vault-sync.AC2.7`,
`remove-vault-sync.AC5.1`–`remove-vault-sync.AC5.8`, `remove-vault-sync.AC6.4`,
`remove-vault-sync.AC6.5`

**Done when:** No user-visible string in `src/app/` or `src/components/` mentions the vault,
syncing, or the bridge; AGENTS.md describes only code that exists; the simulator pass in AC6.4 and
AC6.5 is complete with screenshots.
<!-- END_PHASE_4 -->

## Additional Considerations

**Routine authoring narrows to one path.** With vault import gone, the AI Coach is the only way to
create a routine, and it requires a user-supplied API key. There is no manual routine builder.
This is an accepted consequence, not an oversight, and it is why the Today tab's empty state is
rewritten rather than merely trimmed — that screen is now the sole onboarding funnel for a user
with no routines.

**Test coverage decreases.** Roughly 1,600 lines of test code are deleted. Three replacement tests
are specified (deletable routine, v3→v4 migration, legacy settings blob) and the `upsertRoutine`
defaulting coverage is verified rather than assumed, but net coverage still drops. That is the
expected outcome of removing a feature and should not be read as regression.

**Layout is invisible to the test suite.** AGENTS.md warns that `src/components` and `src/app` are
covered by no jest project — a green run proves nothing about them. Phases 1 and 4 both edit
screens, so each needs a simulator pass, not just a passing suite.

**`../workout-bridge` is untouched.** The separate Node/vitest repo keeps its copy of the markdown
contract and continues to work against any client that speaks it. Only this repo's obligation to
mirror contract changes into it is removed. Archiving or deprecating that repo is out of scope.

**Ordering within Phase 1 matters.** `onCompleteSession` runs the debrief hook last, after the
session record closes and the HealthKit write is under way. Removing the sync block from the
middle of that sequence must not reorder the surrounding effects.
