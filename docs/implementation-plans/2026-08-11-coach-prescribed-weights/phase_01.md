# Coach-Prescribed Weights — Phase 1: Persist the prescription

**Goal:** A routine entry can carry a prescribed weight in the database, written and cleared under the same contract as every other optional target, and readable by entry order.

**Architecture:** `routine_exercises` gains a nullable `target_weight_kg` column at schema v5, added with a real `addColumns` migration step. kg is canonical in storage — lbs exists only at the UI and prompt edges. Two write paths touch the column: `upsertRoutine` (write/clear, matching its existing "absent optional fields are cleared" contract) and `updateRoutineExerciseExerciseId`, which **clears** it when an exercise is swapped. One read path is added: `getRoutineTargetWeightsKg`, keyed by the row's `order`, which is the same 0-based number the engine carries as `RoutineEntry.idx`.

**Tech Stack:** WatermelonDB 0.28.0 (SQLite on device, LokiJS in tests and on web), TypeScript, Jest (`node` project only).

**Scope:** Phase 1 of 5 from `docs/design-plans/2026-08-11-coach-prescribed-weights.md`.

**Depends on:** Nothing. This is the first phase.

**Codebase verified:** 2026-08-11 against `origin/main` @ `b6f8a6d`, by direct read of every file named below.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-prescribed-weights.AC1: A prescription persists on a routine entry
- **coach-prescribed-weights.AC1.1 Success:** `src/db/schema.ts` declares `version: 5` and the
  `routine_exercises` table has a `target_weight_kg` column, type `number`, `isOptional: true`.
- **coach-prescribed-weights.AC1.2 Success:** `src/db/migrations.ts` contains a `toVersion: 5` entry
  whose `steps` is a real `addColumns` step (**not** the empty array v4 used), and a database created
  at v4 opens at v5 without throwing.
- **coach-prescribed-weights.AC1.3 Success:** `upsertRoutine` creating a new row from an entry with
  `targetWeightKg: 83.91` stores 83.91 and reads it back.
- **coach-prescribed-weights.AC1.4 Success:** `upsertRoutine` updating an existing row from an entry
  with `targetWeightKg` absent sets the column to null, and the row keeps its id (so
  `session_sets.routine_exercise_id` still resolves).
- **coach-prescribed-weights.AC1.5 Success:** `getRoutineTargetWeightsKg` returns a `Map<number,
  number>` of `order → kg` containing an entry only for rows whose column is non-null.
- **coach-prescribed-weights.AC1.6 Success:** `updateRoutineExerciseExerciseId` sets
  `target_weight_kg` to null in the same `database.write` in which it re-points `exercise_id`, and
  leaves `target_sets`/`target_reps`/`rest_seconds`/`warmup_sets`/`superset_group` untouched.
- **coach-prescribed-weights.AC1.7 Edge:** A row whose `target_weight_kg` is null produces no key in
  `getRoutineTargetWeightsKg`'s map (never a `null` or `0` value).

---

## Investigation findings

**Read this before writing any code. Two of these will cost you a day if you miss them.**

### 1. The v4 migration is NOT the template to copy

`src/db/migrations.ts:44-66` is the most recent migration and it looks like this:

```ts
{
  toVersion: 4,
  // ... 20 lines of comment ...
  steps: [],
},
```

**That empty array is correct for v4 and wrong for v5.** v4 *removed* a column (`sessions.sync_status`), and WatermelonDB 0.28 ships no column-removal step — official guidance is to undeclare the column and leave it physically in the file. v5 **adds** a column, which has a first-class step builder. Copying v4's shape would leave every upgrading install with a schema declaring a column the database does not have.

The correct templates are v2 (`migrations.ts:12-23`) and v3 (`migrations.ts:24-43`), both of which use `addColumns`.

The `addColumns` symbol is **already imported** at `src/db/migrations.ts:1`:
```ts
import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';
```
No import change is needed.

### 2. `updateRoutineExerciseExerciseId`'s docstring currently states the opposite of what you are about to implement

`src/db/repository.ts:855-878` says, verbatim:

> The prescription (order, warmup/target/rest columns, superset group) belongs to the plan and is left untouched — a substitute changes identity only.

This phase deliberately breaks that for the weight column alone. The reasoning is in the design plan's *The exercise swap clears the prescription* section; summarised: the prescribed weight **overrides** history in the prefill, so a stale one does not quietly lose to the substitute's correct numbers — it wins over them, putting a load the user cannot lift into their input field. **You must update this docstring in the same task**, or the next reader will "fix" your code back.

### 3. WatermelonDB returns `null`, not `undefined`, for an unset optional column

