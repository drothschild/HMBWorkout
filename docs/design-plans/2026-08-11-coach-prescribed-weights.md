# Coach-Prescribed Weights Design

## Summary

The AI coach can already prescribe sets, reps, duration and rest, but not load. This design adds a
nullable `target_weight_kg` column to `routine_exercises`, a `targetWeightLbs` field to the AI draft
contract, and a new precedence rule in the SetLogger's prefill so that a prescription **overrides**
the history-derived weight rather than merely filling a gap. When the coach programs 185 and last
week's log says 175, the weight field opens at 185.

The approach is five independently-mergeable phases, each leaving `tsc --noEmit` clean and
`npm test` green. Every type this change touches gains an **optional** field, so no consumer is
broken by widening and no phase strands another — there is no exhaustive-union hazard here. That
argument covers *type* consumers only, though: three existing tests pin current **values** of things
this change edits (a schema-version literal, an enumerated migration-step list, and an inline
snapshot of the whole AI turn schema), and updating each is named work inside the phase that breaks
it. Two decisions carry most of the design weight. First, the
prescription **does not cross into engine state**: the Rill `RoutineEntry` is a closed record that
silently drops unknown fields (engine convention 6), no rule branches on load, and the shell already
has an established pattern for resolving per-entry display data against the DB (`exerciseTitles`,
`routineDisplay`). Second, the coach **speaks lbs**, because it already *reads* lbs — the prompt
renders history through `formatWeightLbs` — and the single write-side conversion boundary is
`acceptDraft`. The one place this design deliberately contradicts an existing documented invariant is
`updateRoutineExerciseExerciseId`, which today leaves the whole prescription alone on an exercise
swap; because the new field overrides history rather than deferring to it, a stale load left behind
by a swap is worse than no prescription at all, so the swap clears it.

## Definition of Done

1. **A routine entry can carry a prescribed weight.** `routine_exercises` has a nullable
   `target_weight_kg` column at schema v5 with a real `addColumns` migration, and `upsertRoutine`
   writes and clears it under the same "absent fields are cleared" contract as every other optional
   target.

2. **The coach can prescribe one.** `DraftExercise` carries `targetWeightLbs`, `AI_TURN_SCHEMA`
   declares it, `validateRoutineDraft` bounds it, and `personaSection()` states the bound — all three
   declarations moved together, per AGENTS.md's *one turn shape, three declarations* rule. The
   schema still passes `expectStructuredOutputSafe`.

3. **The coach can read its own prior prescription back**, so it can program progression rather than
   re-deriving load from logs every turn. `ExerciseDetail` carries it and `formatExerciseLine`
   renders it in lbs.

4. **The prescription overrides the history-derived prefill.** `computeSetPrefill` applies it ahead
   of the cross-session history fallback but behind the exercise's own last set *this* session.

5. **A routine with no prescription behaves exactly as it does today**, guaranteed structurally: the
   column is nullable, the field optional, and the prefill's prescription branch is skipped entirely
   when it is absent, leaving the existing precedence chain untouched.

6. **No `.lv` file is modified and no engine type is widened.** The prescription is shell-side data.

7. **`npx tsc --noEmit` is clean and `npm test` is green** at every phase boundary. `main` is green
   as of `eb0afe0` (86 suites, 1582 tests), so this is an unqualified gate — an earlier draft of this
   plan carried a carve-out for `src/interop/migrate.test.ts`, which #219/#220 has since deleted.

**Out of scope:** displaying the prescription anywhere other than as the input's default (no "Coach:
185 lbs" badge on the routine screen or SetLogger); extending the vault markdown grammar; a manual
UI for a user to set a target weight by hand; per-set weight ramps (a prescription is one number for
the whole entry); auto-progression without the coach.

## Acceptance Criteria

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

### coach-prescribed-weights.AC3: The coach reads its own prescription back
- **coach-prescribed-weights.AC3.1 Success:** `routineDetailPresenter` populates
  `ExerciseDetail.targetWeightKg` from `re._raw.target_weight_kg`.
- **coach-prescribed-weights.AC3.2 Success:** `formatExerciseLine` renders a prescribed entry with a
  weight segment in lbs (via `formatWeightLbs`), matching the unit the "Recent Training History"
  section already uses.
- **coach-prescribed-weights.AC3.3 Edge:** An entry with no prescription renders exactly the line it
  renders today — no weight segment, no stray separator.

### coach-prescribed-weights.AC4: The prescription overrides history in the prefill
- **coach-prescribed-weights.AC4.1 Success:** With a prescription of 185 lbs and a history fallback
  of 175 lbs, `computeSetPrefill` returns `weightLbs: 185`.
- **coach-prescribed-weights.AC4.2 Success:** In that same case, `reps` still comes from the history
  fallback — the prescription overrides the weight field only.
- **coach-prescribed-weights.AC4.3 Success:** When the exercise already has a set logged this
  session, that set's weight wins over the prescription.
- **coach-prescribed-weights.AC4.4 Success:** With a prescription, no history and no in-session set,
  the result carries the prescribed `weightLbs` and `reps` from `entry.targetReps` — and, with
  `entry.targetReps = 0`, the prescribed `weightLbs` alone. The second invocation is the only one that
  reaches the terminal fallback carrying a prescription and nothing else.
