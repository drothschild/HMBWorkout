# Remove Vault Sync — Phase 4: User-facing copy and documentation

**Goal:** No string or document asserts something the code no longer does.

**Architecture:** No behavior changes. Two screens lose vault copy; `AGENTS.md` loses three sections and gains six rewritten passages where the *content* changed, not just the references. The distinction matters: deleting a passage that documented a real, surviving invariant would lose knowledge, so each one below is marked delete-or-rewrite deliberately.

**Tech Stack:** Markdown and TSX string literals only.

**Scope:** Phase 4 of 4 from `docs/design-plans/2026-08-07-remove-vault-sync.md`.

**Depends on:** Phase 3 complete and merged.

**Codebase verified:** 2026-08-07 (codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### remove-vault-sync.AC2: No UI offers or mentions vault sync
- **remove-vault-sync.AC2.5 Success:** The session-abandon confirmation conveys that the deletion is
  permanent without referencing a vault.
- **remove-vault-sync.AC2.6 Success:** The Today tab's no-routines empty state names the AI Coach as
  the only way to create a routine and does not mention import or the vault.
- **remove-vault-sync.AC2.7 Edge:** No user-visible string in `src/app/` or `src/components/`
  contains "vault", "sync", or "bridge".

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
- **remove-vault-sync.AC6.4:** In the simulator, a routine starts, sets log, the session completes
  with no sync-related console error, and the session appears in History.
- **remove-vault-sync.AC6.5:** In the simulator, Settings → AI opens and saves an API key, proving
  the `bridge_settings` storage key still resolves after the type rename.

**Note on AC5.6 and AC5.7:** both were satisfied in earlier phases — `jest.config.js` in Phase 2 Task 6, the `repository.ts` comment blocks in Phase 3 Task 6. They are claimed here because the design assigns them to Phase 4. Task 8 **verifies** them; do not redo the work.

---

## Investigation findings

**Confirmed, with corrected line numbers:**
- ✓ `src/app/session.tsx` — `confirmAbandon` at **401–410**, not 404. The vault clause is in the message at **line 404**; there is also a rationale **comment at line 400** ("…and never reach the vault, so it takes an explicit confirmation") that the design did not list.
- ✓ `src/app/(tabs)/index.tsx` — empty state at **165–167** (the vault clause wraps onto 166–167); `useFocusEffect` comment at **57–59**, not 57–58.
- ✓ `AGENTS.md` — "Last verified: 2026-08-04" at line 3; "## Two-repo split" **162–173**; engine convention 1 **200–212** (vault-sync citation at 210–211); interop "keep both layers" paragraph **456–466**; "## Sync (`src/sync`)" **468–525** (zero-total defaulting passage **481–512**); Structure `src/sync/` entry **line 743**; Boundaries mirror bullet **771–774**.

**+ Additional finding — AGENTS.md has six more vault/sync sites the design did not list.**
The design names four sections to delete and three passages to rewrite. A full grep found these as well, and every one of them will be false after Phase 3:

| Line | Current content | Why it changes |
|---|---|---|
| 6 | "the Obsidian vault is the sync target via a Mac-side bridge" | The opening architectural claim of the whole file. Most visible wrong statement in the repo. |
| 536–538 | "The four settings fields … live in the existing `bridge_settings` blob, so `BridgeSettings` … is now a misnomer — AI settings are in there too." | Still half-true: the key *is* still `bridge_settings`. But the blob now holds **only** AI and profile settings, so "AI settings are in there too" is wrong. Rewrite, don't delete — the do-not-rename-the-key warning is load-bearing. |
| 546 | "matching the sync convention" | The convention it points at is being deleted. |
| 602 | "after the session record is closed and sync and the Health write are under way" | Describes `onCompleteSession`'s effect order, which Phase 1 changed. |
| 664 | testMatch domain list including `sync` | Must track Phase 2's `jest.config.js` edit. |
| 786, 833 | "the vault export"; "every cardio/stretch entry from a vault import" | Both name paths that no longer exist. `src/export` survives, so 786 is a rename, not a deletion. |

**+ Additional finding — the engine rules state the vault-sync rationale in the source of record.**
`src/engine/rules/types.lv:24`, `transition.lv:196/360/389`, and `src/engine/abandonSession.test.ts:5/109/198` all say `CompleteSession` drives "the vault sync and the HealthKit export". AC5.5 corrects the AGENTS.md *description* of this; the `.lv` rules AGENTS.md is describing keep the deleted claim. Task 6b handles them. Note `.lv` edits require `npx expo start --clear` (AGENTS.md engine convention 4).

**+ Additional finding — four stray comments sit outside every phase's sweep.**
`src/app/session.tsx:454` ("kicks off sync, the HealthKit export, and the debrief"), `src/state/sessionPresenter.ts:61` and `:442`, `src/ai/draftSchema.ts:277` ("Pattern borrowed from syncService.ts"). Also handled by Task 6b. These survived because AC2.7's greps are scoped to `src/app`/`src/components` and keyed on `vault|bridge` — `session.tsx:454` says "sync", and `src/state`/`src/ai` are never swept.

**+ Additional finding — README.md describes vault sync as a shipped feature.**
Lines 4–5 (architecture summary), 32 (settings blob "bridge credentials"), **43–46 (a whole feature section on Obsidian vault sync)**, 55 (test domain list), 89 (`src/sync/` in the structure list).

**This is outside the design's stated scope** — Definition of Done item 5 and AC5.1–AC5.8 name only AGENTS.md. It is included as Task 7 because shipping a README advertising a deleted feature is plainly wrong, and Phase 4's goal is literally "no document asserts something the code no longer does." **Flag it in the PR description as a deliberate scope addition** so a reviewer can drop the commit if they disagree.

**On AC2.7's wording.** The criterion says no user-visible string may contain "vault", "sync", or "bridge". Taken as a raw grep it is unsatisfiable — `SETTINGS_KEY` is still the literal `'bridge_settings'` (deliberately, per Phase 2) and identifiers like `useSyncExternalStore` may appear. The investigator classified every hit as (1) user-visible string, (2) code identifier, or (3) comment. **AC2.7 is about class (1) only.** Task 8's grep is written to be read with that classification in hand.

---

## Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Rewrite the session-abandon confirmation

**Verifies:** remove-vault-sync.AC2.5

**Files:**
- Modify: `src/app/session.tsx` (comment line 400; message line 404)

**Implementation:**

Current (lines 401–410):
```ts
const confirmAbandon = () => {
  Alert.alert(
    'Abandon workout?',
    'This workout and every set you have logged will be deleted. It will not be saved to your vault.',
    [
      { text: 'Keep going', style: 'cancel' },
      ...
```

The deleted clause was carrying the warning's weight — it told the user the data was going nowhere. Removing it without replacement weakens the confirmation. Replace with copy that conveys permanence directly:

```ts
    'This workout and every set you have logged will be permanently deleted. This cannot be undone.',
```

Also update the rationale comment at line 400, which reads "…and never reach the vault, so it takes an explicit confirmation." Restate it in terms of what actually happens now: an abandoned session emits `DiscardSession`, so the session row and its sets are deleted rather than kept — which is exactly why the action needs confirming.

Keep the title (`'Abandon workout?'`) and both buttons (`'Keep going'` / `'Abandon'`) unchanged.

**Verification:**
```bash
grep -n "vault" src/app/session.tsx
```
Expected: **no output.**

**Commit:** `feat(session): restate the abandon warning without the vault`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Rewrite the Today tab empty state

**Verifies:** remove-vault-sync.AC2.6

**Files:**
- Modify: `src/app/(tabs)/index.tsx` (comment 57–59; empty state 165–167)

**Implementation:**

1. Empty state (165–167) currently reads:
   ```
   No routines yet. Build one with the AI Coach, or import your routines from
   the vault.
   ```
   The AI Coach is now the only path. This screen is also the sole onboarding funnel for a user with no routines, so the copy should point somewhere, not just drop a clause:
   ```
   No routines yet. Build one with the AI Coach to get started.
   ```
   Keep it a single `ThemedText` — do not turn it into a button in this phase; adding navigation is behavior, not copy, and is out of scope.

2. Comment (57–59) currently reads:
   ```
   // Reload on focus rather than once on mount: routines arrive from the AI
   // Coach, the vault import, and the Routines tab, all of which the user
   // reaches and returns from without this screen unmounting.
   ```
   The rationale survives — it is still true that routines arrive from elsewhere and the screen stays mounted. Drop only the vault-import source:
   ```
   // Reload on focus rather than once on mount: routines arrive from the AI
   // Coach and the Routines tab, both of which the user reaches and returns
   // from without this screen unmounting.
   ```

**Verification:**
```bash
grep -n "vault\|import" "src/app/(tabs)/index.tsx"
```
Expected: no `vault`; any `import` hits are ES import statements only.

**Commit:** `feat(today): name the AI Coach as the only routine source`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-6) -->

