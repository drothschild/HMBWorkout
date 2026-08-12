# Coach-Prescribed Weights — Phase 2: The coach can prescribe

**Goal:** `targetWeightLbs` exists in all three declarations of the AI turn contract with a matching bound, the schema still passes the structured-output guard, and an accepted draft converts to kg exactly once.

**Architecture:** AGENTS.md's *one turn shape, three declarations* rule: the payload shape and its validation bounds live in `AI_TURN_SCHEMA` (what the API enforces), in `DraftExercise` + `validateRoutineDraft` (what the app enforces), and in `personaSection()` prose (what the model reads). All three move together. Bounds go in the validator only — the structured-output endpoint 400s the entire request on a bound keyword. The coach speaks **lbs**, because the prompt already renders history in lbs; `acceptDraft` is the single lbs→kg conversion boundary.

**Tech Stack:** TypeScript, Jest (`node` project), the Anthropic Messages API structured-output subset.

**Scope:** Phase 2 of 5 from `docs/design-plans/2026-08-11-coach-prescribed-weights.md`.

**Depends on:** Phase 1 complete and merged (`RoutineExerciseEntry.targetWeightKg` must exist for `acceptDraft` to target).

**Codebase verified:** 2026-08-11 against `origin/main` @ `eb0afe0` (rebased after #220), by direct read of every file named below.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-prescribed-weights.AC2: The coach can prescribe a weight
- **coach-prescribed-weights.AC2.1 Success:** `validateRoutineDraft` accepts an exercise with
  `targetWeightLbs: 185`.
- **coach-prescribed-weights.AC2.2 Success:** It accepts a half-pound multiple, `targetWeightLbs:
  187.5`.
- **coach-prescribed-weights.AC2.3 Failure:** It rejects `targetWeightLbs: 0` with a
  `DraftValidationError`.
- **coach-prescribed-weights.AC2.4 Failure:** It rejects a negative value.
- **coach-prescribed-weights.AC2.5 Failure:** It rejects a value off the 0.5 grid, e.g. `185.3`.
- **coach-prescribed-weights.AC2.6 Failure:** It rejects a non-number, e.g. the string `"185"`.
- **coach-prescribed-weights.AC2.7 Success:** `AI_TURN_SCHEMA` declares `targetWeightLbs` as `{ type:
  'number' }` and `expectStructuredOutputSafe(AI_TURN_SCHEMA)` passes — no `minimum`, no
  `multipleOf`, both of which are on `UNSUPPORTED_SCHEMA_KEYWORDS`.
- **coach-prescribed-weights.AC2.8 Success:** `personaSection()` states the weight bound as an exact
  sentence, pinned by a `toContain` assertion in `src/ai/contextBuilder.test.ts`, in the same style as
  the existing `targetSets, targetReps` and `warmupSets, targetDurationSeconds, restSeconds`
  sentences.
- **coach-prescribed-weights.AC2.9 Success:** The persona's blanket "All numeric values must be
  integers" guidance is reworded so it no longer contradicts a half-pound weight, and the reworded
  sentence is pinned by a test.
- **coach-prescribed-weights.AC2.10 Success:** `acceptDraft` converts lbs to kg exactly once, via
  `lbsToKg`, so a draft of `targetWeightLbs: 185` reaches `upsertRoutine` as `targetWeightKg: 83.91`.
- **coach-prescribed-weights.AC2.11 Edge:** A draft exercise omitting `targetWeightLbs` reaches
  `upsertRoutine` with `targetWeightKg: undefined` and stores null.

---

## Investigation findings

### 1. A bound keyword in the schema 400s the whole request — this has already happened once

`src/ai/structuredOutputSubset.ts:31-45` lists the keywords the Anthropic structured-output endpoint rejects. **Both keywords you would reach for are on it:**

```ts
export const UNSUPPORTED_SCHEMA_KEYWORDS = [
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minProperties', 'maxProperties',
] as const;
```

The module's own header records the precedent: `minItems`/`maxItems` on `ALTERNATES_SCHEMA` made the Replace button fail on **every** tap until PR #71. The failure mode is a transport-level 400 — the model never runs — so it does not look like a validation bug.

**So: `targetWeightLbs: { type: 'number' }` and nothing else.** The bound lives in `validateRoutineDraft`.

### 2. It must be `number`, not `integer`

Every existing numeric draft field is `{ type: 'integer' }` (`draftSchema.ts:81-85`). `targetWeightLbs` is the first that is not, because the bound is a 0.5 grid. Declaring it `integer` would let the endpoint constrain away every half-pound value before the validator ever sees it.

### 3. The coach already reads lbs — verified, not assumed

`src/ai/contextBuilder.ts:450-452`:
```ts
  if (set.weightKg !== undefined && set.weightKg !== null) {
    // Storage is canonical kg; the prompt speaks display lbs to match the UI
    parts.push(`@ ${formatWeightLbs(set.weightKg)}`);
```
Pinned by `src/ai/contextBuilder.test.ts:553` — `expect(prompt).toContain('@ 220.5lbs')`. `src/ai/restCommentaryPrompt.ts:120` does the same. A model that reads lbs and writes kg would have to convert on every turn.

`formatWeightLbs` is already imported into `contextBuilder.ts` at line 15.

### 4. The 0.5 grid is `kgToLbs`'s own rounding

`src/state/weightUnits.ts:28-30`:
```ts
export function kgToLbs(kg: number): number {
  return Math.round(kg * LBS_PER_KG * 2) / 2;
}
```
Rounds to the nearest 0.5 lb. A prescription off that grid cannot render back as itself, so 0.5 is the exact expressible set. Integers-only was rejected in design: 2.5lb plate jumps and 12.5lb dumbbells are ordinary programming.

`lbsToKg(185)` = `Math.round((185 / 2.20462) * 100) / 100` = **`83.91`**. Use that literal in the AC2.10 test rather than recomputing it in the assertion — a test that calls `lbsToKg` to build its own expectation cannot catch a bug in `lbsToKg`.

### 5. Zero is rejected, not stored

`computeSetPrefill`'s weight guards all read `> 0` (`sessionPresenter.ts:279`, `:300`). A stored `0` would be silently discarded by the reader, so a validator that accepted it would be inviting a value nothing honours. Reject it, consistent with `targetSets`/`targetReps` which are bounded `>= 1`.

### 6. Two persona sentences are pinned as exact strings; one more must become pinned

`src/ai/contextBuilder.test.ts` pins the two bound sentences at lines 62 and 87:
```ts
expect(prompt).toContain('warmupSets, targetDurationSeconds, restSeconds: when present, must be integers >= 0');
expect(prompt).toContain('targetSets, targetReps: when present, must be integers >= 1');
```

`personaSection` also carries, at `contextBuilder.ts:251`, a blanket guidance line:
```
- All numeric values must be integers
```
**This is currently NOT pinned by any test** (grep confirms no assertion contains it). It becomes false the moment `targetWeightLbs: 187.5` is legal, and the model reads it. Reword it and pin the replacement, so the contradiction cannot reappear.

### 7. Confirmed current state

- ✓ `src/ai/draftSchema.ts:36-47` — `DraftExercise`, `description?` last.
- ✓ `src/ai/draftSchema.ts:76-90` — the `exercises.items` schema; `required: ['title', 'kind']`,
  `additionalProperties: false`.
- ✓ `src/ai/draftSchema.ts:174-188` — the `validateInteger` closure and its five call sites, inside
  the per-exercise `for` loop.
- ✓ `src/ai/acceptDraft.ts:41-51` — the `validated.exercises.map` that builds `RoutineExerciseEntry[]`.
  It currently imports nothing from `@/state/weightUnits`.
- ✓ `src/ai/draftSchema.test.ts` and `src/ai/acceptDraft.test.ts` both exist.
- ✓ `expectStructuredOutputSafe` is exported from `src/ai/structuredOutputSubset.ts:102`, imported at
  `src/ai/draftSchema.test.ts:10`, and already called on `AI_TURN_SCHEMA` at lines **934** and
  **1013**. A bound keyword added in Task 1 fails there immediately.

### 8. A committed inline snapshot of the whole schema breaks in this phase — in a directory you would not think to run

`src/ai/provider/subset.test.ts:370` holds a `toMatchInlineSnapshot` of the **entire**
`AI_TURN_SCHEMA`. Its own comment explains why it exists, and it is worth reading before you touch
it:

> `PRISTINE_AI_TURN` (above) is `JSON.stringify(AI_TURN_SCHEMA)` captured at module load — i.e.
> re-derived from the very module under test. It can catch a transform mutating the schema object in
> place, but it CANNOT catch drift: a field added to (or removed from, or renamed in)
> `AI_TURN_SCHEMA` itself is captured into `PRISTINE_AI_TURN` along with the change […]
> `toMatchInlineSnapshot` writes its expectation into THIS file, checked into git independent of
> `draftSchema.ts`, so a schema edit that isn't deliberately re-approved here (`jest -u`) shows as a
> diff in review and fails CI.

So it is doing its job: **your change is exactly the kind of drift it was built to surface.** The
correct remedy is a reviewed `jest -u`, and the resulting snapshot diff belongs in the PR
description — that is the review step the tripwire exists to force.

Two practical notes:
- The snapshot's properties are **alphabetically ordered** by jest's serializer, so `targetWeightLbs`
  lands between `targetSets` and `title`. If your regenerated diff shows anything else moving, the
  edit was wider than intended.
- `ALTERNATES_SCHEMA` has a second inline snapshot at `:476`. It is **untouched** by this phase; if
  `jest -u` rewrites it too, something is wrong. Those two are the only inline snapshots in the whole
  repo (checked by grep across `src/`).

**Sweep result for the rest of this phase's surface:** nothing else pins a value that changes here.
The existing persona pins at `contextBuilder.test.ts:62` and `:87` are untouched (this phase only
adds a sentence and rewrites the unpinned line 251), and `PRISTINE_AI_TURN` is re-derived at module
load so it follows the change automatically.
- ✓ `npm test` is **green** on `origin/main` — 86 suites, 1582 tests, verified at `eb0afe0`.
  Your gate is plain green; #219/#220 deleted the vault-backed `src/interop/migrate.test.ts` that an
  earlier draft of this plan carved out.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: The draft type and the JSON schema

**Verifies:** `coach-prescribed-weights.AC2.7`

**Files:**
- Modify: `src/ai/draftSchema.ts:36-47` (`DraftExercise`)
- Modify: `src/ai/draftSchema.ts:76-90` (`AI_TURN_SCHEMA` exercise properties)
- Test: `src/ai/draftSchema.test.ts` (unit)
- Regenerate: `src/ai/provider/subset.test.ts:370` — a committed inline snapshot of the whole
  schema. **This task breaks it by design.** See investigation finding 8.

**Step 1: Add the field to `DraftExercise`**

After `restSeconds?: number;` (line 43):

```ts
  restSeconds?: number;
  /**
   * Coach-prescribed target load, in **pounds** — the unit the model reads
   * history in (contextBuilder's formatWeightLbs). acceptDraft converts to
   * canonical kg exactly once on the way to the database.
   */
  targetWeightLbs?: number;
  notes?: string;
```

**Step 2: Add it to the schema**

In `AI_TURN_SCHEMA`, after `restSeconds: { type: 'integer' },` (line 84):

```ts
              restSeconds: { type: 'integer' },
              // `number`, not `integer`: the bound is a 0.5lb grid, matching
              // kgToLbs's rounding. And NO bound keywords here — `minimum` and
              // `multipleOf` are both on UNSUPPORTED_SCHEMA_KEYWORDS, and one of
              // them 400s the entire request before the model runs (see
              // structuredOutputSubset.ts; it cost PR #71 a whole feature).
              // The bound lives in validateRoutineDraft.
              targetWeightLbs: { type: 'number' },
              notes: { type: 'string' },
```

Leave `required` and `additionalProperties: false` alone — the field is optional.

**Step 3: Confirm the schema guard**

`src/ai/draftSchema.test.ts` **already** calls `expectStructuredOutputSafe(AI_TURN_SCHEMA)` — at line 934, and again at line 1013 in the coach-onboarding block. The helper is imported at line 10. So AC2.7's first half is covered the moment you run the file; if you added a bound keyword in Step 2, it fails there.

Add one new assertion for the half the generic guard cannot see: that
`AI_TURN_SCHEMA.properties.draft.properties.exercises.items.properties.targetWeightLbs` equals
`{ type: 'number' }`. `expectStructuredOutputSafe` would pass just as happily on `{ type: 'integer' }`, which silently forbids every half-pound value the bound exists to allow.

**Step 4: Re-approve the inline snapshot**

Running only `npm test -- src/ai/draftSchema.test.ts` will **not** surface the breakage — the
snapshot lives in `src/ai/provider/subset.test.ts`. Run the whole AI tree first so you see it:

```bash
npm test -- src/ai
```
Expected: `src/ai/provider/subset.test.ts` fails on the `AI_TURN_SCHEMA` snapshot. **This is
correct** — see finding 8.

Regenerate it, then **read the diff before committing**:

```bash
npm test -- src/ai/provider/subset.test.ts -u
git diff src/ai/provider/subset.test.ts
```

The diff must show exactly one addition — `"targetWeightLbs": { "type": "number" }` between
`targetSets` and `title` — and nothing else. Anything else moving means your schema edit was wider
than intended; investigate rather than accepting it. Paste this diff into the PR description; that
review step is the entire reason the tripwire is committed to git.

**Step 5: Run**

```bash
npm test
npx tsc --noEmit
```
Expected: **green — every suite, no carve-out.**

**Step 6: Commit**

```bash
git add src/ai/draftSchema.ts src/ai/draftSchema.test.ts src/ai/provider/subset.test.ts
git commit -m "feat(ai): declare targetWeightLbs on the draft contract"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: The validator bound

**Verifies:** `coach-prescribed-weights.AC2.1` – `coach-prescribed-weights.AC2.6`

**Files:**
- Modify: `src/ai/draftSchema.ts:174-188` (inside `validateRoutineDraft`'s per-exercise loop)
- Test: `src/ai/draftSchema.test.ts` (unit)

**Step 1: Add the helper and the call**

`validateRoutineDraft` declares `validateInteger` as a closure inside its `for (const ex of obj.exercises)` loop at line 174. Add a sibling closure immediately after it (after the closing `};` at line 182), then call it alongside the existing five:

```ts
    const validateHalfStepWeight = (field: string, value: unknown) => {
      if (value === undefined) return;
      // The 0.5lb grid is kgToLbs's own rounding step (weightUnits.ts), so it is
      // exactly the set of values that can round-trip to the input and back.
      // Zero is rejected rather than stored: computeSetPrefill treats a
      // non-positive weight as absent, so a stored 0 is a value nothing honours.
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (value * 2) % 1 !== 0) {
        throw new DraftValidationError(
          `${field} must be a positive number in 0.5 steps, got "${value}"`
        );
      }
    };

    validateInteger('warmupSets', exercise.warmupSets, 0);
    validateInteger('targetSets', exercise.targetSets, 1);
    validateInteger('targetReps', exercise.targetReps, 1);
    validateInteger('targetDurationSeconds', exercise.targetDurationSeconds, 0);
    validateInteger('restSeconds', exercise.restSeconds, 0);
    validateHalfStepWeight('targetWeightLbs', exercise.targetWeightLbs);