- **coach-prescribed-weights.AC4.5 Edge:** For a duration-based entry (`isDurationBasedEntry`), the
  prescription is ignored and the duration path is unchanged — verified both with **and without** a
  usable in-session duration set. Without one, the duration branch returns a fresh object that never
  consults the prescription, so that invocation alone cannot discriminate.
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
  present — the same failure as AC4.8, one branch further down.
- **coach-prescribed-weights.AC4.10 Edge:** A history fallback carrying weight but no usable reps,
  plus a prescription, yields the prescribed weight and **no** reps — exactly the reps behaviour the
  same input produces with no prescription. The presence of a prescription never changes the reps
  field.
- **coach-prescribed-weights.AC4.11 Structural:** No non-terminal return in `computeSetPrefill` is
  gated on a predicate computed from the accumulating `prefill` object, in any spelling. Each
  non-terminal return's condition is computed from its own source (the logged set, or
  `historyFallback`). `Object.keys(prefill).length` is the form both known defects took and must
  appear only in the terminal return, but the criterion is the class, not the token.
- **coach-prescribed-weights.AC4.12 Success:** An in-session logged set with reps but no weight, plus
  a prescription, yields the set's reps and the prescription's weight — the partial-fill path, and
  the only case that exercises the prescription's fallback assignment inside the in-session branch.

### coach-prescribed-weights.AC5: Nothing that exists today changes
- **coach-prescribed-weights.AC5.1 Success:** Every pre-existing assertion in
  `src/state/sessionPresenter.test.ts` passes unmodified, proving the added parameter is
  behaviour-neutral when omitted.
- **coach-prescribed-weights.AC5.2 Success:** In the simulator, a routine created before this change
  starts, prefills, logs and completes exactly as it did before. *(human-only)*
- **coach-prescribed-weights.AC5.3 Success:** `git diff origin/main...HEAD --stat` shows no file under
  `src/engine/` changed, `src/engine/types.ts`'s `RoutineEntry` is untouched, and no `targetWeightKg`
  appears in `src/state/startSessionFromRoutine.ts` or `src/state/activeSession.ts` — the two shell
  files that could put the value into engine state with `src/engine/` unchanged. *(Three-dot diffs
  throughout: this is a five-PR chain, and `origin/main` moves under each branch.)*
- **coach-prescribed-weights.AC5.4 Edge:** In the simulator, a duration-based entry's Duration field
  still opens at its target and is not overwritten a beat later, once Phase 5 moves the
  `kind !== 'strength'` gate out of the prefill effect. *(human-only)*

### coach-prescribed-weights.AC6: Cross-cutting
- **coach-prescribed-weights.AC6.1:** `npx tsc --noEmit` reports no errors at every phase boundary.
- **coach-prescribed-weights.AC6.2:** `npm test` is green at every phase boundary — all suites, no
  carve-out.
- **coach-prescribed-weights.AC6.3:** `npm run lint` passes at every phase boundary.
- **coach-prescribed-weights.AC6.4:** In the simulator, the coach drafts a routine with a prescribed
  weight, the user accepts it, starts the session, and the weight field opens at the prescribed value
  even though the exercise has heavier or lighter history. *(human-only)*
- **coach-prescribed-weights.AC6.5:** In the simulator, replacing an exercise mid-session leaves the
  substitute's weight field prefilled from the substitute's own history, not from the replaced
  exercise's prescription — with a substitute that has no history, repeated three times, because the
  underlying outcome is a race that resolves benignly about half the time when the wiring is wrong.
  *(human-only)*
- **coach-prescribed-weights.AC6.6:** In the simulator, the coach's next conversation about that
  routine shows it can see the prescription it made — asked in a **fresh** conversation, never the one
  where the draft was accepted, in which the model can answer from its own prior turn. *(human-only)*
- **coach-prescribed-weights.AC6.7:** `exerciseReplaceStore` increments its `routineRevision`
  counter only *after* `applyToRoutine` resolves, does not increment it when the engine rejects
  the swap or the write throws, and **does** increment it when the sheet is cancelled mid-write.
- **coach-prescribed-weights.AC6.8:** In the simulator, the prescribed weight reaches the input for
  an exercise the user has **never logged** — a brand-new coach-authored routine with no
  cross-session history at all. *(human-only)*
- **coach-prescribed-weights.AC6.9 Structural:** `routineRevision` appears in `src/app/session.tsx` in
  exactly one dependency array — the prefill effect's — and not the progression-hint effect's. This is
  the only criterion covering the *consumption* of the counter; AC6.7 covers only its production, in a
  module no screen change can affect.

## Glossary

- **Prescription / prescribed weight**: A target load the AI coach programs onto a routine entry.
  Stored as `routine_exercises.target_weight_kg`. Distinct from every weight the app knew before,
  which was *observed* — a number the user actually lifted, recorded on `session_sets.weight_kg`.
- **Prefill**: The value the SetLogger's weight/reps inputs open at when the user arrives at an
  exercise. Computed by `computeSetPrefill` (`src/state/sessionPresenter.ts`). This feature changes
  its precedence, not its mechanism.
- **Routine entry**: One row of `routine_exercises` — a single exercise *slot* in a routine's plan.
  Identified by its row id, never by `exercise_id`, because a routine may list the same exercise
  twice.
