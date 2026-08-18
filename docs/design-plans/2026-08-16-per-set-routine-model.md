# Per-Set Routine Data Model Design

Design plan for [#276](https://github.com/drothschild/HMBWorkout/issues/276).

## Summary

Today a routine entry is an **aggregate**: one `routine_exercises` row saying "3 warmup sets, 4
working sets, 8 reps, 60s rest, 22.7 kg". This design replaces that with a **list**: a new
`routine_sets` table in which each row carries its own `set_type`, `target_weight_kg`, reps (or rep
range), duration and distance, leaving `routine_exercises` holding only what is genuinely
per-exercise — `rest_seconds`, `superset_group`, `order`, `notes`. It is the shape Hevy uses, and
more to the point it is the shape a warmup ramp needs: the user's own Hevy "Push" routine ramps
Bench Press 9.07 → 11.34 → 18.14 kg, and our model can only record the number 3.

**The central risk was the engine, and it is measured, not assumed.** AGENTS.md convention 3 warns
that Rill indexed list access is head/tail recursion, and convention 6 that `RoutineEntry` is a
closed record — together raising the possibility that a list-inside-a-list would be unworkable and
sink the design. It is not. A complete per-set rewrite of all three `.lv` files was built and
executed against `rill-lang` 1.1.1 before this plan was written (§Findings). It type-checks, it
runs, and **`advance_after_set` is byte-identical** — the entire round-robin, the whole of
conventions 9 and 10, is untouched. `transition.lv` changes by **four lines**, two of which
*delete* duplicated phase-derivation logic in favour of the already-shared `h.phase_for`. The
engine is the part of this change that gets *smaller*.

**Losing past data is acceptable and the plan is designed for it.** Schema v6 bumps with no
matching migration entry, which WatermelonDB's SQLite adapter handles by wiping and recreating
(§Architecture — *The destructive bump is a supported path*). No back-fill is attempted. That is
not merely a cost saving: back-fill is **impossible in the lossy direction**. The count `3` cannot
be turned back into 9.07 → 11.34 → 18.14. Every routine reconstructed from aggregates would be a
flat ramp that lies about what the user actually did, which is worse than an empty database the
coach can refill in one conversation. This constraint is what makes the project tractable at all.

The work is **six phases**, expand-then-contract. Phases 1–5 are strictly additive: the aggregate
columns stay on `routine_exercises`, still written, and every consumer that has not yet moved keeps
reading them. Phase 6 is the contract step that undeclares them and deletes the derivation
scaffolding. This shape is what lets every phase leave `main` green without any phase becoming
unreviewable — the honest alternative, a single atomic swap of a type consumed by 26 production
files, would have been one enormous phase. Phase 6 is the point of no return; everything before it
is abandonable (§Rollback).

**This lands before [#267](https://github.com/drothschild/HMBWorkout/issues/267).** Draft PR #275's
plan is paused because its Phase 1 adds a `target_weight=` flag and its Phases 2–3 serialize and
parse the aggregate shape. §Relationship to #267 says exactly which of its phases survive, which
are superseded here, and which get *smaller*.

## Findings

Everything in this section was executed, not reasoned about. The spike lives in this session's
scratchpad, not the repo; it is reproducible from the quoted rule text.

### The Rill nested-list constraint does not bite — measured

A full per-set rewrite of `types.lv`, `helpers.lv` and `transition.lv` was type-checked with
`checkRuleSource` and then *run* with `createEngine` from
`node_modules/rill-lang/dist/lib.js`.

**Result 1 — it type-checks.** A `List(RoutineSet)` nested inside `RoutineEntry` inside
`List(RoutineEntry)` inside `SessionState` unifies cleanly. There is no depth limit and no special
handling required.

**Result 2 — `at` is polymorphic and works on the inner list.** AGENTS.md convention 3's "head/tail
recursion" description is about *why entries carry an explicit `idx`*, and it undersells what is
available: `rill-lang`'s prelude declares

```
// src/typechecker.ts:847 (rill-lang)
env.set("at", scheme(tfn(Int, tlist(a), tunion("Result", [a]))));
```

`at : Int -> List(a) -> Result(a)`, polymorphic in `a`, so `at(setIndex, entry.sets)` is as valid as
the `at(s.exerciseIndex, s.entries)?` the rules already use throughout.

**Result 3 — the recovery form matters, and the obvious one fails.** `phase_for` must stay *total*
(its callers use it in value position inside record literals), so the `Result` from `at` has to be
discharged without `?`. Four formulations were probed:

| Formulation | Result |
|---|---|
| `at(i, entry.sets) \|> fn(s) -> … \|> catch e -> Working` | **FAIL** — `Cannot unify TRecord with TUnion` |
| same, parenthesised | **FAIL** — same error |
| `match at(i, entry.sets) { Ok(s) -> …, Err(e) -> … }` | **PASS** |
| `let s = at(i, entry.sets)?` (returns `Result`) | **PASS** |
| `at(i, entry.sets) \|> catch e -> <default record>` then field access | **PASS** |

Rill's `|>` does **not** auto-unwrap a `Result`, so piping one into a function that expects the
payload is a type error. **Use the `match … { Ok(s) -> …, Err(e) -> … }` form**; it keeps
`phase_for` total and leaves all six call sites unchanged. This is a concrete trap that would
otherwise have been discovered in the middle of Phase 2.

**Result 4 — `advance_after_set` is untouched.** The complete diff of `transition.lv` between the
current rules and the working per-set spike is **four lines**:

```diff
@@ -130,7 +130,7 @@   (reconcile_resting_deadline)
-          let nextPhase = if (s.setIndex < currentEntry.warmupSets) then Warmup else Working
+          let nextPhase = h.phase_for(currentEntry)(s.setIndex)
@@ -159,7 +159,7 @@   (StartSession)
-          let firstPhase = if (firstEntry.warmupSets > 0) then Warmup else Working
+          let firstPhase = h.phase_for(firstEntry)(0)
@@ -186,8 +186,8 @@   (LogSet)
-      let isWarmup = state.setIndex < currentEntry.warmupSets
-      let setType = if (isWarmup) then "warmup" else if (currentEntry.kind == "strength") then "working" else currentEntry.kind
+      let prescribedType = h.set_type_at(currentEntry)(state.setIndex)
+      let setType = if (prescribedType == "warmup") then "warmup" else if (currentEntry.kind == "strength") then "working" else currentEntry.kind
```

The first two are a **simplification**: `transition.lv:133` and `:162` currently re-derive the
warmup/working decision inline, duplicating what `h.phase_for` already exists to centralise. Its
own docstring says it is "Shared by every 'recover phase from position' site … so they can never
disagree" — and two sites do not use it. Per-set makes using it mandatory, which closes that gap as
a side effect.

In `helpers.lv` the changes are equally small and equally reductive:

- `phase_for` (`helpers.lv:51-53`) stops comparing a position against a count and reads the set's
  own declared type.
- `next_active_idx` (`helpers.lv:97`): `round < (entry.warmupSets + entry.targetSets)` becomes
  `round < length(entry.sets)`.
- `next_active_landing` (`helpers.lv:133`): `(entry.warmupSets + entry.targetSets) > 0` becomes
  `length(entry.sets) > 0`.
- `set_type_at` is added (four lines) for `LogSet`.

`length` called on an inner list from inside a `fold` lambda over the outer list type-checks and
runs. That was the specific thing most likely to fail, and it does not.

**Result 5 — conventions 9 and 10 survive, exercised end to end.** The spike engine was driven
through a routine built from the real Hevy payload plus the two hard cases:

```
  0  Warmup   ex=0 (bench-press-dumbbell) round=0 pos=0
  1  Warmup   ex=0 (bench-press-dumbbell) round=1 pos=0
  2  Warmup   ex=0 (bench-press-dumbbell) round=2 pos=0
  3  Working  ex=0 (bench-press-dumbbell) round=3 pos=0
  4  Working  ex=0 (bench-press-dumbbell) round=4 pos=0
  5  Working  ex=1 (chest-fly)            round=0 pos=0
  6  Working  ex=2 (triceps-ext)          round=0 pos=1
  7  Working  ex=1 (chest-fly)            round=1 pos=0
  8  Working  ex=2 (triceps-ext)          round=1 pos=1
  9  Working  ex=1 (chest-fly)            round=2 pos=0     <- partner exhausted, round does not end
 10  Working  ex=4 (plank)                round=0 pos=0     <- empty-set entry at idx 3 skipped
  final phase: Done
  set types stamped: warmup, warmup, warmup, working, working, working,
                     working, working, working, working, stretch
```

Convention 9's mismatched-count case is correct (`chest-fly` 3, `triceps-ext` 2, the shorter partner
drops out without ending the round). Convention 10's zero-set entry — now literally an **empty set
list** — is skipped rather than landed on.

Convention 10's subtlest documented case was probed separately, because `next_active_landing`'s
docstring singles it out ("a landing can skip an entire zero-set group to reach a LATER group whose
own leading member(s) are also zero-set"). With entries `[opener, deadA(G1,0), deadB(G1,0),
leadghost(G2,0), realA(G2,2), realB(G2,2)]`:

```
  0  ex=0 (opener) round=0 pos=0
  1  ex=4 (realA)  round=0 pos=1     <- pos relative to G2's true start (3), not 0 and not 4
  2  ex=5 (realB)  round=0 pos=2
  3  ex=4 (realA)  round=1 pos=1
  4  ex=5 (realB)  round=1 pos=2
```

The group-start tracking is intact. **`length(sets) > 0` is a faithful substitute for
`(warmupSets + targetSets) > 0`** — it is in fact the *same* predicate expressed directly, which is
why convention 10 simplifies rather than changing: "an entry planning zero sets" and "an entry with
an empty set list" are the same statement, and the second is checkable without arithmetic.

**Result 6 — the JS bridge round-trips the nested list, and `ReplaceExercise` preserves it.**
`jsToRill`/`rillToJs` carry `List(RoutineSet)` in both directions with float weights and string
types intact. `ReplaceExercise` rebuilds `entries` with `fold` and functional record update
(`{ entry | exerciseId: … }`) — convention 6's field-loss hazard — and the nested `sets` list
survives that rebuild unchanged. Convention 7's `setIndex == 0` guard still rejects a swap after a
logged set.

**One bridge detail with a test consequence.** `rillToJs` **omits** a `None` field rather than
emitting `undefined`. Observed output for a set with no `repsMax` and no `durationSeconds`:

```json
{"setType":"warmup","reps":5,"weightKg":9.07}
```

A `toEqual` against an object that spells those keys out as `undefined` will pass (Jest's `toEqual`
ignores undefined), but `toStrictEqual` will **fail**. Phase 2's tests must use `toEqual`, or
construct expectations without the absent keys.

### The destructive bump is a supported path, not a crash

The sub-question "what happens if the schema version is bumped with no matching migration" has a
definite answer in the installed WatermelonDB 0.28, and it is *not* a throw:

```js
// node_modules/@nozbe/watermelondb/Schema/migrations/stepsForMigration.js
if (fromVersion < minVersion || toVersion > maxVersion) {
  return null;
}
```

```js
// node_modules/@nozbe/watermelondb/adapters/sqlite/index.js:131-133
} else {
  logger.warn('[SQLite] Migrations not available for this version range, resetting database instead');
  this._setUpWithSchema(callback);
}
```

So bumping `databaseSchema.version` to 6 while leaving `migrations.ts`'s highest `toVersion` at 5
makes `maxVersion` 5, `toVersion` 6 > 5, `stepsForMigration` return `null`, and the adapter drop
and recreate the database at the new schema. **The wipe is the framework's own documented fallback
and needs no `unsafeResetDatabase` call.** Two consequences the plan acts on:

1. It is **silent** — a `logger.warn`, nothing user-facing. The user opens the app and their
   routines are gone with no explanation. AC1.8 requires the app to say so.
2. `src/db/migrations.test.ts:70-85` does not merely fail, it **throws**:
   ```ts
   const steps = stepsForMigration({ migrations, fromVersion: 1, toVersion: databaseSchema.version })
     as { table: string; columns: { name: string }[] }[];
   expect(steps.map((step) => `${step.table}.${step.columns[0].name}`)).toEqual([…]);
   ```
   `stepsForMigration` returns `null` and `.map` throws `TypeError`. This is the correct behaviour
   of the design, and rewriting that test to *assert the null* turns a breakage into the fixture
   that proves the wipe (AC1.7).

For Phase 6's column removal there is no destructive step needed and none available — WatermelonDB
0.28 ships no `destroyColumn` (AGENTS.md records this at the v4 migration). The established
precedent in this repo is v4's *undeclare, don't drop*: remove the column from `schema.ts`, add a
`toVersion` entry with `steps: []`, and the adapters ignore the leftover column on read and write.
Phase 6 follows that precedent exactly.

### The file survey, re-measured

The issue's survey says 25 production files. The measured figure is **26** `.ts`/`.tsx`
non-test production files matching `targetSets|warmupSets|target_sets|warmup_sets`, plus the three
`.lv` files:

| Directory | Files | Matches |
|---|---|---|
| `src/ai` | `acceptDraft.ts` (2), `alternatesPrompt.ts` (6), `contextBuilder.ts` (9), `draftSchema.ts` (6), `restCommentaryPrompt.ts` (7) | 30 |
| `src/app` | `ai-coach.tsx` (2), `routine/[id].tsx` (7), `workout/[id].tsx` (4) | 13 |
| `src/db` | `models/RoutineExercise.ts` (2), `repository.ts` (20), `schema.ts` (2) | 24 |
| `src/engine` | `index.ts` (4), `types.ts` (2) | 6 |
| `src/export` | `exportService.ts` (4) | 4 |
| `src/interop` | `format.ts` (6), `parse.ts` (8), `serialize.ts` (8) | 22 |
| `src/state` | `exerciseReplaceStore.ts` (6), `restCommentaryStore.ts` (6), `routineDetailPresenter.ts` (6), `routineListPresenter.ts` (4), `sessionDetailPresenter.ts` (2), `sessionPresenter.ts` (7), `startSessionFromRoutine.ts` (3), `todayStartPresenter.ts` (1) | 35 |
| `src/watch` | `schedule.ts` (2) | 2 |

Every one is assigned to a phase in §Implementation Phases.

**Incidental finding:** `src/state/sessionPresenter.ts.backup` is a stray checked-in backup file
that also matches. It is not a `.ts` file, nothing imports it, and it is not counted above. Phase 6
deletes it.

### A per-set AI schema survives the structured-output subset

`src/ai/structuredOutputSubset.ts` recurses into nested arrays and objects
(`SCHEMA_VALUED` includes `items`; `SCHEMA_LIST_VALUED` and `SCHEMA_MAP_VALUED` walk children), with
**no depth limit and no prohibition on `items` inside `items`**. A nested array-of-set-objects is
therefore expressible. The constraint that bites is a different one: `minItems` and `maxItems` are
both on `UNSUPPORTED_SCHEMA_KEYWORDS`, so **"a set list must be non-empty" cannot be a schema
keyword** and must live in `validateRoutineDraft`, exactly as `targetWeightLbs`'s `minimum` and
`multipleOf` already do.

`normalizeNullsToUndefined` (`src/ai/draftSchema.ts:298-335`) recurses through arrays
(`value.map(normalizeNullsToUndefined)`) and objects, so OpenAI's strict-mode nulls are handled at
every nesting level with no change.

## Definition of Done

1. **A routine entry owns an ordered list of prescribed sets.** A `routine_sets` table exists at
   schema v6, each row carrying `set_type`, `target_reps`, `target_reps_max`, `target_weight_kg`,
   `target_duration_seconds`, `target_distance_m` and `order`, hanging off `routine_exercises` by
   row id. `routine_exercises` keeps `routine_id`, `exercise_id`, `order`, `superset_group`,
   `rest_seconds` and `notes`, and nothing else.

2. **A warmup ramp round-trips.** The user's real Bench Press ramp (9.07 → 11.34 → 18.14 kg, then
   four working sets at 22.68) is stored, started, advanced through, prefilled and exported with all
   seven weights distinct and in order. This is the single criterion the aggregate model cannot
   satisfy at all, and it is the discriminating fixture throughout.

3. **The engine advances by set list.** `helpers.lv`'s two activity predicates key on
   `length(entry.sets)`, `phase_for` reads `sets[round].setType`, and `advance_after_set` is
   unmodified. Conventions 9 and 10 hold, proven by the existing superset and zero-set suites
   re-expressed against set lists.

4. **The coach drafts per-set.** `AI_TURN_SCHEMA`, `RoutineDraft`/`validateRoutineDraft` and
   `personaSection()` all carry a `sets` array (AGENTS.md's *one turn shape, three declarations*),
   the schema still passes `expectStructuredOutputSafe`, and a rep range and a warmup ramp both
   validate.

5. **The markdown grammar is per-set and symmetric.** A routine emits one line per set, the same
   shape a session line already has; `serialize.ts` and `parse.ts` stay symmetric and the
   `<sets>x<reps>` routine overload is gone.

6. **The aggregate columns are gone**, undeclared per the v4 precedent, with no derivation
   scaffolding and no fallbacks left behind.

7. **`npx tsc --noEmit` is clean and `npm test` is green at every phase boundary**, not only at the
   end.

**Out of scope:** migrating or back-filling any existing routine or session (§Summary); a UI for
hand-editing an individual set's weight (the coach and import are the authoring paths this cycle);
per-set `rest_seconds` (Hevy keeps rest per-exercise and so do we — see Open decision 3); Hevy's
`exercise_template_id` as a stored identity; changing `session_sets` in any way.

## Acceptance Criteria

Fixtures referenced by name throughout:

- **RAMP** — Bench Press (Dumbbell), the real payload from routine
  `760bdf23-0a80-4df3-a36d-4af1d55f370b`: `warmup 5×9.07`, `warmup 5×11.34`, `warmup 3×18.14`, then
  four `normal 8–10×22.68`. *Discriminates because the aggregate model literally cannot hold it*: any
  regression to counts collapses the three warmups to one weight, and every assertion on three
  distinct ascending values fails.
- **MISMATCH** — superset label `G5`, member A with 3 sets, member B with 2 (convention 9).
- **EMPTY** — an exercise row with zero `routine_sets` rows (convention 10).
- **INTERLEAVE** — sets `[warmup, normal, warmup]`. *Discriminates the segment arithmetic*: the
  current `setIndex - warmupSets + 1` derivation gives "Set 0" and "Warmup 3" on this input; a
  correct per-set derivation gives "Warmup 1", "Set 1", "Warmup 2".
- **RANGE** — a set with `target_reps: 8`, `target_reps_max: 10`.

### per-set-routine.AC1: The database stores an ordered set list

- **AC1.1 Success:** `src/db/schema.ts` declares `version: 6` and a `routine_sets` table with
  columns `routine_exercise_id` (string, indexed), `order` (number), `set_type` (string),
  `target_reps`, `target_reps_max`, `target_weight_kg`, `target_duration_seconds`,
  `target_distance_m` (all number, `isOptional: true`).
- **AC1.2 Success:** Writing **RAMP** through `upsertRoutine` and reading it back yields seven rows
  in `order` 0–6 whose `target_weight_kg` values are `[9.07, 11.34, 18.14, 22.68, 22.68, 22.68,
  22.68]` and whose `set_type` values are `['warmup','warmup','warmup','normal','normal','normal',
  'normal']`. *Fails on regression:* any code that stores a count instead of a list returns fewer
  than seven rows or repeats one weight.
- **AC1.3 Success:** **RANGE** stores `target_reps: 8` and `target_reps_max: 10` and reads both
  back; a set with `target_reps: 8` and no max reads back `target_reps_max` absent, not equal to 8.
- **AC1.4 Success:** `upsertRoutine` reconciling a routine whose exercise list is unchanged keeps
  every `routine_exercises` row id (so `session_sets.routine_exercise_id` still resolves), while
  replacing that exercise's `routine_sets` rows wholesale. *Fails on regression:* a
  delete-and-recreate of the exercise row orphans logged history — asserted by logging a session set
  first and re-reading it after the upsert.
- **AC1.5 Success:** `upsertRoutine`'s drop branch destroys an omitted exercise's `routine_sets`
  rows alongside its `routine_exercises` row, in the same `database.write`, and still stamps that
  row's null-stamped `session_sets` with the outgoing `exercise_id` before either destroy.
- **AC1.6 Success:** `updateRoutineExerciseExerciseId` clears **every** set's `target_weight_kg` for
  the re-pointed row — not one column — in the same `database.write` as the re-point and the
  history stamp, and leaves `set_type`, `target_reps` and `order` untouched. *Fails on regression:* a
  substitute inheriting the outgoing exercise's ramp is exactly the stale-prescription bug
  AGENTS.md's swap rule exists to prevent, now multiplied across a list.
- **AC1.7 Success:** `src/db/migrations.test.ts`'s v1-walk is rewritten to assert
  `stepsForMigration({ migrations, fromVersion: 1, toVersion: 6 })` returns **`null`**, with a
  comment naming the destructive intent. *Fails on regression:* if someone later adds a
  `toVersion: 6` migration entry "to be safe", this test goes red rather than silently preserving a
  half-migrated database with no `routine_sets` rows.
- **AC1.8 Success:** The first launch after the wipe shows the user a one-time notice that stored
  routines were reset by an app update. *Fails on regression:* without it the wipe is a
  `logger.warn` nobody sees and the app looks like it lost data by accident.
- **AC1.9 Edge:** **EMPTY** persists — an exercise row with zero `routine_sets` rows is writable and
  readable, and `getRoutine…` returns it with `sets: []`, not with the row omitted.

### per-set-routine.AC2: The engine advances through a set list

- **AC2.1 Success:** `rules/types.lv` declares `alias RoutineSet = { setType: String, reps:
  Option(Int), repsMax: Option(Int), weightKg: Option(Float), durationSeconds: Option(Int),
  distanceM: Option(Float) }` and `RoutineEntry` carries `sets: List(RoutineSet)` and no longer
  carries `warmupSets`, `targetSets`, `targetReps` or `targetDurationSeconds`.
- **AC2.2 Success:** `loadRules()` type-checks the per-set rules — `checkRuleSource` returns
  `ok: true`.
- **AC2.3 Success:** `h.phase_for` is written as `match at(setIndex, entry.sets) { Ok(s) -> …,
  Err(e) -> Working }`. *Fails on regression:* the `|> catch` form does not compile
  (`Cannot unify TRecord with TUnion`), so this is enforced by the build, but the criterion records
  *why* the form is what it is.
- **AC2.4 Success:** Dispatching `LogSet` seven times through **RAMP** stamps set types
  `['warmup','warmup','warmup','working','working','working','working']`. *Fails on regression:*
  code that still compares `setIndex` against a warmup *count* gives the same answer here — so this
  criterion is paired with AC2.5, which the count-based version cannot pass.
- **AC2.5 Success:** **INTERLEAVE** stamps `['warmup','working','warmup']`. *Fails on regression:*
  this is the fixture a count-based derivation cannot satisfy at all — `setIndex < warmupSets`
  gives `['warmup','working','working']` for `warmupSets: 1`, or `['warmup','warmup','working']`
  for 2. No count reproduces the correct answer.
- **AC2.6 Success:** **MISMATCH** logs 3 sets for member A and 2 for member B, alternating, with the
  round not ending when B is exhausted (convention 9).
- **AC2.7 Success:** **EMPTY** is never landed on: `StartSession` onto a routine whose first entry
  has `sets: []` lands on the first entry that does not, and `advance_after_set` skips past it
  (convention 10).
- **AC2.8 Success:** A routine in which *every* entry has `sets: []` is rejected by `StartSession`
  with `Err("routine has no entry with any sets to perform")` — the existing message, unchanged.
- **AC2.9 Success:** The zero-set-group-skipping landing case is preserved: entries
  `[opener, dead(G1,0), dead(G1,0), leadghost(G2,0), realA(G2,2), realB(G2,2)]` land on `realA` with
  `supersetPosition: 1`. *Fails on regression:* a `next_active_landing` that stops tracking
  `groupStart` returns `0` or `4` here, and the next `advance_after_set` derives the wrong
  `groupEndIdx`.
- **AC2.10 Success:** `git diff` on `transition.lv` for this phase touches exactly the four lines in
  §Findings; `advance_after_set` and `reconcile_resting_deadline`'s structure are otherwise
  unmodified. *A read-and-record criterion*, recorded in the PR.
- **AC2.11 Success:** `ReplaceExercise` on an entry carrying a set list swaps `exerciseId` and
  leaves `sets` intact (convention 6's closed-record hazard), and still rejects a swap once
  `setIndex > 0` (convention 7).
- **AC2.12 Edge:** `SENTINEL_TO_OPTION_MAP` is **not** extended. `RoutineSet`'s optional fields cross
  the boundary as honest `undefined`, and Phase 2's tests use `toEqual`, not `toStrictEqual`,
  because `rillToJs` omits `None` keys entirely (§Findings, Result 6).

### per-set-routine.AC3: The session reads the plan set by set

- **AC3.1 Success:** `startSessionFromRoutine` builds each `RoutineEntry.sets` from `routine_sets`
  in `order`, and still assigns `idx: re._raw.order` from the DB's canonical order (convention 3).
- **AC3.2 Success:** `startSessionFromRoutine` refuses a routine in which every entry has an empty
  set list, with its existing message — the shell-side guard that keeps the user off the engine's
  `Err` (AGENTS.md Boundaries).
- **AC3.3 Success:** `deriveSetPosition` returns the position **within the run of same-typed sets**,
  computed by counting preceding sets of the same type rather than by subtracting a warmup count. On
  **INTERLEAVE** it returns `Warmup 1`, `Set 1`, `Warmup 2`. *Fails on regression:* the current
  arithmetic gives `Set 0` for index 2.
- **AC3.4 Success:** `setPositionLabel` renders `Warmup 2 of 3` and `Set 1 of 4` for **RAMP**, with
  the denominators being counts of that type within the list.
- **AC3.5 Edge:** For **EMPTY**, `setPositionLabel` and `restCommentaryPrompt`'s `setPosition` both
  return `''` and both consumers hide the row — the two independent label builders AGENTS.md names,
  each still guarded. *Fails on regression:* guarding only the presenter leaves
  `buildRestCommentaryPrompt` emitting an empty segment.
- **AC3.6 Success:** `isLastSetOfExercise` is `setIndex === entry.sets.length - 1`, and is true on
  **MISMATCH** for member B at round 1 (its own last set) even though the group continues.
- **AC3.7 Success:** `computeSetPrefill` takes the weight from **the current set's own**
  `target_weight_kg`. On **RAMP** at index 1 it prefills 11.34 kg, not 9.07 and not 22.68. *Fails on
  regression:* any per-exercise prescription lookup returns one value for all seven sets.
- **AC3.8 Success:** The three-way precedence collapses to two: the exercise's own last set *this
  session* still wins over the prescribed set, and the prescribed set wins over cross-session
  history. The per-exercise middle term is gone. Reps still come from the set's own
  `target_reps`/`target_reps_max`, and the duration path is unchanged.
- **AC3.9 Edge:** A set with no `target_weight_kg` falls through to history exactly as an
  unprescribed entry does today — the existing behaviour, unchanged, proven by a fixture with a null
  weight on set 2 of 3.
- **AC3.10 Success:** `exerciseReplaceStore.routineRevision` still bumps strictly after
  `applyToRoutine` resolves and never on a rejected swap, and `routineRevision` is still an entry in
  the prefill effect's dependency array in `src/app/session.tsx` — a **structural** criterion read
  from source, per AGENTS.md AC6.9's precedent, since no suite can load the screen. *Note:*
  AGENTS.md cites this as `session.tsx:303`; the entry is currently at **line 305** (303 is
  `sessionState?.exerciseIndex`). Match on the identifier, not the line number, and correct
  AGENTS.md's citation in Phase 6.

### per-set-routine.AC4: The coach drafts per-set

- **AC4.1 Success:** `AI_TURN_SCHEMA`'s draft exercise carries `sets: { type: 'array', items: {
  type: 'object', properties: { type, reps, repsMax, weightLbs, durationSeconds }, required:
  ['type'], additionalProperties: false } }` and `expectStructuredOutputSafe(AI_TURN_SCHEMA)` passes.
  *Fails on regression:* adding `minItems: 1` to express "at least one set" trips the guard —
  `minItems` is on `UNSUPPORTED_SCHEMA_KEYWORDS` and 400s the request (PR #71's failure mode).
- **AC4.2 Success:** `validateRoutineDraft` accepts **RAMP** expressed as a draft, with three
  `type: 'warmup'` sets at ascending `weightLbs` and four `type: 'normal'`.
- **AC4.3 Success:** It accepts **RANGE** (`reps: 8, repsMax: 10`) and rejects `repsMax < reps`.
- **AC4.4 Failure:** It rejects a set whose `type` is neither `'warmup'` nor `'normal'`.
- **AC4.5 Failure:** It rejects `weightLbs: 0`, a negative, and a value off the 0.5 grid — the
  existing `validateHalfStepWeight` bound, now applied per set.
- **AC4.6 Failure:** It rejects an exercise with `sets: []`, since `minItems` cannot express it in
  the schema (AC4.1) and this validator is the only enforcing layer. *Fails on regression:* without
  it, a drafted empty exercise reaches the engine as an unlandable entry and the whole of
  convention 10 is doing work the validator should have done.
- **AC4.7 Success:** `personaSection()` states the per-set contract, and every changed bound
  sentence is re-pinned by an exact-string `toContain` in `contextBuilder.test.ts`. The five existing
  pinned sentences (`contextBuilder.test.ts:62, 87, 94, 113, 122`) are **rewritten, not deleted** —
  each names a bound that still exists in per-set form.
- **AC4.8 Success:** The persona's `targetSets: 1`-for-duration guidance is replaced by its per-set
  equivalent ("a timed hold is one set in the list") and re-pinned. AGENTS.md flags this sentence as
  having no validator counterpart — it steers the model away from zero-set drafts — so it must
  survive the rewrite rather than be dropped as unenforced.
- **AC4.9 Success:** `acceptDraft` converts lbs→kg exactly once per set, via `lbsToKg`, and writes
  the set list through `upsertRoutine`. **RAMP** drafted at `[20, 25, 40, 50, 50, 50, 50]` lbs
  reaches the database as seven distinct-then-repeating kg values.
- **AC4.10 Success:** `src/ai/provider/subset.test.ts:370`'s `toMatchInlineSnapshot` of
  `AI_TURN_SCHEMA` is re-approved by a **reviewed** `jest -u`, and the diff is quoted in the PR
  description. It is a deliberate git-checked tripwire and this change is exactly what it is for.
- **AC4.11 Success:** `formatExerciseLine` renders a routine's plan to the coach as its set list, so
  the coach can progress a ramp rather than re-derive it. **RAMP** renders three distinct warmup
  weights in lbs. *Fails on regression:* a summarised "3 warmup sets" line means the coach cannot see
  the ramp it wrote last week and will flatten it on the next revision.
- **AC4.12 Success:** `alternatesPrompt` and `restCommentaryPrompt`'s target summaries read the set
  list, and the secret-leak regression tests in each still pass.

### per-set-routine.AC5: The markdown grammar is per-set and symmetric

- **AC5.1 Success:** `serializeRoutine` emits **one line per set**, the same shape a session line
  already has, with `set_type=warmup` and `target_weight=` flags. The `<sets>x<reps>` routine
  overload is gone from `format.ts`'s grammar doc and from the serializer.
- **AC5.2 Success:** `parseRoutine` groups consecutive lines sharing an exercise id into one entry
  with an ordered set list, and `parse(serialize(RAMP))` returns seven sets with the original seven
  weights in order. *Fails on regression:* a parser that keeps one-line-per-exercise returns one set
  or seven separate exercises.
- **AC5.3 Success:** `target_weight` and `reps_max` join `knownFlags` (`format.ts:424` — this plan
  originally cited `:247`, which #282's quoted-flag work moved twice in one day; re-verify by grep
  rather than by line number when Phase 5 starts), and the
  `weight=`-on-a-routine-line leak recorded in AGENTS.md is closed — the allowlist becomes
  context-aware, the second and third consultations of `parse.ts`'s `context` parameter.
- **AC5.4 Success:** The context-dependent zero-reps rule is **deleted**, not ported. With routine
  lines now per-set, `3x0` has no expressible form and `1x0` means the same thing in both contexts,
  so `parseRoutine` and `parseSession` stop diverging on validation strictness. *Fails on
  regression:* keeping the rule leaves dead branches that `parse.ts`'s tests can no longer reach.
- **AC5.5 Success:** Every session round-trip test in `src/interop/__tests__/roundtrip.test.ts`
  passes **unmodified**. Session serialization is driven by logged sets, not routine aggregates, and
  is not in scope. *Fails on regression:* if a session test needs editing, the change has leaked out
  of the routine grammar.
- **AC5.6 Success:** The five routine round-trip tests identified in `roundtrip.test.ts` (the
  machine-fields round-trip, the warmup/working set-type case, the stretch-duration case, the
  cardio-duration case, and the null-omission case) are rewritten against set lists, and a new
  **RAMP** round-trip test is added next to them.
- **AC5.7 Success:** `serializeSession`'s guarantee that it never emits a partial session is intact,
  including the orphaned-group path, and `exportSessionHistory` still returns
  `{ markdown, failures }` with `failures` reaching the user.
- **AC5.8 Edge:** **EMPTY** serializes to an exercise line with no set lines and parses back to an
  entry with an empty set list — not to a dropped exercise, and not to a throw.

  ⚠️ **Amended after the #293 review: this AC did not say how that line is SPELLED, and the
  obvious spelling is unsound.** A bare `- <exercise-id>:` is byte-identical to a prescribed set
  carrying only flags — a load, a rep-range top, a distance — because all five `routine_sets`
  columns are independently nullable. Left ambiguous, the parser guessed, and both guesses were
  wrong: a bare cardio entry line threw as a set missing its duration, and a load-only set was
  silently DROPPED. The spelling is therefore **`- <exercise-id>: sets=0 [entry flags…]`**, and
  the rule is: *a routine line is one prescribed set unless it says `sets=0`.* Its consequences,
  which Phase 6 and #267 Phase 3 inherit:
  - Every prescribed field on a routine line is independently optional. A set carrying only
    `target_weight=50`, only `reps_max=12`, only `target_distance=5000`, only `set_type=warmup`,
    or nothing at all is one set, and round-trips as one set.
  - The cardio/stretch **duration** requirement, the cardio/stretch **sets-slot prohibition**, and
    the strength **sets×reps** requirement are the SESSION's alone — **all three, and the third one
    is why this list needed amending twice.** A session line is a measurement and must say what was
    measured; a routine line is a plan and may prescribe as little as it likes.

    ⚠️ **Amended again after the #293 round-2 review.** The first amendment named only the duration
    requirement and the sets×reps requirement, and the fix that implemented it moved exactly those
    two — leaving the cardio/stretch sets-slot prohibition unconditional thirty lines above the
    split. `serializeRoutine` then emitted documents `parseRoutine` threw on for **64 of the 192**
    exhaustively enumerated storable `routine_sets` shapes: every cardio or stretch set carrying
    `target_reps`. The shape is ordinary — nothing validates a set's fields against its parent
    exercise's kind, `updateRoutineExerciseExerciseId` deliberately keeps reps across a
    substitution, and a stretch prescribed in reps ("5 × cat-cow") is how one is actually written.
    In a routine the slot reads `1x<reps>`, so there is no multi-set plan to misread; `3x8` is
    still refused by the routine-only "a routine line is one set" rule. **#267 Phase 3 inherits
    this list — read all three, not the first two.**
  - `sets=<n>` for nonzero `n` is **refused**, not reinterpreted — a count is spelled by writing
    that many lines — and `sets=0` alongside set content is a contract violation. `sets` is a
    routine-only flag key.
  - A stray token (`4x`) is still refused on a line that prescribes **no reps and no duration**,
    and still ignored on a line that prescribes either. That relaxation predates #276 and making
    the refusal unconditional would break the #277 legacy-tokenizer fixtures.

    ⚠️ **The width here is a recorded DECISION, not a consequence (#293 round-2 review, M8).**
    Phase 5 first widened the condition to "prescribes nothing across all five set fields", which
    reads as consistent with the rule the rest of the function moved to and is strictly *looser*:
    four lines that threw before — `target_weight=50 4x`, `reps_max=10 4x`, `set_type=warmup 4x`,
    `target_distance=100 4x` — silently swallowed the typo'd sets slot. **Both widths pass the
    entire suite**, so no test forced either; the writeup presented the wider one as a necessity
    when it was a choice. Restored to the narrower reps-or-duration test, which keeps `4x` loud on
    four more shapes, and pinned by its own test so the next widening is deliberate.

### per-set-routine.AC6: The aggregates are gone

- **AC6.1 Success:** `src/db/schema.ts` declares `version: 7`, `routine_exercises` no longer lists
  `warmup_sets`, `target_sets`, `target_reps`, `target_duration_seconds` or `target_weight_kg`, and
  `migrations.ts` gains **both a `toVersion: 6` entry and a `toVersion: 7` entry**. The
  `toVersion: 7` entry carries `steps: []` with a comment citing the v4 precedent (columns are
  undeclared, not dropped); the `toVersion: 6` entry carries the real
  `createTable({ name: 'routine_sets', … })` mirroring `schema.ts`.
  **Both entries are mandatory, and this supersedes Phase 1's "do not add a `toVersion: 6` entry".**
  `schemaMigrations` refuses a gapped list, so a lone `toVersion: 7` throws *"Migrations must be
  listed without gaps, or duplicates"* at module init — in non-production builds only, the same
  `NODE_ENV` asymmetry Phase 1 fixed for `validateAdapter`, and a module-init throw crashes before
  `RuleErrorScreen` can render. Leaving the migrations withheld at v7 instead is not the
  alternative: that resets the database a **second** time and destroys whatever the user rebuilt
  after Phase 1. Both readings were verified by execution; the numbered note at the end of
  `src/db/adapterMigrations.ts` carries the detail. *Fails on regression:* a v6 database must open
  at v7 without wiping — a purpose-built `fromVersion: 6, toVersion: 7` assertion returns a non-null
  `[]`. **AC1.7's pins invert here and must be rewritten rather than deleted:** with coverage
  spanning 1–7, `migrations.maxVersion` is `7` not `5`, and `stepsForMigration(1 → 6)` returns real
  steps rather than `null`.
  ⚠️ **CORRECTED AT IMPLEMENTATION: it is FOUR steps, not five.** This AC said five and the
  consolidated Phase-6 debt comment repeated it. Five migration *entries* are traversed (v2, v3,
  v4, v5, v6) but `stepsForMigration` concatenates their `steps` arrays and v4's is deliberately
  empty — `sync_status` was undeclared, not dropped. Entries and steps are not the same count, and
  the same arithmetic applies to v7, whose array is empty for the same reason: a v1 walk to v7 is
  the same four steps as a v1 walk to v6. Measured, not reasoned about.
- **AC6.2 Success:** ~~`rg 'targetSets|warmupSets|target_sets|warmup_sets' src --glob '!*.test.ts'`
  returns **zero** matches.~~ **REWRITTEN AT IMPLEMENTATION — no production CODE names an
  aggregate**, asserted by `src/db/aggregatesGone.static.test.ts`, which sweeps every non-test
  `.ts`/`.tsx` under `src/`, strips comments (keeping string literals, which are exactly where an
  un-typecheckable `Q.where('target_sets', …)` would hide), and requires zero matches.

  The original could not reach zero, for two reasons pulling opposite ways. `WorkoutLine.targetSets`
  was never a routine aggregate — it is the raw `<sets>` half of a workout line's slot, 12
  unremovable hits — and explaining what was removed requires naming it, so the migration entries,
  the model and half a dozen presenters legitimately carry the word in prose.

  Both ends were fixed rather than carved out. The field is **`setsSlot`** now, which is what it
  always meant; and the criterion asks the question it was reaching for. **A carve-out for
  `src/interop` was the tempting wrong answer and would have hidden four genuinely dead
  `RoutineExerciseRow` fields** — the debt list flagged two of them, and a fix that named two would
  have left two. *Fails on regression:* still the criterion that catches a forgotten fallback
  branch, and now stronger than the shell command, since a comment can neither satisfy nor break
  it.
- **AC6.3 Success:** The derivation scaffolding is deleted: `toRillRoutineEntry` no longer derives a
  set list from counts, `fromRillState` no longer re-derives counts from a set list, and
  `RoutineEntry.sets` is required rather than optional.
- ~~**AC6.4 Success:** `src/state/sessionPresenter.ts.backup` is deleted.~~ **ALREADY DONE** in #280/#285, before Phase 6 opened. Nothing to do; recorded so the next reader does not go looking for the file.
- **AC6.5 Success:** AGENTS.md is rewritten for the new model: conventions 3, 6, 8, 9 and 10 are
  restated in per-set terms; the `rillToJs`-omits-`None` test hazard is recorded; the destructive-bump
  mechanism and its `logger.warn` silence are recorded; the `target_weight_kg` three-way precedence
  paragraph is replaced by the two-way rule. "Last verified"
  is bumped. *Fails on regression:* AGENTS.md describing the aggregate model after Phase 6 is a
  documentation bug of exactly the class #269 and #266 were filed for.

  ⚠️ **The vault-markdown-contract section carries six false statements as of Phase 5, not
  one.** The original wording of this AC named only "the `weight=`-leak paragraph", which is how
  #269 and #282 happened — a rewrite list that names one instance of a class and misses the rest.
  **The list itself then repeated the mistake twice:** it was written as four, missed Phase 5's own
  as a fifth, and missed a sixth that sits in the section *intro* rather than in the subsection
  item 2 sweeps (#293 round-2 review, M10). Each of these is now wrong and must be rewritten, not
  merely re-read:
  1. "the `<sets>x<reps>` slot means **target** sets×reps in a routine" — gone. The slot is
     `1x<reps>` in both documents and a routine line is one prescribed set.
  2. The whole **"Parse context and validation strictness"** subsection. The zero-reps divergence
     is deleted (AC5.4); `context` is consulted three times, not once; and both cited line numbers
     are stale. **The numbers to grep for are the ones AGENTS.md carries TODAY —
     `format.ts:424` (in the `knownFlags` sentence, which itself notes it "moved from :247" by
     #277) and `parse.ts` "line 211".** This AC previously cited `format.ts:247` and
     `parse.ts:171`, the *pre-#277* numbers, which appear nowhere in AGENTS.md — so an engineer
     grepping what the AC named would have found nothing and concluded the statements were already
     fixed (#293 round-2 review, M9).
  3. "`serializeRoutine` **does not** emit `target_weight_kg` and the grammar was deliberately not
     extended … wiring an export path means adding a **distinct** flag key" — it does emit it, and
     the distinct key is `target_weight`. The `weight=`-on-a-routine-line leak that paragraph
     records as open is closed: the flag allowlist is context-aware (AC5.3).
  4. "a malformed `0x10` or `3x0` line … under the context-dependent rules" — `3x0` is refused by
     the sets-slot rule now, and there are no context-dependent zero rules left.
  5. Nothing yet records the **`sets=0` entry marker** (#293 review, C1/C2) — that a routine line
     is one prescribed set unless it says `sets=0`, that all five prescribed fields are
     independently optional on a routine line, and that the cardio/stretch duration requirement
     and the strength sets×reps requirement are the SESSION's alone. This is the load-bearing half
     of the grammar: without the marker, an exercise line and a content-only set line are the same
     string, and the parser guessed — throwing on the first and silently dropping the second.
     Record the cardio/stretch **sets-slot prohibition** as the session's alone here too, per the
     amended AC5.8 — that is the one the round-1 fix missed.
  6. **The section INTRO (`AGENTS.md:415-422`), which items 1–5 do not reach.** Two things wrong in
     one paragraph, both found by the #293 round-2 review (M10):
     - "an earlier version of the **zero-reps guard below** was unconditional" — a dangling
       reference. AC5.4 deleted the zero-reps guard, so "below" now points at nothing. The PR #89
       regression the sentence exists to pin is still real and still pinned by the `reps: 0`
       roundtrip test; it is the *explanation* that has to be rewritten, not the test.
     - "42 of the interop suite's **59** tests involve parsing" — the counts are long stale. The
       suite is **210** tests as of Phase 5, of which **123** involve parsing (all of
       `parse.test.ts` and `roundtrip.test.ts`; `serialize.test.ts` and `format.test.ts` call
       neither `parseRoutine` nor `parseSession`). **The same stale `59` is duplicated in
       `parse.ts`'s own header docstring**, which is why the number drifted unnoticed — Phase 5
       corrected the copy in `parse.ts`, so AGENTS.md is now the only stale one. Prefer re-deriving
       both numbers to copying these: a hardcoded test count in prose goes stale by construction.

### per-set-routine.AC7: Cross-cutting gates

- **AC7.1** `npx tsc --noEmit` is clean at every phase boundary.
- **AC7.2** `npm test` is green at every phase boundary.
- **AC7.3** `npm run lint` is clean at every phase boundary.
- **AC7.4** After Phase 3 and again after Phase 6, a simulator pass: create **RAMP** via the coach,
  start it, and confirm the weight field opens at 20, then 25, then 40 lbs across the three warmup
  sets. *No suite can see this* — `src/app` is uncovered and `src/components`' JSX is excluded from
  `testMatch`.

## Glossary

- **Aggregate model** — the current shape: one `routine_exercises` row carrying counts and single
  target values for the whole exercise.
- **Per-set model** — the target shape: the row carries only per-exercise fields, and an ordered
  list of `routine_sets` rows carries the per-set prescription.
- **Set type** — `warmup` or `normal`, stored per set. Distinct from `session_sets.set_type`, which
  is the *logged* type (`warmup`/`working`/`stretch`/`cardio`) and is unchanged by this design.
- **Round** — engine `setIndex`. Under supersets it is a group-shared round number, not a per-entry
  logged-set count (AGENTS.md convention 9). Per-set does not change this.
- **Expand/contract** — the phasing shape: add the new representation alongside the old (expand),
  move consumers one at a time, then delete the old (contract).
- **Destructive bump** — raising `databaseSchema.version` past `migrations.maxVersion`, which makes
  WatermelonDB drop and recreate the database.

## Architecture

### The target shape

```
routine_exercises                     routine_sets
  routine_id       (indexed)            routine_exercise_id  (indexed)
  exercise_id      (indexed)            order                (0-based, within the exercise)
  order                                 set_type             'warmup' | 'normal'
  superset_group   (nullable)           target_reps          (nullable)
  rest_seconds     (nullable)           target_reps_max      (nullable)
  notes            (nullable)           target_weight_kg     (nullable)
                                        target_duration_seconds (nullable)
                                        target_distance_m    (nullable)