<!-- START_TASK_3 -->
### Task 3: Delete the three AGENTS.md sections

**Verifies:** remove-vault-sync.AC5.1, remove-vault-sync.AC5.2

**Files:**
- Modify: `AGENTS.md` (delete 162–173, 468–525, line 743, 771–774)

**Edit from the bottom of the file upward** so earlier deletions do not shift the line numbers of later ones.

**Implementation:**

1. **Boundaries mirror bullet, 771–774** (AC5.2) — delete the whole bullet:
   > Markdown grammar changes to the shared pieces — document-level structure, `parseDuration`, `ContractError` — must be mirrored in `../workout-bridge/src/contract.ts`; line-level flag changes (`parseFlags`) are app-only

   Nothing replaces it. `src/interop` no longer has a mirror obligation to anything.

2. **Structure entry, line 743** (AC5.1) — delete:
   > - `src/sync/` — bridge HTTP client + offline sync queue

   Leave the other Structure entries alone. `src/interop/` and `src/export/` both still exist and keep their entries.

3. **"## Sync (`src/sync`)" section, 468–525** (AC5.1) — delete the heading and its body **except** the zero-total defaulting passage at 481–512, which is not really about sync and must be **relocated and rewritten**, not deleted. Task 5 owns that rewrite. The mechanical move: cut 481–512 out before deleting 468–525, and park it in the interop section near the other `upsertRoutine` material. Task 5 then rewrites it in place.