- **Rill / `.lv` files**: The pure functional state machine (`src/engine/rules/*.lv`) that owns all
  session-flow decisions. Its `RoutineEntry` is a **closed record**: a field the alias does not
  declare is silently dropped when state crosses the boundary. This is why the prescription stays out
  of engine state.
- **FCIS (Functional Core / Imperative Shell)**: The architecture invariant. `src/engine` is the pure
  core; `src/state`, `src/ai`, `src/db`, `src/components`, `src/app` are the shell. Prefill
  precedence is a shell concern and stays there.
- **WatermelonDB**: The on-device database (SQLite on iOS, LokiJS in tests and on web). Its versioned
  `schemaMigrations` mechanism is why adding a column requires both a `version` bump and a matching
  `addColumns` step.
- **`addColumns` vs. empty `steps`**: WatermelonDB's migration step for *adding* a column. Schema v4
  used `steps: []` because it *removed* a column and WatermelonDB 0.28 ships no removal step. v5 adds
  one and must use a real step — copying v4's shape would crash upgrading installs.
- **`ReplaceExercise` / the Replace button**: The mid-session flow that swaps which exercise a routine
  entry names. Implemented by `exerciseReplaceStore` dispatching to the engine, then
  `updateRoutineExerciseExerciseId` re-pointing the DB row.
- **`AI_TURN_SCHEMA`**: The JSON Schema handed to the Anthropic structured-output endpoint. It is
  compiled server-side and a keyword outside the supported subset 400s the whole request, so bounds
  live in the validator instead.
- **`expectStructuredOutputSafe`**: The guard (`src/ai/structuredOutputSubset.ts`) asserting a schema
  carries no keyword the endpoint rejects. `minimum` and `multipleOf` are both on its list.
- **`personaSection()`**: The prose block in `src/ai/contextBuilder.ts` that tells the model the
  contract's rules. Several of its sentences are pinned as exact strings by `contextBuilder.test.ts`,
  so a validator bound cannot drift away from what the model is told.
- **Vault markdown / `src/interop`**: A markdown serializer and parser left over from the removed
  Obsidian sync feature. It has no production consumer for routines, which is why this design does
  not extend its grammar.
- **`routineRevision`**: A counter this design adds to `exerciseReplaceStore`, bumped after the
  routine row is re-pointed. The session screen's prefill effect depends on it so that it always
  re-reads the prescription *after* the swap's write commits, rather than racing it.
- **Inline snapshot (`toMatchInlineSnapshot`)**: A jest assertion whose expected value is written
  into the test file itself and committed to git. `src/ai/provider/subset.test.ts` uses one on
  `AI_TURN_SCHEMA` deliberately, so an unapproved schema change shows up as a reviewable diff.
  Updating it is `jest -u`, and the diff belongs in the PR.
- **`kgToLbs` / `lbsToKg` / `formatWeightLbs`**: The only conversion functions in the app
  (`src/state/weightUnits.ts`). kg is canonical in storage, the engine and HealthKit; lbs is display
  and entry only.

## Architecture

Weight has been an *observed* quantity for the app's whole life: `session_sets.weight_kg` records
what the user lifted, and `computeSetPrefill` replays it into the next set's input. This design adds
the first *planned* weight, and the entire difficulty is that the two now compete for the same input
field, with the planned one winning.

### Where the prescription lives, and where it does not

**It lives on the routine entry, in kg, in the database.** `routine_exercises.target_weight_kg`,
nullable, alongside `target_sets`, `target_reps`, `target_duration_seconds` and `rest_seconds` — the
plan columns it is a sibling of.

**It does not live in engine state.** This is the load-bearing decision and it is worth stating the
argument rather than the conclusion:

- The Rill `RoutineEntry` alias (`src/engine/rules/types.lv`) is a **closed record**.
  `toRillRoutineEntry` and `fromRillState` rebuild entries field-by-field in both directions, so an
  extra field bolted onto the TS `RoutineEntry` survives until the first `dispatch` and then silently
  vanishes (engine convention 6). Adding the field *properly* means editing `types.lv`, both mapping
  functions, the sentinel map in `engine/index.ts` (a 0-means-absent convention, per convention 8),
  and the two places `engine/index.ts` copies entry fields (lines 58–62 and 139–143) — plus a Metro
  cache restart hazard on every `.lv` edit (convention 4).
- Nothing in the engine would *use* it. No rule branches on load; the prescription decides nothing
  about phase, advancement, rest or validation. Engine convention 6 exists precisely to keep this
  class of data out: "Engine state carries ids, never display data."
- The shell already has the pattern. `createSessionPresenter` takes `exerciseTitles` and
  `routineDisplay` as caller-resolved arguments for exactly this reason, and `computeSetPrefill`
  already takes a caller-resolved `historyFallback`. The prescription is a third argument of the same
  kind.

So the prescription reaches the prefill the same way the history fallback does: `src/app/session.tsx`
reads it from the DB and hands it to a pure function.

