# Coach-Prescribed Weights — Test Requirements

Maps every acceptance criterion in `docs/design-plans/2026-08-11-coach-prescribed-weights.md` to either an automated test or a documented human verification.

**Generated:** 2026-08-11. **Design:** `coach-prescribed-weights`. **Phases:** 5.

---

## Read this first: two facts that shape everything below

### 1. `npm test` is already red on `origin/main`

Verified at `b6f8a6d` with a clean worktree: **12 failures, all in `src/interop/migrate.test.ts`.**

They are vault-backed tests gated on an Obsidian vault directory existing. On CI and most machines the gate `describe.skip`s them. On the maintainer's machine the directory still exists while its files have been renamed — the helper resolves `"* Push.md"`, the vault now holds `"Push 2026-07-08 0935.md"` — so `resolveRoutineFile` throws. They are dead weight left by the vault-sync removal in #214.

**No phase in this plan can honestly claim "npm test passes."** Every gate is worded as *no failing suite other than `src/interop/migrate.test.ts`*. Confirm the baseline yourself before blaming your own change:

```bash
git stash && npm test 2>&1 | tail -5 && git stash pop
```

Deleting that suite is out of scope here and belongs on the board.

### 2. The coverage boundary

`jest.config.js` runs **one `node` project**. Its `testMatch` globs
`src/{engine,db,interop,state,health,helpers,ai,theme,watch,components,export}`.

- **`src/app/` is not in the glob at all.** `src/app/session.tsx` — where this feature becomes true
  for a user — is invisible to every suite. AGENTS.md: *"a green run proves nothing about it."*
- **`src/components/` is in the glob but has no RN environment**, so nothing renders. This change
  touches no component anyway.
- **DB tests run on LokiJS**, not SQLite (`createTestDatabase`). Any criterion about a real SQLite
  migration is out of reach by construction.

Consequence: **4 of 28 criteria are human-verified**, and they are the four that matter most to a user. That is the shape of the codebase, not a gap to be closed by writing more tests.

This change is unusually well-placed against that boundary: the behavioural heart (`computeSetPrefill`) is a pure function in `src/state`, and the contract work is all in `src/db` and `src/ai`. Only the final wiring escapes.

---

## Automated coverage

### coach-prescribed-weights.AC1 — A prescription persists on a routine entry

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC1.1** | unit | `src/db/migrations.test.ts` | Read `databaseSchema.version === 5` and the `target_weight_kg` column (`type: 'number'`, `isOptional: true`) **off the imported schema object**. Do not re-derive the shape. Phase 1 Task 1. |
| **AC1.2** | unit *(partial)* | `src/db/migrations.test.ts` | `stepsForMigration({ migrations, fromVersion: 4, toVersion: 5 })` returns **one** step with `type: 'add_columns'`, `table: 'routine_exercises'`, column `target_weight_kg`. ⚠ **Assert the step's content, not merely that it does not throw** — a "does not throw" test passes against an empty-`steps` regression, which is the exact mistake this migration guards against (v4 legitimately uses `steps: []`). **Partial:** the suite runs on LokiJS, so this proves the migration list is well-formed, not that a SQLite file upgrades. That half is **H1**. Phase 1 Task 1. |
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
| **AC6.2** | `npm test` — **no failing suite other than `src/interop/migrate.test.ts`** | every phase boundary |
| **AC6.3** | `npm run lint` | every phase boundary |
| **AC6.4 – AC6.6** | — | **Human — H3, H4, H5.** |

---

## Human verification

Five items. Each names *why* it cannot be automated.

### Real SQLite — the suite runs on LokiJS

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H1** | **AC1.2** | **Install over an existing v4 install — do not uninstall first.** Uninstalling destroys the v4 database and turns this into a fresh-install test, proving nothing about the migration. Back up `hmbworkout.db` first via `xcrun devicectl device copy from … --source Documents` (Release builds keep `get-task-allow`, so this works). Launch: must open without throwing. Then open a pre-existing routine and confirm its data is intact. | launch log + screenshot |

