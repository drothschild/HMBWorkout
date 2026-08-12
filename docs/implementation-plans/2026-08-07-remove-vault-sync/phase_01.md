# Remove Vault Sync — Phase 1: De-wire callers from sync

**Goal:** Make no code path reach `src/sync`, while the sync modules still exist on disk. This isolates the runtime-only hazard (a dynamic import `tsc` cannot see) from the deletion itself.

**Architecture:** Pure subtraction at the shell boundary. `onCompleteSession` loses its sync block but keeps the order of every surrounding effect; two screens lose their bridge entry points; one screen is deleted outright. Nothing in `src/engine` is touched — this is all imperative shell.

**Tech Stack:** TypeScript, React Native 0.86 / Expo SDK 57, expo-router (file-based), Zustand 5, Jest + ts-jest (node project only).

**Scope:** Phase 1 of 4 from `docs/design-plans/2026-08-07-remove-vault-sync.md`.

**Codebase verified:** 2026-08-07 (codebase-investigator, plus direct reads of the sites below).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### remove-vault-sync.AC1: The bridge is unreachable from the app
- **remove-vault-sync.AC1.1 Success:** Completing a session issues no network request to a bridge
  URL — the effect path writes the database and HealthKit only.

### remove-vault-sync.AC2: No UI offers or mentions vault sync
- **remove-vault-sync.AC2.1 Success:** The Settings index renders exactly one row ("AI") and offers
  no route to a bridge screen.
- **remove-vault-sync.AC2.2 Success:** `/settings/bridge` resolves to no screen.
- **remove-vault-sync.AC2.3 Success:** The Routines tab renders the AI Coach button and no "Import
  Routines" button.

---

## Investigation findings

Read this before starting. Several design assumptions were confirmed; three things the design did **not** anticipate are called out because they change the work.

**Confirmed:**
- ✓ `src/state/activeSession.ts` — `onCompleteSession` spans **lines 183–281**. The sync block is **lines 207–233**, exactly where the design said.
- ✓ Effect order inside `onCompleteSession`: `drainPendingPersists()` (195) → `database.write` closing the session (197–205) → **sync (207–233)** → HealthKit (235–258) → post-workout debrief (263–280). The sync block sits in the middle and the surrounding order must not change.
- ✓ `src/app/(tabs)/settings/_layout.tsx` is a bare `<Stack screenOptions={{ headerShown: false }} />` with **no route enumeration** — deleting `bridge.tsx` requires no edit there.
- ✓ `EntryPointButtons` is defined **inside** `src/app/(tabs)/routines.tsx` (lines 18–67) and used only there, at lines 171 and 181. Its props can be narrowed at the definition, not just the call sites.

**✗ Design gap 1 — `syncFn` is a POSITIONAL parameter, and the hazard is NOT name-scoped.**
`createActiveSessionStore` (lines 54–60) is:
```ts
export function createActiveSessionStore(
  database: Database,
  overrideExecutors?: Partial<EffectExecutors>,
  syncFn?: () => Promise<void>,        // ← 3rd
  healthKitDeps?: HealthKitDeps,       // ← 4th, becomes 3rd
  openDebriefChat?: (mode: DebriefMode) => void  // ← 5th, becomes 4th
) {
```
Deleting the 3rd parameter re-binds every positional call site that passes a 4th or 5th argument.

**Critically, `grep syncFn` does not find these call sites.** Most of them name their injected function something else. The full verified list of files passing a sync function positionally — every one of which also passes a 4th argument, so removing parameter 3 rebinds a `jest.fn` into `healthKitDeps` and the HealthKit deps object into `openDebriefChat`:

| File | Call sites | Assertions that die |
|---|---|---|
| `src/state/activeSession.test.ts` | 1039, 1135, 1374, 1395, 1414, 1441 | 1102, 1181, 1191, 1193–1194, 1424 |
| `src/state/activeSession.integration.test.ts` | 52, 124, 216 (`syncSpy`, defined 28/102/197) | 181 |
| `src/state/abandonSession.integration.test.ts` | 78 (`syncSpy`, defined 62/69) | 130 |
| `src/state/startSessionAfterFinish.integration.test.ts` | 68 (inline `async () => {}`) | — |
| `src/sync/abandonedSessionNeverSyncs.test.ts` | 68 (inline `jest.fn`) | whole file |
| `src/sync/unsyncedSessionSurvivesRoutineEdit.test.ts` | 80 (inline `jest.fn`) | whole file |

