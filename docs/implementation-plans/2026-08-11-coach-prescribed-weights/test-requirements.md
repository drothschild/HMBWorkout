# Coach-Prescribed Weights — Test Requirements

Maps every acceptance criterion in `docs/design-plans/2026-08-11-coach-prescribed-weights.md` to either an automated test or a documented human verification.

**Generated:** 2026-08-11. **Revised:** 2026-08-11 after review. **Design:** `coach-prescribed-weights`. **Phases:** 5.

---

## Read this first: three facts that shape everything below

### 1. `main` is green, and so is every gate

Verified at `eb0afe0`: **86 suites, 1582 tests, all passing.** An earlier revision of this document carved out 12 pre-existing failures in `src/interop/migrate.test.ts`; #219/#220 deleted that stale vault-backed suite. **Every gate below is now plain, unqualified green.** A failure in any suite is yours.

### 2. Three existing tests pin values this change edits, and each one is expected work

`tsc --noEmit` staying clean is not the whole greenness story. Every widened type here gains an *optional* field, so no type consumer breaks — but three assertions pin **current values**:

| Assertion | Breaks in | Remedy |
|---|---|---|
| `src/db/migrations.test.ts:11` — `expect(databaseSchema.version).toBe(4)` | Phase 1 | rebump to `5`, retitle (the title names v4's reason for existing) |
| `src/db/migrations.test.ts:59-73` — v1-walk enumerates exactly two steps | Phase 1 | append `'routine_exercises.target_weight_kg'`; **do not** relax to a length check |
| `src/ai/provider/subset.test.ts:370` — `toMatchInlineSnapshot` of `AI_TURN_SCHEMA` | Phase 2 | reviewed `jest -u`, diff pasted into the PR |

⚠ The middle one is the instructive case: **it fails because the migration was written correctly.** A v5 `addColumns` step makes the array three elements. An implementer who "fixes" it by giving v5 `steps: []` gets a green suite and breaks every upgrading install.

⚠ The third is a deliberate tripwire, committed to git precisely so a schema edit shows as a reviewable diff. Failing it is the mechanism working, not a signal that the edit was wrong.

**Sweep result for everything else:** only two inline snapshots exist in the whole repo (`AI_TURN_SCHEMA` and `ALTERNATES_SCHEMA`; the latter is untouched), no test asserts a `_raw` object by equality, no test enumerates `routine_exercises`' columns, and `sessionPresenter.test.ts`'s `toEqual` prefill assertions are unaffected because this change adds no new *output* field. Each phase's task list nonetheless carries the same instruction: grep for value pins on anything it edits.

### 3. The coverage boundary

`jest.config.js` runs **one `node` project**. Its `testMatch` globs
`src/{engine,db,interop,state,health,helpers,ai,theme,watch,components,export}`.

- **`src/app/` is not in the glob at all.** `src/app/session.tsx` — where this feature becomes true
  for a user — is invisible to every suite. AGENTS.md: *"a green run proves nothing about it."*
- **`src/components/` is in the glob but has no RN environment**, so nothing renders. This change
  touches no component anyway.
- **DB tests run on LokiJS**, not SQLite (`createTestDatabase`). Any criterion about a real SQLite
  migration is out of reach by construction.

Consequence: **5 of 40 criteria are human-verified**, and they are the five that matter most to a user. That is the shape of the codebase, not a gap to be closed by writing more tests.

This change is unusually well-placed against that boundary: the behavioural heart (`computeSetPrefill`) is a pure function in `src/state`, and the contract work is all in `src/db` and `src/ai`. Only the final wiring escapes — and even there, Phase 5 deliberately pushes the swap-ordering mechanism down into `src/state/exerciseReplaceStore.ts` so that the safety property AC6.5 checks by hand has an automated test (AC6.7) underneath it.

---

## Automated coverage

### coach-prescribed-weights.AC1 — A prescription persists on a routine entry

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC1.1** | unit | `src/db/migrations.test.ts` | Read `databaseSchema.version === 5` and the `target_weight_kg` column (`type: 'number'`, `isOptional: true`) **off the imported schema object**. Do not re-derive the shape. ⚠ This *is* the existing assertion at `:11`, rebumped from 4 to 5 — retitle it too, the current title names v4's reason for existing. Phase 1 Task 1. |
| **AC1.2** | unit *(partial)* | `src/db/migrations.test.ts` | `stepsForMigration({ migrations, fromVersion: 4, toVersion: 5 })` returns **one** step with `type: 'add_columns'`, `table: 'routine_exercises'`, column `target_weight_kg`. ⚠ **Assert the step's content, not merely that it does not throw** — a "does not throw" test passes against an empty-`steps` regression, which is the exact mistake this migration guards against (v4 legitimately uses `steps: []`). **Partial:** the suite runs on LokiJS, so this proves the migration list is well-formed, not that a SQLite file upgrades. That half is **H1**. ⚠ The v1-walk at `:59-73` also needs `'routine_exercises.target_weight_kg'` appended — it fails *because* the step is real. Do not relax it to a length check or `toContain`; the ordered array is what catches a missing or misordered step. Phase 1 Task 1. |
| **AC1.3** | unit | `src/db/repository.test.ts` | `upsertRoutine` creating a row from `targetWeightKg: 83.91` stores and reads back `83.91`. Phase 1 Task 3. |
| **AC1.4** | unit | `src/db/repository.test.ts` | Re-upserting the same routine+exercise with `targetWeightKg` omitted clears the column **and the row id is unchanged**. ⚠ Both halves required. A test asserting only the cleared value passes against a delete-and-recreate regression, which orphans every set referencing that row via `session_sets.routine_exercise_id`. Phase 1 Task 3. |
| **AC1.5** | unit | `src/db/repository.test.ts` | Three entries at orders 0/1/2, prescriptions on 0 and 2 only. Map has exactly those two keys with the right kg values; `map.size === 2`. Phase 1 Task 5. |
| **AC1.7** | unit | `src/db/repository.test.ts` | On the same fixture, `map.has(1) === false`. ⚠ **Use `has`, not `get`** — `get` returns `undefined` for a missing key *and* for a key mapped to `undefined`, so only `has` distinguishes "omitted" from "present but falsy", which is the entire content of this criterion. Phase 1 Task 5. |
| **AC1.6** | unit | `src/db/repository.test.ts` | After `updateRoutineExerciseExerciseId`, `targetWeightKg` is null **and** `targetSets`, `targetReps`, `restSeconds`, `warmupSets`, `supersetGroup` all still hold their original values. ⚠ The second half is the real test: it pins this as a one-column exception rather than a general row reset. Phase 1 Task 4. |

### coach-prescribed-weights.AC2 — The coach can prescribe a weight

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC2.1** | unit | `src/ai/draftSchema.test.ts` | `validateRoutineDraft` accepts `targetWeightLbs: 185` and the returned draft carries it. Phase 2 Task 2. |
| **AC2.2** | unit | `src/ai/draftSchema.test.ts` | Accepts `187.5`. Phase 2 Task 2. |
| **AC2.3** | unit | `src/ai/draftSchema.test.ts` | Rejects `0` with `DraftValidationError`. Phase 2 Task 2. |
| **AC2.4** | unit | `src/ai/draftSchema.test.ts` | Rejects a negative value. Phase 2 Task 2. |
| **AC2.5** | unit | `src/ai/draftSchema.test.ts` | Rejects `185.3` (off the 0.5 grid). Phase 2 Task 2. |
| **AC2.6** | unit | `src/ai/draftSchema.test.ts` | Rejects the string `'185'`. ⚠ Assert the error **type**, not its message — wording is not a contract. Phase 2 Task 2. |
| **AC2.7** | unit | `src/ai/draftSchema.test.ts` | `expectStructuredOutputSafe(AI_TURN_SCHEMA)` **already exists** at lines 934 and 1013 — it covers the first half for free. Add an assertion that the field's schema node equals `{ type: 'number' }`: the generic guard passes just as happily on `{ type: 'integer' }`, which silently forbids every half-pound value the bound exists to allow. ⚠ This is the criterion protecting against the PR #71 class of failure — a bound keyword 400s the whole request before the model runs, so it presents as a transport error, not a validation bug. Phase 2 Task 1. |
| **AC2.8** | unit (exact string) | `src/ai/contextBuilder.test.ts` | `toContain('targetWeightLbs: the load to lift, in pounds; when present, must be a positive number in steps of 0.5')`, matching the pinning style at lines 62 and 87. Phase 2 Task 3. |
| **AC2.9** | unit (exact string) | `src/ai/contextBuilder.test.ts` | `toContain('All numeric values must be integers, except targetWeightLbs, which may use 0.5 steps')`. ⚠ The original line (`- All numeric values must be integers`) is currently pinned by **nothing**, so without this new assertion the contradiction can silently return. Phase 2 Task 3. |
| **AC2.10** | integration | `src/ai/acceptDraft.test.ts` | A draft with `targetWeightLbs: 185` writes `targetWeightKg === 83.91`. ⚠ **Hard-code `83.91`.** `expect(row.targetWeightKg).toBe(lbsToKg(185))` is a tautology that passes even if `lbsToKg` is broken. Phase 2 Task 4. |
| **AC2.11** | integration | `src/ai/acceptDraft.test.ts` | A draft omitting the field writes null/absent — proving `undefined` passes through `upsertRoutine`'s create branch rather than being coerced to 0. Phase 2 Task 4. |

### coach-prescribed-weights.AC3 — The coach reads its prescription back

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC3.1** | unit | `src/state/routineDetailPresenter.test.ts` | Two entries, one prescribed at `83.91` and one not. The first's `targetWeightKg` is `83.91`; the second's is **falsy**. ⚠ Do not assert the second is exactly `undefined` — this presenter passes WatermelonDB's raw `null` through without normalization, so pinning `undefined` pins behaviour the code does not have. Phase 3 Task 1. |
| **AC3.2** | unit | `src/ai/contextBuilder.test.ts` | The prompt contains `'@ 185lbs'` for an entry stored at `83.91`. ⚠ Assert the **rendered lbs string**, never the kg number — asserting `'83.91'` would pass even if the conversion were dropped, which is the whole thing this criterion protects. Phase 3 Task 2. |
| **AC3.3** | unit | `src/ai/contextBuilder.test.ts` | An unprescribed entry renders no weight segment **and** still renders its existing segments. ⚠ Scope the negative assertion: `'@ '` also appears in the Recent Training History section, so a whole-prompt `not.toContain('@ ')` fails for the wrong reason on any fixture with logged sets. Extract the routine section, or build a history-free fixture. Phase 3 Task 2. |

### coach-prescribed-weights.AC4 — The prescription overrides history in the prefill

All in `src/state/sessionPresenter.test.ts`, all pure unit tests. This is the best-covered part of the change. Phase 4 Task 2.

Conversion pairs to use: `lbsToKg(185) = 83.91`, `kgToLbs(83.91) = 185`, `kgToLbs(79.38) = 175`.

| AC | Type | What it must verify |
|---|---|---|
| **AC4.1** | unit | No logged sets; `historyFallback = { reps: 8, weightLbs: 175 }`; prescription `83.91`. Result's `weightLbs` is `185`. |
| **AC4.2** | unit | **Same single invocation as AC4.1** — `reps` is still `8`. ⚠ Assert both against one call, not two fixtures: the criterion is that the override is field-scoped, and two separate calls cannot demonstrate that. |
| **AC4.3** | unit | A logged in-session set at `weightKg: 79.38` plus prescription `83.91` → `weightLbs` is `175`. The in-session set wins. |
| **AC4.4** | unit | Prescription only, no history, `entry.targetReps = 5` → `{ weightLbs: 185, reps: 5 }`. |
| **AC4.5** | unit | A duration-based entry with a prescription → result carries `durationSeconds` and **no** `weightLbs`. ⚠ Read `isDurationBasedEntry` in `src/state/exerciseStopwatch.ts` and build the fixture to match its actual predicate; guessing produces a test that exercises the strength path while claiming to test the duration one. |
| **AC4.6** | unit | `computeSetPrefill(state, fallback)` deep-equals `computeSetPrefill(state, fallback, undefined)` deep-equals `computeSetPrefill(state, fallback, 0)`. ⚠ Write it as a **comparison between calls**, not as three copies of an expected literal — that states the invariant instead of restating one value, and survives a legitimate change to the fixture. |
| **AC4.7** | unit | Covered by AC4.1 expecting `185`. Add an explicit assertion that the returned `weightLbs` is **not** `83.91`, so a dropped conversion cannot pass. |
| **AC4.8** | unit | An in-session set that contributed **nothing usable** (reps `0`/null, weight null) plus `historyFallback = { reps: 8, weightLbs: 175 }` plus prescription `83.91` → `{ reps: 8, weightLbs: 185 }`. ⚠ **This is the criterion that catches the ordering bug found in review.** An implementation that applies the prescription *before* computing `inSessionContributed` returns `{ weightLbs: 185 }` and silently drops the history reps — a whole-object override by accident, in exactly one branch. Nothing else catches it: AC4.6 only exercises the no-prescription path, and the extra reps-but-no-weight case uses a set that *did* contribute. A set logged with zero reps is a real action; `src/interop/parse.ts`'s context rules exist because of it. |

**Plus one case not in the AC list**, specified in Phase 4 Task 2 Step 3 and worth keeping: an in-session set with **reps but no weight**, plus a prescription → reps from the set, weight from the prescription. That is the partial-fill branch through the in-session block, and it is the one most likely to be broken by a later "simplification".

### coach-prescribed-weights.AC5 — Nothing that exists today changes

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC5.1** | suite + static | `src/state/sessionPresenter.test.ts` | Every pre-existing assertion passes **with the file unmodified**. Verified mechanically, not by trust: `git diff origin/main -- src/state/sessionPresenter.test.ts \| grep '^-' \| grep -v '^---'` must return **nothing** — this phase only adds lines. Any deleted or changed line means a pre-existing assertion was edited to accommodate the new behaviour, which falsifies the criterion. Phase 4 Tasks 2 & 3. |
| **AC5.3** | static | — | `git diff origin/main --stat -- src/engine` returns nothing, and `git diff origin/main -- src/engine/types.ts` returns nothing. ⚠ This is the check that the biggest trap in the feature was avoided: adding `targetWeightKg` to the TS `RoutineEntry` compiles cleanly and then **silently drops the value on the first `dispatch`**, because the Rill record is closed (engine convention 6). Phase 4 Task 3. |
| **AC5.2** | — | — | **Human — H2.** |

### coach-prescribed-weights.AC6 — Cross-cutting

| AC | Command | When |
|---|---|---|
| **AC6.1** | `npx tsc --noEmit` | every phase boundary |
| **AC6.2** | `npm test` — **plain green, every suite, no carve-out** | every phase boundary |
| **AC6.3** | `npm run lint` | every phase boundary |
| **AC6.4 – AC6.6** | — | **Human — H3, H4, H5.** |
| **AC6.8** | — | **Human — H6.** |

**AC6.7** is automated, and it is the one criterion in Phase 5 a test can actually reach:

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC6.7** | unit | `src/state/exerciseReplaceStore.test.ts` | Four cases, using the file's existing injected-`ExerciseReplaceDeps` setup. **(a)** a successful `replace()` leaves `routineRevision` one higher. **(b)** the injected `applyToRoutine` records `routineRevision` at call time, and that recorded value equals the *pre-swap* value — proving the bump had not happened when the write started. **(c)** an engine rejection (`dispatch` resolves `null`) leaves it unchanged. **(d)** a thrown `applyToRoutine` leaves it unchanged. ⚠ **(b) is the assertion that pins the contract.** A test checking only that the counter ended up higher passes against an implementation that bumps *before* the await — which is the bug, because it announces a clear that has not happened and the effect re-reads the stale prescription. Phase 5 Task 1. |

---

## Human verification

Six items. Each names *why* it cannot be automated.

### Real SQLite — the suite runs on LokiJS

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H1** | **AC1.2** | **Install over an existing v4 install — do not uninstall first.** Uninstalling destroys the v4 database and turns this into a fresh-install test, proving nothing about the migration. Back up `hmbworkout.db` first via `xcrun devicectl device copy from … --source Documents` (Release builds keep `get-task-allow`, so this works). Launch: must open without throwing. Then open a pre-existing routine and confirm its data is intact. | launch log + screenshot |

### Screens — no jest project covers `src/app/`

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H2** | **AC5.2** | On the **upgraded** install from H1: open a routine that existed before this change, start it, arrive at an exercise with logged history. The weight field prefills from history exactly as before. Log sets and complete normally. *(Why human: `src/app/session.tsx` is outside every jest project. AC5.1 proves the pure function is unchanged; only this proves the screen still calls it correctly.)* | screenshots before/after |
| **H3** | **AC6.4** | Log a working set at a distinctive load (135 lbs) and finish that session so it becomes history. Ask the coach for a routine with that exercise at a clearly different prescribed load (185). Accept, start, observe the weight field. **Expected: 185, not 135.** ⚠ **This scenario cannot fail on the phase's most likely bug** — see H6. It proves the prescription *outranks* history; it says nothing about whether the prescription survives when there is no history, because its fixture has history by construction. ⚠ Do not judge on the first frame — the synchronous prefill pass renders before the DB reads resolve, so a value that appears and then changes to 185 is correct. If the number looks wrong, read ground truth: `select "order", exercise_id, target_weight_kg from routine_exercises where routine_id = '…';` — a stored `83.91` rendering as `185` is right; a stored `185` means `acceptDraft` skipped the lbs→kg conversion. | SetLogger screenshot + coach draft screenshot |
| **H4** | **AC6.5** | Start the prescribed routine. On the prescribed exercise, **before logging any set**, tap Replace and accept an alternate. The weight field must no longer show 185 — it shows the substitute's own history, or is empty. *(Why this is the safety case: a prescription **overrides** history, so a stale one does not quietly lose to the substitute's correct numbers — it wins over them and pre-types an impossible load. AC1.6 proves the column is cleared; only this proves the screen re-reads it.)* ⚠ **A pass here is weaker evidence than it looks.** The effect's read races the swap's write off the same dispatch (`exerciseReplaceStore.ts:239` vs `:252`), so before Phase 5 Task 1's `routineRevision` counter this check would pass or fail on whichever side won that run. **AC6.7 is what actually pins the ordering**; treat H4 as confirmation, not proof. If it fails, suspect the counter wiring before Phase 1's clear. | screenshots before/after the swap |
| **H5** | **AC6.6** | Open the AI Coach in edit mode on the prescribed routine (or use the post-workout debrief). Ask what weight it programmed. It answers with the prescribed number, in lbs. *(Exercises the Phase 3 read path end to end: `routineDetailPresenter` → `formatExerciseLine` → prompt. AC3.2 proves the string is built; only this proves it reaches a real request.)* | screenshot of the exchange |
| **H6** | **AC6.8** | Ask the coach for a routine containing an exercise **you have never logged a set for** — a brand-new movement name, or a fresh install — with a prescribed weight (95). Accept, then **confirm there is genuinely no history** with `select count(*) from session_sets where exercise_id = '<slug>';` (expect `0`; if not, pick a different exercise). Start the routine and arrive at that exercise. **Expected: the field opens at 95.** *(Why this exists: `session.tsx:217`'s `if (cancelled \|\| !latest) return;` fires when history is empty. An implementation that threads `prescribedWeightKg` into `computeSetPrefill` but leaves that early return in place **passes H3, passes the whole suite, and does nothing on every new coach-authored routine** — the single most likely way to get Phase 5 wrong. H3's fixture structurally cannot detect it. Nothing under `src/app/` is testable, so this manual check is the only line of defence.)* | SetLogger screenshot + the `count(*) = 0` query output (both required — without the query the screenshot does not distinguish this from H3) |

