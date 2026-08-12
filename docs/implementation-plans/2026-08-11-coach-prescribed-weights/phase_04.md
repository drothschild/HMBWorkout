# Coach-Prescribed Weights — Phase 4: Prefill precedence

**Goal:** The pure precedence rule — a prescription beats cross-session history, loses to this session's own set, and touches the weight field only.

**Architecture:** `computeSetPrefill` is a pure function in the imperative shell's presenter layer, and it is the behavioural heart of this feature. It gains an optional third parameter carrying the prescription in kg. The precedence chain becomes: this session's last set for the exercise → the prescription (weight only) → the caller's cross-session history fallback → the routine's `targetReps`. The parameter is optional and the function is byte-equivalent when it is omitted, which is what lets this phase land on `main` alone and what guarantees every existing routine behaves exactly as it does today.

**Tech Stack:** TypeScript, Jest (`node` project). No database, no React — this file is pure and fully covered.

**Scope:** Phase 4 of 5 from `docs/design-plans/2026-08-11-coach-prescribed-weights.md`.

**Depends on:** Nothing technically — the parameter is optional and self-contained. Meaningless before Phase 1 supplies a value; wired up in Phase 5.

**Codebase verified:** 2026-08-11 against `origin/main` @ `eb0afe0` (rebased after #220), by direct read of `src/state/sessionPresenter.ts` in full.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-prescribed-weights.AC4: The prescription overrides history in the prefill
- **coach-prescribed-weights.AC4.1 Success:** With a prescription of 185 lbs and a history fallback
  of 175 lbs, `computeSetPrefill` returns `weightLbs: 185`.
- **coach-prescribed-weights.AC4.2 Success:** In that same case, `reps` still comes from the history
  fallback — the prescription overrides the weight field only.
- **coach-prescribed-weights.AC4.3 Success:** When the exercise already has a set logged this
  session, that set's weight wins over the prescription.
- **coach-prescribed-weights.AC4.4 Success:** With a prescription, no history and no in-session set,
  the result carries the prescribed `weightLbs` and `reps` from `entry.targetReps`.
- **coach-prescribed-weights.AC4.5 Edge:** For a duration-based entry (`isDurationBasedEntry`), the
  prescription is ignored and the duration path is unchanged.
- **coach-prescribed-weights.AC4.6 Edge:** A prescription argument of `undefined` or `0` leaves the
  existing precedence chain byte-identical.
- **coach-prescribed-weights.AC4.7 Success:** The returned value is in lbs — the kg prescription
  passes through `kgToLbs` exactly once.
- **coach-prescribed-weights.AC4.8 Edge:** An in-session logged set that contributed nothing usable
  (no positive reps, no positive weight) still falls through to the history fallback when a
  prescription is present — the prescription must not, by filling the weight field, make an empty
  in-session set look authoritative and suppress history's reps.
- **coach-prescribed-weights.AC4.9 Edge:** A history fallback that is present but contributes nothing
  usable (e.g. `{ reps: 0 }`) still falls through to the routine's `targetReps` when a prescription is
  present — the prescription must not, by filling the weight field, make an empty history fallback
  look authoritative and suppress the target-reps fallback.
- **coach-prescribed-weights.AC4.10 Edge:** A history fallback carrying weight but no usable reps,
  plus a prescription, yields the prescribed weight and **no** reps — exactly the reps behaviour the
  same input produces with no prescription. The presence of a prescription never changes the reps
  field.
- **coach-prescribed-weights.AC4.11 Structural:** No non-terminal return in `computeSetPrefill` is
  gated on `Object.keys(prefill).length`. Each non-terminal return's condition is computed from its
  own source (the logged set, or `historyFallback`), never from the accumulating `prefill` object.

### coach-prescribed-weights.AC5: Nothing that exists today changes
- **coach-prescribed-weights.AC5.1 Success:** Every pre-existing assertion in
  `src/state/sessionPresenter.test.ts` passes unmodified, proving the added parameter is
  behaviour-neutral when omitted.
- **coach-prescribed-weights.AC5.3 Success:** `git diff origin/main --stat` shows no file under
  `src/engine/` changed, and `src/engine/types.ts`'s `RoutineEntry` is untouched.

---

## Investigation findings

### 1. Do not put the prescription in engine state — this is the single biggest trap in the feature

The obvious-looking move is to add `targetWeightKg` to `RoutineEntry` in `src/engine/types.ts:10-20`, next to `targetSets` and `targetReps`, so `computeSetPrefill` can read it straight off `entry`. **Do not.**

- The Rill `RoutineEntry` alias (`src/engine/rules/types.lv`) is a **closed record**.
  `toRillRoutineEntry` and `fromRillState` rebuild entries field-by-field in both directions, so a
  field added to the TS type but not the `.lv` alias **survives until the first `dispatch` and then
  silently vanishes** (AGENTS.md engine convention 6). The bug looks like "the prescription works
  until you log a set."
- Doing it *properly* means editing `types.lv`, both mapping functions, the sentinel map in
  `engine/index.ts` (0-means-absent, convention 8), and the two field-copy blocks in
  `engine/index.ts` (~lines 58-62 and 139-143) — plus restarting Metro with `--clear` after any `.lv`
  edit or modules end up with mixed old/new rule copies (convention 4).
- No rule would *use* it. Load decides nothing about phase, advancement, rest or validation.
  Convention 6 exists to keep exactly this class of data out: *"Engine state carries ids, never
  display data."*

The design decided this deliberately. AC5.3 is the check that it stayed decided.

### 2. The established pattern is a caller-resolved argument

`computeSetPrefill(sessionState, historyFallback)` already takes shell-resolved per-entry data as a parameter, for exactly this reason. So does `createSessionPresenter`, with `exerciseTitles` and `routineDisplay`. The prescription is a third argument of the same kind.

### 3. `computeSetPrefill`'s current shape, and where the two early returns are

`src/state/sessionPresenter.ts:253-306`. Two `return` points inside the body matter:

- **Line 283:** `if (Object.keys(prefill).length > 0) return prefill;` — after the in-session match
  block. Reached with a partially-filled `prefill` when the logged set had, say, reps but no weight.
  Crucially, `prefill` is **the same object** on the fall-through path, so anything written before
  this line persists into the fallback blocks.
- **Line 303:** the same check after the history block.

Both are gated on `Object.keys(prefill).length > 0`, and **that is safe only in today's code**,
where `prefill` is populated exclusively by the source each branch is about. The prescription breaks
that equivalence — it writes into `prefill` from outside either branch — so both returns must be
re-gated on predicates computed from their own source. Two rounds of review found the same defect
here, one branch apart. Read Task 1 Step 3's table and bug-class note before touching either.

### 4. The `> 0` guards are the absence convention, and they are why 0 is not a prescription

Lines 274-281 and 297-302 all guard `!= null && > 0`. AGENTS.md explains why: the host maps 0 values to "not logged" on dispatch, so a prefilled 0 would silently vanish from the logged set. The prescription follows the same rule — `prescribedWeightKg` of `0` means *no prescription*, which is also why the Phase 2 validator rejects a drafted 0 and Phase 1's `getRoutineTargetWeightsKg` omits it from the map. Three layers, one convention.

### 5. Confirmed current state

- ✓ `src/state/sessionPresenter.ts:3` — `kgToLbs` already imported.
- ✓ `src/state/sessionPresenter.ts:13-19` — `SetInputValues { reps?, weightLbs?, rpe?, durationSeconds? }`.
  **No change needed**: the prescription is an input to the function, not a new output field.
- ✓ `src/state/sessionPresenter.ts:260` — `isDurationBasedEntry(entry)` from `./exerciseStopwatch`.
- ✓ `computeSetPrefill` has exactly one production caller, `src/app/session.tsx` (lines 204 and 241),
  which is wired in Phase 5. Adding an optional third parameter breaks neither call site.
- ✓ `src/state/sessionPresenter.test.ts` exists and is in `testMatch`.
- ✓ **Value-pin sweep for this phase's surface:** `computeSetPrefill` gains a *parameter*, not an
  output field, so no `toEqual` on its result can break — the returned shape is unchanged when the
  parameter is omitted. `sessionPresenter.test.ts`'s `toEqual` prefill assertions (`:473, :485, :492,
  :511, :520, :521, :532, :542, :551, :559, :560`) are exactly what AC5.1 requires to pass
  **unmodified**. No snapshot covers this module. **Nothing breaks** — and if something does, it means
  AC4.6's byte-identity claim is false, which is a bug in your implementation, not a stale pin.
- ✓ `npm test` is **green** on `origin/main` — 86 suites, 1582 tests, verified at `eb0afe0`.
  Your gate is plain green; #219/#220 deleted the vault-backed `src/interop/migrate.test.ts` that an
  earlier draft of this plan carved out.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Restructure `computeSetPrefill`

**Verifies:** `coach-prescribed-weights.AC4.1` – `coach-prescribed-weights.AC4.11` (tested in Task 2)

**Files:**
- Modify: `src/state/sessionPresenter.ts:241-306` (the docblock and the whole function body)

**Step 1: Update the docblock**

Replace the existing docblock at lines 241-252 with:

```ts
/**
 * Default input values for the next set of the current exercise.
 *
 * Precedence, highest first:
 *   1. the exercise's own last set **this session** (matched by exerciseId — the
 *      engine's LoggedSet carries no entry row id, and duplicate entries of the
 *      same movement sharing a prefill is the desired behavior)
 *   2. the coach's prescribed load, `prescribedWeightKg` — **weight only**
 *   3. the caller's cross-session history fallback (strength only)
 *   4. the routine targets
 *
 * The prescription outranking history is the point of the feature: a coach that
 * programs 185 must not be silently overruled by last week's 175, because the
 * case where they differ is the only case that matters. It does **not** outrank
 * a set logged minutes ago in this same session — that is the athlete actively
 * correcting the plan, and re-offering the prescribed load on the next set would
 * fight them.
 *
 * It is scoped to the weight field alone. With a prescription of 185 and a
 * history set of 8 x 175, the right prefill is 8 reps at 185: the coach
 * programmed the load, and the reps still come from what the athlete does.
 *
 * The prescription arrives in canonical kg and is resolved shell-side by the
 * caller, not carried in engine state — the Rill RoutineEntry is a closed record
 * that silently drops unknown fields, and no rule branches on load (engine
 * convention 6). Same reason `exerciseTitles` and `historyFallback` are
 * parameters.
 *
 * RPE is never prefilled: it is per-set perceived effort, and the -1 sentinel
 * must not leak into an input. Zero/absent metrics are omitted rather than
 * prefilled — the host maps 0 values to "not logged" on dispatch, so a prefilled
 * 0 would silently vanish from the logged set. A `prescribedWeightKg` of 0 is
 * therefore read as *no prescription*, not as a prescribed zero.
 */
```

**Step 2: Replace the function**

Replace lines 253-306 in full with:

```ts
export function computeSetPrefill(
  sessionState: SessionState,
  historyFallback?: SetInputValues,
  prescribedWeightKg?: number
): SetInputValues | undefined {
  const entry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!entry) return undefined;

  const isDurationBased = isDurationBasedEntry(entry);
  const sets = sessionState.loggedSets ?? [];

  // The prescribed load, converted to display lbs once, here. Absent for a
  // duration-based entry (there is no weight input to fill) and for any
  // non-positive value (0 means "no prescription", matching the > 0 absence
  // convention every other metric in this function uses).
  const prescribedLbs =
    !isDurationBased && prescribedWeightKg != null && prescribedWeightKg > 0
      ? kgToLbs(prescribedWeightKg)
      : undefined;

  let lastMatch: LoggedSet | undefined;
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i].exerciseId === entry.exerciseId) {
      lastMatch = sets[i];
      break;
    }
  }

  const prefill: SetInputValues = {};

  // ---- R2: this session's own last set for this exercise ----------------
  if (lastMatch) {
    // `contributed` is computed from the LOGGED SET ALONE, never from
    // `prefill`'s key count. See "The bug class" below: a return gated on
    // "prefill is non-empty" is wrong the moment the prescription can populate
    // prefill, and this function has produced that defect twice.
    let contributed = false;

    if (isDurationBased) {
      if (lastMatch.durationSeconds != null && lastMatch.durationSeconds > 0) {
        prefill.durationSeconds = lastMatch.durationSeconds;
        contributed = true;
      }
    } else {
      if (lastMatch.reps != null && lastMatch.reps > 0) {
        prefill.reps = lastMatch.reps;
        contributed = true;
      }
      if (lastMatch.weightKg != null && lastMatch.weightKg > 0) {
        prefill.weightLbs = kgToLbs(lastMatch.weightKg);
        contributed = true;
      }
    }

    if (contributed) {
      // The set the athlete just did outranks the plan, so the prescription only
      // fills a weight this session has not already established (e.g. a logged
      // set that recorded reps but no load). `prescribedLbs` is already
      // undefined for a duration-based entry, so no extra guard is needed here —
      // that decision lives at its single site above.
      if (prefill.weightLbs === undefined && prescribedLbs !== undefined) {
        prefill.weightLbs = prescribedLbs;
      }
      return prefill;
    }
    // A fully-empty logged set contributed nothing; `prefill` is still empty.
    // Fall through to the fallbacks below.
  }

  // ---- R3: duration entries have no weight and no cross-session history --
  if (isDurationBased) {
    // The history query returns working-type sets only, so targets are the only
    // fallback here.
    return entry.targetDurationSeconds > 0
      ? { durationSeconds: entry.targetDurationSeconds }
      : undefined;
  }

  // ---- The override: the prescription claims the weight field ahead of
  // ---- history. Reps are untouched and still come from history below.
  if (prescribedLbs !== undefined) prefill.weightLbs = prescribedLbs;

  // ---- R4: cross-session history ----------------------------------------
  if (historyFallback) {
    // Both predicates read `historyFallback` alone, never `prefill`. That is
    // what keeps R4's firing independent of whether a prescription exists.
    const historyHasReps = historyFallback.reps != null && historyFallback.reps > 0;
    const historyHasWeight =
      historyFallback.weightLbs != null && historyFallback.weightLbs > 0;

    if (historyHasReps) prefill.reps = historyFallback.reps;
    if (prefill.weightLbs === undefined && historyHasWeight) {
      prefill.weightLbs = historyFallback.weightLbs;
    }

    if (historyHasReps || historyHasWeight) return prefill;
  }

  // ---- R5: routine targets (terminal) ------------------------------------
  if (entry.targetReps > 0) prefill.reps = entry.targetReps;
  return Object.keys(prefill).length > 0 ? prefill : undefined;
}
```

**Step 3: Walk every return path against this table before running anything**

This function has now produced the *same* defect twice, in adjacent branches, and the second
instance arrived inside the fix for the first. Do not spot-check the branch you were told about.
Check every path against the table, then check the invariants under it.

| # | Reached when | `weightLbs` | `reps` | `durationSeconds` |
|---|---|---|---|---|
| **R1** | no current entry | — | — | — (returns `undefined`) |
| **R2** | this session's last set for this exercise contributed something | that set's weight if it had one, **else** the prescription, else absent | that set's reps if `> 0`, else absent — never history, never targets, because this set is authoritative | duration entries only: that set's duration |
| **R3** | duration-based entry, no usable in-session set | never (no weight input exists) | never | `entry.targetDurationSeconds` if `> 0`, else the whole result is `undefined` |
| **R4** | strength entry, history contributed reps and/or weight | the prescription if present, **else** history's weight if `> 0`, else absent | history's reps if `> 0`, else absent | never |
| **R5** | strength entry, nothing above returned | the prescription if present, else absent | `entry.targetReps` if `> 0`, else absent | never |

Three invariants hold across the whole table. If your code breaks any of them, it is wrong even if
the tests pass:

1. **The prescription only ever writes `weightLbs`.** `prescribedLbs` is assigned to exactly two
   places, both `prefill.weightLbs` (inside R2's block, and just above R4). It never touches `reps`
   or `durationSeconds`.
2. **Whether a return fires is never decided by the prescription.** R2 gates on `contributed`,
   computed from the logged set. R4 gates on `historyHasReps || historyHasWeight`, computed from
   `historyFallback`. Neither reads `prefill`. This is the invariant both bugs violated.
3. **`Object.keys(prefill)` appears exactly once, in R5.** R5 is terminal — there is nothing below
   it to skip — so a key-count decision there is harmless. Anywhere else it is the bug.

**The bug class, stated once so it is not rediscovered a third time:** *a non-terminal return gated
on `prefill` being non-empty.* Before this feature, `prefill` was only ever populated by the source
that branch was about, so "non-empty" and "this source contributed" were the same thing. The
prescription broke that equivalence by writing into `prefill` from outside the branch. Both defects
were exactly this, one branch apart. AC4.11 pins the class structurally; AC4.8 and AC4.9 pin the two
known instances behaviourally.

**Step 3b: Confirm AC4.6 (no-prescription byte-identity) holds by inspection**

With `prescribedWeightKg` omitted, `prescribedLbs` is `undefined` and:

- `contributed` is true in exactly the cases the old `Object.keys(prefill).length > 0` was true —
  each assignment that could add a key sets it — and the new `if` inside R2 is a no-op;
- R3 is unchanged;
- `if (prescribedLbs !== undefined)` is a no-op, so `prefill` is still empty entering R4;
- `historyHasReps || historyHasWeight` is true in exactly the cases the old
  `Object.keys(prefill).length > 0` was true there, because with an empty `prefill` the only keys
  that block can add are the two those predicates describe — and the weight guard's added
  `prefill.weightLbs === undefined` is always true when no prescription was applied;
- R5's build-and-check is equivalent to `entry.targetReps > 0 ? { reps } : undefined`, because
  `prefill` is provably empty there without a prescription.

If you cannot follow that argument, stop and re-read rather than trusting the tests alone — AC5.1's
whole job is to catch a mistake here, and a suite edited to accommodate a regression catches nothing.

**Step 4: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no output. The third parameter is optional, so `src/app/session.tsx`'s two existing call sites still compile untouched.

**Step 5: Commit**

```bash
git add src/state/sessionPresenter.ts
git commit -m "feat(state): prescribed weight overrides history in the set prefill"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: The precedence test matrix