4. **"## Two-repo split" section, 162–173** (AC5.1) — delete the heading and all bullets. The `../workout-bridge` repo is untouched on disk; this repo simply no longer has a relationship to document.

**Verification:**
```bash
grep -n "Two-repo split\|## Sync\|src/sync/\|workout-bridge" AGENTS.md
```
Expected: **no output.**

**Commit:** `docs(agents): delete the two-repo split and sync sections`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Rewrite the interop null-normalization passage

**Verifies:** remove-vault-sync.AC5.3

**Files:**
- Modify: `AGENTS.md` (paragraph at 456–466, pre-Task-3 numbering)

**Implementation:**

The paragraph currently ends:
> `syncService.ts`'s row-to-serializer mapping normalizes the same hazard at the shell boundary (`?? undefined`, matching its pre-existing `exerciseId` handling); **keep both layers.** A regression here is not a rejected sync — the bridge's `validateSessionDoc` never runs `parseFlags`, so a bad guard writes a `<flag>=null` line straight into the vault and the session still flips to `synced`.

Both the second layer and the consequence-clause are gone. Rewrite so the passage:
- **keeps** the whole first half unchanged — the `!= null` vs `!== undefined` rule, the reason (WatermelonDB returns `null` for unset optional columns), and the full list of affected fields (`reps`, `weightKg`, `distanceM`, `durationSeconds`, `rpe` on `SessionSet`; `targetSets`, `targetReps`, `targetDurationSeconds`, `restSeconds` on `RoutineExercise`). That rule is unchanged and is the load-bearing part.
- **replaces** the "keep both layers" instruction with a statement that `buildSessionSetLine`'s `!= null` guards are now the **sole** normalization layer, so a bad guard has no backstop.
- **replaces** the bridge/vault consequence with the real one: `src/export`'s `exportService.ts` maps rows to the serializer and is the only remaining caller, so a regression writes a `<flag>=null` line into whatever the export produces.

Do not shorten the field list. Its exhaustiveness is the point.

**Verification:**
```bash
grep -n "keep both layers\|validateSessionDoc\|flips to" AGENTS.md
```
Expected: **no output.**

```bash
grep -n "buildSessionSetLine" AGENTS.md
```
Expected: still present, now described as the sole layer.

**Commit:** `docs(agents): buildSessionSetLine is the sole null-normalization layer`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Rewrite the zero-total defaulting passage

**Verifies:** remove-vault-sync.AC5.4

**Files:**
- Modify: `AGENTS.md` (the passage relocated in Task 3, originally 481–512)

This is the longest rewrite in the phase. The passage is ~30 lines and most of it documents rules that are still true.

**Implementation:**

**Delete** every clause about the deleted layer:
- `importRoutines` as a defaulting layer, and the entire "redundant by construction" framing — including the sentence explaining that only the direct unit tests on `defaultTargetSetsForDurationLine` prove it does anything on its own. Both the function and its tests are gone.
- "vault import" as a write path into `upsertRoutine`, and the `importRoutines` skip-and-log behavior on a malformed line.
- The note that a routine's origin is "hand-authored in the vault vs. drafted by the coach" — there is only one origin now.
- The trailing **Note:** paragraph about routines imported before the fix being left with `target_sets = null` and healed by manual re-import. There is no re-import.