```

`Number.isFinite` is load-bearing: without it `NaN` and `Infinity` slip through. `NaN <= 0` is `false` and `(NaN * 2) % 1 !== 0` is... also `false`, since `NaN % 1` is `NaN` and `NaN !== 0` is `true` — so `NaN` would actually be caught by the grid check, but `Infinity` would not (`Infinity % 1` is `NaN`, `NaN !== 0` is `true`, so it *is* caught too). Keep `isFinite` anyway: relying on `NaN` arithmetic to reject values is the kind of thing that breaks silently when the condition is next refactored.

**Step 2: Write the tests**

Add to `src/ai/draftSchema.test.ts`, following the shape of the existing `validateRoutineDraft` bound tests. Build a minimal valid draft (name + one exercise with `title` and `kind`) and vary `targetWeightLbs`:

- **AC2.1:** `185` — accepted; the returned draft carries `targetWeightLbs: 185`.
- **AC2.2:** `187.5` — accepted.
- **AC2.3:** `0` — throws `DraftValidationError`.
- **AC2.4:** `-5` — throws `DraftValidationError`.
- **AC2.5:** `185.3` — throws `DraftValidationError`.
- **AC2.6:** `'185'` (string) — throws `DraftValidationError`.

Assert the error *type*, not the message text — the message is not a contract.

Add one more case not in the AC list but worth pinning while you are here: a draft **omitting** `targetWeightLbs` is accepted, so the field is genuinely optional.

**Step 3: Run**

```bash
npm test -- src/ai/draftSchema.test.ts
```

**Step 4: Commit**

```bash
git add src/ai/draftSchema.ts src/ai/draftSchema.test.ts
git commit -m "feat(ai): bound targetWeightLbs to positive 0.5lb steps"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: The persona prose