**Verifies:** `coach-prescribed-weights.AC4.1` – `coach-prescribed-weights.AC4.11`, `coach-prescribed-weights.AC5.1`

**Files:**
- Test: `src/state/sessionPresenter.test.ts` (unit)

**Step 1: Run the existing suite first, unmodified**

```bash
npm test -- src/state/sessionPresenter.test.ts
```
Expected: **everything passes with zero edits to the file.** This *is* AC5.1. If any pre-existing test fails, Task 1's restructure changed behaviour it should not have — fix the implementation, never the test.

**Step 2: Write the new cases**

Add a `describe('computeSetPrefill — coach-prescribed weight', …)` block, reusing whatever `SessionState` fixture builder the file already uses for `computeSetPrefill` tests. Do not invent a new fixture shape.

The kg↔lbs pairs to use: `lbsToKg(185) = 83.91` and `kgToLbs(83.91) = 185`; `kgToLbs(79.38) = 175`.

- **AC4.1:** entry with no logged sets; `historyFallback = { reps: 8, weightLbs: 175 }`;
  `prescribedWeightKg = 83.91`. Expect `weightLbs` to be `185`.
- **AC4.2:** same call — expect `reps` to be `8`, from the history fallback. Assert this in the same
  test or a sibling; the point is that the override is field-scoped, so both halves must be checked
  against **one** invocation, not two different fixtures.
