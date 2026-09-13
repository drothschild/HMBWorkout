> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Boundaries

- Safe to edit: `src/`
- Session-flow logic changes go in `src/engine/rules/*.lv`, never in the store/components
- **Every app-side superset-contiguity walk goes through
  `src/domain/supersetGrouping.ts` (#278), with one named exception below.
  Before writing a walk, re-point at the helper or add your site to that
  exception list — do not add a silent copy.** #278 consolidated four of them:
  `getSupersetGroups` (dead, now deleted), `routineDetailPresenter`,
  `restCommentaryStore`, and `ai-coach.tsx`'s draft card. They disagreed at the
  edges, and the disagreement was invisible from inside any one of them. The
  #268 routine screen is the related failure one step earlier, not an instance
  of this one: it merged two non-adjacent same-label runs the engine keeps
  apart because it bucketed rows into a `Map<label, ExerciseDetail[]>` and so
  had no contiguity check at all. #272 fixed that by writing the walk a third
  time; #278 replaced all four with the shared helper.
  `groupBySupersetRuns` partitions already-ordered entries into
  contiguous runs; `supersetRunEndIndex` is the contiguity check itself, the
  shell's counterpart to `h.group_end_idx`. Three rules it fixes, each of which
  a copy previously got its own way: **ordering is the caller's job** (the
  helper groups by adjacency in the array it is handed and never reads an
  `order` field); **`null`, `undefined` and `''` all mean no superset**, `''`
  because that is the engine's own sentinel (`engine/types.ts`,
  `startSessionFromRoutine.ts`); and a **standalone entry is a singleton run
  whose `label` is `null`**, so a caller wanting singleton groups reads
  `.members` while a caller wanting "not a group" tests `label === null`. The
  key type is generic, so re-pointing `superset_group` at an integer id would
  be a type argument rather than a rewrite (#276's plan currently keeps the
  string). `src/app` cannot be jest-tested, so
  `supersetGrouping.callSites.test.ts` gates the call sites structurally — and
  gates the helper's own internals too, since `groupBySupersetRuns` silently
  inlining its own copy of `supersetRunEndIndex` would defeat the point while
  every behavioural test stayed green.
  **The one named exception is `groupSupersets` in `src/interop/parse.ts`,
  deliberately left in place by #278.** It walks the markdown grammar's parsed
  `WorkoutLine[]` rather than DB rows or drafts, and it carries a third
  treatment of a singleton labelled run — it drops the label and emits a bare
  line — that is part of the **markdown contract** which both `h.group_end_idx`
  in `helpers.lv` and the contiguity note in `transition.lv` cite *by name* as the
  basis for the engine's own
  contiguity assumption, so re-pointing it is a contract change with engine
  consequences rather than a refactor. #276's Phase 5 rewrote that grammar and
  `groupSupersets` survived it, still with its own third treatment. (Cited by
  symbol, not by line: this read `helpers.lv:56` and was off by 29 — the name is
  at :85 — which is the same failure mode the `session.tsx:303` note below
  records, in a bullet that already knew better. The correction itself then said
  ":80" and was off by five, in #276 Phase 6, in the bullet whose entire subject
  is this failure mode. Cite the symbol; if you write a line number, run
  `grep -n` for it in the same breath.)
- A routine may list the same exercise more than once, so a routine *entry* is
  identified by its `routine_exercises` row id, never by `exercise_id` — React list
  keys, logged-set attribution (`session_sets.routine_exercise_id`), and
  `upsertRoutine`'s duplicate matching all depend on that row id. Presenters must
  therefore surface it (`ExerciseDetail.routineExerciseId`)
