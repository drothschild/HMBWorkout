# Remove Vault Sync — Phase 2: Delete the sync modules and settings fields

**Goal:** Remove the bridge code and its configuration surface from the repo.

**Architecture:** Straight deletion, now safe because Phase 1 left nothing pointing at these modules. The one piece of real judgement is the *inherited responsibility*: `syncService.ts` holds a second copy of the zero-total defaulting rule, and its tests are the ones being deleted. Coverage for the surviving copy must be confirmed **before** the deletion, not after.

**Tech Stack:** TypeScript, expo-secure-store (settings persistence), Jest + ts-jest.

**Scope:** Phase 2 of 4 from `docs/design-plans/2026-08-07-remove-vault-sync.md`.

**Depends on:** Phase 1 complete and merged.

**Codebase verified:** 2026-08-07 (codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### remove-vault-sync.AC1: The bridge is unreachable from the app
- **remove-vault-sync.AC1.2 Success:** `src/sync/` does not exist, and no file under `src/` imports
  `@/sync/…` either statically or dynamically.
- **remove-vault-sync.AC1.3 Success:** The settings type has no `baseUrl` or `token` field, and
  `getSettings()` returns an object without them.
- **remove-vault-sync.AC1.4 Edge:** A stored settings blob that still contains `baseUrl`/`token`
  loads without error, and those stale keys reach no read site.
- **remove-vault-sync.AC1.5 Success:** `src/helpers/settingsActions.ts` and its test no longer exist.

### remove-vault-sync.AC4: The markdown layer survives intact
- **remove-vault-sync.AC4.1 Success:** `src/interop/` and `src/export/` exist unchanged and their
  test suites pass.
- **remove-vault-sync.AC4.2 Success:** `serializeRoutine`, `serializeSession`, `parseRoutine`, and
  `parseSession` remain exported and importable.
- **remove-vault-sync.AC4.3 Success:** `upsertRoutine` still defaults `targetSets` to 1 for an entry
  with absent `targetSets` and zero `warmupSets`, proven by a test that does not depend on `src/sync`.
- **remove-vault-sync.AC4.4 Failure:** `validateRoutineDraft` still rejects a draft with an explicit
  `targetSets: 0`.

---

## Investigation findings

**Confirmed:**
- ✓ `src/sync/` contains exactly the seven files the design lists: `bridgeClient.ts` (121), `bridgeClient.test.ts` (251), `syncService.ts` (299), `syncService.test.ts` (758), `syncService.integration.test.ts` (439), `abandonedSessionNeverSyncs.test.ts` (142), `unsyncedSessionSurvivesRoutineEdit.test.ts` (135). ~2,145 lines total. **Note:** the last two were already deleted in Phase 1 Task 2b — they construct the real store and broke when `syncFn` was removed. Task 2 below deletes the directory wholesale, so this changes nothing operationally; do not be surprised to find only five files.
- ✓ `src/state/settings.ts`: `BridgeSettings` at lines 9–38 (`baseUrl` line 10, `token` line 11); `SETTINGS_KEY = 'bridge_settings'` at **line 46**; `DEFAULT_SETTINGS` lines 48–61; `loadSettings` lines 88–104 merging `cache = { ...cache, ...parsed }` at **line 98**. Backend is expo-secure-store.
- ✓ Deleting `settingsActions.{ts,test.ts}` does **not** empty `src/helpers/` — `eslintSetup.test.ts` and `sceneLifecyclePlugin.test.ts` remain, so `helpers` stays in the jest `testMatch`.
- ✓ `src/interop/` and `src/export/` contain no `@/sync/` imports. After this phase, `src/interop/parse` is imported only by `src/state/startSessionFromRoutine.integration.test.ts` and `src/export/exportService.test.ts` — tests only, exactly as the design predicted and accepted.

**✗ Design gap 1 — AC4.3 is already satisfied. Verify, do not write.**
The design says Phase 2 "must confirm `upsertRoutine`'s own tests cover the case before removing layer 1," and lists "Add the coverage if it is missing." It is **not** missing. `src/db/repository.test.ts` already has four independent tests, none of which touch `src/sync`:
- **1712–1738** — defaults `targetSets` to 1 for a duration-based entry with `targetSets` undefined and `warmupSets` zero.
- **1740–1765** — does *not* default when `warmupSets` is already set.
- **1767–1791** — defaults to 1 even when `targetDurationSeconds` is undefined (the AI-draft case).
- **1793–1830+** — the UPDATE branch applies the same default on re-upsert.

The two implementations are also confirmed equivalent: `defaultTargetSetsForDurationLine` (`src/sync/syncService.ts:24–34`) and the inline expression in `upsertRoutine` (`src/db/repository.ts:1163–1165`) return `targetSets` when defined, else `1` when `(warmupSets ?? 0) === 0`, else `undefined`. Task 1 is therefore a **verification gate**, not a test-writing task.

**✓ Design point confirmed — the secret-leak assertions live in FIVE files, exactly as the design said.**
An earlier draft of this plan claimed only two files carried them. **That was wrong**, and it mattered: the investigation behind it grepped only `src/ai`, while three of the five files live in `src/state`. All five, verified:

| File | Setup | Assertions |
|---|---|---|
| `src/ai/contextBuilder.test.ts` | 1126–1141, 1673–1689 | in place |
| `src/ai/alternatesPrompt.test.ts` | 160–175 | in place |
| `src/state/exerciseQuestionStore.test.ts` | **443–444** | **465–466** |
| `src/state/restCommentaryStore.test.ts` | **445–446** | **466–467** |
| `src/state/exerciseReplaceStore.test.ts` | **328–329** | **351–352** |

Each of the three `src/state` files passes an object literal into `setSettings(newSettings: Partial<BridgeSettings>)` containing `token: 'bridge-token-12345'` and `baseUrl: 'http://bridge.local:3000'`. **Once Task 3 deletes those two fields from the interface, TypeScript's excess-property checking makes all three hard type errors.** Skipping them does not merely leave a stale test — it fails `npx tsc --noEmit` at Task 3 and fails Task 4's own `grep -rn "baseUrl\|\btoken\b" src/state` → "no output" check. Task 5 handles all five.

This is the third instance in this plan of the same failure mode: **a grep scoped to where the thing was expected to live rather than to where it could be.** The first two were caught in review (`syncFn` vs `syncSpy`, `syncNow` vs "layer 1"). Treat any "the design overcounted" finding in this document with suspicion.

**+ Additional finding — `BridgeSettings` has only two type-level importers.**
`src/state/coachOnboarding.ts:10` and `src/state/coachOnboarding.test.ts:1` (imported there, then used at 21, 36, 51, 66, 81). Everything else uses `getSettings()`/`setSettings()` and never names the type. That makes the optional `BridgeSettings → AppSettings` rename a three-file change. See Task 5 for the recommendation — and note those five *uses* in `coachOnboarding.test.ts` need editing in this phase regardless of whether the rename happens, because their literals carry `baseUrl`/`token`.

---

## Tasks

<!-- START_TASK_1 -->
### Task 1: Gate — confirm `upsertRoutine`'s defaulting coverage survives without `src/sync`

**Verifies:** remove-vault-sync.AC4.3

**Files:**
- Read only: `src/db/repository.test.ts` (lines 1712–1830), `src/db/repository.ts` (lines 1163–1165), `src/sync/syncService.test.ts` (lines 732–757)

**This task writes no code. It is a gate: if it fails, stop and add coverage before any deletion happens.** Once `syncService.test.ts` is gone, the only proof of the zero-total defaulting rule is whatever lives in `repository.test.ts`. Confirming that *first* is the whole reason the design carved this out.

**Implementation:**

1. Run the surviving tests in isolation and confirm they pass **with `src/sync` still present** (so a failure here means a real gap, not a deletion side effect):
   ```bash
   npm test -- src/db/repository.test.ts
   ```
2. Read `src/db/repository.test.ts:1712–1830` and confirm all four cases listed in the findings above are present and assert on the defaulted value, not merely that the call succeeded.
3. Read `src/sync/syncService.test.ts:732–757` — the four unit tests on `defaultTargetSetsForDurationLine` that are about to be deleted — and confirm each has a behavioural counterpart above. The mapping is:
   - "returns targetSets unchanged when defined" → covered by 1740–1765 (warmup set, no default applied) and by the explicit-value paths in 1712–1738.
   - "defaults to 1 when both undefined" → 1767–1791.
   - "defaults to 1 when targetSets undefined + warmupSets 0" → 1712–1738.
   - "returns undefined when targetSets undefined but warmupSets > 0" → 1740–1765.

**If any of the four has no counterpart:** stop. Add the missing case to `src/db/repository.test.ts` as a behavioural test through `upsertRoutine` (not a unit test of a helper — the helper is being deleted), commit it, and only then continue to Task 2.

**Verification:**
```bash
npm test -- src/db/repository.test.ts
```
Expected: passes, including all four defaulting tests.

**Commit:** none, unless a gap was found and filled — then `test(db): cover upsertRoutine zero-total defaulting for <case>`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Delete `src/sync/` and `src/helpers/settingsActions`

**Verifies:** remove-vault-sync.AC1.2, remove-vault-sync.AC1.5

**Files:**
- Delete: `src/sync/` — the **five remaining files** (`bridgeClient.ts`, `bridgeClient.test.ts`, `syncService.ts`, `syncService.test.ts`, `syncService.integration.test.ts`). The other two named in the design, `abandonedSessionNeverSyncs.test.ts` and `unsyncedSessionSurvivesRoutineEdit.test.ts`, were already deleted in Phase 1 Task 2b.
- Delete: `src/helpers/settingsActions.ts`, `src/helpers/settingsActions.test.ts`

**Implementation:**

```bash
git rm -r src/sync
git rm src/helpers/settingsActions.ts src/helpers/settingsActions.test.ts
```

Phase 1 removed every caller, so nothing should break. If `tsc` reports an error after this, a Phase 1 site was missed — fix it here rather than restoring the module.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
grep -rn "@/sync/\|settingsActions" src
```
Expected: **no output.** This is the design's original Phase 1 criterion, now finally true (see Phase 1, Design gap 2).

```bash
ls src/helpers/
```
Expected: `eslintSetup.test.ts`, `sceneLifecyclePlugin.test.ts` — the directory is not empty, so `helpers` stays in the jest `testMatch`.

**Commit:** `feat: delete the vault sync modules and settings actions`
<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Remove `baseUrl` and `token` from the settings type

**Verifies:** remove-vault-sync.AC1.3

**Files:**
- Modify: `src/state/settings.ts` (module docstring lines 1–5; interface lines 9–38; `DEFAULT_SETTINGS` lines 48–61)

**Implementation:**

1. Delete `baseUrl: string;` (line 10) and `token: string;` (line 11) from the `BridgeSettings` interface.
2. Delete `baseUrl: ''` and `token: ''` from `DEFAULT_SETTINGS` (lines 48–61).
3. Rewrite the **module docstring at lines 1–5**, which currently reads:
   ```
   /**
    * Settings store for bridge configuration with persistent storage.
    * Holds bridge URL, API token, and multi-provider AI configuration in-memory,
    * backed by secure storage.
    */
   ```
   Both named fields are gone. Restate it as what the module now is: an in-memory settings store backed by secure storage, holding multi-provider AI configuration and onboarding/profile state. Note here — this is the natural place for it — that the storage key is the legacy string `'bridge_settings'` and **must not be renamed**, because the blob holds every user's API key and onboarding state.

**DO NOT touch `SETTINGS_KEY` at line 46.** Its value must stay the literal string `'bridge_settings'`. That one blob also holds `anthropicKey`, `openaiKey`, `aiGoals`, `aiEquipment`, `aiPersonality`, `profileAge`, `profileExperience`, and `onboardingState`. Renaming the key orphans every existing user's API key and resets their onboarding. The name is a known misnomer (AGENTS.md says so); it stays anyway.

**DO NOT add a settings migration.** `loadSettings` merges with `cache = { ...cache, ...parsed }` (line 98), so `baseUrl`/`token` keys in an existing stored blob simply survive as undeclared extras that nothing reads. That is the intended behavior and it is what AC1.4 asserts — same undeclare-don't-delete shape as the schema decision in Phase 3.

**Verification:**
```bash
npx tsc --noEmit
```
Expected: errors **are expected here** at any site still reading `settings.baseUrl` or `settings.token`. Phase 1 removed the screens that did; if `tsc` is clean, good. If it flags something, that site was missed earlier — fix it now.

**Commit:** `feat(settings): drop the baseUrl and token fields`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update the settings tests, and pin the legacy-blob behavior

**Verifies:** remove-vault-sync.AC1.3, remove-vault-sync.AC1.4

**Files:**
- Modify: `src/state/settings.test.ts` — `baseUrl`/`token` occurrences run to **line 475**, not line 105. The verified full list:
  `35–39, 42–46, 49–56, 58–65, 67–77, 79–93, 83, 91–92, 95–105, 97–98, 103–104, 108–109, 112–113, 141–142, 151–152, 160, 168–169, 179, 183, 236–237, 271–272, 394–395, 459–460, 474–475`, plus the existing legacy-blob test at 138–156.

**Every one of these breaks `tsc` after Task 3.** They fall into two groups, and the distinction decides what you do with each:

**Group A — tests that are *about* `baseUrl`/`token`.** Delete outright. These are the "persists baseUrl to storage", "persists token to storage", "loads baseUrl/token from storage" tests in the 35–113 range. Their subject no longer exists; there is nothing to re-anchor.

**Group B — tests about *other* behavior that merely use `baseUrl`/`token` as convenient sample fields.** Keep the test, swap the sample field for a surviving one (`aiGoals`, `anthropicKey`, `onboardingState`). These are easy to delete by accident because the grep hit looks identical to Group A. Confirmed Group B sites:
- **67–77** — "persists partial updates". About the partial-write path.
- **95–105** — "load returns early if storage is empty". About the early return; asserts defaults stay empty.
- **141–152, 160–169, 179–183** — blob merge behavior.
- **236–237, 271–272** — AI provider selection.
- **394–395** — model config.
- **459–475** — blob merging.

Read each site before editing it. A test named for AI provider selection that happens to seed `baseUrl` is Group B no matter how the grep line looks.

**Testing — add one new case for AC1.4:**

There is already a legacy-blob test at 138–156 covering a blob written *before* the AI fields existed. Add a sibling covering the *inverse* direction — a blob written before this phase, still carrying the now-deleted keys:

- **remove-vault-sync.AC1.4:** Seed the fake storage backend with a JSON blob that contains `baseUrl` and `token` alongside valid current fields. Call `loadSettings()`. Assert it resolves without throwing, and that the surviving fields (e.g. `anthropicKey`, `onboardingState`) loaded correctly. Do **not** assert that `baseUrl` is absent from the returned object — the merge at line 98 deliberately preserves unknown keys, so asserting absence would pin the opposite of the designed behavior. The criterion is "loads without error, and those stale keys reach no read site"; the first half is what a test can prove, and the second half is proven by Task 3's `tsc` pass and the grep below.

Follow the existing file's setup shape — it already injects a fake storage backend, so no new harness is needed.

**Verification:**
```bash
npm test -- src/state/settings.test.ts
```
Expected: all pass, including the new legacy-blob case.

```bash
npx tsc --noEmit
```
Expected: **errors remain at this point, and that is correct.** Nineteen `baseUrl`/`token` sites across four other `src/state` files — `coachOnboarding.test.ts` (10) and the three store tests (3 each) — belong to **Task 5**, one task later. Expect a clean run only *after* Task 5 lands; Task 7 re-runs it as the phase gate.

What this check tells you *now*: every error must be in a file Task 5 already names. An error anywhere else means the list in Task 4 or Task 5 is short — track it down before moving on.

```bash
grep -rn "baseUrl\|\btoken\b" src/state
```
Expected, **after Task 5 lands**: no output. Right now it still returns the 19 Task 5 sites. (Unrelated `max_tokens`-style hits elsewhere in the repo are fine — this grep is scoped to `src/state`.)

**Commit:** `test(settings): drop baseUrl/token coverage, pin legacy blob loading`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_5 -->
### Task 5: Narrow the secret-leak regression assertions

**Verifies:** remove-vault-sync.AC1.3 (regression protection)

**Files — all FIVE files, three of them in `src/state`:**
- Modify: `src/ai/contextBuilder.test.ts` (lines 1126–1141, 1673–1689)
- Modify: `src/ai/alternatesPrompt.test.ts` (lines 160–175)
- Modify: `src/state/exerciseQuestionStore.test.ts` (setup 443–444, assertions 465–466)
- Modify: `src/state/restCommentaryStore.test.ts` (setup 445–446, assertions 466–467)
- Modify: `src/state/exerciseReplaceStore.test.ts` (setup 328–329, assertions 351–352)
- Modify: `src/state/coachOnboarding.test.ts` — **five `BridgeSettings`-annotated literals at 21–23, 36–38, 51–53, 66–68, 81–83**, each carrying `baseUrl: ''` and `token: ''`. Delete both fields from all five. These are explicitly typed `const settings: BridgeSettings = {…}`, so they are excess-property errors the moment Task 3 lands — the same failure as the three stores above, in a file that is easy to miss because it has nothing to do with prompts or secrets.
- Modify: `src/ai/alternatesPrompt.ts` (line 11), `src/ai/exerciseQuestionPrompt.ts` (line 13), `src/ai/restCommentaryPrompt.ts` (line 12) — **production docstrings**, not tests. Each reads "…has no access to `anthropicKey`/`token`/`baseUrl`." Drop `/token`/`baseUrl`, keep `anthropicKey`. Not compile errors, but they defeat this task's own verification grep.

These tests prove the system prompt never leaks credentials. Two of their subjects no longer exist. **The three `src/state` files are hard `tsc` failures if skipped**, not merely stale — see Design point above.

**Implementation:**

**Narrow them; do not delete them.** The guard keeps its purpose and loses only two subjects.

1. `contextBuilder.test.ts:1126–1141` — a test named for "the anthropic key, openai key, or bridge credentials". Remove the `token` and `baseUrl` setup values and their `not.toContain` assertions. Keep the `anthropicKey` and `openaiKey` assertions. Rename the test so its name matches what it now asserts.
2. `contextBuilder.test.ts:1673–1689` — sets `token: 'bridge-token-12345'` and `baseUrl: 'http://bridge.local:3000'` and asserts `not.toContain('bridge-token-12345')` / `not.toContain('bridge.local')`. Remove both setup values and both assertions; keep the key assertions. Rename.
3. `alternatesPrompt.test.ts:160–175` — asserts `prompt.toLowerCase()).not.toContain('baseurl')`. Remove that assertion and any `token`/`baseUrl` setup; keep the anthropic-key assertion. Rename.
4. **`exerciseQuestionStore.test.ts`** — delete `token`/`baseUrl` from the `setSettings({...})` literal at 443–444 and the two `not.toContain` assertions at 465–466. Keep the anthropic-key assertion and rename the test.
5. **`restCommentaryStore.test.ts`** — same shape: literal at 445–446, assertions at 466–467.
6. **`exerciseReplaceStore.test.ts`** — same shape: literal at 328–329, assertions at 351–352.
7. **`coachOnboarding.test.ts`** — delete `baseUrl: ''` and `token: ''` from each of the five `const settings: BridgeSettings = {…}` literals (21–23, 36–38, 51–53, 66–68, 81–83). No assertions to rename here; these are fixtures for onboarding-state tests that are otherwise unaffected.
8. **The three `src/ai` prompt docstrings** — `alternatesPrompt.ts:11`, `exerciseQuestionPrompt.ts:13`, `restCommentaryPrompt.ts:12`. Each says the prompt "has no access to `anthropicKey`/`token`/`baseUrl`". The guarantee is still real and still worth stating; it just has one subject now. Reduce each to `anthropicKey`.

After the edit, every settings object these tests build must typecheck against the narrowed `BridgeSettings` — that is precisely what makes this task load-bearing rather than cosmetic.

**Verification note:** `grep -rn "bridge-token-12345\|bridge.local" src` is the fastest way to confirm all five were caught. It must return **no output**.

**Verification:**
```bash
npm test -- src/ai src/state
```
Expected: all pass.

```bash
grep -rn "baseUrl\|bridge-token\|bridge.local" src/ai src/state
```
Expected: **no output.** Scope this to both directories — three of the five files are in `src/state`, and an `src/ai`-only grep is exactly the mistake that hid them in the first place.

**Commit:** `test(ai): narrow secret-leak guards to the API keys`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Drop `sync` from the jest testMatch

**Verifies:** remove-vault-sync.AC5.6 (partial — the AC is fully claimed in Phase 4, satisfied here)

**Files:**
- Modify: `jest.config.js` (line 12)

**Implementation:**

Line 12 currently reads:
```js
testMatch: ['<rootDir>/src/{engine,db,interop,state,sync,health,helpers,ai,theme,watch,components,export}/**/*.test.ts'],
```

Remove `sync` from the brace list. Change nothing else on the line — the other eleven domains all still have tests, including `helpers` (Task 2 confirmed it is not empty).

**Verification:**
```bash
npm test
```
Expected: the full suite passes. Compare the suite count to the pre-phase run — it should drop by exactly **three**: the `src/sync` test files still present at the start of this phase (`bridgeClient.test.ts`, `syncService.test.ts`, `syncService.integration.test.ts`). `src/sync` shipped five test files originally, but Phase 1 Task 2b already removed two of them, so the pre-Phase-2 baseline is three, not five. A larger drop means a domain was removed from the glob by accident.

**Commit:** `chore(jest): drop sync from testMatch`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Verify the phase

**Verifies:** remove-vault-sync.AC1.2, remove-vault-sync.AC4.1, remove-vault-sync.AC4.2, remove-vault-sync.AC4.4

**Files:** none — this task only runs and observes.

**Step 1: Full verification**
```bash
npm test
```
Expected: all suites pass.

```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
npm run lint
```
Expected: passes.

**Step 2: Confirm the survivors (AC4.1, AC4.2)**
```bash
npm test -- src/interop src/export
```
Expected: every `src/interop` and `src/export` suite passes, unmodified by this phase.

```bash
git diff --stat main -- src/interop src/export
```
Expected: **no output** — neither directory was touched. This is the literal check for AC4.1's "unchanged".

```bash
grep -rn "export function serializeRoutine\|export function serializeSession" src/interop/serialize.ts
grep -rn "export function parseRoutine\|export function parseSession" src/interop/parse.ts
```
Expected: all four still exported (AC4.2).

**Step 3: Confirm AC4.4 is untouched**
```bash
npm test -- src/ai/draftSchema.test.ts
```
Expected: passes. `validateRoutineDraft` still rejects `targetSets: 0`. This phase does not edit `draftSchema.ts`; the run confirms nothing collateral broke it.

**Step 4: Final grep sweep**
```bash
grep -rn "@/sync/\|settingsActions\|BridgeUnreachable\|BridgeHttpError\|createBridgeClient\|createSyncService\|syncNow\|importRoutines" src
```
Expected: **no output.**

**No simulator pass is required for this phase.** It edits no screens — Phase 1 already removed them, and Phase 4 does the copy sweep with its own simulator pass. The deletions here are compiler- and test-verified.

**Done when:** all commands above pass and the final grep is empty.
<!-- END_TASK_7 -->

---

## Deferred decision: the `BridgeSettings` → `AppSettings` rename

The design offers this as optional. **Recommendation: skip it in this phase.**

It touches only three files (`src/state/settings.ts`, `src/state/coachOnboarding.ts:10`, `src/state/coachOnboarding.test.ts:1` plus its five annotated literals), so it is cheap — but it is pure cosmetics landing in the middle of a deletion whose correctness rests on reviewability. The type name being a misnomer is already documented in AGENTS.md and is not load-bearing. If it is wanted, do it as its own commit after Task 7, never bundled with a deletion, and remember it must **not** touch `SETTINGS_KEY`.

If skipped, leave the AGENTS.md note about the misnomer intact in Phase 4 rather than deleting it as stale.

---

## Phase exit criteria

- `npm test`, `npx tsc --noEmit`, `npm run lint` all pass (**AC6.1, AC6.2, AC6.3** — asserted at every phase boundary rather than claimed by one phase's AC Coverage section, matching how the design scopes them).
- `src/sync/` and `src/helpers/settingsActions.{ts,test.ts}` do not exist.
- `grep -rn "@/sync/\|settingsActions" src` returns nothing.
- `git diff --stat main -- src/interop src/export` returns nothing.
- `SETTINGS_KEY` still equals `'bridge_settings'`.

`main` is green and mergeable. `sync_status` is still in the schema — that is Phase 3.