- **AC4.3:** a session with a logged set for this exercise at `weightKg: 79.38` (175 lbs);
  `prescribedWeightKg = 83.91`. Expect `weightLbs` to be `175` — the in-session set wins.
- **AC4.4:** no logged sets, `historyFallback` omitted, `prescribedWeightKg = 83.91`, and the entry's
  `targetReps = 5`. Expect `{ weightLbs: 185, reps: 5 }`.
- **AC4.5:** a duration-based entry (`targetDurationSeconds > 0`, `targetReps: 0` — check
  `isDurationBasedEntry` in `src/state/exerciseStopwatch.ts` for the exact predicate and build the
  fixture to match it), with `prescribedWeightKg = 83.91`. Expect the result to carry
  `durationSeconds` and **no** `weightLbs`.
- **AC4.6:** the same fixtures as AC4.1 and AC4.4 but with the third argument `undefined`, and again
  with `0`. Expect exactly what the two-argument form returns. Write this as a direct comparison —
  call `computeSetPrefill(state, fallback)` and `computeSetPrefill(state, fallback, 0)` and assert
  the results are equal — so the test states the invariant rather than restating one expected value.
- **AC4.7:** covered by AC4.1's expectation of `185` rather than `83.91`. Add an explicit assertion
  that the returned `weightLbs` is not the kg number, so a dropped conversion cannot pass.