**Verifies:** `coach-prescribed-weights.AC2.8`, `coach-prescribed-weights.AC2.9`

**Files:**
- Modify: `src/ai/contextBuilder.ts:233` (add a line after it) and `src/ai/contextBuilder.ts:251`
- Test: `src/ai/contextBuilder.test.ts` (unit)

**Step 1: State the bound**

In `personaSection`'s `basePersona`, under `Exercise schema (inside draft.exercises):`, add a line after line 233 (`- warmupSets, targetDurationSeconds, restSeconds: when present, must be integers >= 0`) and before the `description:` line:

```
- targetWeightLbs: the load to lift, in pounds; when present, must be a positive number in steps of 0.5 (e.g. 185, 187.5). Omit it when you are not programming a load — an omitted weight leaves the athlete's own recent history to fill the field
```

The unit is stated in the field name and again in the prose, deliberately: the model reads history in lbs a few sections later and a silent unit switch is the failure this wording exists to prevent.

**Step 2: Fix the contradicting guidance line**

`src/ai/contextBuilder.ts:251` currently reads:
```
- All numeric values must be integers
```
Replace with:
```
- All numeric values must be integers, except targetWeightLbs, which may use 0.5 steps
```

Without this, the model is told two contradictory things and the one it reads last is the blanket rule.

