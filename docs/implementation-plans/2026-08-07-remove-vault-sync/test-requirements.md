# Remove Vault Sync — Test Requirements

Maps every acceptance criterion in `docs/design-plans/2026-08-07-remove-vault-sync.md` to either an automated test or a documented human verification.

**Generated:** 2026-08-09. **Design:** `remove-vault-sync`. **Phases:** 4.

---

## The coverage boundary you must understand first

This repo's jest setup makes a large share of these criteria **unautomatable**, and pretending otherwise is the main risk to this document's usefulness.

1. **One `node` jest project only** (`jest.config.js`). Its `testMatch` globs `src/{engine,db,interop,state,sync,health,helpers,ai,theme,watch,components,export}`. There is no RN runtime; the commented-out `rn` project is intentional future work.
2. **`src/app/` is not in the glob at all.** Every screen — Settings index, Routines tab, Today tab, session screen — is invisible to `npm test`. AGENTS.md is explicit: *"a green run proves nothing about it."*
3. **`src/components/` is in the glob but has no RN environment**, so layout and rendering still cannot be asserted.
4. **DB tests run on LokiJS**, not SQLite (`createTestDatabase` in `src/db/test-helpers.ts`). Any criterion about a real SQLite migration is out of reach of the suite by construction.

Consequence: **13 of 35 criteria are human-verified.** That is not a coverage gap to be fixed — it is the shape of the codebase. Every one below carries a justification and a concrete verification procedure.

A third category appears here that a normal test plan would not need: **static verification** — a criterion whose subject is the *absence* of code. `src/sync/` not existing is not a behavior any test can assert; it is a `grep` that returns nothing, or a `tsc` run that stays clean. These are listed as automated, with the command as the test.

---

## Automated coverage

### remove-vault-sync.AC1 — The bridge is unreachable

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC1.2** | static | — | `test -d src/sync` fails; `grep -rn "@/sync/" src` returns nothing. Phase 2 Task 2. |
| **AC1.3** | unit + type | `src/state/settings.test.ts` | `getSettings()` returns an object with no `baseUrl`/`token`. The stronger proof is `tsc --noEmit`: the fields are gone from the interface, so any reader is a compile error. Phase 2 Tasks 3–5. |
| **AC1.4** | unit | `src/state/settings.test.ts` | **New test.** Seed the fake storage backend with a JSON blob containing `baseUrl`/`token` alongside current fields; `loadSettings()` resolves without throwing and surviving fields load correctly. **Do not assert `baseUrl` is absent from the returned object** — `loadSettings` merges `{ ...cache, ...parsed }`, deliberately preserving unknown keys. Asserting absence would pin the opposite of the design. Phase 2 Task 4. |
| **AC1.5** | static | — | `src/helpers/settingsActions.{ts,test.ts}` do not exist. Phase 2 Task 2. |