```

Five columns leave `routine_exercises`: `warmup_sets`, `target_sets`, `target_reps`,
`target_duration_seconds`, `target_weight_kg`. Three stay because they are genuinely per-exercise:
`rest_seconds`, `superset_group`, `order`.

`target_distance_m` is new and has no aggregate ancestor. It is added because Hevy sends it (the
Cycling entry carries `distance_meters: 2000`) and #267's plan records its loss as one of four
import problems; the column costs nothing and closes one of them outright.

### What Hevy actually sends, and where we deliberately differ

Fetched live from routine `760bdf23-0a80-4df3-a36d-4af1d55f370b`:

```json
{ "title": "Bench Press (Dumbbell)", "index": 1, "rest_seconds": 120,
  "notes": "↑ to 50 lb. …",
  "sets": [
    { "index": 0, "type": "warmup", "weight_kg": 9.071858188712795,  "reps": 5, "rep_range": {"start":5,"end":5} },
    { "index": 1, "type": "warmup", "weight_kg": 11.339822735890994, "reps": 5, "rep_range": {"start":5,"end":5} },
    { "index": 2, "type": "warmup", "weight_kg": 18.14371637742559,  "reps": 3, "rep_range": {"start":3,"end":3} },
    { "index": 3, "type": "normal", "weight_kg": 22.67964547178199,  "rep_range": {"start":8,"end":10} },
    …three more identical…
  ] }