---

## Traps

Ten places where a test can pass while the thing it names is broken. Seven were identified while writing this plan; three (8–10) came out of review.

1. **A migration test that only asserts "does not throw."** It passes against a `steps: []` regression — and `steps: []` is *correct* for v4, sitting right above v5 in the same file, which is exactly why someone will copy it. Assert the step's `type`, `table` and column name.
2. **`map.get(1)` instead of `map.has(1)` for AC1.7.** `get` returns `undefined` for both "omitted" and "present but undefined". Only `has` tests the criterion.
3. **A swap test that only checks the weight is gone.** It passes against a change that resets the whole row and silently discards `targetSets`/`targetReps`/`restSeconds`. Assert the survivors.
4. **`expect(x).toBe(lbsToKg(185))`.** A tautology. Hard-code `83.91`.
5. **A whole-prompt `not.toContain('@ ')` for AC3.3.** The history section uses the same prefix; the test fails for the wrong reason on any fixture with logged sets.
6. **Editing an existing `sessionPresenter.test.ts` assertion to make it pass.** AC5.1 is the guarantee that pre-v5 routines are unaffected, and it is checked by a `git diff` for removed lines precisely because a green suite proves nothing when the suite was edited.
7. **`tsc` clean ≠ the value survives.** Adding `targetWeightKg` to `src/engine/types.ts`'s `RoutineEntry` type-checks perfectly and then vanishes on the first `dispatch`, because the Rill `RoutineEntry` alias is a closed record and `fromRillState` rebuilds entries field-by-field. Nothing but AC5.3's `git diff` catches this before the simulator does.
8. **A human scenario whose setup guarantees the failure mode cannot occur.** H3 was written with history present, which is exactly when the early return it was meant to catch does not fire. H6 exists because of it. Apply the same question to every manual step you write: *could this scenario actually fail if the bug were present?*
9. **`tsc` clean ≠ suite green.** The "every widened field is optional" argument covers type consumers only. Three assertions pin current *values* (§2 above), and two of them fail in phases whose plans originally said "all tests pass".
10. **A counter test that only checks the counter moved.** AC6.7(a) alone passes against a `routineRevision` bumped *before* the write it exists to sequence after. (b) — recording the value from inside the injected `applyToRoutine` — is the assertion that pins it.

