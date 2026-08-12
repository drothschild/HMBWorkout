# Coach-Prescribed Weights — Phase 3: The coach reads its prescription back

**Goal:** The system prompt shows the coach what it has already programmed, in the same unit it reads history in, so the next turn can progress from it instead of re-deriving load from logs.

**Architecture:** The prompt's routine section is built from `ExerciseDetail` objects produced by `routineDetailPresenter` and rendered by `formatExerciseLine`. Both gain the prescription. Storage stays kg; `formatWeightLbs` converts at the render edge, exactly as the "Recent Training History" section already does for logged sets.

**Tech Stack:** TypeScript, Jest (`node` project).

**Scope:** Phase 3 of 5 from `docs/design-plans/2026-08-11-coach-prescribed-weights.md`.

**Depends on:** Phase 1 (the column), Phase 2 (something that writes it).

**Codebase verified:** 2026-08-11 against `origin/main` @ `eb0afe0` (rebased after #220), by direct read of every file named below.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-prescribed-weights.AC3: The coach reads its own prescription back
- **coach-prescribed-weights.AC3.1 Success:** `routineDetailPresenter` populates
  `ExerciseDetail.targetWeightKg` from `re._raw.target_weight_kg`.
- **coach-prescribed-weights.AC3.2 Success:** `formatExerciseLine` renders a prescribed entry with a
  weight segment in lbs (via `formatWeightLbs`), matching the unit the "Recent Training History"
  section already uses.
- **coach-prescribed-weights.AC3.3 Edge:** An entry with no prescription renders exactly the line it
  renders today — no weight segment, no stray separator.

---

## Investigation findings

### 1. `ExerciseDetail` has exactly two consumers, and only one is testable

`src/state/routineDetailPresenter.ts:4-17` defines it. Grep confirms it is read in exactly two places:

- `src/ai/contextBuilder.ts` — imported at line 5, flattened at line 367, rendered by
  `formatExerciseLine` at lines 409-436. **Jest-covered** (`src/ai` is in `testMatch`).
- `src/app/routine/[id].tsx` — renders the fields at lines 144-152 (superset groups) and 188-196
  (standalone). **Not jest-covered** — `src/app` is outside `testMatch` entirely.

This phase deliberately does **not** touch `routine/[id].tsx`. Displaying the prescription on the routine screen is listed as out of scope in the design plan; adding it here would put behaviour in the one directory no test can see, for no gain to the feature.

### 2. `formatExerciseLine` builds a `|`-joined parts list — order matters for readability, not correctness

`src/ai/contextBuilder.ts:409-436`:
```ts
  parts.push(`${exercise.title} (${exercise.kind})`);
  if (exercise.warmupSets) { parts.push(`warmup: ${exercise.warmupSets}`); }
  if (exercise.targetSets && exercise.targetReps) {
    parts.push(`${exercise.targetSets}x${exercise.targetReps}`);
  } else if (exercise.targetDurationSeconds) {
    parts.push(`${exercise.targetDurationSeconds}s`);
  }
  if (exercise.restSeconds) { parts.push(`rest ${exercise.restSeconds}s`); }
  if (supersetLabel) { parts.push(`[${supersetLabel}]`); }
  return `  - ${parts.join(' | ')}`;
```

Every segment is guarded, so an absent field contributes nothing and `join` produces no stray separator. Adding a guarded segment therefore satisfies AC3.3 by construction — but test it anyway, because "by construction" is what everyone says right before a regression.

Put the weight segment **immediately after the sets×reps segment**, so a line reads
`Squat (strength) | warmup: 1 | 3x5 | @ 185lbs | rest 180s` — load next to the volume it belongs to.

### 3. `formatWeightLbs` owns the unit suffix and is already imported

`src/ai/contextBuilder.ts:15` — `import { formatWeightLbs } from '@/state/weightUnits';`. It is used at line 452 for logged sets. `weightUnits.ts:32-35` documents that nothing outside that module may append a weight suffix, so **do not** write `${kgToLbs(x)}lbs` by hand.

### 4. `routineDetailPresenter` does not null-normalize

`src/state/routineDetailPresenter.ts:81-93` assigns `_raw` values straight through:
```ts
        targetSets: re._raw.target_sets,
        targetReps: re._raw.target_reps,
```
So `ExerciseDetail`'s `?: number` fields can actually hold `null` at runtime despite the type. That is pre-existing and out of scope to fix — but it is why `formatExerciseLine`'s guards are truthiness checks (`if (exercise.restSeconds)`) rather than `!== undefined`, and why your new guard must be a truthiness check too. A `!== undefined` guard here would render `@ nullkg`-shaped garbage for every unprescribed entry.

### 5. Confirmed current state

- ✓ `src/state/routineDetailPresenter.ts:4-17` — `ExerciseDetail`; `description: string | null` last.
- ✓ `src/state/routineDetailPresenter.ts:81-93` — the only construction site.
- ✓ `src/state/routineDetailPresenter.test.ts` exists.
- ✓ `src/ai/contextBuilder.test.ts:281-292` — the existing routine-section assertions
  (`toContain('3x8')`, `toContain('rest 120s')`, etc.), which are the pattern to follow.
- ✓ `npm test` is **green** on `origin/main` — 86 suites, 1582 tests, verified at `eb0afe0`.
  Your gate is plain green; #219/#220 deleted the vault-backed `src/interop/migrate.test.ts` that an
  earlier draft of this plan carved out.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `ExerciseDetail` carries the prescription

**Verifies:** `coach-prescribed-weights.AC3.1`

**Files:**
- Modify: `src/state/routineDetailPresenter.ts:4-17` (the interface)
- Modify: `src/state/routineDetailPresenter.ts:81-93` (the construction site)
- Test: `src/state/routineDetailPresenter.test.ts` (unit)

**Step 1: Add the field**

In `ExerciseDetail`, after `restSeconds?: number;` (line 14):

```ts
  restSeconds?: number;
  /**
   * Coach-prescribed target load in canonical kg, or absent. Rendered in lbs at
   * the display edge (formatWeightLbs) — never carried in lbs.
   */
  targetWeightKg?: number;
  kind: string;
```

**Step 2: Populate it**

At `src/state/routineDetailPresenter.ts:90`, after the `restSeconds` line:

```ts
        restSeconds: re._raw.rest_seconds,
        targetWeightKg: re._raw.target_weight_kg,
        kind: exerciseInfo?.kind || 'strength',
```

Pass it through raw, matching every sibling on this object. (This presenter does not null-normalize; see finding 4.)

**Step 3: Write the test**

Add to `src/state/routineDetailPresenter.test.ts`, using the same DB fixture setup the neighbouring tests use.

- **AC3.1:** Build a routine with two entries — one with `targetWeightKg: 83.91` written through `upsertRoutine`, one without. Call `routineDetailPresenter`. Assert the first entry's `targetWeightKg` is `83.91` and the second's is falsy. Do not assert the second is exactly `undefined` — WatermelonDB gives `null` and this presenter does not normalize, so pinning `undefined` would pin a behaviour the code does not have.

**Step 4: Run**

```bash
npm test -- src/state/routineDetailPresenter.test.ts
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/state/routineDetailPresenter.ts src/state/routineDetailPresenter.test.ts
git commit -m "feat(state): ExerciseDetail carries targetWeightKg"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: The prompt renders the prescription

**Verifies:** `coach-prescribed-weights.AC3.2`, `coach-prescribed-weights.AC3.3`

**Files:**
- Modify: `src/ai/contextBuilder.ts:421-426` (inside `formatExerciseLine`)
- Test: `src/ai/contextBuilder.test.ts` (unit)

**Step 1: Add the segment**

In `formatExerciseLine`, after the sets×reps / duration block (which ends at line 425) and before the `restSeconds` block (line 427):

```ts
  if (exercise.targetSets && exercise.targetReps) {
    parts.push(`${exercise.targetSets}x${exercise.targetReps}`);
  } else if (exercise.targetDurationSeconds) {
    parts.push(`${exercise.targetDurationSeconds}s`);
  }

  // The load this entry is programmed at, if the coach has set one. Rendered in
  // lbs to match the unit the Recent Training History section below uses for
  // logged sets — the model must never see two units for weight in one prompt.
  // Truthiness guard, not `!== undefined`: routineDetailPresenter passes
  // WatermelonDB's raw null straight through.
  if (exercise.targetWeightKg) {
    parts.push(`@ ${formatWeightLbs(exercise.targetWeightKg)}`);
  }

  if (exercise.restSeconds) {
```

The `@ ` prefix matches `formatSetMetrics`'s rendering of logged weight at line 452, so a prescribed load and a logged load read the same way to the model.

**Step 2: Write the tests**

Add to `src/ai/contextBuilder.test.ts`, in the same describe block as the existing routine-section assertions around lines 281-292.

- **AC3.2:** Build a routine whose entry has `targetWeightKg: 83.91` and assert the prompt contains
  `'@ 185lbs'`. Use the **rendered lbs string**, not the kg value — this is the assertion that proves
  the conversion happened at the right edge. (`kgToLbs(83.91)` = `185`.)
- **AC3.3:** Build a routine entry with no prescription and assert the prompt does **not** contain
  `'@ '` anywhere in that routine's section, and that the entry's line still contains its existing
  segments (`'3x8'`, `'rest 120s'` or whatever the fixture uses). Both halves matter: the first
  proves nothing is rendered, the second proves nothing else broke while making that true.

⚠ For AC3.3, scope the "does not contain" assertion carefully. `'@ '` also appears in the **Recent
Training History** section for logged sets. Either build the fixture with no logged history, or
assert against the extracted routine-section substring rather than the whole prompt. A whole-prompt
`not.toContain('@ ')` on a fixture that has history will fail for the wrong reason.

**Step 3: Run**

```bash
npm test -- src/ai/contextBuilder.test.ts
```
Expected: the whole file passes, including the persona pins added in Phase 2 and the pre-existing secret-leak regression test.

**Step 4: Commit**

```bash
git add src/ai/contextBuilder.ts src/ai/contextBuilder.test.ts
git commit -m "feat(ai): prompt shows the coach its own prescribed loads"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Phase gate

**Verifies:** `coach-prescribed-weights.AC6.1`, `coach-prescribed-weights.AC6.2`, `coach-prescribed-weights.AC6.3` (per-phase gates)

**Step 1:**
```bash
npx tsc --noEmit
```
Expected: no output.

**Step 2:**
```bash
npm test
```
Expected: **green — every suite, no carve-out.** Any failure is yours.

**Step 3:**
```bash
npm run lint
```

**Step 4: Confirm no untested directory was touched**

```bash
git diff origin/main --stat -- src/app src/components
```
Expected: no output. This phase's whole point is that it lands in jest-covered files; if a screen changed, the coverage claim in `test-requirements.md` is wrong.
<!-- END_TASK_3 -->

---

## Traps

1. **A `!== undefined` guard on `targetWeightKg`.** `routineDetailPresenter` passes WatermelonDB's raw `null` through, so a strict guard renders a weight segment for every unprescribed entry. Use truthiness, like every sibling guard in this function.
2. **Hand-writing the unit suffix.** `weightUnits.ts` owns it. `formatWeightLbs`, never `` `${kgToLbs(x)}lbs` ``.
3. **Asserting the kg value in the prompt test.** The point of AC3.2 is that the *rendered* string is lbs. Asserting `'83.91'` would pass even if the conversion were dropped.
4. **A whole-prompt `not.toContain('@ ')` for AC3.3.** The history section uses the same prefix. Scope the assertion or build a history-free fixture.
5. **Adding the prescription to `src/app/routine/[id].tsx` "while you're there."** Out of scope, and it puts behaviour where no test can see it.