This is an AGENTS.md-documented hazard with a live history of bugs. `re._raw.target_weight_kg` on an unprescribed row is `null`. `getRoutineTargetWeightsKg` must therefore filter with `!= null` (loose, catching both `null` and `undefined`) and must never emit a `null` or `0` into its map — see AC1.7.

### 4. `upsertRoutine`'s two branches are not symmetric, on purpose

`src/db/repository.ts:1166-1191`. The **update** branch (1167-1176) assigns every optional field unconditionally with `?? null`, because an edit fully replaces a row's contents — an absent field is a *cleared* field. The **create** branch (1178-1190) guards each assignment with `if (x !== undefined)`, because a fresh row already has null everywhere.

`target_weight_kg` follows the same split. Do not "simplify" them into one shape.

### 5. Confirmed current state

- ✓ `src/db/schema.ts:4` — `version: 4`. `routine_exercises` columns at lines 28-38, ending with `notes`.
- ✓ `src/db/models/RoutineExercise.ts:12-21` — nine `@field`/`@text` declarations, `notes` last.
- ✓ `src/db/repository.ts:1089-1099` — `RoutineExerciseEntry` interface, `notes?: string` last.
- ✓ `src/db/repository.ts:1101-1233` — `upsertRoutine`.
- ✓ `src/db/repository.ts:879-923` — `updateRoutineExerciseExerciseId` body; `row.update` at 917-919.
- ✓ `src/db/repository.ts:45-54` — `UpsertRoutineExerciseOptions`, a **separate** interface used by
  `upsertRoutineExercise` (a different, older function). **This phase does not touch it.** It has no
  AI-accept-path caller and adding the field there is out of scope; leaving it alone keeps the diff
  honest.
- ✓ `src/db/test-helpers.ts` exports `createTestDatabase`, `closeTestDatabase`, `flush`.
- ✓ `npx tsc --noEmit` is clean on `origin/main`.
- ⚠ `npm test` on `origin/main` reports **12 pre-existing failures**, all in
  `src/interop/migrate.test.ts` (vault-backed tests whose fixture files were renamed). Your gate is
  "no failure other than that file", never "all green". Do not try to fix it here.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Schema v5 and the migration

**Verifies:** `coach-prescribed-weights.AC1.1`, `coach-prescribed-weights.AC1.2`

**Files:**
- Modify: `src/db/schema.ts:4` and `src/db/schema.ts:26-40`
- Modify: `src/db/migrations.ts:66` (append a new entry after the v4 entry, before the closing `],`)

**Step 1: Bump the schema version**

`src/db/schema.ts` line 4:
```ts
  version: 5,
```

**Step 2: Add the column**

In `src/db/schema.ts`, inside the `routine_exercises` `tableSchema`, add the new column immediately after `rest_seconds` (line 37) and before `notes` (line 38), so it sits with the other plan targets:

```ts
        { name: 'rest_seconds', type: 'number', isOptional: true },
        // A coach-prescribed target load for this entry, in canonical kg.
        // Nullable and never backfilled: an absent prescription is the normal
        // case and must leave the SetLogger's history-derived prefill exactly
        // as it was. lbs exists only at the UI and prompt edges
        // (src/state/weightUnits.ts).
        { name: 'target_weight_kg', type: 'number', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },
```

**Step 3: Add the migration**

In `src/db/migrations.ts`, append this entry to the `migrations` array, after the `toVersion: 4` object's closing `},` (line 66) and before the array's closing `],` (line 67):

```ts
    {
      toVersion: 5,
      steps: [
        // v4 -> v5: a routine entry can carry a coach-prescribed target load.
        //
        // NOTE: this is a real addColumns step, unlike v4's deliberately empty
        // one. v4 *undeclared* a column (WatermelonDB 0.28 ships no removal
        // step); v5 *adds* one, which has a first-class builder. Copying v4's
        // empty-steps shape here would leave every upgrading install with a
        // schema declaring a column its database does not have.
        //
        // Nullable and deliberately not backfilled, the same as v2's
        // exercises.description and v3's session_sets.exercise_id: an entry with
        // no prescription is the ordinary case, and the prefill's precedence
        // chain is unchanged when the column is null.
        addColumns({
          table: 'routine_exercises',
          columns: [{ name: 'target_weight_kg', type: 'number', isOptional: true }],
        }),
      ],
    },
```

**Step 4: Write the migration test**

Add to `src/db/migrations.test.ts`, following whatever `describe` structure that file already uses. Two cases:

- **AC1.1:** Read `databaseSchema.version` off the imported schema object and assert it is `5`. Assert `databaseSchema.tables.routine_exercises.columns` contains a `target_weight_kg` entry with `type: 'number'` and `isOptional: true`. Read it off the object; do not re-derive it.
- **AC1.2:** `stepsForMigration` is **already imported** at `src/db/migrations.test.ts:1`, from `@nozbe/watermelondb/Schema/migrations/stepsForMigration` — no import change needed. Follow the existing v3→v4 case at line 94. Assert `stepsForMigration({ migrations, fromVersion: 4, toVersion: 5 })` returns an array of length 1 whose single step has `type: 'add_columns'`, `table: 'routine_exercises'`, and one column named `target_weight_kg`. **Assert the step's content, not merely that it does not throw** — a "does not throw" test passes against an empty-steps regression, which is the exact mistake this migration is guarding against, and the `steps: []` it would be copied from sits ten lines above in the same file.

Add a comment on the AC1.2 test noting that the suite runs on LokiJS, so this proves the migration *list* is well-formed, not that a real SQLite file upgrades. The SQLite half is human verification H1 in `test-requirements.md`.

**Step 5: Run the tests**

```bash
npm test -- src/db/migrations.test.ts
```
Expected: all tests in the file pass.

**Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts src/db/migrations.test.ts
git commit -m "feat(db): schema v5 adds routine_exercises.target_weight_kg"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: The model field

**Verifies:** None directly — this is a type declaration, verified by `tsc`. It is a prerequisite for Task 3.

**Files:**
- Modify: `src/db/models/RoutineExercise.ts:20-21`

**Step 1: Add the field**

Add between `restSeconds` (line 20) and `notes` (line 21), matching the column order in the schema:

```ts
  @field('rest_seconds') restSeconds?: number;
  @field('target_weight_kg') targetWeightKg?: number;
  @text('notes') notes?: string;
```

Use `@field`, not `@text` — it is a number. `@field` is already imported at line 2.

**Do not add a test for this.** It is a type declaration with no behaviour of its own; `tsc` verifies it and Task 3's tests exercise it through the repository.

**Step 2: Verify**

```bash
npx tsc --noEmit
```
Expected: no output.

**Step 3: Commit**

```bash
git add src/db/models/RoutineExercise.ts
git commit -m "feat(db): RoutineExercise model carries targetWeightKg"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: `upsertRoutine` writes and clears the prescription

**Verifies:** `coach-prescribed-weights.AC1.3`, `coach-prescribed-weights.AC1.4`

**Files:**
- Modify: `src/db/repository.ts:1089-1099` (the `RoutineExerciseEntry` interface)
- Modify: `src/db/repository.ts:1167-1176` (upsert **update** branch)
- Modify: `src/db/repository.ts:1178-1190` (upsert **create** branch)
- Test: `src/db/repository.test.ts` (unit)

**Step 1: Widen the entry type**

`src/db/repository.ts`, in `RoutineExerciseEntry`, add after `restSeconds?: number;` (line 1097):

```ts
  restSeconds?: number;
  /**
   * Coach-prescribed target load in canonical kg. The lbs → kg conversion
   * happens once, upstream in acceptDraft; nothing below this boundary sees
   * lbs. Absent means "no prescription", which leaves the SetLogger's
   * history-derived prefill untouched.
   */
  targetWeightKg?: number;
  notes?: string;
```

This is an **optional** field on an existing interface, so no caller breaks and `tsc` stays clean with no other edit. That is what lets this phase land on `main` alone.

**Step 2: Write it in the update branch**

At `src/db/repository.ts:1174`, add after the `restSeconds` line:

```ts
          re.restSeconds = exerciseEntry.restSeconds ?? null;
          re.targetWeightKg = exerciseEntry.targetWeightKg ?? null;
          re.notes = exerciseEntry.notes ?? null;
```

The unconditional `?? null` is deliberate and matches every sibling here: an edit fully replaces a row's contents, so an entry that omits the prescription **clears** it. That is how the coach removes a prescription in a revision.

**Step 3: Write it in the create branch**

At `src/db/repository.ts:1188`, add after the `restSeconds` line:

```ts
          if (exerciseEntry.restSeconds !== undefined) re.restSeconds = exerciseEntry.restSeconds;
          if (exerciseEntry.targetWeightKg !== undefined) re.targetWeightKg = exerciseEntry.targetWeightKg;
          if (exerciseEntry.notes !== undefined) re.notes = exerciseEntry.notes;