The lookup key is the entry's `idx`, which is the DB row's `order` — `startSessionFromRoutine` sets
`idx: re._raw.order` deliberately ("Use DB order directly, NOT loop counter"), and
`exerciseReplaceStore`'s `ReplaceTarget` already documents `idx` as "the engine's `idx` and the DB
row's `order`". A new repository reader, `getRoutineTargetWeightsKg(db, routineId): Promise<Map<number,
number>>`, returns `order → kg`.

### Units: the coach speaks lbs

The DB stores kg; the UI works in lbs. The question is which the *coach* speaks, and the codebase has
already answered it: the system prompt renders logged history through `formatWeightLbs`
(`src/ai/contextBuilder.ts:452`, with the comment "Storage is canonical kg; the prompt speaks display
lbs to match the UI"), pinned by `contextBuilder.test.ts:553` asserting `'@ 220.5lbs'`. Rest
commentary does the same (`src/ai/restCommentaryPrompt.ts:120`).

A model that reads history in lbs and writes prescriptions in kg would have to convert on every turn,
which is a reliable source of silent error and has no upside. **The draft field is
`targetWeightLbs`.**

That gives exactly one conversion boundary in each direction, both at module edges that already own
conversion:

| Direction | Where | Function |
|---|---|---|
| Write: draft lbs → stored kg | `src/ai/acceptDraft.ts` | `lbsToKg` |
| Read: stored kg → input lbs | `src/state/sessionPresenter.ts` (`computeSetPrefill`) | `kgToLbs` |
| Read: stored kg → prompt lbs | `src/ai/contextBuilder.ts` (`formatExerciseLine`) | `formatWeightLbs` |

Everything between those edges is kg, matching `weightUnits.ts`'s stated invariant. The field name
carries its unit at both ends (`targetWeightLbs` on the draft, `targetWeightKg` on the repository
entry and `ExerciseDetail`) so no read site has to infer it.

### The bound: a positive multiple of 0.5 lbs

`kgToLbs` rounds to the nearest 0.5 lb, so 0.5 is the exact display grid; a prescription off that
grid cannot render back as itself. Integers-only was considered and rejected — 2.5 lb plate jumps and
12.5 lb dumbbells are ordinary programming, and the coach could not express them. Zero is rejected
rather than stored: `computeSetPrefill`'s existing weight guards all read `> 0`, so a stored 0 would
be silently ignored, and a bound that accepts a value the reader discards is a trap.

The bound goes in `validateRoutineDraft` and in the persona prose, **never in `AI_TURN_SCHEMA`** —
`minimum` and `multipleOf` are both on `UNSUPPORTED_SCHEMA_KEYWORDS`, and a schema carrying either
400s the entire request before the model runs. The schema type must also be `number`, not `integer`,
or the endpoint constrains away the half-pound values.

This makes `targetWeightLbs` the first draft field that is not an integer, which falsifies the
persona's existing blanket guidance line "All numeric values must be integers". That sentence has to
be reworded in the same change, or the model is told two contradictory things.

### Prefill precedence

Today's chain, in `computeSetPrefill`:

1. the exercise's own last set **this session**
2. the caller's cross-session `historyFallback` (strength only)
3. the routine targets (`targetReps`)

The prescription slots in **between 1 and 2**, and applies to the weight field only:

1. the exercise's own last set this session — **still wins**
2. **the prescription** (weight only)
3. cross-session history (weight only if no prescription; reps always)
4. `entry.targetReps`

Putting the prescription behind the in-session set is a reading of the settled scope, not a
departure from it: the issue says the prescription overrides *"the history-derived prefill"* and
illustrates it with "last week's log". A set logged minutes ago in this same session is the user
actively correcting the plan — if the coach programmed 185 and the user just did 175 because 185 was
too heavy, re-offering 185 on the next set fights them. This is the one interpretive call in the
design; it is called out here rather than buried.

The prescription being *field-scoped* matters as much as its rank. With a prescription of 185 and a
history set of 8 × 175, the right prefill is 8 reps at 185 — the coach programmed the load, and reps
still come from what the user actually does. A whole-object override would drop the reps.

### The exercise swap clears the prescription

`updateRoutineExerciseExerciseId`'s docstring today says: "The prescription (order, warmup/target/rest
columns, superset group) belongs to the plan and is left untouched — a substitute changes identity
only." This design **deliberately breaks that for the weight column alone.**

The reason is the override semantics. Sets, reps and rest are close to dimensionless across
substitutes — 3 × 8 with 90 s rest is a sane plan for a squat or a leg press. Load is not: 185 lb is
a working squat and an impossible leg extension. And because the prescription *beats* history, a
stale one does not quietly lose to the substitute's own correct numbers — it wins over them. The
failure mode is a user arriving at a substitute exercise with a dangerous load pre-typed into the
field, which is strictly worse than the pre-feature behaviour.

Clearing it in the same `database.write` that re-points `exercise_id` restores the substitute to
plain history-derived prefill, which is correct. `upsertRoutine`'s existing "absent fields are
cleared" contract covers the other direction (the coach revising a routine and dropping the
prescription).

### Clearing it is not enough on its own: the swap has a read/write race

Clearing the column is only half the job. The session screen has to *observe* the clear, and the
ordering that would make it do so is not guaranteed.

`exerciseReplaceStore.replace` (`src/state/exerciseReplaceStore.ts`) deliberately writes in two
steps: it dispatches `ReplaceExercise` to the engine at line 239, and only re-points the routine row
at line 252, so a rejected swap never leaves the routine pointing where the session isn't. But **the
dispatch is also what re-triggers the prefill effect** — it updates `activeSessionStore.sessionState`
(`activeSession.ts:330`), which changes `currentEntryExerciseId`, which is in the effect's dependency
array.

So two independent async paths start from the same dispatch:

- the effect's `getRoutineTargetWeightsKg` read, reached via a React re-render that zustand's
  notification schedules;
- `applyAlternateToRoutine`'s work, which is itself two steps — `findRoutineExerciseIdByOrder` (a
  read) and only then `updateRoutineExerciseExerciseId` (the write that clears the column).

Nothing orders them. The React scheduler's re-render is a macrotask, and AGENTS.md documents that
WatermelonDB's WorkQueue routes a queued write through a real `setTimeout(fn, 0)` — also a macrotask
— with an intervening async read before it. **This design does not claim to know which wins.** An
earlier draft asserted the effect "re-reads the (now cleared) prescription"; that was an assumption
presented as an analysis, and it is withdrawn.

If the read wins, `prescriptions.get(entry.idx)` returns the *old* prescription,
`historyPrefillStillApplies` passes (session, index and the new exercise id all match, and no set is
logged against the substitute), and the substitute's weight field is pre-typed with the replaced
exercise's load — exactly the failure the swap-clear rule exists to prevent. Nothing re-triggers the
effect afterwards, so it persists until the user navigates away.

**The fix does not require settling the race.** `exerciseReplaceStore` gains a monotonic
`routineRevision` counter, incremented **after** `await deps.applyToRoutine(...)` resolves, and the
prefill effect adds it to its dependency array. Whichever side wins, a final effect run happens after
the write is committed and reads the cleared value. The extra run is idempotent — the same guard
chain applies, and re-applying an identical prefill is invisible.

Two things make this cheap: `session.tsx` already imports and subscribes to `exerciseReplaceStore`
(line 24), and `src/state/exerciseReplaceStore.ts` is jest-covered. So the counter's contract — bump
after the write, **no** bump on a rejected swap or a thrown write — becomes an automated criterion
(AC6.7) rather than a manual one. That converts the case the design itself calls the safety case from
a flaky human check into a real test.

The residual risk is a user typing into the weight field in the milliseconds between accepting an
alternate and the write committing, whose entry the extra run would overwrite. They have just tapped
a button in a modal; this is accepted.

**The counter's scope is narrower than its name**, and the plan says so in both the docblock and
AGENTS.md rather than relying on the name. It bumps on exercise swaps only. `upsertRoutine` is the
other writer of `target_weight_kg`, so a coach revising a routine through `acceptDraft` can change or
clear a prescription and bump nothing — a session screen that stays mounted across such an edit keeps
the stale value until it remounts. That is not a live defect (editing a routine mid-session is not a
supported flow, and nothing outside the session screen's own prefill reads a prescription). The name
is deliberately about the *routine* rather than the swap so an `acceptDraft` bump can join the same
counter later without a rename — but until it does, the scope is written down.

### The vault markdown grammar is not extended

`src/interop`'s grammar already has a `weight=` flag. It is documented in three places as "logged
weight in kg, session sets only" — and **nothing enforces that.** `parseFlags` keeps one global
`knownFlags` allowlist shared by both contexts (`format.ts:247`), `parseSingleFlag` validates range
only (`format.ts:203-207`), the `context` parameter is consulted exactly once in the whole of
`parse.ts` (line 171, the zero-reps rule), and `formatFlags` emits `weight=` unconditionally whenever
present (`format.ts:304-306`). A routine line carrying `weight=60` parses cleanly today and yields
`weight: 60`. The session-only restriction is a comment, not a rule.

Extending the grammar would therefore mean either overloading `weight=` with a second meaning — the
exact hazard the `<sets>x<reps>` overload already documents — or adding a distinct `target_weight=`
key to `knownFlags`, `ParsedFlags`, `WorkoutLine`, `formatFlags`, both serializer input shapes and
the routine-line builder, keeping serialize and parse symmetric throughout.

**This design does none of it.** `serializeRoutine` and `exportRoutine` have no production caller at
all — grep finds references only from `src/export/exportService.test.ts` — and `parse.ts` has no
production consumer whatsoever since vault sync was removed. Building grammar for a path nothing
executes is speculative work on the most drift-prone file pair in the repo.

The accepted consequence, stated so it is not later mistaken for an oversight: **`serializeRoutine`
silently omits a prescribed weight.** If an export path is ever wired to a screen, the prescription
must be added to the grammar at that time. This belongs in AGENTS.md alongside the existing
markdown-contract warnings.

### No component changes

The prescription reaches the user as a different default in an input that already exists.
`session.tsx` sets `setWeightText(formatSetInputValue(prefill?.weightLbs))`; changing what
`computeSetPrefill` returns is the entire user-visible change. `SetLogger.tsx` and every other
component are untouched, which is fortunate — `src/components` and `src/app` are outside jest's
`testMatch` and have zero automated coverage.

## Existing Patterns

This design follows patterns already established in the codebase:

- **Caller-resolved per-entry data.** `createSessionPresenter(sessionState, dispatch,
  progressionHint, exerciseTitles, routineDisplay)` and `computeSetPrefill(sessionState,
  historyFallback)` both take shell-resolved arguments precisely because engine state carries ids
  only. The prescription is a third argument of that same kind, not a new mechanism.
- **Additive nullable columns with a real migration step.** v2 (`exercises.description`) and v3
  (`session_sets.exercise_id`) both added a nullable column via `addColumns` and were deliberately
  not backfilled. v5 is the same shape. v4 is the *exception* — empty `steps` for an undeclared
  column — and must not be used as the template.
- **Bounds in the validator, keywords out of the schema.** `validateRoutineDraft` already carries
  every numeric bound in `validateInteger` while `AI_TURN_SCHEMA` carries only types, because
  `expectStructuredOutputSafe` rejects bound keywords. `targetWeightLbs` follows it exactly, with a
  new `validateHalfStepWeight` helper alongside `validateInteger`.
- **Three declarations move together.** `DraftExercise` + `AI_TURN_SCHEMA` + `validateRoutineDraft` +
  `personaSection()` prose, with the prose pinned as exact strings by `contextBuilder.test.ts`.
- **kg canonical, lbs at the edges.** `weightUnits.ts`'s stated invariant, already honoured by the
  presenter, the prompt builders and HealthKit.
- **Test placement follows `jest.config.js`'s `testMatch`.** New tests land in `db`, `ai` and
  `state`, all already covered. Nothing new lands in `app` or `components`.

**Divergence:** one, argued above — `updateRoutineExerciseExerciseId` clears `target_weight_kg` on a
swap, contradicting its current docstring's claim that a substitute changes identity only. The
docstring is updated in the same phase.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Persist the prescription

**Goal:** A routine entry can carry a prescribed weight in the database, written and cleared under the
same contract as every other optional target, and readable by order.

**Components:**
- `src/db/schema.ts` — `version: 4 → 5`; add `{ name: 'target_weight_kg', type: 'number', isOptional:
  true }` to `routine_exercises`.
- `src/db/migrations.ts` — a `toVersion: 5` entry with a real `addColumns` step, and a comment
  explaining why it is not shaped like v4's empty `steps`.
- `src/db/models/RoutineExercise.ts` — `@field('target_weight_kg') targetWeightKg?: number`.
- `src/db/repository.ts` — `targetWeightKg?: number` on `RoutineExerciseEntry`; `upsertRoutine`
  writes it in both the update and create branches; `updateRoutineExerciseExerciseId` clears it on
  re-point (and its docstring is corrected); a new exported `getRoutineTargetWeightsKg`.
- `src/db/repository.test.ts`, `src/db/migrations.test.ts` — coverage for all of the above, **plus
  two existing assertions the version bump breaks**: `migrations.test.ts:11`
  (`expect(databaseSchema.version).toBe(4)`, and its stale test title) and `migrations.test.ts:59-73`
  (the v1-walk, which enumerates exactly two steps and gains a third).

**Dependencies:** None.

**Covers:** `coach-prescribed-weights.AC1.1` – `coach-prescribed-weights.AC1.7`

**Done when:** `npm test` is green (all suites, not just `src/db`); `tsc --noEmit` clean; a v4
database opens at v5.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: The coach can prescribe

**Goal:** `targetWeightLbs` exists in all three declarations with a matching bound, the schema still
passes the structured-output guard, and an accepted draft converts to kg exactly once.

**Components:**
- `src/ai/draftSchema.ts` — `targetWeightLbs?: number` on `DraftExercise`; `targetWeightLbs: { type:
  'number' }` in `AI_TURN_SCHEMA` (no bound keywords); a `validateHalfStepWeight` helper used by
  `validateRoutineDraft`.
- `src/ai/contextBuilder.ts` — `personaSection()` gains the weight bound sentence and reworks the
  "All numeric values must be integers" guidance line.
- `src/ai/acceptDraft.ts` — maps `ex.targetWeightLbs` through `lbsToKg` into
  `RoutineExerciseEntry.targetWeightKg`. The sole write-side conversion boundary.
- `src/ai/draftSchema.test.ts`, `src/ai/contextBuilder.test.ts`, `src/ai/acceptDraft.test.ts` —
  bounds, pinned prose, `expectStructuredOutputSafe`, conversion.
- `src/ai/provider/subset.test.ts:370` — a `toMatchInlineSnapshot` of the whole `AI_TURN_SCHEMA`,
  checked into git as a deliberate second tripwire. The new field breaks it; a **reviewed** `jest -u`
  is the correct remedy, and the resulting diff belongs in the PR description.

**Dependencies:** Phase 1 (the repository field must exist for `acceptDraft` to target).

**Covers:** `coach-prescribed-weights.AC2.1` – `coach-prescribed-weights.AC2.11`

**Done when:** `npm test` is green (all suites — the snapshot lives outside `src/ai/*.test.ts`'s
obvious neighbourhood); `tsc --noEmit` clean; the schema guard is green.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: The coach reads its prescription back

**Goal:** The system prompt shows the coach what it has already programmed, in the same unit it reads
history in, so the next turn can progress from it instead of re-deriving load from logs.

**Components:**
- `src/state/routineDetailPresenter.ts` — `targetWeightKg?: number` on `ExerciseDetail`, populated
  from `re._raw.target_weight_kg`.
- `src/ai/contextBuilder.ts` — `formatExerciseLine` appends a weight segment via `formatWeightLbs`
  when present.
- `src/state/routineDetailPresenter.test.ts`, `src/ai/contextBuilder.test.ts` — population, rendering,
  and the unprescribed line's shape.

**Dependencies:** Phase 1 (the column), Phase 2 (something to write it).

**Covers:** `coach-prescribed-weights.AC3.1` – `coach-prescribed-weights.AC3.3`

**Done when:** `npm test -- src/ai src/state` passes; `tsc --noEmit` clean.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Prefill precedence

**Goal:** The pure precedence rule — prescription beats cross-session history, loses to this
session's own set, and touches the weight field only.

**Components:**
- `src/state/sessionPresenter.ts` — `computeSetPrefill` gains an optional third parameter
  `prescribedWeightKg?: number`; the weight resolution is restructured so the prescription is
  consulted after the in-session match and before `historyFallback`, without disturbing reps or the
  duration-based path.
- `src/state/sessionPresenter.test.ts` — the full precedence matrix, including the no-prescription
  case proving today's behaviour is unchanged.

**Dependencies:** None technically (the parameter is optional and self-contained), but it is
meaningless before Phase 1 supplies a value.

**Covers:** `coach-prescribed-weights.AC4.1` – `coach-prescribed-weights.AC4.12`,
`coach-prescribed-weights.AC5.1`, `coach-prescribed-weights.AC5.3`

**Done when:** `npm test -- src/state/sessionPresenter.test.ts` passes with every pre-existing
assertion unmodified; `tsc --noEmit` clean; `git diff origin/main...HEAD --stat` shows nothing under
`src/engine/` (three-dot — `origin/main` moves under this branch as the chain lands).
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Screen wiring, simulator verification and docs

**Goal:** The prescription actually reaches the input, verified by hand because this is the one phase
whose code no test suite can see.

**Components:**
- `src/app/session.tsx` — the prefill effect fetches the prescription alongside the history query and
  passes it to `computeSetPrefill`. **The async block's existing early returns must be restructured**:
  it currently bails when the entry is not strength, when history is empty, or when the fallback has
  no usable field — each of which would skip a prescription that has nothing to do with history.
- `src/state/exerciseReplaceStore.ts` — a `routineRevision` counter bumped after `applyToRoutine`
  resolves, which the prefill effect depends on. This is what makes the swap case correct without
  settling the race above, and it is **jest-covered**, unlike the rest of this phase.
- `src/state/exerciseReplaceStore.test.ts` — the counter's contract.
- `AGENTS.md` — record the new column and its unit boundary; the engine-convention-6 rationale for
  keeping it shell-side; the swap-clears-the-prescription rule alongside the existing
  `updateRoutineExerciseExerciseId` stamp rule; the `routineRevision` ordering contract; and the
  accepted gap that `serializeRoutine` omits it. Update "Last verified".

**Dependencies:** Phases 1–4.

**Covers:** `coach-prescribed-weights.AC5.2`, `coach-prescribed-weights.AC5.4`,
`coach-prescribed-weights.AC6.4`, `coach-prescribed-weights.AC6.5`,
`coach-prescribed-weights.AC6.6`, `coach-prescribed-weights.AC6.7`,
`coach-prescribed-weights.AC6.8`, `coach-prescribed-weights.AC6.9`

**Done when:** `npm test` is green including the new `exerciseReplaceStore` cases; the six simulator
scenarios in test-requirements.md (H2–H7) pass with screenshots; AC6.9's structural line is recorded
in the PR; AGENTS.md describes only code that exists.
<!-- END_PHASE_5 -->

### AC × phase matrix

| AC | Phase | Automated? |
|---|---|---|
| AC1.1 – AC1.7 | 1 | yes (`src/db`) |
| AC2.1 – AC2.11 | 2 | yes (`src/ai`) |
| AC3.1 – AC3.3 | 3 | yes (`src/ai`, `src/state`) |
| AC4.1 – AC4.12 | 4 | yes (`src/state`; AC4.11 is a read-and-record check) |
| AC5.1 | 4 | yes (`src/state`) |
| AC5.2 | 5 | **no — simulator** |
| AC5.3 | 4 | yes (three-dot `git diff` + one grep) |
| AC5.4 | 5 | **no — simulator** |
| AC6.1 – AC6.3 | **gate on every phase** | yes (`tsc`, `jest`, `lint`) |
| AC6.4 – AC6.6 | 5 | **no — simulator** |
| AC6.7 | 5 | yes (`src/state/exerciseReplaceStore.test.ts`) |
| AC6.8 | 5 | **no — simulator** |
| AC6.9 | 5 | yes (read-and-record on `src/app/session.tsx`) |

**Totals: 46 criteria — 40 automated, 6 human.** (Revised 2026-08-11 by an acceptance-criteria audit
of Phases 4–5: AC4.12, AC5.4 and AC6.9 added, and AC4.4/AC4.5/AC5.3/AC6.5/AC6.6/AC6.7 sharpened where
the stated criterion could not discriminate the failure it named. Phases 1–3 were already merged and
are untouched.)

Every AC belongs to exactly one phase's *Covers* list, with one deliberate exception: AC6.1–AC6.3 are
per-phase **gates**, not deliverables of any single phase, so they appear in every phase's *Done
when* rather than in one *Covers*. Recording them against a single phase would be false — a phase
that leaves `tsc` broken is not done, whichever phase it is.

**Consequence sweep.** Four pieces of work are consequences of one phase but land in another phase's
files, and are assigned deliberately:

- **Clearing the prescription on an exercise swap** is a consequence of the column existing (Phase 1)
  and lands in `src/db/repository.ts` (Phase 1's file). Kept in Phase 1 so the column never exists
  without its swap rule. Its user-visible proof is AC6.5, in Phase 5.
- **Rewording the persona's "All numeric values must be integers" line** is a consequence of the
  half-step bound (Phase 2) and lands in `src/ai/contextBuilder.ts` — which Phase 3 also edits, for a
  different function. Assigned to Phase 2, because a phase that ships the half-step bound while the
  prompt still says integers-only has shipped a contradiction.
- **Updating `src/ai/provider/subset.test.ts:370`'s inline snapshot** is a consequence of Phase 2's
  schema edit but lands in a directory (`src/ai/provider/`) no other part of this change touches.
  Assigned to Phase 2: the phase that breaks a tripwire owns re-approving it.
- **`exerciseReplaceStore`'s `routineRevision` counter** is a consequence of Phase 1's swap-clear but
  lands in `src/state/` and is only *observable* once Phase 5 wires the effect. Assigned to Phase 5,
  because a counter nothing depends on is dead code, and Phase 1's AC1.6 already proves the column is
  cleared. The gap between them is real and accepted: between Phase 1 and Phase 5 the clear happens
  and may not be observed — which is harmless, because until Phase 5 nothing reads the prescription
  at all.

## Additional Considerations

**Greenness is not only `tsc`, and this plan learned that the hard way.** The first draft argued
phases were independently mergeable because every widened type gains an *optional* field. That is
true, and `tsc --noEmit` does stay clean at every boundary — but it says nothing about tests that pin
current **values**. Three exist, and each is now named in the phase that breaks it:

| Assertion | Breaks in | Why |
|---|---|---|
| `src/db/migrations.test.ts:11` — `expect(databaseSchema.version).toBe(4)` | Phase 1 | direct version bump |
| `src/db/migrations.test.ts:59-73` — v1-walk enumerates exactly two steps | Phase 1 | a third `addColumns` step appears **because the migration was written correctly** |
| `src/ai/provider/subset.test.ts:370` — `toMatchInlineSnapshot` of `AI_TURN_SCHEMA` | Phase 2 | a deliberate git-checked tripwire; remedy is a reviewed `jest -u` |

The middle one is the instructive case: it fails *as a consequence of doing the work right*, which is
the kind of gate failure that makes an implementer doubt a correct change. A sweep of the rest of the
suite found nothing else — only two inline snapshots exist in the whole repo (`AI_TURN_SCHEMA` and
`ALTERNATES_SCHEMA`, the latter untouched), no test asserts a `_raw` object by equality, and
`sessionPresenter.test.ts`'s `toEqual` prefill assertions are unaffected because this change adds no
new *output* field. **Every phase file states its own sweep result** under "Investigation findings",
naming what was checked on that phase's surface and what it found — phases 1 and 2 name the
assertions that break, phases 3 to 5 record that nothing on their surface is pinned and give the
commands to re-check. A phase that widens a surface not covered by its own sweep must re-run it.

**`main` is green.** Verified at `eb0afe0` — 86 suites, 1582 tests. An earlier draft of this plan
carried a carve-out for 12 failures in `src/interop/migrate.test.ts`; #219/#220 deleted that
vault-backed leftover, so AC6.2 is now an unqualified green gate. A failure in any suite is yours.

**The Replace flow's alternates prompt will not mention the prescription.** `exerciseReplaceStore`'s
`ReplaceTarget` is built from *engine* state, which by design does not carry the weight. Since the
swap clears the prescription anyway, telling the model about a load that is about to be discarded
would be actively misleading. This is consistent, not an omission.

**A one-frame flash is possible on arrival at an exercise.** `session.tsx` prefills synchronously
first and upgrades asynchronously once the DB reads resolve. A prescribed exercise will therefore
briefly show the target-reps-only prefill before the prescription lands. This is the existing
behaviour of the history upgrade and is accepted; making the prescription synchronous would mean
loading it at session start and holding it in the store, which is more state for a sub-frame gain.

**Layout and screen logic remain invisible to the test suite.** AGENTS.md's warning applies with full
force to Phase 5: `src/app/session.tsx` is the file where the feature actually becomes true for a
user, and no jest project can see it. Phase 5's verification is the simulator run, not a green suite.

**Two latent bugs were found in passing and are not fixed here.** `src/interop/parse.ts` accepts
`weight=` on a routine line despite three comments saying it is session-only, and
`src/interop/serialize.ts`'s `serializeRoutine` re-declares its routine-exercise input shape inline
instead of reusing `RoutineExerciseRow`, so the two can drift. Neither is reachable from production
code today. Both belong on the board.