```

Three points of deliberate divergence:

**Rest stays per-exercise.** Hevy also keeps `rest_seconds` on the exercise, not the set, so this is
agreement rather than divergence — but it is worth stating, because it is the one aggregate field
that is *not* moving and a reader may expect it to. `transition.lv:66` and `:99-100` both read
`currentEntry.restSeconds`, and nothing in the round-robin would know which set's rest to use during
a superset hop.

**Supersets stay a string label, not Hevy's integer `supersets_id`.** Hevy's ids are not ordered
ascending (this routine uses 5, 6, 7, then 4) and Hevy permits non-contiguous groups, which our
engine cannot represent at all: `h.group_end_idx` defines a group as a *contiguous* run and
convention 9's whole round-robin depends on it. Adopting the integer would buy nothing and would
imply a capability we do not have. Import maps `supersets_id: 5` to the string `"5"`. This answers
one of the issue's open questions rather than deferring it.

**`rep_range` is stored as two nullable columns, not a JSON pair.** `target_reps` alone means an
exact prescription; `target_reps` plus `target_reps_max` means a range. Hevy's own data shows why:
it emits `rep_range: {start:5, end:5}` for exact prescriptions, which is a range that is not a
range, and collapsing that on import to a bare `target_reps: 5` is both correct and lossless.
Two columns also keep the existing single-`targetReps` read sites working during the expand phases
by simply ignoring the max, which a JSON blob would not.

### The engine: what changes, and what emphatically does not

Verified by execution (§Findings). Restated here as the design commitment:

`rules/types.lv` gains `RoutineSet` and `RoutineEntry` becomes:

```
alias RoutineEntry = { exerciseId: String, kind: String, restSeconds: Int,
                       supersetGroup: Option(String), sets: List(RoutineSet) }