**Keep and re-frame** everything that survives:
- `upsertRoutine` defaults a duration-based entry's `targetSets` to 1 when it is undefined/null and `warmupSets` is 0 — now stated as the **only** enforcing layer (AC5.4).
- The default does **not** gate on `targetDurationSeconds` being set — an entry with `targetSets` undefined and `warmupSets` 0 is zero-total whether it has a duration or not (the AI-drafted strength exercise with only title and kind).
- It fires only when `targetSets` is **absent**, never on an explicit `0`.
- An AI draft with `targetSets: 0` is rejected upstream by `validateRoutineDraft` (`src/ai/draftSchema.ts`), which enforces `targetSets >= 1` when present.
- An entry with explicit `warmup=2` and no target sets totals 2 and is never defaulted.
- The AI persona's own `targetSets: 1` convention for duration-based exercises, which the default mirrors.

**On `parseWorkoutLine`'s zero-sets and zero-reps rejections** (currently framed as protecting vault import): `src/interop/parse.ts` still exists and still enforces them, and AC4.4's sibling rule is still tested. Keep the rules documented — they are real — but re-frame them as properties of the parser rather than as a vault-import gate. The routine-vs-session context distinction (`3x0` rejected in a routine, `1x0` valid in a logged session) is unchanged and must survive verbatim in substance; it is already documented separately in the interop section, so avoid duplicating it — cross-reference instead.

**Verification:**
```bash
grep -n "redundant by construction\|importRoutines\|defaultTargetSetsForDurationLine\|re-import" AGENTS.md
```
Expected: **no output.**

```bash
grep -n "upsertRoutine" AGENTS.md
```
Expected: present, described as the sole layer.

**Commit:** `docs(agents): upsertRoutine is the only zero-total defaulting layer`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Fix engine convention 1 and the six unlisted sites

**Verifies:** remove-vault-sync.AC5.5, remove-vault-sync.AC5.8

**Files:**
- Modify: `AGENTS.md` (line 3; line 6; convention 1 at 210–211; lines 536–538, 546, 602, 664, 786, 833 — all pre-Task-3 numbering)

**Implementation:**

1. **Engine convention 1, 210–211** (AC5.5). Currently:
   > `CompleteSession` is what drives vault sync and the HealthKit export, so an abandoned session (`AbandonSession`) must emit `DiscardSession` so the session is deleted instead of synced or exported.

   The *reason* `DiscardSession` is a separate variant survives — it is still why an abandoned session must not be exported. Drop only the sync half: `CompleteSession` drives the HealthKit export, so an abandoned session must emit `DiscardSession` and be deleted instead of exported. Do not delete the convention or its rationale.

2. **Line 6**, the opening architecture sentence: "…data lives on-device (WatermelonDB); the Obsidian vault is the sync target via a Mac-side bridge." Delete the vault clause. The surrounding sentence about local-first on-device storage stays.

3. **Lines 536–538**, AI Coach settings. Rewrite so it states that the settings blob is persisted under the key `'bridge_settings'` and that **the key must not be renamed** — it holds every AI and profile field, and renaming it orphans existing users' API keys and resets onboarding. Drop "AI settings are in there too", which implied non-AI settings share the blob; after Phase 2 they do not. If Phase 2's optional `BridgeSettings → AppSettings` rename was skipped (the recommendation), keep the note that the type name is a misnomer.

4. **Line 546**: "matching the sync convention" → attribute the network-vs-HTTP failure-type split to the AI client itself, since the convention it referenced is deleted.

5. **Line 602**: "after the session record is closed and sync and the Health write are under way" → drop "sync and". Must now match Phase 1's actual order: session record closed, HealthKit write under way, debrief last.

6. **Line 664**, Testing gotchas: the testMatch domain list still names `sync`. Update it to match `jest.config.js` after Phase 2 Task 6.

7. **Line 786**, Boundaries: "…`getRecentSessionSummaries`, the vault export — resolves stamp-first…" → the export path survives as `src/export`; rename "the vault export" to "the markdown export". Do not delete the bullet — it documents the stamp-first identity rule, which is load-bearing.

8. **Line 833**, convention 10: "every cardio/stretch entry from a vault import validly carries no `target_sets`" → the fact that cardio/stretch entries validly carry no `target_sets` is still true and still the reason the guard exists; re-attribute it to the parser (`parseWorkoutLine` rejects sets×reps for those kinds) rather than to vault import.

9. **Line 452**: "…than the vault copy being written permanently short and marked `'synced'`", inside the `serializeSession` paragraph. Task 4 covers 456–466 and stops just short of this one. The rule it justifies — `serializeSession` throws rather than emitting a partial session — is still true and still load-bearing; only the vault-copy consequence is dead. Restate the consequence in terms of the export producing a silently short document.

10. **Line 407**: the section heading `## The vault markdown contract (\`src/interop\`)`. Keep "vault markdown contract" — that is the format's name and `src/interop` still implements it, consistent with Task 6b item 12 and with Phase 3's decision to leave the module unchanged. **No edit**; listed here so the Task 8 grep result is expected rather than alarming.