### remove-vault-sync.AC3 — `sync_status` is gone

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC3.1** | unit | `src/db/migrations.test.ts` | `databaseSchema.version === 4`, and `databaseSchema.tables.sessions.columns` has no `sync_status`. Read it off the schema object; do not re-derive. Phase 3 Task 2. |
| **AC3.2** | unit | `src/db/migrations.test.ts` | `stepsForMigration({ migrations, fromVersion: 3, toVersion: 4 })` returns `[]` **and does not throw**. This test is what pins the emptiness as deliberate — without it, a contributor "fixing" the empty array by deleting the entry breaks the gapless-version invariant silently. Phase 3 Task 2. |
| **AC3.3** | unit *(partial)* | `src/db/repository.test.ts` | `createSession` writes a session that is retrievable, with no `sync_status`. **Partial only** — LokiJS, not SQLite. The real-database half is human (H8). Do not add a test inspecting `_raw` for an absent key; that pins LokiJS internals, not behavior. Phase 3 Task 3. |
| **AC3.4** | type | — | `tsc --noEmit` clean after `customSyncStatus` is deleted from `src/db/models/Session.ts`. No behavioral test — a removed field has no behavior. Note `src/export/exportService.ts:145` reads it through `as any`, so `tsc` will *not* flag it; Phase 3 Task 3 fixes that site by hand. Phase 3 Task 3. |
| **AC3.5** | integration | `src/db/repository.test.ts` | A routine referenced by a **completed** session deletes successfully, **and** its `routine_exercises` rows survive as history carriers. Both halves required. The export removal of `RoutineHasUnsyncedSessionsError` is proven at compile time by deleting its import. ⚠ **The rewritten test must assert deletion actually happened** — one that merely stops expecting a throw passes vacuously if `deleteRoutine` silently no-ops. Phase 3 Task 5. |
| **AC3.6** | unit *(partial)* | `src/db/migrations.test.ts` | `stepsForMigration` resolves the v3→v4 path without throwing. **This is the honest limit of the suite** — it runs on LokiJS. The criterion is about a real v3 SQLite database opening at v4, which only H8 covers. Put a comment on the test saying so, rather than letting it imply more. Phase 3 Task 2. |

### remove-vault-sync.AC4 — The markdown layer survives

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC4.1** | suite + static | `src/interop/**`, `src/export/**` | All existing suites pass **unmodified**. Plus `git diff --stat main -- src/interop` returns nothing, and `-- src/export` returns exactly one file / 3 insertions / 1 deletion. ⚠ **AC4.1 says "unchanged"; read it as "unchanged except the one flagged line in `exportService.ts:145`."** That deviation is argued in phase_03.md and must be in the PR description, or a reviewer checking the AC verbatim reads a failure. Phase 2 Task 7, Phase 3 Task 7. |
| **AC4.2** | static | — | `serializeRoutine`, `serializeSession`, `parseRoutine`, `parseSession` still exported from `src/interop/{serialize,parse}.ts`. Phase 2 Task 7. |
| **AC4.3** | unit | `src/db/repository.test.ts` **(already exists)** | Four cases at **1712–1738, 1740–1765, 1767–1791, 1793–1830**: defaults to 1 when `targetSets` absent and `warmupSets` 0; does *not* default when `warmupSets` is set; defaults even without `targetDurationSeconds`; the UPDATE branch applies it too. **No new test needed.** Phase 2 Task 1 is a verification gate: confirm these pass *before* deleting `syncService.test.ts`, since that file currently holds the only unit tests of the rule. Phase 2 Task 1. |
| **AC4.4** | unit | `src/ai/draftSchema.test.ts` **(already exists)** | `validateRoutineDraft` rejects an explicit `targetSets: 0`. Untouched by this change; run it to confirm nothing collateral broke. Phase 2 Task 7. |

### remove-vault-sync.AC5 — Documentation matches the code

All eight are **static verification** — greps over `AGENTS.md`, `jest.config.js`, and `src/db/repository.ts`. No jest test can assert prose.

| AC | Command | Expected |
|---|---|---|
| **AC5.1** | `grep -n "Two-repo split\|## Sync\|src/sync/" AGENTS.md` | no output |
| **AC5.2** | `grep -n "workout-bridge" AGENTS.md` | no output |
| **AC5.3** | ⚠ **CORRECTED — see the note below this table.** `grep -c "keep both layers" AGENTS.md` | `1`, NOT `0`. The passage must no longer name `syncService.ts`, but must still mandate both layers |
| **AC5.4** | `grep -n "redundant by construction\|importRoutines\|defaultTargetSetsForDurationLine" AGENTS.md` | no output |
| **AC5.5** | `grep -n "vault sync" AGENTS.md` | no output. Also `src/engine/rules/types.lv` and `transition.lv` — the source of record AGENTS.md documents (Phase 4 Task 6b) |
| **AC5.6** | `sed -n '12p' jest.config.js \| grep -c "sync"` | `0`. ⚠ A bare grep on the file still hits **line 42**, the commented-out `rn` project, which is intentional future work and stays |
| **AC5.7** | `grep -n "syncNow\|sync_status\|vault\|bridge\|sync-layer\|layer 1\|Defense-in-depth" src/db/repository.ts` | no output. The last three patterns matter: the `upsertRoutine` comment described the dead layer without using any of the obvious words |
| **AC5.8** | `grep -n "Last verified" AGENTS.md` | today's date |