- **AC4.8:** an in-session logged set for this exercise that contributed **nothing usable** — reps
  `0` (or null) and weight null — plus `historyFallback = { reps: 8, weightLbs: 175 }` and a
  prescription of `83.91`. Expect `{ reps: 8, weightLbs: 185 }`: the empty set falls through, history
  supplies the reps, the prescription supplies the weight.

  ⚠ This is the criterion that catches the ordering bug in Task 1. An implementation that applies the
  prescription *before* computing `inSessionContributed` returns `{ weightLbs: 185 }` and silently
  loses the reps. Nothing else catches it: AC4.6's byte-identity argument only exercises the
  no-prescription path, and the extra case below uses a set that *does* have reps. A set logged with
  zero reps is a real action — `src/interop/parse.ts`'s context rules exist precisely because of it.

- **AC4.9:** no in-session set; `historyFallback = { reps: 0 }` (present but useless — this is what
  `session.tsx` actually builds for a working set logged with zero reps and no weight, because its
  builder gates on `!= null`, not `> 0`); prescription `83.91`; `entry.targetReps = 5`. Expect
  `{ weightLbs: 185, reps: 5 }`.

  ⚠ This is the second instance of the bug class. Without the `historyHasReps || historyHasWeight`
  gate, R4 returns `{ weightLbs: 185 }` and the reps field opens **empty** where today it opens at
  `targetReps` — an unintended behaviour change gated purely on the feature being present.