11. **Line 740**: the Structure entry `- \`src/interop/\` — vault markdown serializer/parser (the shared contract)`. Two conflicting instructions previously applied here — Task 3 said leave it, Task 7 said strip "vault" from README's near-identical line. **Resolve in favour of keeping "vault markdown" in both**, per item 11 of Task 6b: it names a format that survives. Drop only the trailing `(the shared contract)`, which referred to the deleted `../workout-bridge` mirroring obligation. README line 87 carries the same line without the article — `(shared contract)` — and gets the same treatment in Task 7.

12. **Line 441**: "…rejected in routine targets and vault import". The zero-reps rejection is a property of `parseWorkoutLine` and is still true; only the vault-import framing dies. Re-attribute it to routine parsing, matching the re-framing Task 5 applies to the same rules in the defaulting passage.

13. **Line 3** (AC5.8): update `Last verified: 2026-08-04` to the date this phase is completed.

**Verification:**
```bash
grep -ni "vault\|bridge\|workout-bridge\|syncNow\|sync_status" AGENTS.md
```
Expected: only hits you kept on purpose — the `'bridge_settings'` storage-key mentions from step 3, and the two "vault markdown contract" format names at lines 407 and 740 (items 10 and 11). Read every hit; do not assume.

```bash
grep -ni "vault import\|vault sync\|the bridge\|workout-bridge" AGENTS.md
```
Expected: **no output.** The sharper check — dead paths only, unsatisfiable by leaving a stale reference in place.

```bash
grep -n "Last verified" AGENTS.md
```
Expected: today's date.

**Commit:** `docs(agents): sweep the remaining vault and sync references`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6B -->
### Task 6b: Sweep the engine rules and the four stray comments

**Verifies:** remove-vault-sync.AC5.5 (its source-of-record half), remove-vault-sync.AC2.7

**Files:**
- Modify: `src/engine/rules/types.lv` (line 24)
- Modify: `src/engine/rules/transition.lv` (lines 196, 360, 389)
- Modify: `src/engine/abandonSession.test.ts` (lines 5, 109, 198)
- Modify: `src/app/session.tsx` (line 454)
- Modify: `src/state/sessionPresenter.ts` (lines 61, 442)
- Modify: `src/ai/draftSchema.ts` (line 277)
- Modify: `src/state/routineListPresenter.ts` (line 12), `src/state/routineListPresenter.test.ts` (line 72), `src/state/startSessionFromRoutine.test.ts` (line 148), `src/state/todayStartPresenter.test.ts` (line 10), `src/state/weightUnits.ts` (lines 5, 15), `src/state/weightUnits.test.ts` (lines 7, 8) — see items 10 and 11
- Modify: `src/theme/actionButtonColors.ts` (lines 36, 42) — see item 11
- **Leave alone:** `src/ai/contextBuilder.ts` (472, 476), `src/export/exportService.ts` (9) — format-name references, see item 12

**Why this task exists.** AC5.5 fixes engine convention 1 in AGENTS.md — but AGENTS.md is *documenting* the `.lv` rules, and the rules themselves still carry the deleted claim. Fixing the documentation while leaving the source of record wrong inverts the intended direction of truth. None of these sites is reachable by any other task's grep: Phase 4's AC2.7 greps are scoped to `src/app`/`src/components` and match `vault|bridge` (missing "sync"), and `src/engine`, `src/state`, and `src/ai` are never swept at all.

**Implementation — comments only. Change no logic.**

1. **`src/engine/rules/types.lv:24`** — "CompleteSession is what drives the vault sync and the HealthKit export, so an…". Drop the vault-sync half; `CompleteSession` drives the HealthKit export. The rationale for `DiscardSession` being its own variant survives intact and must stay.
2. **`src/engine/rules/transition.lv:196`** — "must precede the advancement effects (CompleteSession drives sync)." Re-attribute to the HealthKit export.
3. **`src/engine/rules/transition.lv:360`** — "synced to the vault or exported to HealthKit." → exported to HealthKit.
4. **`src/engine/rules/transition.lv:389`** — "Done is already written, synced and…" → written and exported.
5. **`src/engine/abandonSession.test.ts:5, 109, 198`** — the file docstring and two inline comments repeat the same "drives the vault sync and the HealthKit export" framing. Same correction. **These are comments in a test file; do not change any assertion.**
6. **`src/app/session.tsx:454`** — "// Irreversible (kicks off sync, the HealthKit export, and the debrief), so". Drop "sync,". Must match Phase 1's actual effect order.
7. **`src/state/sessionPresenter.ts:61`** — "triggers vault sync, the HealthKit export, and the debrief), so the screen". Same drop.
8. **`src/state/sessionPresenter.ts:442`** — "// The input carries display lbs; the engine, DB, and vault stay kg". The unit invariant is real and still true of the engine and DB; drop the vault from the list.
9. **`src/ai/draftSchema.ts:277`** — "Pattern borrowed from syncService.ts, which does the same for WatermelonDB columns." The referenced file is gone. Keep the explanation of what the pattern *is* and drop the dead attribution.