Task 2 covers the four `src/state` files; **Task 2b** covers the two `src/sync` ones, which need different handling. `tsc --noEmit` catches most mis-bindings but is not sufficient proof on its own — verify by call-site count, not by grep.

**✗ Design gap 2 — Phase 1's stated "Done when" is not achievable in Phase 1.**
The design says the phase is done when `grep -rn "@/sync/" src` returns matches only inside `src/sync/` itself. It cannot: `src/helpers/settingsActions.ts:6-7` and `src/helpers/settingsActions.test.ts:7` also import `@/sync/…`, and the design defers deleting those files to Phase 2. The exit criterion is corrected in this plan (see Verification) to permit `src/sync/` **plus** `src/helpers/settingsActions.{ts,test.ts}`. Phase 2 deletes both and makes the original grep true.

**+ Additional finding — the Routines empty state becomes incoherent in this phase.**
`src/app/(tabs)/routines.tsx:169` reads `"No routines found. Import routines to get started."` Once the Import button is gone (this phase), that sentence instructs the user to press a control that no longer exists. The design assigns copy to Phase 4, but leaving this until then ships an incoherent screen at the Phase 1 merge point. It is fixed here, in the same file and the same edit, and Phase 4's sweep re-verifies it.

---

## Environment note (read first)

This worktree has **no `node_modules`**, and `npm install` will not resolve here without one preparatory step. `package.json` depends on `rill-lang` via `file:../rill-lang/rill-lang-1.1.1.tgz`, a path relative to the *main* checkout. From a worktree under `.claude/worktrees/`, that path does not resolve.

Stage the tarball where the relative path lands, then install:

```bash
mkdir -p /Users/davidrothschild/Projects/HMBWorkout/.claude/worktrees/rill-lang
```

```bash
cp /Users/davidrothschild/Projects/rill-lang/rill-lang-1.1.1.tgz /Users/davidrothschild/Projects/HMBWorkout/.claude/worktrees/rill-lang/
```

```bash
npm install
```

Then confirm the toolchain runs before touching any task:

```bash
npm test
```

If the tarball is not at that source path, find it — `ls /Users/davidrothschild/Projects/rill-lang/*.tgz` — and copy the 1.1.1 file. Do not edit `package.json` to point elsewhere; the dependency spec is shared with the main checkout.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Remove the sync block and `syncFn` from `onCompleteSession`

**Verifies:** remove-vault-sync.AC1.1

**Files:**
- Modify: `src/state/activeSession.ts` (JSDoc line 49; signature lines 54–60; sync block lines 207–233)

**This is the highest-risk edit in the entire change.** The sync reference is a *dynamic* `await import('@/sync/syncService')`, which TypeScript cannot see. Nothing in `tsc --noEmit` or `npm test` will tell you if you get this wrong — it fails at runtime, at session completion, on a device. Hand-audit it.

**Implementation:**

1. Delete the `syncFn` parameter from `createActiveSessionStore` (line 57). The signature becomes:
   ```ts
   export function createActiveSessionStore(
     database: Database,
     overrideExecutors?: Partial<EffectExecutors>,
     healthKitDeps?: HealthKitDeps,
     openDebriefChat?: (mode: DebriefMode) => void
   ) {
   ```
2. Delete the `@param syncFn …` JSDoc line (line 49).
3. Delete the entire sync block, lines 207–233 — both arms. That is the `if (syncFn) { … } else { … }` construct in full, including the two dynamic imports (`@/sync/syncService`, `@/sync/bridgeClient`), the `getSettings()` call feeding `createBridgeClient`, the `syncService.syncNow().catch(…)`, and the surrounding `try/catch`. Also delete the comment block immediately above it that explains the sync-enqueue behavior.