- **AC4.10:** no in-session set; `historyFallback = { weightLbs: 175 }` (weight, no reps);
  prescription `83.91`; `entry.targetReps = 5`. Expect `{ weightLbs: 185 }` — **and assert `reps` is
  `undefined`.**

  ⚠ Do not "improve" this to `{ weightLbs: 185, reps: 5 }`. Without a prescription this input returns
  `{ weightLbs: 175 }` with no reps, and the whole design claim is that a prescription changes the
  weight field and nothing else. Assert the same call with the prescription omitted also has no
  `reps`, so the two are pinned together. This is also the case that distinguishes the correct fix
  from a plausible wrong one: gating R4 on a *key-count delta* instead of on history's own predicates
  would let `targetReps` leak in here.

- **AC4.11:** a structural check, not a behavioural test. Read `computeSetPrefill` and confirm
  `Object.keys(prefill)` appears exactly once, in the terminal R5 return. Record it as a one-line
  assertion in the PR description rather than as a jest test — a test that greps its own source is
  worse than a reviewer who reads it. Its value is that it names the *class*, so the third instance
  is caught by reading rather than by a third round of review.

**Step 3b: Add one case that is not in the AC list**

A logged in-session set with **reps but no weight**, plus a prescription. Expect `reps` from the
logged set and `weightLbs` from the prescription. This is the partial-fill path through the in-session
block, and it is the branch most likely to be broken by a later "simplification" of Task 1's code.
Note it is *not* the same as AC4.8: here the set contributed something, so it is authoritative and
the fall-through never happens.