### Screens — no jest project covers `src/app/`

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H2** | **AC5.2** | On the **upgraded** install from H1: open a routine that existed before this change, start it, arrive at an exercise with logged history. The weight field prefills from history exactly as before. Log sets and complete normally. *(Why human: `src/app/session.tsx` is outside every jest project. AC5.1 proves the pure function is unchanged; only this proves the screen still calls it correctly.)* | screenshots before/after |
| **H3** | **AC6.4** | Log a working set at a distinctive load (135 lbs) and finish that session so it becomes history. Ask the coach for a routine with that exercise at a clearly different prescribed load (185). Accept, start, observe the weight field. **Expected: 185, not 135.** ⚠ Do not judge on the first frame — the synchronous prefill pass renders before the DB reads resolve, so a value that appears and then changes to 185 is correct. If the number looks wrong, read ground truth: `select "order", exercise_id, target_weight_kg from routine_exercises where routine_id = '…';` — a stored `83.91` rendering as `185` is right; a stored `185` means `acceptDraft` skipped the lbs→kg conversion. | SetLogger screenshot + coach draft screenshot |
| **H4** | **AC6.5** | Start the prescribed routine. On the prescribed exercise, **before logging any set**, tap Replace and accept an alternate. The weight field must no longer show 185 — it shows the substitute's own history, or is empty. *(Why this is the safety case: a prescription **overrides** history, so a stale one does not quietly lose to the substitute's correct numbers — it wins over them and pre-types an impossible load. AC1.6 proves the column is cleared; only this proves the screen re-reads it.)* | screenshots before/after the swap |
| **H5** | **AC6.6** | Open the AI Coach in edit mode on the prescribed routine (or use the post-workout debrief). Ask what weight it programmed. It answers with the prescribed number, in lbs. *(Exercises the Phase 3 read path end to end: `routineDetailPresenter` → `formatExerciseLine` → prompt. AC3.2 proves the string is built; only this proves it reaches a real request.)* | screenshot of the exchange |

---

## Traps

Seven places where a test can pass while the thing it names is broken. Each was identified while writing this plan.

1. **A migration test that only asserts "does not throw."** It passes against a `steps: []` regression — and `steps: []` is *correct* for v4, sitting right above v5 in the same file, which is exactly why someone will copy it. Assert the step's `type`, `table` and column name.
2. **`map.get(1)` instead of `map.has(1)` for AC1.7.** `get` returns `undefined` for both "omitted" and "present but undefined". Only `has` tests the criterion.
3. **A swap test that only checks the weight is gone.** It passes against a change that resets the whole row and silently discards `targetSets`/`targetReps`/`restSeconds`. Assert the survivors.
4. **`expect(x).toBe(lbsToKg(185))`.** A tautology. Hard-code `83.91`.
5. **A whole-prompt `not.toContain('@ ')` for AC3.3.** The history section uses the same prefix; the test fails for the wrong reason on any fixture with logged sets.
6. **Editing an existing `sessionPresenter.test.ts` assertion to make it pass.** AC5.1 is the guarantee that pre-v5 routines are unaffected, and it is checked by a `git diff` for removed lines precisely because a green suite proves nothing when the suite was edited.
7. **`tsc` clean ≠ the value survives.** Adding `targetWeightKg` to `src/engine/types.ts`'s `RoutineEntry` type-checks perfectly and then vanishes on the first `dispatch`, because the Rill `RoutineEntry` alias is a closed record and `fromRillState` rebuilds entries field-by-field. Nothing but AC5.3's `git diff` catches this before the simulator does.

---

## Coverage summary

| Group | Criteria | Automated | Human |
|---|---|---|---|
| AC1 — prescription persists | 7 | 7 (1 partial) | +H1 (the SQLite half of AC1.2) |
| AC2 — coach can prescribe | 11 | 11 | 0 |
| AC3 — coach reads it back | 3 | 3 | 0 |
| AC4 — prefill precedence | 7 | 7 | 0 |
| AC5 — nothing else changes | 3 | 2 | 1 (H2) |
| AC6 — cross-cutting | 6 | 3 | 3 (H3–H5) |
| **Total** | **37** | **33** | **4** (+H1 as a partial's other half) |

Every criterion is claimed by exactly one phase. Net automated coverage **increases** over this change: 33 new automated assertions, concentrated in `src/db`, `src/ai` and `src/state`, with only the final screen wiring escaping into manual territory.

The four human items are not leftovers. They are the four things a user would notice: that an old routine still works, that the prescription actually beats history on screen, that a swap does not leave a dangerous load in the field, and that the coach can see what it programmed.