**Order is load-bearing — do not disturb it.** After the edit, `onCompleteSession` must read:
`drainPendingPersists()` → `database.write` (set `ended_at`, clear `engine_state`) → HealthKit `try/catch` → debrief `try/catch`. The HealthKit block must remain exactly where it is relative to the session close, and the debrief must remain last. AGENTS.md states the debrief is "deliberately last"; the design restates that removing the middle block must not reorder the others.

**Do not** remove `getSettings` from the file's imports without checking — the debrief block at lines 263–280 also calls `getSettings()`. Verify before deleting any import.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
grep -n "syncFn\|@/sync/" src/state/activeSession.ts
```
Expected: **no output.**

Then read the whole of `onCompleteSession` and confirm by eye that the four remaining steps appear in the order above. This read is the actual verification for this task; the greps only prove absence.

**Commit:** `refactor(session): drop the sync block and syncFn from onCompleteSession`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update every positional sync-function call site in `src/state`

**Verifies:** remove-vault-sync.AC1.1 (regression protection for Task 1)

**Files:**
- Modify: `src/state/activeSession.test.ts` (1013, 1028–1039, 1075, 1101–1102, 1126–1135, 1181, 1191, 1193–1194, 1298, 1374, 1395, 1408–1424, 1441)
- Modify: `src/state/activeSession.integration.test.ts` (28, 52, 102, 124, 181, 197, 216)
- Modify: `src/state/abandonSession.integration.test.ts` (62, 69, 78, 130)
- Modify: `src/state/startSessionAfterFinish.integration.test.ts` (68)

**Do not use `grep syncFn` to find this work.** Three of these four files name their injected function `syncSpy` or pass an inline `async () => {}`. Work from the list above, and verify by counting `createActiveSessionStore(` call sites, not by grepping a name that is about to vanish.

**`src/state/activeSession.test.ts` — four distinct usages:**

1. **1028–1039, asserted 1101–1102** — `syncFnThatRejects`, injected to prove a failing sync does not crash session completion. **This test's premise no longer exists**; there is no sync to fail. Delete the test, the `syncFnThatRejects` definition, and the explanatory comment at 1013. Do not salvage it by re-pointing it at HealthKit — that path already has its own error-swallowing coverage.

2. **1126–1135, asserted 1181 / 1191 / 1193–1194** — **this is not a no-op `syncFn`, despite appearances.** It is the test's only observable for "completion proceeded past the persist":
   ```ts
   expect(syncFn).not.toHaveBeenCalled();   // :1181 — completion parked behind the persist
   expect(syncFn).toHaveBeenCalled();       // :1191 — completion resumed
   expect(persistDone.mock.invocationCallOrder[0]).toBeLessThan(
     syncFn.mock.invocationCallOrder[0]     // :1193 — the point of the test
   );
   ```
   The test proves the final set's `PersistSet` lands **before** the session closes — a real invariant that survives this change and must keep its coverage. Re-anchor all three assertions on an observable that still exists. The session row's `ended_at` is the natural one: the test already reads it at 1180 and 1190. Replace the `syncFn` call-order assertion with one on the session-close write or on an injected HealthKit dep, whichever the surrounding harness already provides. **Do not delete this test.**

3. **1298, 1374, 1395, 1408–1424, 1441** — `makeSyncFn()` and its four call sites. The debrief-ordering test at 1408–1424 asserts on `syncFn.mock.invocationCallOrder[0]` to prove the debrief runs *last*. Re-anchor that ordering assertion on the HealthKit write, which is still the effect immediately preceding the debrief. Then delete `makeSyncFn` (1298) and remove the positional argument at 1374, 1395, 1441 — checking at each site whether a 4th/5th argument must shift up.

**The three integration files** each pass a sync spy positionally with a 4th argument following:

- `activeSession.integration.test.ts` — `syncSpy` defined at 28, 102, 197 and passed at 52, 124, 216. The assertion at **181** (`expect(syncSpy).toHaveBeenCalled()`) proves completion ran; re-anchor it on the session's `ended_at` or the injected HealthKit dep. Remove all three definitions and arguments.
- `abandonSession.integration.test.ts` — `syncSpy` at 62/69, passed at 78. The assertion at **130** is `expect(syncSpy).not.toHaveBeenCalled()`, proving an abandoned session never syncs. That guarantee is now structural (there is no sync at all), so the assertion cannot be re-anchored — delete it. **Keep the surrounding test**: it also proves `DiscardSession` deletes the session rather than completing it, which is the durable half and is exactly what AGENTS.md engine convention 1 exists to protect.
- `startSessionAfterFinish.integration.test.ts` — an inline `async () => {}` at 68 with no assertions on it. Remove the argument and shift what follows.

**Testing:**
Every re-anchored assertion must still prove its original invariant — persist-before-close, debrief-last, abandon-discards. Do **not** add new tests asserting the *absence* of sync; assert-on-absence via mock inspection is brittle and the mock is gone. Task 1's grep and Task 6's simulator pass are the real evidence for AC1.1.

**Verification:**
```bash
npm test -- src/state
```
Expected: every `src/state` suite passes.

```bash
grep -rn "syncFn\|syncSpy\|makeSyncFn" src/state
```
Expected: **no output.**

```bash
grep -c "createActiveSessionStore(" src/state/activeSession.test.ts src/state/activeSession.integration.test.ts src/state/abandonSession.integration.test.ts src/state/startSessionAfterFinish.integration.test.ts
```
Read each call site and confirm no positional argument was left in the wrong slot. This is the check `tsc` cannot fully do.

**Commit:** `test(session): drop positional sync injection from state tests`
<!-- END_TASK_2 -->

<!-- START_TASK_2B -->
### Task 2b: Delete the two `src/sync` tests that drive the store

**Verifies:** remove-vault-sync.AC1.1 (keeps the phase green)

**Files:**
- Delete: `src/sync/abandonedSessionNeverSyncs.test.ts` (142 lines)
- Delete: `src/sync/unsyncedSessionSurvivesRoutineEdit.test.ts` (135 lines)

These two live in `src/sync/` — which Phase 2 deletes wholesale — but they break **here**, in Phase 1, because both construct the real store: `createActiveSessionStore(` at `abandonedSessionNeverSyncs.test.ts:68` and `unsyncedSessionSurvivesRoutineEdit.test.ts:80`, each injecting an inline `jest.fn` in the sync slot with a 4th argument after it.

**Delete rather than repair.** Both test the store's *sync wiring*, which Task 1 just removed:
- `abandonedSessionNeverSyncs.test.ts` asserts an abandoned workout never reaches the vault. With no sync path, the property is structural and untestable — and its durable half (abandon discards rather than completes) is already covered by `src/engine/abandonSession.test.ts` and by the `abandonSession.integration.test.ts` test kept in Task 2.
- `unsyncedSessionSurvivesRoutineEdit.test.ts` asserts a dropped exercise's sets survive a routine edit and still export. The **set-survival** half is real and must not be lost — but it is repository behavior, not sync behavior, and it is **already covered in two places, both of which this change keeps**:
  - `src/db/repository.test.ts:1401` — "finds a stamped set even when its `routine_exercises` row is gone"
  - `src/db/repository.test.ts:1623` — "freezes a dropped entry's legacy sets at its exercise before deleting the row"

  together covering the stamp-on-drop rule (AGENTS.md Boundaries: `upsertRoutine`'s drop branch stamps null-stamped sets before destroying the row). The second half — that `serializeSession` actually *emits* the orphaned group — is covered independently by `src/interop/__tests__/serialize.test.ts:330` and `:467`, which Phase 3 leaves untouched.

  Confirm those four sites exist before deleting. They should; this is a gate that is expected to pass. **Only if the coverage is genuinely absent, port the set-survival assertions into `repository.test.ts` first** — as a repository test with no store and no sync — and then delete.

```bash
git rm src/sync/abandonedSessionNeverSyncs.test.ts src/sync/unsyncedSessionSurvivesRoutineEdit.test.ts
```

Phase 2's deletion list still names these files; deleting `src/sync/` wholesale there is unaffected by their being gone early.

**Verification:**
```bash
npm test
```
Expected: passes. The remaining `src/sync` suites (`bridgeClient.test.ts`, `syncService.test.ts`, `syncService.integration.test.ts`) do **not** touch `createActiveSessionStore` and still pass untouched.

**Commit:** `test(sync): drop the two store-driving sync tests`
<!-- END_TASK_2B -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Strip the Import Routines entry point from the Routines tab

**Verifies:** remove-vault-sync.AC2.3

**Files:**
- Modify: `src/app/(tabs)/routines.tsx` (imports 14–16; `EntryPointButtons` 18–67; `handleImportRoutines` 133–158; usages 171, 181; empty-state copy 169; button label 172)

**Implementation:**

1. Delete the three imports at lines 14–16:
   ```ts
   import { createBridgeClient } from '@/sync/bridgeClient';
   import { createSyncService } from '@/sync/syncService';
   import { runImportRoutines } from '@/helpers/settingsActions';
   ```
2. Delete `handleImportRoutines` in full (lines 133–158) and the `importing` / `importMessage` state hooks that only it drives. Leave `loadRoutines` — it is still called elsewhere.

   **`getSettings` (imported at line 13) was called only by `handleImportRoutines`** (`const settings = getSettings();` at the top of it, feeding the `settings.baseUrl` guard). Check whether any other call survives in this file; if not, remove the import too, or `npm run lint` fails on an unused import in Task 6.
3. Narrow `EntryPointButtonsProps` (lines 18–24) to `{ onAiCoach: () => void }`, dropping `importLabel`, `importing`, `importMessage`, `onImport`.
4. In the `EntryPointButtons` body (lines 26–67), delete the import `Pressable` (with its `ActivityIndicator` spinner branch) and the `importMessage` status `ThemedText`. Keep the AI Coach `Pressable` exactly as it is. Check whether `ActivityIndicator` is still used anywhere in the file; if not, remove it from the `react-native` import.
5. Update both usages (lines 171 and 181) to pass only `onAiCoach`.
6. Rewrite the empty state at line 169. It currently reads `"No routines found. Import routines to get started."` and now points at a control that no longer exists. Replace with copy naming the AI Coach as the way to create a routine, e.g.:
   ```
   No routines yet. Build one with the AI Coach.
   ```
   (See "Additional finding" above for why this lands in Phase 1 rather than Phase 4.)
7. Leave the `RoutineHasUnsyncedSessionsError` import (line 11) and its catch arm (lines 114–118) **alone.** They are Phase 3's work, and removing them now would break the build against `src/db/repository.ts`, which still exports the error.

**Styles:** check whether `styles.importButton`, `styles.importButtonDisabled`, `styles.importButtonPressed`, `styles.statusText`, `styles.successText`, `styles.errorText` are still referenced after the edit. The AI Coach button reuses `importButton` and `importButtonPressed`, so those stay; delete only the genuinely unreferenced ones. Do not rename `importButton` in this phase — a cosmetic rename here adds diff noise to a hand-audited change.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
grep -n "Import Routines\|importLabel\|onImport\|importMessage\|@/sync/\|settingsActions" "src/app/(tabs)/routines.tsx"
```
Expected: **no output.**

**Commit:** `feat(routines): remove the vault import entry point`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Remove the Bridge & Sync row from the Settings index

**Verifies:** remove-vault-sync.AC2.1

**Files:**
- Modify: `src/app/(tabs)/settings/index.tsx` (`SectionRow` 9–13, `href` union line 12; `SECTIONS` 15–26)

**Implementation:**

1. Narrow the `href` union (line 12) from `'/settings/ai' | '/settings/bridge'` to just `'/settings/ai'`.
2. Delete the `Bridge & Sync` entry from `SECTIONS` (the object with `title: 'Bridge & Sync'`, `description: 'Bridge connection, import, session sync'`, `href: '/settings/bridge'`).

`SECTIONS` is left with exactly one row — the AI Coach one. That single-row list is what AC2.1 asserts; do not collapse the list into a bare `<Link>` just because it now has one element. Keeping the array shape means Settings can grow a second row later without re-deriving the layout.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors. In particular, narrowing the union must not produce an error at the `href` prop — if it does, a stale reference to `/settings/bridge` survives somewhere.

```bash
grep -rn "settings/bridge" src
```
Expected: only `src/app/(tabs)/settings/bridge.tsx` itself (deleted in Task 5).

**Commit:** `feat(settings): remove the Bridge & Sync row`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Delete the bridge settings screen

**Verifies:** remove-vault-sync.AC2.2

**Files:**
- Delete: `src/app/(tabs)/settings/bridge.tsx` (335 lines)

**Implementation:**

```bash
git rm "src/app/(tabs)/settings/bridge.tsx"
```

No other file needs editing. `src/app/(tabs)/settings/_layout.tsx` is a bare `<Stack>` and does not enumerate routes (verified), so expo-router simply stops resolving `/settings/bridge` once the file is gone. Task 4 already removed the only link to it.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
ls "src/app/(tabs)/settings/"
```
Expected: `_layout.tsx`, `ai.tsx`, `index.tsx` — no `bridge.tsx`.

**Commit:** `feat(settings): delete the bridge screen`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Verify the phase and prove it in the simulator

**Verifies:** remove-vault-sync.AC1.1 (runtime), remove-vault-sync.AC2.1, remove-vault-sync.AC2.2, remove-vault-sync.AC2.3

**Files:** none — this task only runs and observes.

**Why a simulator pass is mandatory here.** AGENTS.md is explicit that `src/components` and `src/app` are covered by **no jest project** — a green `npm test` proves nothing about the three screens this phase edited. And Task 1's dynamic-import removal is invisible to both `tsc` and jest by construction. The simulator is the only place AC1.1 is actually verified.

**Step 1: Full suite and type check**
```bash
npm test
```
Expected: all suites pass. The three surviving `src/sync/` suites — `bridgeClient.test.ts`, `syncService.test.ts`, `syncService.integration.test.ts` — still run and still pass, because the sync *modules* are untouched in this phase and those three never construct the store. The two that did construct it were deleted in Task 2b.

```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
npm run lint
```
Expected: passes. Watch for newly-unused imports or styles in the three edited screens.

**Step 2: The corrected de-wiring grep**
```bash
grep -rn "@/sync/" src --include=*.ts --include=*.tsx
```
Expected — and this is the **corrected** criterion (see Design gap 2):
- `src/sync/…` internal imports, and
- `src/helpers/settingsActions.ts:6-7`, `src/helpers/settingsActions.test.ts:7`

and **nothing else**. Any hit in `src/state/`, `src/app/`, or `src/components/` means the phase is not done. The design's stricter version of this grep becomes true in Phase 2, when `settingsActions` is deleted.

**Step 3: Simulator pass**

Follow the project's `running-in-simulator` skill. Then:
1. Start a routine, log at least one set, and complete the session.
2. Confirm no sync-related output in the Metro console — no bridge URL, no `Sync failed…`, no `Failed to initialize sync`.
3. Confirm the session appears in History.
4. Open the Routines tab: the AI Coach button renders, no Import Routines button (AC2.3).
5. Open Settings: exactly one row, "AI Coach" (AC2.1). There is no Bridge & Sync row and no way to reach `/settings/bridge` (AC2.2).

Capture a screenshot of the Routines tab and of Settings. Those two screenshots are the evidence for AC2.1 and AC2.3, which no automated test covers.

**Step 4: Commit**
```bash
git add -A
git commit -m "chore: verify phase 1 de-wiring"
```
(Only if anything remains uncommitted; Tasks 1–5 each committed their own work.)

**Done when:** all three commands pass, the corrected grep shows only the two permitted locations, and the simulator pass is complete with screenshots.
<!-- END_TASK_6 -->

---

## Phase exit criteria

- `npm test`, `npx tsc --noEmit`, and `npm run lint` all pass (**AC6.1, AC6.2, AC6.3** — these three apply at every phase boundary and are re-asserted in each phase's exit criteria rather than claimed by any single phase's AC Coverage section, matching how the design scopes them).
- `grep -rn "@/sync/" src` returns hits only in `src/sync/` and `src/helpers/settingsActions.{ts,test.ts}`.
- `grep -rn "syncFn\|syncSpy\|makeSyncFn" src` returns nothing.
- A session completes in the simulator with no sync-related console output.
- Screenshots captured for the Routines tab and the Settings index.

`main` is green and mergeable at this point. `src/sync/`'s three remaining suites still pass — nothing reaches the modules.