**Step 3: Pin both sentences**

Add to `src/ai/contextBuilder.test.ts`, in the same describe block as the existing bound pins at lines 62 and 87, using the same `toContain` shape:

- **AC2.8:** `expect(prompt).toContain('targetWeightLbs: the load to lift, in pounds; when present, must be a positive number in steps of 0.5')`
- **AC2.9:** `expect(prompt).toContain('All numeric values must be integers, except targetWeightLbs, which may use 0.5 steps')`

These are exact-string pins on purpose. Their whole job is to fail when someone loosens or tightens the bound in `draftSchema.ts` without rewording the prose the model actually reads — the drift AGENTS.md's *one turn shape, three declarations* rule exists to catch.

**Step 4: Run**

```bash
npm test -- src/ai/contextBuilder.test.ts
```
Expected: the file passes. In particular the pre-existing secret-leak regression test — which asserts no API key reaches the prompt — must still pass untouched.

**Step 5: Commit**

```bash
git add src/ai/contextBuilder.ts src/ai/contextBuilder.test.ts
git commit -m "feat(ai): persona states the targetWeightLbs bound"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: `acceptDraft` converts lbs to kg

**Verifies:** `coach-prescribed-weights.AC2.10`, `coach-prescribed-weights.AC2.11`

**Files:**
- Modify: `src/ai/acceptDraft.ts:1-4` (imports) and `src/ai/acceptDraft.ts:41-51` (the entry map)
- Test: `src/ai/acceptDraft.test.ts` (integration — it writes through `upsertRoutine` to a test DB)

**Step 1: Import the converter**

Add to the imports at the top of `src/ai/acceptDraft.ts`:

```ts
import { lbsToKg } from '@/state/weightUnits';
```

**Step 2: Convert in the entry map**

`src/ai/acceptDraft.ts:41-51`, add after `restSeconds: ex.restSeconds,`:

```ts
    restSeconds: ex.restSeconds,
    // The single write-side unit boundary. The model speaks lbs (it reads
    // history in lbs — contextBuilder's formatWeightLbs); storage is canonical
    // kg. Nothing below this line sees pounds. Guard on undefined rather than
    // falsiness: the validator has already rejected 0, but `lbsToKg(0)` is 0,
    // and a 0 written into the column is a value the prefill silently ignores.
    targetWeightKg: ex.targetWeightLbs !== undefined ? lbsToKg(ex.targetWeightLbs) : undefined,
    notes: ex.notes,