10. **Five more sites naming "vault import" as a live code path.** All are comments explaining *why* a zero-total entry is reachable — the reasoning survives, only the attribution dies. Re-attribute each to the parser (`parseWorkoutLine` rejects sets×reps for cardio/stretch, so those entries validly carry no `target_sets`), matching the re-framing Task 5 applies in AGENTS.md:
    - `src/state/routineListPresenter.ts:12` — "vault-import shape for cardio/stretch entries, which validly carries no…"
    - `src/state/routineListPresenter.test.ts:72` — "Reachable via vault import, where cardio/stretch entries validly carry…"
    - `src/state/startSessionFromRoutine.test.ts:148` — "the vault-import path, where target_sets is validly absent instead…"
    - `src/state/todayStartPresenter.test.ts:10` — "the vault-import shape"
    - `src/state/weightUnits.ts:5` — "the vault markdown weight= flag, sync, and HealthKit". Drop ", sync"; see item 12 on "vault markdown".

11. **`src/theme/actionButtonColors.ts:36` and `:42`** — two docstrings naming "Bridge settings" as a consumer screen for the `danger` and `success` tokens. Phase 1 Task 5 deleted that screen, so both lists are now wrong. Drop "Bridge settings" from each; the surrounding enumeration of the remaining consumers (Today, Routines, routine + exercise detail, ReplaceExercise, `session.tsx`) stays. The `success` token's list becomes just the Routines status line — check whether it still has any consumer at all, and if not, say so in the docstring rather than deleting the token (it is an independent theme token by design).

12. **Seven lines across four files, naming the markdown *format* rather than a code path.** `src/state/weightUnits.ts:5,15`, `src/state/weightUnits.test.ts:7,8`, `src/ai/contextBuilder.ts:472,476`, `src/export/exportService.ts:9` describe the serialization format as "vault markdown" / "vault-contract-compliant" / "vault-date symmetry".

    **These are not stale.** `src/interop` still implements that exact format and Phase 3 keeps it unchanged — the format's name really is the Obsidian vault markdown contract. Rewording them would be churn, and would contradict Phase 3's decision to leave the module (and its own "vault" vocabulary) alone. **Leave all four alone**, and expect them in the Task 8 grep. Do strip any `sync` reference that rides alongside (`weightUnits.ts:5`, `weightUnits.test.ts:7`), since the sync path genuinely is gone.

**⚠ Editing `.lv` files requires a Metro restart.** AGENTS.md engine convention 4: `.lv` files are inlined as strings by babel, and Metro's transform cache keys on the *importing* TS file, not the `.lv` content. After steps 1–4, restart with `npx expo start --clear` before the Task 8 simulator pass, or modules can end up holding mixed old/new copies of the rules.

**Testing:** none. These are comments; behavior is unchanged. `npm test` passing is the guard that nothing was edited by accident.

**Verification:**
```bash
npm test -- src/engine
```
Expected: every engine suite passes unchanged. A failure here means logic was touched, not a comment.

```bash
grep -rn "vault" src/engine/rules
```
Expected: **no output.** (Case-sensitive and `vault`-only on purpose: a case-insensitive `sync` here matches `fs.readFileSync` in `transition.load-gate.test.ts:12,13,14` and the word "synchronously" in `transition.lv:339,340`. All five are legitimate and must not be touched.)

```bash
grep -rn "vault sync\|drives sync\|synced" src/engine
```
Expected: **no output.** This targets the actual dead claims without colliding with the five legitimate hits above.

```bash
grep -rni "vault" src/engine src/state src/ai src/app src/components
```
Expected: only the format-name references from item 12 — `weightUnits.ts:5,15`, `weightUnits.test.ts:7,8`, `contextBuilder.ts:472,476`. No live-path references.

```bash
grep -rni "vault import\|vault-import\|vault sync" src
```
Expected: **no output.** This is the sharper check — it targets dead *paths* rather than the surviving format name, so it cannot be satisfied by leaving a stale reference in place.

**Commit:** `docs: drop vault sync from the engine rules and stray comments`
<!-- END_TASK_6B -->

<!-- START_TASK_7 -->
### Task 7: Update README.md

**Verifies:** None — this task is outside the design's acceptance criteria. See findings.