```

The record stays **closed**, so convention 6 is unchanged in force: `toRillRoutineEntry` and
`fromRillState` still rebuild field by field, and a stray field bolted onto the TS type still
vanishes at the first dispatch. What changes is that the thing crossing the boundary is now a list
of records rather than four integers — and PROBE 4/5 confirm the bridge and the `ReplaceExercise`
rebuild both carry it intact.

`helpers.lv` — three predicates change and one function is added, all quoted in §Findings.
`transition.lv` — four lines. `advance_after_set` — nothing.

**Convention 9 is unchanged in substance and its soundness argument gets *shorter*.** The docstring
currently has to argue that a member's visit count equals the shared round number, and hedge that
this "is a visit count, not strictly a logged-set count". Under per-set, `next_active_idx`'s
predicate `round < length(entry.sets)` says the same thing about a list the entry actually owns, and
the guard that depended on the argument (convention 7's `setIndex == 0`) is unaffected.

**Convention 10 simplifies.** "A zero-set entry is never landed on, only skipped past" becomes "an
entry with an empty set list is never landed on". The arithmetic disappears; the machinery
(`next_active_landing`'s group-start tracking, the `StartSession` `Err`, the group-exhausted
landing) is untouched and was verified intact against the skipped-group case.

**Convention 8's sentinels are not extended.** `SENTINEL_TO_OPTION_MAP` stays exactly as it is.
`RoutineSet`'s optional fields are new surface with no legacy read sites to protect, so they cross
as honest `undefined` and read sites use `!= null`. Adding five new sentinels would grow the
`-1`-renders-as-`RPE: -1` hazard class for no benefit. The one thing this costs is a test
convention: `rillToJs` omits `None` keys, so expectations use `toEqual` (AC2.12).

### The prefill precedence rule mostly dissolves

AGENTS.md documents a three-way rule: a prescription overrides history and is outranked by the
exercise's own last set this session. That rule exists because a *per-exercise* prescription is one
number applied to every set, so it needed a careful story about when it should and should not win.

Per-set, the prescription is attached to the set being performed, and the rule collapses to two
terms: this session's own last set for the exercise still wins (the athlete adjusting load mid-workout
is newer information than the plan), and otherwise the set's own `target_weight_kg` is used, falling
back to history when it is null. The `updateRoutineExerciseExerciseId` clear survives and gets
*more* important — a substitute inheriting a seven-step ramp is worse than inheriting one number —
and `routineRevision`'s ordering contract is unchanged.

### The markdown grammar: a routine line becomes a set line

This is the design's one genuinely open shaping decision, and the recommendation is to **unify
rather than fork**.

A session document already emits one line per logged set, using the `<sets>x<reps>` slot as
`1x<logged-reps>`. A routine document emits one line per *exercise*, using the same slot as
`<target-sets>x<target-reps>`. That overload is documented at `format.ts:24-28` and is the source of
the context-dependent validation asymmetry (`3x0` rejected in a routine, `1x0` accepted in a
session) that `parse.ts` consults its `context` parameter for.

Under a per-set model the routine document should emit **one line per prescribed set**, which makes
the two contexts the same shape:

```
- bench-press-db: 1x5  set_type=warmup target_weight=9.07 rest=120
- bench-press-db: 1x5  set_type=warmup target_weight=11.34 rest=120
- bench-press-db: 1x3  set_type=warmup target_weight=18.14 rest=120
- bench-press-db: 1x8  reps_max=10 target_weight=22.68 rest=120
…
```

`parseRoutine` groups consecutive same-exercise-id lines into one entry with an ordered set list —
mechanically the same grouping `groupSupersets` already does for adjacent same-label lines. The
`<sets>x<reps>` overload disappears, the zero-reps context rule disappears with it (AC5.4), and
`format.ts`'s grammar has one line shape instead of two.

The cost is verbosity: **RAMP** becomes seven lines. That is the honest representation of seven
prescribed sets, and it is what makes the document diffable — changing one warmup weight changes one
line. The alternative considered and rejected was a bracketed set list in the sets slot
(`[w 5x20, w 5x25, …]`), which is a new sublanguage inside a slot, needs its own tokeniser, and
would have made `parse.ts` and `serialize.ts` harder to keep symmetric — the exact property #262
keeps `parse.ts` alive to protect.

**`parse.ts` is rewritten, not deleted.** It has no production caller and is kept deliberately
(#262) as the mechanism enforcing serializer symmetry and as `exportService.test.ts`'s oracle. A
grammar change is precisely the moment that contract earns its keep, and AC5.2's round-trip is the
test that proves the new grammar is symmetric before anything depends on it.

### Relationship to #267 and draft PR #275

| #267 phase | Fate |
|---|---|
| **Phase 1** — "Make the grammar say what a routine means" (`target_weight=` flag, close the `weight=` leak, fix `@hint` tokenising) | **Superseded and absorbed.** Its `target_weight=` flag lands here in Phase 5, but on a *set* line, not an exercise line — shipping it first against the aggregate shape would put the key in the wrong place and then move it. The `weight=` leak fix and the `@hint` tokeniser fix are genuinely independent grammar defects: **the `@hint` fix should be split out and shipped now**, since nothing about it depends on the model. |
| **Phase 2** — "Get a file out" (export screen, share sheet, `exportOutcome`) | **Survives unchanged.** It is screen and file-system work over whatever `serializeRoutine` produces. Its one trap — widening `SectionRow.href` — is unrelated. Sequence it after this design's Phase 5. |
| **Phase 3** — "Read our own file back" (Files picker, import) | **Survives, marginally smaller.** The apply-to-DB path is still `upsertRoutine`. Its AC that a zero-set entry is invalid gets *easier*: an empty set list is directly checkable rather than an arithmetic sum. |
| **Phase 4** — "Import a routine from the Hevy API" | **Gets substantially smaller.** This is the payoff. |

#267's plan records four Hevy mapping losses. Per-set resolves three of them:

| Loss | Under per-set |
|---|---|
| Warmup weight ramp — "the ramp is unrecoverable" | **Resolved.** Each warmup set is a row with its own weight. |
| `rep_range {start,end}` collapsed to one `target_reps` — "the range is destroyed" | **Resolved.** `target_reps` + `target_reps_max`. |
| Per-set `weight_kg` collapsed to the heaviest normal set — "per-set variation collapses" | **Resolved.** Each set keeps its own weight. |
| `distance_meters` dropped — no column | **Resolved by adding `target_distance_m`**, which is cheap once a set table exists. |

So the import lossiness report shrinks from four entries to essentially one:
`exercise_template_id` is still not stored, which affects re-import matching, not fidelity. #267's
Phase 4 ACs about counting set types to derive `warmupSets`/`targetSets` become unnecessary — there
is nothing to count, the sets map one-to-one.

**Recommended sequencing:** split #267's `@hint` tokeniser fix out and ship it immediately; hold the
rest of #275 until this design's Phase 5 lands, then rewrite #267's Phase 1 as a thin
"grammar already done" note and renumber.

## Existing Patterns

- **Expand/contract with a derivation seam.** `toRillRoutineEntry` (`src/engine/index.ts:53-65`) is
  already the single translation point between the TS entry and the Rill record. Phases 2–5 make it
  prefer `entry.sets` and derive one from the counts when absent; Phase 6 deletes the fallback. No
  other file needs to know a transition is in progress.
- **Row-identity stability under reconciliation.** `upsertRoutine` claims existing
  `routine_exercises` rows by `exerciseId`, oldest `order` first, so surviving exercises keep their
  row ids and `session_sets.routine_exercise_id` stays valid. `routine_sets` needs no such care —
  nothing references those rows — so they are replaced wholesale per exercise, which is simpler and
  is why AC1.4 asserts the *exercise* row id survives while the set rows do not.
- **The layer-2 stamp before an invalidating write.** `updateRoutineExerciseExerciseId` and
  `upsertRoutine`'s drop branch both stamp null-stamped `session_sets` with the outgoing
  `exercise_id` inside the same `database.write` before re-pointing or destroying. Both gain a set-row
  operation in that same write; `replaceRoutineExercise.test.ts`'s competing-writer test (#225) is
  the fixture that catches a hoist into a second write.
- **Structural criteria where nothing can test.** `src/state/activeSession.callSites.test.ts` reads
  `src/app/*.tsx` as text from the covered node project. AC3.10 uses the same technique for
  `session.tsx`'s dependency-array entry.
- **The v4 undeclare-don't-drop migration.** `migrations.ts`'s `toVersion: 4` entry with `steps: []`
  and its explanatory comment is the exact precedent Phase 6 follows.
- **`!= null`, not `!== undefined`.** WatermelonDB returns `null` for unset optional columns. Every
  `routine_sets` read site inherits this, and `exportService.ts`'s boundary normalisation (`??
  undefined`) is kept as the second layer.

## Implementation Phases

Six phases. Phases 1–5 are additive — the aggregate columns remain on `routine_exercises`, remain
written, and every unmigrated consumer keeps working. Phase 6 contracts.

**On phase size.** Phase 2 and Phase 3 are the large ones, and deliberately so. Phase 2 must change
all three `.lv` files, `engine/types.ts` and `engine/index.ts` together, because the Rill record is
closed: a half-per-set rule set does not type-check. Phase 3 must move every presenter that reads a
count in the same phase it changes `deriveSetPosition`, because they share the derivation. Splitting
either would red `main`. A big honest phase beats a small phase that reds `main`.

<!-- START_PHASE_1 -->
### Phase 1: The set list exists in the database

**Goal:** `routine_sets` exists, is written and read, and the destructive bump has happened. Nothing
outside `src/db` knows yet; the aggregate columns are still present and still written.

**Components:**
- `src/db/schema.ts` — `version: 5 → 6`; add the `routine_sets` table. `routine_exercises` is
  **unchanged** in this phase.
- `src/db/migrations.ts` — **no `toVersion: 6` entry**, with a comment explaining that the omission
  is the mechanism (§Findings) and citing the wipe.
- `src/db/models/RoutineSet.ts` (new) — the model, `belongs_to routine_exercises`.
- `src/db/models/RoutineExercise.ts` — `@children('routine_sets')`.
- `src/db/repository.ts` — `RoutineSetEntry` on `RoutineExerciseEntry`; `upsertRoutine` writes the
  set list *and* keeps writing the derived aggregates (`warmup_sets` = count of warmup sets,
  `target_sets` = count of normal sets, `target_reps` = the first normal set's reps) so no existing
  reader breaks; the drop branch destroys set rows; `updateRoutineExerciseExerciseId` clears every
  set's weight; a `getRoutineSets(routineExerciseId)` reader.
- `src/db/migrations.test.ts` — **the v1-walk test at lines 70-85 throws a `TypeError` under this
  change** and must be rewritten to assert `null` (AC1.7); `line 11`'s `toBe(5)` becomes `toBe(6)`
  and its title updated.
- `src/app/_layout.tsx` + a new pure `src/state/schemaResetNotice.ts` — the one-time
  "routines were reset" notice, with the decision logic in the covered node project and the
  rendering in the uncovered screen.
- `src/db/repository.test.ts`, `src/db/replaceRoutineExercise.test.ts` — **RAMP**, **RANGE**,
  **EMPTY**, the row-id-survives case, the competing-writer case.

**Dependencies:** None.

**Covers:** `per-set-routine.AC1.1` – `per-set-routine.AC1.9`

**Testing reality:** fully test-backed (`src/db` is in `testMatch`), except AC1.8's rendering, which
is a structural read of `_layout.tsx` plus a simulator check deferred to AC7.4.

**Done when:** `npm test` green (all suites, not just `src/db` — the version bump is visible to
`migrations.test.ts` only, but confirm); `tsc --noEmit` clean; a pre-existing v5 database opens at
v6 empty, with the warn logged.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: The engine advances by set list

**Goal:** The Rill core is fully per-set and proven against the hard conventions. The shell is
unchanged because `RoutineEntry.sets` is optional on the TS side and derived when absent.

**Components:**
- `src/engine/rules/types.lv` — `RoutineSet`; `RoutineEntry` loses the four count/target fields and
  gains `sets`.
- `src/engine/rules/helpers.lv` — `phase_for` rewritten as the `match … { Ok/Err }` form;
  `set_type_at` added; `next_active_idx:97` and `next_active_landing:133` key on `length(entry.sets)`.
- `src/engine/rules/transition.lv` — the four lines in §Findings, and nothing else.
- `src/engine/types.ts` — `RoutineSet`; `RoutineEntry.sets?: RoutineSet[]` **optional**, which is
  what keeps this phase from breaking 20 shell files.
- `src/engine/index.ts` — `toRillRoutineEntry` uses `entry.sets` when present and otherwise expands
  the counts into a flat list (lossless in that direction); `fromRillState` emits `sets` *and*
  re-derives the counts so existing readers see no change.
- `src/engine/*.test.ts` — the suites that build entries from counts keep working via the
  derivation; new per-set cases for **RAMP**, **INTERLEAVE**, **MISMATCH**, **EMPTY**, and the
  skipped-group landing.

**Dependencies:** None technically (the derivation makes it self-contained), but meaningless before
Phase 1 supplies real set lists.

**Covers:** `per-set-routine.AC2.1` – `per-set-routine.AC2.12`

**Testing reality:** fully test-backed (`src/engine` is in `testMatch`). AC2.10 is a
read-and-record on the diff. **Note:** after editing any `.lv`, Metro's transform cache keys on the
importing TS file, so restart with `npx expo start --clear` before any simulator work (AGENTS.md
convention 4).

**Done when:** `npm test` green; `tsc --noEmit` clean; `loadRules()` type-checks; the four-line
`transition.lv` diff recorded in the PR.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: The session reads the plan set by set

**Goal:** A warmup ramp is visible end to end — stored, started, labelled and prefilled. This is the
phase where the feature becomes real.

**Components:**
- `src/state/startSessionFromRoutine.ts` — populate `entry.sets` from `routine_sets`; the
  all-empty-set-lists guard replaces the sum guard.
- `src/state/sessionPresenter.ts` — `deriveSetPosition` counts preceding same-typed sets;
  `setPositionLabel` and `isLastSetOfExercise` read the list; `computeSetPrefill` takes the current
  set's own weight and reps and the precedence collapses to two terms.
- `src/state/restCommentaryStore.ts`, `src/ai/restCommentaryPrompt.ts` — the *second*, independent
  `setPosition` builder AGENTS.md names; its zero-total guard becomes an empty-list guard.
- `src/state/routineDetailPresenter.ts`, `routineListPresenter.ts`, `todayStartPresenter.ts` —
  `hasActiveExercise` becomes "has a non-empty set list"; `ExerciseDetail` carries the set list.
- `src/state/sessionDetailPresenter.ts` — reads the plan for the `Set N` label; no total, so no
  guard needed, but the plan lookup moves.
- `src/state/exerciseReplaceStore.ts` — `routineRevision` unchanged; the swap now clears a list.
- `src/app/session.tsx`, `src/app/routine/[id].tsx`, `src/app/workout/[id].tsx` — consume the
  presenters. **Uncovered by every suite.**
- `src/components/SetLogger.tsx`, `ExerciseStopwatch.tsx` — read the new presenter fields.
  **Uncovered:** `testMatch` includes `components` but the pattern is `*.test.ts`, so JSX is
  excluded — only `restAlert.test.ts` and `timerSoundPlayer.test.ts` run there.
- `src/watch/schedule.ts` — reads counts for the watch summary; move to list length. **Covered**
  (`watch` is in `testMatch`).
- Tests: `sessionPresenter.test.ts`, `startSessionFromRoutine.test.ts`, the four presenter suites,
  `restCommentaryPrompt.test.ts`, `exerciseReplaceStore.test.ts`.

**Dependencies:** Phases 1 and 2.

**Covers:** `per-set-routine.AC3.1` – `per-set-routine.AC3.10`

**Testing reality:** `src/state`, `src/ai` and `src/watch` are covered. `src/app` and the two JSX
components are **not** — AC3.10 is a structural read of `session.tsx:303` (precedent:
`src/state/activeSession.callSites.test.ts`), and the ramp-prefill behaviour needs the AC7.4
simulator pass. Deleting `session.tsx`'s dependency-array entry passes every test; only the
structural read catches it.

**Done when:** `npm test` green; `tsc --noEmit` clean; the AC7.4 simulator pass on **RAMP** with
screenshots; AC3.10's structural line recorded in the PR.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: The coach drafts per-set

**Goal:** All three declarations carry a set list, together, and an accepted draft writes it.

**Components:**
- `src/ai/draftSchema.ts` — `DraftSet`; `DraftExercise.sets`; `AI_TURN_SCHEMA`'s nested array (no
  `minItems`); `validateRoutineDraft` gains the per-set bounds and the non-empty-list rule that the
  schema cannot express.
- `src/ai/contextBuilder.ts` — `personaSection()` rewritten for the per-set contract;
  `formatExerciseLine` renders the set list; `formatTarget` (the debrief) likewise.
- `src/ai/acceptDraft.ts` — `lbsToKg` per set, once.
- `src/ai/alternatesPrompt.ts`, `exerciseQuestionPrompt.ts`, `restCommentaryPrompt.ts` — target
  summaries read the list.
- `src/app/ai-coach.tsx` — draft rendering. **Uncovered.**
- `src/ai/contextBuilder.test.ts` — the **five** exact-string assertions at lines 62, 87, 94, 113 and
  122 all break and are rewritten, not deleted (AC4.7, AC4.8).
- `src/ai/provider/subset.test.ts:370` — the `AI_TURN_SCHEMA` inline snapshot; reviewed `jest -u`,
  diff in the PR (AC4.10).
- `src/ai/draftSchema.test.ts`, `acceptDraft.test.ts`, `alternatesPrompt.test.ts`.

**Dependencies:** Phase 1 (somewhere to write), Phase 3 (something that reads it).

**Covers:** `per-set-routine.AC4.1` – `per-set-routine.AC4.12`

**Testing reality:** `src/ai` is covered. Per AGENTS.md and the *prompt-wording-needs-a-live-run*
lesson, the persona tests pin wording against drift but **cannot prove the model obeys it** — this
phase needs one live call per surface producing a valid per-set draft, and the outcome recorded in
the PR body.

**Done when:** `npm test` green; `expectStructuredOutputSafe(AI_TURN_SCHEMA)` passes; `tsc` clean;
one live coach conversation produces a **RAMP**-shaped draft that `acceptDraft` stores with seven
distinct-then-repeating weights.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: The markdown grammar goes per-set

**Goal:** `serializeRoutine` emits one line per set, `parseRoutine` reads it back, and the two stay
symmetric.

**Components:**
- `src/interop/format.ts` — the routine line shape; `target_weight` and `reps_max` join
  `knownFlags` (line 247), made context-aware so `weight=` is refused on a routine line; the
  `<sets>x<reps>` routine overload removed from the grammar doc.
- `src/interop/serialize.ts` — `serializeRoutine` iterates the set list. `serializeSession` and
  `buildSessionSetLine` are **untouched**.
- `src/interop/parse.ts` — group consecutive same-exercise-id routine lines into a set list; delete
  the context-dependent zero-reps rule (AC5.4).
- `src/export/exportService.ts` — pass the set list through the row-to-serializer mapping with
  `?? undefined` normalisation, as it already does for every optional column.
- `src/interop/__tests__/roundtrip.test.ts` — the five routine round-trip tests rewritten; a **RAMP**
  round-trip added; **every session round-trip test must pass unmodified** (AC5.5).
- `src/interop/__tests__/parse.test.ts`, `serialize.test.ts` — the routine-shaped cases.

**Dependencies:** Phase 1 (the shape to serialize).

**Covers:** `per-set-routine.AC5.1` – `per-set-routine.AC5.8`

**Testing reality:** `src/interop` and `src/export` are covered, and this is the best-tested phase —
`parse.ts` exists precisely to be the round-trip oracle (#262). No simulator work; nothing here has
a screen yet.

**Done when:** `npm test` green with the session round-trips **unmodified**; `tsc` clean;
`parse(serialize(RAMP))` returns seven sets in order.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Contract — the aggregates are gone

**Goal:** Delete the old representation and the scaffolding that bridged to it. The point of no
return.

**Components:**
- `src/db/schema.ts` — `version: 6 → 7`; remove `warmup_sets`, `target_sets`, `target_reps`,
  `target_duration_seconds`, `target_weight_kg` from `routine_exercises`.
- `src/db/migrations.ts` — `toVersion: 7` with `steps: []`, comment citing v4.
- `src/db/models/RoutineExercise.ts` — drop the five `@field`s.
- `src/db/repository.ts` — stop writing the derived aggregates; delete `getRoutineTargetWeightsKg`.
- `src/engine/types.ts` — `RoutineEntry.sets` becomes required.
- `src/engine/index.ts` — delete both derivation directions in `toRillRoutineEntry` /
  `fromRillState`.
- Every remaining fallback branch across `src/state`, `src/ai`, `src/interop`, `src/watch`,
  `src/app` — located mechanically by AC6.2's `rg`.
- `src/state/sessionPresenter.ts.backup` — deleted.
- `AGENTS.md` — the rewrite described in AC6.5. This is substantial: conventions 3, 6, 8, 9 and 10,
  the `target_weight_kg` precedence paragraph, the `weight=`-leak paragraph, the zero-planned-set
  rule in Boundaries, and the structure section all describe the aggregate model today.
- `docs/design-plans/2026-08-16-routine-import-export.md` — a note recording which of its phases
  this design superseded.

**Dependencies:** Phases 1–5, all merged.

**Covers:** `per-set-routine.AC6.1` – `per-set-routine.AC6.5`

**Testing reality:** AC6.2's `rg` is the mechanical guard and is the most valuable criterion in the
phase. AGENTS.md correctness (AC6.5) is a human read — no test can see it, and #266 and #269 are
both instances of exactly this going wrong.

**Done when:** `npm test` green; `tsc` clean; AC6.2's `rg` returns zero; a v6 database opens at v7
**without** wiping; the AC7.4 simulator pass repeated; AGENTS.md describes only code that exists.
<!-- END_PHASE_6 -->

### AC × phase matrix

| AC | Phase | Automated? |
|---|---|---|
| AC1.1 – AC1.7, AC1.9 | 1 | yes (`src/db`) |
| AC1.8 | 1 | partly — pure logic yes (`src/state`), rendering is structural + simulator |
| AC2.1 – AC2.9, AC2.11, AC2.12 | 2 | yes (`src/engine`) |
| AC2.10 | 2 | read-and-record on the diff |
| AC3.1 – AC3.9 | 3 | yes (`src/state`, `src/ai`, `src/watch`) |
| AC3.10 | 3 | yes — **structural read** of `src/app/session.tsx` from the node project |
| AC4.1 – AC4.12 | 4 | yes (`src/ai`); AC4.7/AC4.8 additionally need a live model call |
| AC5.1 – AC5.8 | 5 | yes (`src/interop`, `src/export`) |
| AC6.1, AC6.3, AC6.4 | 6 | yes (`src/db`, `tsc`) |
| AC6.2 | 6 | yes — one `rg` |
| AC6.5 | 6 | **no — human read of AGENTS.md** |
| AC7.1 – AC7.3 | **gate on every phase** | yes (`tsc`, `jest`, `lint`) |
| AC7.4 | after 3 and again after 6 | **no — simulator** |

**Totals: 56 criteria — 50 automated, 6 needing a human or a device** (AC1.8's rendering half,
AC2.10, AC4.7/AC4.8's live call, AC6.5, AC7.4).

Every AC belongs to exactly one phase's *Covers* list, with the single deliberate exception of
AC7.1–AC7.3, which are per-phase **gates** and appear in every phase's *Done when* instead —
recording them against one phase would be false, since a phase that leaves `tsc` broken is not done
whichever phase it is. AC7.4 runs twice by design: once when the ramp first becomes visible
(Phase 3) and once after the scaffolding is removed (Phase 6), because the second run is what proves
the contract step did not quietly break the path the first run verified.

**Consequence sweep.** Four pieces of work land in a different area from the phase that causes them:

- **Clearing every set's weight on an exercise swap** is a consequence of the set table existing
  (Phase 1) and lands in `src/db/repository.ts`. Kept in Phase 1 so the table never exists without
  its swap rule, exactly as the coach-prescribed-weights plan kept its single-column clear in the
  phase that added the column.
- **The schema-reset notice** (AC1.8) is a consequence of Phase 1's destructive bump but lands in
  `src/app/_layout.tsx`, which no other phase touches. Assigned to Phase 1: the phase that wipes the
  user's data owns telling them.
- **The `AI_TURN_SCHEMA` inline snapshot** (`src/ai/provider/subset.test.ts:370`) breaks in Phase 4
  and lives in a directory nothing else in this change touches. Assigned to Phase 4 — the phase that
  trips a tripwire owns re-approving it.
- **AGENTS.md** is a consequence of all six phases and is assigned wholly to Phase 6. The gap is
  real and accepted: between Phases 1 and 6, AGENTS.md describes a model that is half true. The
  alternative — amending it six times — produces five intermediate states that are each *also* half
  true and cost five reviews. Phase 6's AC6.5 is the single point where it becomes correct again.

### Value-pinning tests that break, and in which phase

Following the coach-prescribed-weights plan's hard-won lesson that greenness is not only `tsc`:

| Assertion | Breaks in | Why |
|---|---|---|
| `src/db/migrations.test.ts:11` — `expect(databaseSchema.version).toBe(5)` | 1 | direct version bump |
| `src/db/migrations.test.ts:70-85` — the v1-walk | 1 | **throws `TypeError`**, not just fails: `stepsForMigration` returns `null` and the test calls `.map` on it. This is the design working correctly. |
| `src/ai/contextBuilder.test.ts:62, 87, 94, 113, 122` — five exact-string persona assertions | 4 | every bound sentence is restated per-set |
| `src/ai/provider/subset.test.ts:370` — `AI_TURN_SCHEMA` inline snapshot | 4 | reviewed `jest -u` |
| `src/db/migrations.test.ts` (again) | 6 | a `fromVersion: 6, toVersion: 7` case must be added asserting a non-null `[]`, distinguishing Phase 6's *non*-destructive bump from Phase 1's destructive one |

The second row is the instructive one, and it is the same class of trap the coach-prescribed-weights
plan flagged: it fails *because the work was done right*, which is exactly the kind of gate failure
that makes an implementer doubt a correct change and "fix" it by adding the migration entry that
would defeat the whole design.

## Rollback

This is the largest change the app has undergone, so "abandon halfway" needs a real answer.

**Phases 1–5 are individually revertable and cumulatively abandonable.** Because they are additive,
the app at the end of any of them is a working app that happens to carry two representations of the
same plan, with the aggregates still authoritative for anything not yet moved. Concretely:

- **Abandon after Phase 1.** A `routine_sets` table exists with rows nothing reads. The user's data
  was wiped, which is the one irreversible act, and it happened in the first phase by design — so
  the cost of abandoning is paid up front rather than discovered late. Reverting the schema version
  to 5 would wipe *again*; the correct abandonment is to leave v6 in place and delete the unread
  table in a later v7 undeclare.
- **Abandon after Phase 2.** The engine is per-set internally but fed by derived lists, so behaviour
  is identical to today. This is a pure refactor at that point and can simply be left.
- **Abandon after Phase 3.** Ramps work in the session flow but cannot be authored — the coach still
  writes aggregates and the only source of a real ramp would be a hand-edited database. Usable but
  pointless; revert Phase 3 alone if desired, since Phases 1–2 do not depend on it.
- **Abandon after Phase 4 or 5.** Fully functional. The residue is the derivation scaffolding in
  `toRillRoutineEntry`/`fromRillState` and five dead columns. That is untidy, not broken, and can sit
  indefinitely.

**Phase 6 is the point of no return**, and only because reverting it means re-declaring five columns
whose data was never written during Phases 1–5's additive period... which is not actually true — they
*were* written, as derived values. So even Phase 6 is revertable: re-declare the columns at v8 and
the derived values are still in the SQLite file, since v7 undeclares rather than drops. **There is
no genuinely irreversible step after Phase 1's wipe.** That is worth knowing before starting, and it
is a direct consequence of choosing undeclare-don't-drop over a real column removal.

**The one thing that cannot be rolled back is the user's existing routines**, destroyed in Phase 1.
Before Phase 1 merges, pull the on-device database off the phone as a keepsake — AGENTS.md's
`devicectl device copy from` recipe, remembering the memory note that `.db` alone gives a stale
snapshot and the `-wal` and `-shm` files must come too. It will not be restorable into the new
schema, but it is the only record of what the routines were, and the coach can be shown it to
rebuild them in one conversation.

## Open decisions

Four questions I could not answer for you. Everything else that was open on the issue —
per-set weight (settled by you), rep ranges, superset representation, grammar shape — is answered in
§Architecture rather than asked here.

1. **Does the schema-reset notice (AC1.8) block, or just inform?**
   - *(a)* A dismissible banner on first launch after the wipe.
   - *(b)* A modal the user must acknowledge before reaching the app.
   - *(c)* Nothing — accept the silent `logger.warn`.
   - **Recommendation: (a).** The data is already gone by the time anything renders, so a modal buys
     no decision, only friction. (c) is what the framework does by default and is how a deliberate
     wipe comes to look like a bug.

2. **Should the routine markdown carry a rep range as `8-10` in the reps slot, or as a `reps_max=`
   flag?**
   - *(a)* `1x8 reps_max=10` — the flag form assumed in Phase 5 and AC5.3.
   - *(b)* `1x8-10` — compact, but it changes the `<n>x<n>` token's shape, which `parse.ts:151`
     matches with `/^\d+x\d+$/` and which session lines share.
   - **Recommendation: (a).** The whole point of the grammar change is to make routine and session
     lines the *same* shape; (b) reintroduces a routine-only token variant, which is the fork this
     design is trying to remove. (a) costs eight characters.

3. **Should `rest_seconds` stay per-exercise, or move per-set?**
   Hevy keeps it per-exercise and so does this design (§Architecture), and I am confident that is
   right for the engine — but it forecloses drop sets with zero rest between drops and full rest
   after, which is one of the four patterns the issue names as motivating the change. Making it
   per-set is not hard *in the data*, but `transition.lv:66` and `:99-100` read
   `currentEntry.restSeconds` and would need to read the just-completed set's, which touches
   `advance_after_set` — the one function this design currently leaves byte-identical.
   - **Recommendation: keep it per-exercise this cycle**, and raise a follow-up card for per-set rest
     once the model has landed. It is the only item in the issue's motivation that this design does
     not fully deliver, and doing it now would give up the plan's strongest property.

4. **Do you want #267's `@hint` tokeniser fix split out and shipped before this lands?**
   It is an independent grammar defect (a routine note cannot hold a sentence today), it blocks
   nothing, and it is the only part of #275's Phase 1 that does not depend on the model shape.
   - **Recommendation: yes, split it out now.** #275 is otherwise paused behind six phases, and this
     fix is worth more shipped than shelved. If you prefer, it can instead ride along inside this
     design's Phase 5, which touches `format.ts` anyway.