**Step 4: Run**

```bash
npm test -- src/state/sessionPresenter.test.ts
```
Expected: all tests pass, old and new.

**Step 5: Commit**

```bash
git add src/state/sessionPresenter.test.ts
git commit -m "test(state): prefill precedence matrix for prescribed weights"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Phase gate, including the engine-untouched check

**Verifies:** `coach-prescribed-weights.AC5.3`, plus `coach-prescribed-weights.AC6.1` – `coach-prescribed-weights.AC6.3` (per-phase gates)

**Step 1: Prove the engine was not touched (AC5.3)**

```bash
git diff origin/main --stat -- src/engine
```
Expected: **no output.**

```bash
git diff origin/main -- src/engine/types.ts
```
Expected: **no output.** `RoutineEntry` must be byte-identical to `origin/main`.

If either prints anything, the implementation took the trap in finding 1. Revert the engine changes and resolve the prescription shell-side.

**Step 2:**
```bash
npx tsc --noEmit
```
Expected: no output.

**Step 3:**
```bash
npm test
```
Expected: **green — every suite, no carve-out.** Any failure is yours.

**Step 4:**
```bash
npm run lint
```

**Step 5: Confirm the existing prefill tests were not edited**

```bash
git diff origin/main -- src/state/sessionPresenter.test.ts | grep '^-' | grep -v '^---'
```
Expected: **no output** — this phase only *adds* lines to that file. Any deleted or modified line means a pre-existing assertion was changed to accommodate the new behaviour, which falsifies AC5.1.
<!-- END_TASK_3 -->

---

## Traps

1. **Adding `targetWeightKg` to `src/engine/types.ts`'s `RoutineEntry`.** It compiles, it looks right, and the value silently vanishes on the first `dispatch` because the Rill record is closed. AC5.3 exists to catch it.
2. **Making the prescription override the in-session set too.** It re-offers a load the athlete just chose not to use. The chain is deliberate.
3. **Gating any non-terminal return on `prefill` being non-empty.** This is the phase's defect class and it has now been found twice, in adjacent branches, the second time *inside the fix for the first* — once in the in-session block (AC4.8) and once in the history block (AC4.9). Both times the prescription had already written `weightLbs`, making a "did this source contribute?" check true when the source contributed nothing, so the fall-through that should have fetched reps never ran. Gate each non-terminal return on its own source: `contributed` from the logged set, `historyHasReps || historyHasWeight` from `historyFallback`. AC4.11 pins the class; check it by reading, not by hoping a third test catches a third instance.
4. **Making the override whole-object instead of field-scoped.** Returning `{ weightLbs: prescribed }` and dropping the history reps loses information for no reason. AC4.10 is the sharp end of this: a prescription must never cause a `reps` value to appear that would not have appeared without it, either.
5. **Editing an existing test to make it pass.** AC5.1 is the guarantee that pre-v5 routines behave identically, and Task 3 Step 5 checks it mechanically with a diff, not by trust.
6. **Treating a prescribed `0` as a prescription.** Every other metric here reads `> 0` as the absence convention; a 0 would be discarded downstream anyway.
7. **Converting kg→lbs more than once.** `prescribedLbs` is computed once at the top. Do not call `kgToLbs` again further down.
8. **Building the AC4.5 duration fixture by guessing.** Read `isDurationBasedEntry` in `src/state/exerciseStopwatch.ts` and match its actual predicate, or the test exercises the strength path while claiming to test the duration one.