```

Guarded, matching its siblings — a fresh row is already null everywhere.

**Step 4: Write the tests**

Add to `src/db/repository.test.ts`, in or beside the existing `upsertRoutine` describe block. Use `createTestDatabase`/`closeTestDatabase` from `src/db/test-helpers.ts` exactly as the neighbouring tests in this file do.

- **AC1.3:** Create an exercise, then `upsertRoutine` with one entry carrying `targetWeightKg: 83.91`. Query the `routine_exercises` row back and assert its `targetWeightKg` is `83.91`.
- **AC1.4:** Starting from the row created above, call `upsertRoutine` again for the same routine and the same `exerciseId`, with `targetWeightKg` **omitted**. Assert two things: the column is now null/absent, **and the row's `id` is unchanged from the first upsert**. The row-id half is not optional — `session_sets.routine_exercise_id` references it, and a test that only checks the cleared value would pass against a delete-and-recreate regression that orphans every logged set.

**Step 5: Run the tests**

```bash
npm test -- src/db/repository.test.ts
```
Expected: the whole file passes, including every pre-existing test.

**Step 6: Commit**

```bash
git add src/db/repository.ts src/db/repository.test.ts
git commit -m "feat(db): upsertRoutine writes and clears targetWeightKg"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: An exercise swap clears the prescription

**Verifies:** `coach-prescribed-weights.AC1.6`

**Files:**
- Modify: `src/db/repository.ts:855-878` (the docstring)
- Modify: `src/db/repository.ts:917-919` (the `row.update` call)
- Test: `src/db/repository.test.ts` (unit)

**Step 1: Correct the docstring**

`src/db/repository.ts:861-862` currently reads:

```
 * The prescription (order, warmup/target/rest columns, superset group) belongs
 * to the plan and is left untouched — a substitute changes identity only.
```

Replace those two lines with:

```
 * The plan's structure (order, warmup/target-set/target-rep/rest columns,
 * superset group) belongs to the entry and is left untouched — a substitute
 * inherits it.
 *
 * **`target_weight_kg` is the one exception, and it is cleared here.** Sets,
 * reps and rest survive a substitution because they are near-dimensionless
 * across movements; load is not — 185lb is a working squat and an impossible
 * leg extension. And because a prescription *overrides* the history-derived
 * prefill rather than deferring to it (computeSetPrefill, sessionPresenter.ts),
 * a stale one does not quietly lose to the substitute's own correct numbers: it
 * wins over them, and pre-types a dangerous load into the athlete's input. So
 * the swap drops it, and the substitute falls back to plain history-derived
 * prefill, which is right.
```

**Step 2: Clear the column**

`src/db/repository.ts:917-919`, inside the same `database.write` that already re-points the row:

```ts
    await row.update((record: any) => {
      record.exerciseId = trimmed;
      // See the docstring: a prescribed load does not survive a substitution.
      record.targetWeightKg = null;
    });
```

Both writes are already inside one `database.write`, so they cannot come apart — the same guarantee the pre-v3 set-stamping above it relies on. Do not move this into a second transaction.

**Step 3: Write the test**

Add to `src/db/repository.test.ts`, beside the existing `updateRoutineExerciseExerciseId` tests.

- **AC1.6:** Create a routine row via `upsertRoutine` with `targetWeightKg` set **and** non-default `targetSets`, `targetReps`, `restSeconds`, `warmupSets` and `supersetGroup`. Call `updateRoutineExerciseExerciseId` to point it at a different exercise. Assert `targetWeightKg` is now null/absent, **and** assert each of the other five fields still holds its original value. The second half is the real content of the test: it pins that this is a one-column exception, not a general reset.

Also confirm the file's existing `updateRoutineExerciseExerciseId` tests — the pre-v3 set-stamping ones — still pass unmodified. If any of them asserts on the full row shape, it may need the new field added to an expectation; that is a legitimate update, not a regression.

**Step 4: Run the tests**

```bash
npm test -- src/db/repository.test.ts
```
Expected: whole file passes.

**Step 5: Commit**