> **AC5.3 correction (2026-08-09, found in Phase 4's review).** This criterion was
> written on a false investigation finding: that deleting `src/sync` left
> `buildSessionSetLine`'s `!= null` guards as the *sole* null-normalization layer.
> It did not. `src/export/exportService.ts` performs the same `?? undefined`
> shell-boundary mapping `syncService.ts` used to — verified side by side — and a
> **superset** of it, also normalizing `targetSets`/`targetReps`/
> `targetDurationSeconds`, which the old layer passed raw. The second layer moved;
> it did not disappear.
>
> So `grep "keep both layers" AGENTS.md` MUST still return a hit, and AGENTS.md must
> NOT describe `buildSessionSetLine` as the sole layer. Doing so deletes a standing
> defense-in-depth mandate and invites the next person editing `exportService`'s row
> mapping to drop the `?? undefined`, making a `<flag>=null` line reachable for the
> first time.
>
> The criterion's *intent* — stop naming the deleted `syncService.ts` — is satisfied.
> **Do not "fix" AGENTS.md back to the original wording.**

### remove-vault-sync.AC6 — Cross-cutting

| AC | Command | When |
|---|---|---|
| **AC6.1** | `npm test` | every phase boundary |
| **AC6.2** | `npx tsc --noEmit` | every phase boundary |
| **AC6.3** | `npm run lint` | every phase boundary |

---

## Human verification

Thirteen criteria. Each names *why* it cannot be automated — none is "we didn't get to it."

### Screens — no jest project covers `src/app/`

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H1** | **AC2.1** | Open Settings. Exactly one row, "AI Coach". No Bridge & Sync row. | screenshot |
| **H2** | **AC2.2** | From Settings, confirm no navigation path reaches a bridge screen. `src/app/(tabs)/settings/bridge.tsx` is deleted; `_layout.tsx` is a bare `<Stack>` with no route enumeration, so expo-router simply stops resolving it. | screenshot + file absence |
| **H3** | **AC2.3** | Open the Routines tab. AI Coach button renders; no "Import Routines" button. | screenshot |
| **H4** | **AC2.5** | Start a session, tap Abandon. Read the confirmation: conveys permanence, no vault reference. | screenshot of dialog |
| **H5** | **AC2.6** | With no routines present, view the Today tab empty state. Names the AI Coach; no import or vault mention. | screenshot |
| **H6** | **AC2.4** | Delete a routine that has a completed session. Succeeds with **no error alert**. Then confirm that session still appears in History. *(The repository half is automated — AC3.5. This covers the UI half: that no alert fires and history survives.)* | screenshot before/after |

### Real SQLite — the suite runs on LokiJS

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H7** | **AC3.6** | **Install over an existing v3 install — do not uninstall first.** Uninstalling destroys the v3 database and turns this into a fresh-install test, proving nothing. Back up `hmbworkout.db` first (`xcrun devicectl device copy from … --source Documents`). Launch: must open without throwing. Data preservation is explicitly *not* required (pre-release); record what survives either way. | launch log |
| **H8** | **AC3.3** | On the **upgraded** database, complete a new session. This is the exact case a reviewer predicted would crash on a leftover NOT NULL column — the prediction was refuted against WatermelonDB's `encodeSchema` (it emits no constraints), and this is the empirical confirmation. Then uninstall, reinstall, and repeat on a fresh v4 database. | screenshots |

### Runtime behavior invisible to `tsc` and jest

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H9** | **AC1.1** | Complete a session in the simulator. **No sync-related console output** — no bridge URL, no `Sync failed…`, no `Failed to initialize sync`. Session appears in History. *(Why human: `onCompleteSession` reached sync through a **dynamic** `await import('@/sync/syncService')`. TypeScript cannot see through a dynamic import, so neither `tsc` nor jest can prove the call is gone. This is the single highest-risk edit in the change and the simulator is the only place it is actually verified.)* | Metro console + screenshot |
| **H10** | **AC6.4** | Full happy path: start a routine, log sets, complete, confirm in History. No sync-related error. | screenshot |
| **H11** | **AC6.5** | Settings → AI: enter and save an API key, leave the screen, return. Key persists. *(Why this matters: it is the direct proof that the `'bridge_settings'` storage key still resolves after Phase 2 narrowed the type. If the key had been renamed, this is where it would surface — as every user silently losing their API key.)* | screenshot |

### Prose

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H12** | **AC2.7** | Run Phase 4 Task 8's grep set, then **read every hit**. The greps cannot distinguish a rendered string from a code identifier; only a human can. Expect deliberate residue: the `BridgeSettings` type name, `'bridge_settings'`, seven "vault markdown" format-name lines, and everything inside `src/interop`. | annotated grep output |
| **H13** | **AC5.1–AC5.8** | Read `AGENTS.md` start to finish. Six separate edits land in it; a surviving cross-reference to a deleted section shows up in no grep. | reviewer sign-off |

---

## Traps

Five places where a test can pass while the thing it names is broken. Each was found during plan review.

1. **A vacuous deletion test.** The rewritten `deleteRoutine` tests must assert the routine row is *gone*. Merely dropping `expect(...).rejects.toThrow()` passes even if `deleteRoutine` silently no-ops.
2. **Absence asserted through a mock.** Do not add tests proving sync *wasn't* called — the mock is being deleted. Absence is proven by grep (AC1.2) and by H9.
3. **Greps keyed on the removed identifier.** `grep syncFn` misses `syncSpy`; `grep syncNow` misses `layer 1 (sync/syncService.ts)`; an `src/ai`-scoped grep misses the three secret-leak tests in `src/state`. All three actually happened while writing this plan. Grep for what the code *does*, not for the name you are deleting.
4. **`tsc` clean ≠ readers gone.** `src/export/exportService.ts:145` reads `customSyncStatus` through `as any` and compiles fine against a model that no longer has it, silently passing `undefined`.
5. **Fire-and-forget DB writes.** Any assertion after `onCompleteSession`-style writes needs `flush()` (`src/db/test-helpers.ts`), and `flush()` only reliably covers queue depth ≤ 2. Deeper queues need the bounded-retry idiom at `activeSession.test.ts:512,601`. See AGENTS.md Testing gotchas.

---

## Coverage summary

| Group | Criteria | Automated | Human |
|---|---|---|---|
| AC1 — bridge unreachable | 5 | 4 | 1 (H9) |
| AC2 — no UI mentions sync | 7 | 0 | 7 (H1–H6, H12) |
| AC3 — sync_status gone | 6 | 5 (2 partial) | 1 (H7) + H8 |
| AC4 — markdown survives | 4 | 4 | 0 |
| AC5 — docs match code | 8 | 8 (static) | 1 (H13, read-through) |
| AC6 — cross-cutting | 5 | 3 | 2 (H10, H11) |
| **Total** | **35** | **24** | **13** |

Every criterion is claimed. Net automated test coverage **decreases** over this change — roughly 1,600 lines of test code are deleted with `src/sync`. Three replacement tests are specified (deletable routine, v3→v4 migration, legacy settings blob) and AC4.3's coverage is verified rather than assumed. That drop is the expected result of removing a feature and should not be read as regression.