**Files:**
- Modify: `README.md` (lines 4–5, 32, 43–46, 55, 89)

**Scope note — read before doing this.** The design assigns Phase 4 only AGENTS.md; no AC covers README. It is included because the phase goal is "no document asserts something the code no longer does," and README currently advertises vault sync as a shipped feature. **Commit it separately and flag it in the PR description**, so a reviewer who reads the design strictly can drop this one commit without touching the rest of the phase.

**Implementation:**

1. **Lines 4–5** — the architecture summary states data "lives on-device, and an Obsidian vault is the sync target via a Mac-side bridge." Delete the vault/bridge clause; keep the local-first and Rill-engine description and the AI-authoring sentence that follows.
2. **Line 32** — "settings blob (bridge credentials + AI key/goals/…)". Drop "bridge credentials +".
3. **Lines 43–46** — the whole "Obsidian vault sync" feature section (vault sync, markdown contract, bridge, offline queue). Delete the section. Do **not** replace it with an "export coming soon" placeholder — `src/export` is wired to no UI and promising it would be its own false claim.
4. **Line 55** — test domain list including `sync`. Update to match `jest.config.js`.
5. **Line 89** — `- \`src/sync/\` — bridge HTTP client + offline sync queue`. Delete the line. Line 87's `src/interop/` entry stays and **keeps "vault markdown"** — that is the format's name and `src/interop` still implements it (Task 6b item 12, and AGENTS.md line 740 gets the same treatment in Task 6 item 11). Drop only "(shared contract)", which named the deleted `../workout-bridge` mirroring obligation.

**Verification:**
```bash
grep -ni "vault\|bridge\|sync" README.md
```
Expected: **no output**, or only clearly-correct residue you can justify.

**Commit:** `docs(readme): drop the vault sync feature description`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Verify the whole change, in the suite and in the simulator

**Verifies:** remove-vault-sync.AC2.7, remove-vault-sync.AC5.6, remove-vault-sync.AC5.7, remove-vault-sync.AC6.4, remove-vault-sync.AC6.5

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

**Step 2: Confirm the earlier-phase ACs stuck (AC5.6, AC5.7)**
```bash
sed -n '12p' jest.config.js | grep -c "sync"
```
Expected: **0** (AC5.6, done in Phase 2 Task 6).

A bare `grep -n "sync" jest.config.js` still returns **line 42** — the commented-out `rn` project, whose own `testMatch` also lists `sync`. AGENTS.md calls that block intentional future work, and Phase 2 Task 6 deliberately edits only the active `testMatch` on line 12. Line 42 is dead text inside a comment and is left alone; scope the check to line 12 so it is achievable.

```bash
grep -n "syncNow\|sync_status\|vault\|bridge" src/db/repository.ts
```
Expected: **no output** (AC5.7, done in Phase 3 Task 6).

**Step 3: The AC2.7 sweep — widened past the AC's literal scope, but NOT into `src/interop`**

The criterion names `src/app/` and `src/components/`. Sweep wider than that: every Critical issue found in review of this plan was a site a narrower, identifier-keyed grep could not see.

**`src/interop` is excluded from all three sweeps below.** Phase 3 deliberately holds it unchanged to satisfy AC4.1, which knowingly strands ~40 `vault` hits, three `syncService` references, and the `VAULT_SYNC_DIR` test helpers inside it. That decision is argued in phase_03.md; these greps must not contradict it.

```bash
grep -rni "vault" src --exclude-dir=interop
```
Expected: exactly the **seven format-name lines across four files** that Task 6b item 12 deliberately keeps — `src/state/weightUnits.ts:5,15`, `src/state/weightUnits.test.ts:7,8`, `src/ai/contextBuilder.ts:472,476`, `src/export/exportService.ts:9`. Every one must be a description of the *markdown format* (which `src/interop` still implements), never a live code path. Anything naming "vault import", "vault sync", or "the bridge" is a miss — go fix it.

```bash
grep -rni "bridge" src --exclude-dir=interop
```
Expected: **~29 hits, all of them the surviving `BridgeSettings` type name and `'bridge_settings'` storage key** — across `src/state/settings.ts`, `src/state/coachOnboarding.ts`, `src/state/coachOnboarding.test.ts`, and `src/state/settings.test.ts`'s `fakeStorage.bridge_settings` accesses.

> ⚠ **Do NOT resolve this grep by renaming `BridgeSettings` or `SETTINGS_KEY`.** Phase 2 recommends deferring the type rename, and renaming the *key* is forbidden outright — `'bridge_settings'` holds every user's API key and onboarding state, so changing it orphans them. A non-empty result here is the expected, correct state.