```

**Step 3: Write the tests**

Add to `src/ai/acceptDraft.test.ts`, matching how that file already sets up a database and asserts on written rows.

- **AC2.10:** Accept a draft whose single exercise carries `targetWeightLbs: 185`. Read the written `routine_exercises` row back and assert `targetWeightKg === 83.91`. **Use the literal `83.91`** — do not call `lbsToKg` to compute the expectation, or the test cannot catch a bug in the conversion. Assert the row's `targetWeightKg` is a number, not a string.
- **AC2.11:** Accept a draft whose exercise omits `targetWeightLbs`. Assert the written row's `targetWeightKg` is null/absent — proving the `undefined` passes cleanly through `upsertRoutine`'s create branch rather than being coerced to 0.

Note for AC2.10: `acceptDraft` awaits `upsertRoutine`, which is a real `database.write`, so no `flush()` is needed here — this is not a fire-and-forget path. (Contrast the `onCompleteSession` hazard in AGENTS.md's Testing gotchas.)

**Step 4: Run**

```bash
npm test -- src/ai/acceptDraft.test.ts
```

**Step 5: Commit**

```bash
git add src/ai/acceptDraft.ts src/ai/acceptDraft.test.ts
git commit -m "feat(ai): acceptDraft converts prescribed lbs to canonical kg"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Phase gate

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