```bash
git add src/db/repository.ts src/db/repository.test.ts
git commit -m "feat(db): clear target_weight_kg when an entry is re-pointed"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: `getRoutineTargetWeightsKg`

**Verifies:** `coach-prescribed-weights.AC1.5`, `coach-prescribed-weights.AC1.7`

**Files:**
- Modify: `src/db/repository.ts` (add an exported function; place it immediately after
  `updateRoutineExerciseExerciseId` ends at line 923, so it sits with the other
  `routine_exercises` accessors)
- Test: `src/db/repository.test.ts` (unit)

**Step 1: Add the reader**

```ts
/**
 * A routine's coach-prescribed target loads, keyed by entry position.
 *
 * The key is the row's `order`, which is the same 0-based number the engine
 * carries as `RoutineEntry.idx` — `startSessionFromRoutine` sets `idx:
 * re._raw.order` deliberately ("Use DB order directly, NOT loop counter"), so a
 * caller holding an engine entry can look its prescription up directly without
 * resolving a row id. Keying on `exercise_id` would be wrong: a routine may
 * list the same exercise twice with different prescriptions.
 *
 * Rows with no prescription are **omitted entirely**, never mapped to `null` or
 * `0`. WatermelonDB returns `null` for an unset optional column, and
 * `computeSetPrefill` treats a non-positive weight as absent — a `0` in this map
 * would be a value the reader silently discards.
 *
 * @param database The database instance
 * @param routineId The routine whose entries to read
 * @returns order → prescribed weight in kg, for prescribed entries only
 */
export async function getRoutineTargetWeightsKg(
  database: Database,
  routineId: string
): Promise<Map<number, number>> {
  const rows = (await database
    .get('routine_exercises')
    .query(Q.where('routine_id', routineId))
    .fetch()) as RoutineExercise[];

  const weights = new Map<number, number>();
  for (const row of rows) {
    const raw = (row as any)._raw;
    const kg = raw.target_weight_kg;
    // `!= null` on purpose: WatermelonDB gives null, not undefined, for an
    // unset optional column (AGENTS.md). The `> 0` guard keeps a stored 0 —
    // which the draft validator rejects but a hand-edited database could
    // hold — out of the map, so no consumer has to re-derive absence.
    if (kg != null && kg > 0) {
      weights.set(raw.order as number, kg as number);
    }
  }

  return weights;
}
```

`Database`, `Q` and `RoutineExercise` are already imported at the top of `src/db/repository.ts`. Verify before adding an import.

**Step 2: Write the tests**

Add to `src/db/repository.test.ts`.

- **AC1.5:** Build a routine with three entries at orders 0, 1, 2 where orders 0 and 2 carry prescriptions and order 1 does not. Assert the returned map has exactly the two expected keys with the right kg values, and `map.size === 2`.
- **AC1.7:** From that same fixture, assert `map.has(1)` is `false` — not that `map.get(1)` is null. `get` returns `undefined` for a missing key either way, so only `has` distinguishes "omitted" from "present as a falsy value", which is the whole point of the criterion.

**Step 3: Run the tests**

```bash
npm test -- src/db/repository.test.ts
```
Expected: whole file passes.

**Step 4: Commit**

```bash
git add src/db/repository.ts src/db/repository.test.ts
git commit -m "feat(db): getRoutineTargetWeightsKg reads prescriptions by entry order"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Phase gate

**Verifies:** `coach-prescribed-weights.AC6.1`, `coach-prescribed-weights.AC6.2`, `coach-prescribed-weights.AC6.3` (per-phase gates, not deliverables)

**Step 1: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no output.

**Step 2: Full suite**

```bash
npm test
```
Expected: exactly one failing suite, `src/interop/migrate.test.ts`, with 12 failures — **the same failures present on `origin/main` before this branch.** Confirm the count and the file. Any other failing suite is yours and must be fixed before this phase is done.

To confirm the baseline if you doubt it:
```bash
git stash && npm test 2>&1 | tail -5 && git stash pop
```

**Step 3: Lint**

```bash
npm run lint
```
Expected: passes.

**Step 4: Confirm the engine was not touched**

```bash
git diff origin/main --stat -- src/engine
```
Expected: no output. The prescription is shell-side data; if this command prints anything, something has gone wrong.
<!-- END_TASK_6 -->

---

## Traps

1. **Copying v4's `steps: []`.** It is right for a removed column and catastrophic for an added one. Use `addColumns`, like v2 and v3.
2. **A migration test that only asserts "does not throw."** It passes against an empty-steps regression. Assert the step's `type`, `table` and column name.
3. **Symmetrising `upsertRoutine`'s two branches.** Update clears with `?? null`; create guards with `if (… !== undefined)`. They differ deliberately.
4. **`=== null` instead of `!= null`.** WatermelonDB returns `null` for unset optional columns; a strict-undefined check misses it. This exact class of bug is called out twice in AGENTS.md.
5. **Testing the swap-clears rule without asserting the other columns survive.** A test that only checks the weight is gone would pass against a change that reset the whole row.
6. **Chasing the `src/interop/migrate.test.ts` failures.** They pre-date this branch and are out of scope.
7. **Adding `targetWeightKg` to `UpsertRoutineExerciseOptions` (`repository.ts:45-54`).** Different function, no caller on the accept path, not in scope.