---

## Coverage summary

| Group | Criteria | Automated | Human |
|---|---|---|---|
| AC1 — prescription persists | 7 | 7 (1 partial) | +H1 (the SQLite half of AC1.2) |
| AC2 — coach can prescribe | 11 | 11 | 0 |
| AC3 — coach reads it back | 3 | 3 | 0 |
| AC4 — prefill precedence | 8 | 8 | 0 |
| AC5 — nothing else changes | 3 | 2 | 1 (H2) |
| AC6 — cross-cutting | 8 | 4 | 4 (H3–H6) |
| **Total** | **40** | **35** | **5** (+H1 as a partial's other half) |

Every criterion is claimed by exactly one phase. Net automated coverage **increases** over this change: 35 automated assertions, concentrated in `src/db`, `src/ai` and `src/state`, with only the final screen wiring escaping into manual territory.

The five human items are not leftovers. They are the five things a user would notice: that an old routine still works, that the prescription beats history on screen, that it still arrives when there is no history at all, that a swap does not leave a dangerous load in the field, and that the coach can see what it programmed.

**Two of the review's findings changed this table's shape, not just its numbers.** AC4.8 exists because a precedence bug was found by reading the plan's own code sample, not by any criterion it had already written. AC6.7 exists because the swap's ordering could not be settled statically — so rather than leaving the safety case resting on a manual check that races, the mechanism moved into a jest-covered module and became a test. That second move is the pattern to reach for whenever a phase's only verification would otherwise be a simulator run.