**Step 4: Confirm the snapshot was re-approved, not left broken**

```bash
git diff origin/main --stat -- src/ai/provider/subset.test.ts
```
Expected: exactly one file changed, a small insertion. If this is empty, the snapshot was never
regenerated and the suite is red.

**Step 5: Confirm the three declarations actually moved together**

```bash
grep -c targetWeightLbs src/ai/draftSchema.ts src/ai/contextBuilder.ts
```
Expected: a non-zero count for **both** files. `draftSchema.ts` should show at least 3 (type, schema, validator call); `contextBuilder.ts` at least 2 (the bound sentence and the reworded guidance line). A zero on either file means one of the three declarations was missed.
<!-- END_TASK_5 -->

---

## Traps

1. **Putting `minimum` or `multipleOf` in `AI_TURN_SCHEMA`.** Either 400s every request before the model runs. This exact mistake killed the Replace button until PR #71. Bounds go in the validator.
2. **Declaring the field `integer`.** Silently forbids every half-pound value the bound is designed to allow.
3. **Changing a validator bound without rewording the persona.** The pinned strings will catch it — but only if you add the pin in Task 3. Do not skip it because "the validator is the real rule."
4. **Leaving "All numeric values must be integers" in place.** It is not currently pinned by any test, so nothing else will tell you.
5. **Computing the AC2.10 expectation with `lbsToKg`.** `expect(row.targetWeightKg).toBe(lbsToKg(185))` is a tautology that passes even if `lbsToKg` is broken. Hard-code `83.91`.
6. **Converting somewhere other than `acceptDraft`.** A second conversion site is how a value gets converted twice. `acceptDraft` is the boundary; the repository, the engine and the DB are all kg.
7. **Asserting on error message strings.** Assert `DraftValidationError` is thrown; the wording is not a contract.
8. **Running only `npm test -- src/ai/draftSchema.test.ts` and committing green.** The inline snapshot that your schema edit breaks lives in `src/ai/provider/subset.test.ts`. You will find it at the phase gate instead, with no idea it was expected.
9. **Blind `jest -u` across the repo.** Regenerate that one file and read the diff. A blanket update would silently re-approve `ALTERNATES_SCHEMA` too, discarding the second tripwire.
10. **Concluding your schema edit was wrong when the snapshot fails.** It is doing its job. The remedy is a reviewed regeneration, not a revert.