- **A set's performed exercise is its own `session_sets.exercise_id` (schema v3),
  not the row's.** The row's `exercise_id` is mutable (the Replace flow re-points
  it), so the row join is only the *legacy fallback* for pre-v3 sets whose stamp is
  null. `appendSet` stamps every new set from the engine entry (the value
  `onPersistSet` already verified), and every identity reader —
  `getExerciseWorkingSetHistory`, `getSessionExerciseLog`,
  `getRecentSessionSummaries`, the markdown export — resolves stamp-first,
  join-fallback. `updateRoutineExerciseExerciseId` is the ONLY path allowed to
  re-point a row, and the same layer-2 defense binds it and `upsertRoutine`'s
  drop branch — the only other path that invalidates the join: inside the same
  `database.write`, stamp every attached null-stamped set with the row's outgoing
  identity *before* re-pointing or destroying the row. Any future path that does
  either owes the same stamp. The *single-write* half of that is pinned
  behaviorally (#225), not just by review: WatermelonDB's writer is a
  serialization primitive over a FIFO queue rather than a rollback-capable
  transaction, so "one write" means "no other writer ever sees the row
  half-swapped" — and `replaceRoutineExercise.test.ts` asserts exactly that by
  queueing a competing writer behind an un-awaited swap. Hoisting any of the
  three effects (stamp, clear every attached set's `target_weight_kg`, re-point)
  into a second
  `database.write` fails it; before that test all three splits left the suite
  green. `deleteRoutine` is exempt only because it
  deliberately retains the rows as history carriers rather than destroying them.
  A new reader that resolves a set's exercise through the row alone reintroduces
  the PR #65 history-corruption bug. One rendering consequence: a swapped row's
  sets can span two performed identities, so session-detail entries key on the
  `(routineExerciseId, exerciseId)` pair (`sessionDetailPresenter` exposes both;
  `workout/[id].tsx` keys on the pair), not the row id alone. Resolving identity
  stamp-first is necessary but **not sufficient**: a reader that *iterates*
  `routine_exercises` still loses sets whose row was destroyed —
  `upsertRoutine`'s drop branch is the only `destroyPermanently` on that table.
  Iterate the sets, or reconcile the leftovers, as `serializeSession` does
- `routine_sets.target_weight_kg` is a coach-prescribed target load, nullable, and
  **per set** — the entry-level column of the same name was undeclared at schema v7
  (#276 Phase 6), which is what lets a warmup ramp carry three different loads under
  what used to be the single number 3. **It is stored in kg and the coach speaks
  lbs.** There is exactly one write-side conversion, `lbsToKg` in `acceptDraft`, and
  it now runs **once per set** rather than once per exercise — one call site, many
  calls. The read edges are `computeSetPrefill` (`kgToLbs`) and `formatExerciseLine`
  (`formatWeightLbs`).
  A second conversion site is how a value gets converted twice. The bound is a
  **positive multiple of 0.5 lbs**, enforced in `validateRoutineDraft` and stated
  in `personaSection()`. It is the first non-integer field in the draft contract,
  which is why the persona's numeric guidance carries an explicit exception.
  `AI_TURN_SCHEMA` declares it as `number` with **no** bound keyword — `minimum`
  and `multipleOf` are both on `UNSUPPORTED_SCHEMA_KEYWORDS`.

  **The precedence rule is TWO-WAY and decided FIELD BY FIELD — the old three-way
  "prescription overrides history, last-set-this-session overrides the
  prescription" ordering is gone** (#276 Phase 3). It could not survive a ramp: a
  single per-exercise number either won everywhere or lost everywhere, and a ramp
  needs the plan to win at set 2 while an athlete's deviation at set 1 still sticks.
  The rule now is: for field F at set *i*, **the plan asserts itself iff F's planned
  value at *i* differs from F's planned value at *i-1*.** At *i* = 0 there is no
  previous set to inherit from, so the plan asserts itself iff F is not uniform
  across the entry — i.e. iff this is a genuinely per-set plan at all. When the plan
  does not assert itself, the pre-existing ranks apply unchanged (the exercise's own
  last set this session, then the cross-session history fallback, then the plan as a
  terminal default).

  Field-wise, not set-wise, and the distinction is load-bearing: on `8/8/6 @ 50` with
  the athlete having dropped to 45, a set-wise comparison sees set 2 as "different"
  and drags the weight back to 50, where the field-wise rule lands the rep change and
  keeps the deviated load. The uniformity clause at set 0 is what keeps every
  pre-#276-shaped routine byte-identical to the old behaviour: a uniform list never
  triggers the override, so the ranks below behave exactly as they did, including the
  documented weight/reps asymmetry ("the coach programs the load, the reps come from
  what the athlete does"). `planAssertsField` in `sessionPresenter.ts` is the whole
  rule, in nine lines.

  It is no longer scoped to the weight field — reps and duration take the same
  treatment, from the same index. But the *sources* differ and must not be merged:
  **load comes from the DB list the caller read fresh, reps and duration from engine
  state's own list.** See engine convention 6 for why.

  `updateRoutineExerciseExerciseId` must also clear every attached set's
  `target_weight_kg`. On a **same-kind** replacement, only loads go: set type,
  reps, distance, duration, order and rest remain the plan. On a **cross-kind**
  replacement, preserve only order, `set_type` and per-set `rest_seconds`; clear
  reps/range/load/duration/distance atomically in the engine and routine rows.
  There is no safe reps-to-duration conversion, and retaining a duration-only
  plan after choosing strength can override the selected kind's controls. The
  session screen's
  prefill effect and `applyAlternateToRoutine`'s write are independent async paths
  off the same dispatch, with no ordering between them, so `exerciseReplaceStore.routineRevision`
  is bumped **after** the write and the prefill effect depends on it. The contract
  has two halves: bump strictly after `applyToRoutine` resolves, and never on a
  rejected swap or a thrown write. **The store mechanism is pinned by AC6.7 tests in
  `src/state/exerciseReplaceStore.test.ts`. The screen's consumption of it —
  the prefill effect's dependency array in `session.tsx` depending on
  `routineRevision` — has zero automated cover from any suite that can execute it: no
  test suite can load the screen, and deleting the dependency array entry passes all
  tests. AC6.9 is the only safeguard, and since #276 it is
  `src/state/sessionPrefillWiring.static.test.ts`: a structural read that extracts
  that array and compares it AS A SET against the entries it must hold
  (`sessionId`, `exerciseIndex`, `setIndex`, the exercise id, `routineRevision`).
  Match on the identifiers, never on a line number — the citation here used to be
  `session.tsx:303` and was wrong twice over within one issue. The set comparison is
  the load-bearing part: a `toContain` is satisfied by the `const routineRevision = …`
  selector line alone, and a four-entry expectation is how the missing `setIndex`
  stayed invisible through a whole phase.** Its scope is explicit and load-bearing: it bumps
  on exercise swaps only. `upsertRoutine` is the other writer of a prescribed load,
  so a coach revising a routine through `acceptDraft` can change or clear a
  prescription and bump nothing — a session screen that stays mounted across such an
  edit keeps the stale value until it remounts. That is not a live defect (editing a
  routine mid-session is not a supported flow, and nothing outside the session
  screen's own prefill reads a prescription), and the name is deliberately about the
  *routine* so an `acceptDraft` bump can join the same counter later without a
  rename. Do not assume routine edits are covered today.
- A routine entry may prescribe **zero sets** — an empty `sets` list, which the
  markdown grammar spells `sets=0` and the coach cannot author (`validateRoutineDraft`
  requires at least one) — so no display path may render "Set 1 of 0".
  `deriveSetPosition` (`sessionPresenter.ts`)
  feeds *two* independent label builders: `createSessionPresenter`'s
  `setPositionLabel`, and `setPosition` in `src/ai/restCommentaryPrompt.ts`, which
  reaches the derivation through `restCommentaryTarget` and never touches the
  presenter — so a guard on one does not cover the other. Both return `''` when the
  entry prescribes nothing, and both consumers read that as *hide*
  (`SetLogger` skips the row; `buildRestCommentaryPrompt` drops the empty segment
  from its "Up Next" *and* "Last Set" line — one guard, both shapes, since the
  two share `setPosition`). An empty list is the exact condition, not a conservative
  one: both activity predicates in `helpers.lv` key on the list's length —
  `h.next_active_idx` treats an entry as active for round `r` iff
  `r < length(entry.sets)`, and `h.next_active_landing` iff
  `length(entry.sets) > 0` — so only an empty list can reach a zero denominator.

  Engine convention 10 keeps `exerciseIndex` off zero-set
  entries in the first place, which demotes these guards to a layer-2 defense but
  does **not** make them dead code: rehydrate restores a stored `exerciseIndex`
  through a `hydrate` call that no rule ever validates (convention 5), so a session
  persisted by a build predating that rule comes back sitting on exactly such an
  entry. `sessionDetailPresenter` is the
  third label site and needs no guard — it renders `Set N` with no total.
  `sessionPresenter.isLastSetOfExercise` is the fourth site that checks the list
  length — it's the first one whose correctness depends specifically
  on convention 9's round-number semantics (not just "is this entry active"), so
  integration tests through mismatched-set-count supersets guard against future
  changes to `helpers.lv`'s `next_active_idx` predicate or `transition.lv`'s
  `setIndex` carry-over that could silently break the popup's timing
- Starting a session mirrors that same condition one layer up.
  `startSessionFromRoutine` refuses a routine where *every* entry has an empty set
  list, the same as it already refused one with no
  exercises at all — a routine can have exercises yet still have nothing for
  `h.next_active_landing` to land on. **The live source of such rows is history,
  not any current write path:** a `routine_exercises` row whose `routine_sets` are
  gone or were never written prescribes nothing, and with vault import gone there is
  no re-import to heal one. A stored `exerciseIndex` can
  also come back through `hydrate` pointing at such an entry (convention 5). Do
  not read these guards as dead just because no code still *creates* the shape —
  and note that #276 Phase 6 made the shape *harder* to create, not impossible:
  `RoutineExerciseEntry.sets` is required, so a caller can no longer forget a plan,
  but `sets: []` is still legal and still means exactly this.
  `hasActiveExercise` carries the same emptiness check
  through `routineListPresenter` and `routineDetailPresenter` into
  `todayStartPresenter`'s `startable` flag and `routine/[id].tsx`'s start
  button, so a routine that can't actually be started never renders as
  startable — the engine's `Err` is a backstop for a case the shell should
  already have kept the user from reaching, not the only guard against it
- AI turn payload shapes *and* validation bounds must be mirrored across
  `AI_TURN_SCHEMA`, the validators, and the persona prompt (all in `src/ai`)
- The AI accept path may create exercises but must never mutate existing ones
- An AI-proposed settings change must be approved by the user before it is written
- Do not touch generated Rill dist or the `../rill-lang` tarball dependency by hand

[Back to reference index](README.md)