What must **not** appear: any reference to a bridge *client*, *URL*, *token*, *connection*, or the `../workout-bridge` repo. Use the sharper check:

```bash
grep -rni "bridgeClient\|bridge url\|bridge token\|workout-bridge\|Bridge & Sync\|bridge connection" src
```
Expected: **no output.**

```bash
grep -rni "sync" src --exclude-dir=interop
```
Expected: any hit must be a class (2) code identifier — React's `useSyncExternalStore`, `fs.readFileSync`, the word "synchronously" — never a rendered string. **Read every hit; do not skim.** AC2.7 is about user-visible strings and this grep cannot make that distinction for you.

```bash
grep -rni "syncService\|syncNow\|importRoutines\|sync-layer\|layer 1" src --exclude-dir=interop
```
Expected: **no output.** This catches the dead-feature vocabulary that the word "sync" alone misses inside prose comments — it is how the `upsertRoutine` "layer 1" comment was found. Inside `src/interop` the same grep legitimately hits `parse.ts:159`, `migrate.test.ts:96`, and `roundtrip.test.ts:936-937`; all three are the knowingly-stranded sites recorded in phase_03.md.

```bash
grep -rn "bridge_settings" src
```
Expected: `SETTINGS_KEY` in `src/state/settings.ts`, **plus `settings.test.ts`'s surviving `fakeStorage.bridge_settings` harness accesses** (~15 remain after Phase 2 Task 4 deletes its Group A block). All are deliberate and must **not** be removed — renaming the key orphans every existing user's API key and resets their onboarding.

**Step 4: Simulator pass (AC6.4, AC6.5)**

Follow the project's `running-in-simulator` skill. AGENTS.md is explicit that `src/app` and `src/components` are covered by no jest project, and this phase edited two screens, so a green suite proves nothing about them.

**Start Metro with `npx expo start --clear`.** Task 6b edited `.lv` rule files, and Metro's transform cache keys on the importing TS file rather than the `.lv` content (AGENTS.md engine convention 4) — without `--clear`, different modules can hold mixed old and new copies of the rules.

1. **AC6.4** — start a routine, log sets, complete the session. No sync-related console error. The session appears in History.
2. **AC6.5** — open Settings → AI, enter and save an API key, leave the screen and return. The key persists. This is the specific proof that the `'bridge_settings'` storage key still resolves after Phase 2 narrowed the type — if the key had been renamed, this is where it would surface.
3. **AC2.5** — trigger the abandon confirmation on a live session and read the new copy on screen.
4. **AC2.6** — with no routines present, view the Today tab empty state.

Screenshot the abandon dialog, the Today empty state, and the Settings → AI screen with a saved key. Those three are the evidence for AC2.5, AC2.6, and AC6.5, none of which any automated test covers.

**Step 5: Final read-through**

Read `AGENTS.md` start to finish. It is the file most likely to have been left internally inconsistent by six separate edits — a surviving cross-reference to a deleted section will not show up in any grep. Check in particular that nothing still points at the Sync section or the Two-repo split.

**Done when:** every command above is clean, the simulator pass is complete with three screenshots, and the AGENTS.md read-through found no dangling references.
<!-- END_TASK_8 -->

---

## Phase exit criteria

- `npm test`, `npx tsc --noEmit`, `npm run lint` all pass (**AC6.1, AC6.2, AC6.3** — asserted at every phase boundary rather than claimed by one phase's AC Coverage section, matching how the design scopes them).
- `grep -rni "vault import\|vault-import\|vault sync" src` returns nothing. *(The dead-path check. A bare `grep -rni "vault" src --exclude-dir=interop` legitimately returns the seven format-name lines Task 6b item 12 keeps — do not treat those as failures.)*
- `grep -rni "bridgeClient\|bridge url\|bridge token\|workout-bridge\|Bridge & Sync\|bridge connection" src` returns nothing. *(A bare `grep -rni "bridge" src` returns ~29 surviving `BridgeSettings` / `'bridge_settings'` hits. **Never resolve that by renaming the type or the key.**)*
- `grep -rni "sync" src --exclude-dir=interop` returns only code identifiers, no rendered strings.
- `grep -rn "vault" src/engine/rules` returns nothing.
- `grep -rn "bridge-token-12345\|bridge.local" src` returns nothing.
- `src/interop` is excluded throughout by Phase 3's AC4.1 decision, not by oversight.
- AGENTS.md has no Two-repo split section, no Sync section, no `src/sync/` Structure entry, and no `../workout-bridge` mirror rule.
- AGENTS.md "Last verified" is today's date.
- Simulator: session completes clean, Settings → AI saves and persists a key.

The change is complete. `src/interop` and `src/export` remain green and unwired, ready for the Excel backup work.
