> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Architecture: Functional Core / Imperative Shell (FCIS)

This is the load-bearing invariant. All session-flow logic lives in the pure core;
everything else only shapes payloads and runs side effects.

- **Core (`src/engine`)** — pure. The bundled `.lv` rules are the *only* place that
  decides phase transitions, advancement, validation, and which effects fire. A Rill
  `transition(state, event) → Result({state, effects})` is the single contract.
- **Shell (`src/state`, `src/components`, `src/app`, `src/ai`)** — imperative. The
  Zustand store owns injected effect executors and persistence; presenters derive view
  data from engine state. **No session-flow decisions belong in components or the
  store** — if you find yourself branching on `phase` to decide what happens next, it
  belongs in a `.lv` rule, not TS.
- The AI slice is shell-only and deliberately does not touch the engine: it authors
  *data* (routines, alternate exercises, descriptions), never session flow. A routine
  produced by the AI is indistinguishable from a hand-built one by the time the
  engine sees it. The one AI feature that changes a *running* session — the Replace
  button — still decides nothing shell-side: `exerciseReplaceStore` dispatches a
  `ReplaceExercise` event and the `.lv` rule alone decides whether the swap happens
  (see engine convention 7).

### Non-obvious engine conventions (will bite you)

These exist to work around Rill's type system and have no analog in ordinary TS:

1. **Typed effect variants, not a uniform record.** `Effect` is a tagged union
   declared in `types.lv` — `CreateSession`, `ScheduleRest`, `CancelRest`, `Notify`,
   `PersistSet`, `CompleteSession`, `DiscardSession` — mirrored by the TS `Effect`
   union in `engine/types.ts`. The host (`engine/index.ts`) maps each tag to a
   handler in the `rillExecutors` table, unpacking that variant's own payload and
   forwarding it to the matching `EffectExecutors` method inside a try/catch so one
   failing executor never crashes `dispatch`. Adding an effect means adding a variant
   to `types.lv` **and** `engine/types.ts`, plus a case in `rillExecutors` — there is
   no shared record shape left to widen. `DiscardSession` is its own variant rather
   than a case of `CompleteSession` on purpose: `CompleteSession` is what drives
   the HealthKit export, so an abandoned session (`AbandonSession`) must emit
   `DiscardSession` so the session is deleted instead of exported.

2. **`transition.lv` appends to `loggedSets` itself.** Rill does have a list-append
   builtin, and the `LogSet` rule uses it: `loggedSets: append(state.loggedSets,
   [theSet])` on the returned state, so the host never rebuilds the list. The same
   rule also writes `theSet` onto `lastLoggedSet`; `engine/index.ts` only carries
   that field across the sentinel boundary (rpe -1.0 ⇄ `undefined`, etc.) — nothing
   else in the codebase currently reads it.

3. **`idx` is 0-based order, host-assigned — and it is now the only field
   `toRillRoutineEntry` drops.** Rill indexed list access uses head/tail
   recursion, so entries must carry an explicit `idx`. Rill's own `RoutineEntry`
   alias (`types.lv`) has no `idx` field — `toRillRoutineEntry` strips it before an
   entry crosses into Rill — so the host supplies it on both sides of a `dispatch`
   call: `fromRillState` re-derives `idx` as array position after every transition
   returns (`entries.map((entry, idx) => ({ idx, ... }))`), and, going the other way,
   `startSessionFromRoutine.ts` assigns `idx: re._raw.order` — the DB's canonical
   0-based order, not a loop counter — when building a `StartSession` event's
   `routine.entries`, so it matches `routine_exercises.order` for `onPersistSet`'s
   later lookup. Callers pass routines *without* `idx`; never author `idx` by hand.

   Between #276 Phases 2 and 5 this boundary did a second job, and it is worth
   knowing it is gone. A *derivation seam* sat on both sides: `toRillRoutineEntry`
   expanded four aggregate count fields into a set list when `RoutineEntry.sets`
   was absent, and `fromRillState` re-derived those counts back out of the list on
   the way home, so shell files that had not moved to per-set kept seeing what they
   always saw. Phase 6 deleted both directions along with `engine/entrySets.ts`.
   **`RoutineEntry.sets` is required**, it is the entry's whole plan, and nothing
   anywhere converts between a count and a list. A `RoutineEntry` literal that
   omits `sets` is a type error, which is deliberate: an entry with no plan is a
   bug, while `sets: []` is a legal entry that genuinely prescribes nothing
   (convention 10).

4. **Rules are inlined, not module-loaded.** `.lv` files are imported as strings
   (babel inline-import). Metro's transform cache keys on the *importing* TS file,
   not the `.lv` content — after editing any `.lv` file, restart Metro with
   `npx expo start --clear` or modules that inline the same rules can end up with
   mixed old/new copies (e.g. `loadRules.ts` validating different sources than
   `engine/index.ts` executes, since each file has its own `import ... from
   './rules/*.lv'` statements). `loadRules()` type-checks the bundled rules
   directly — `checkRuleSource(transitionSource, { resolve })`, where `resolve`
   serves the same inlined `types.lv`/`helpers.lv`/`transition.lv` sources
   `engine/index.ts` uses — it does not assemble or splice rule text together.
   `loadRules()` (the type-check gate) must run from the boot effect in
   `_layout.tsx`, **not** at module-init — a module-init throw crashes before the
   RuleErrorScreen can render. Keep it that way.

5. **State is fully JSON-serializable** (no Dates/functions) so it can be persisted and
   rehydrated after an app kill. `entries` is stored *in* the state for this reason.
   Rehydrating is a `hydrate` call, not a dispatch, and **the shell is therefore the
   only layer that can ask whether a restored state is one this build can run.**
   `hasRunnablePlan` (`src/state/sessionRehydrate.ts`) is that check: it requires
   `entries` to be an array and every entry to carry a `sets` array, and it exists
   because Phase 6 deleted the derivation seam that used to expand aggregate counts
   into a set list — a pre-Phase-2 state now reaches `toRillRoutineEntry`'s
   `entry.sets.map(...)` and throws out of the boot effect into `RuleErrorScreen`.
   `Array.isArray` at *both* levels is deliberate: an absent list and an empty one
   mean different things (`sets: []` is a legitimate zero-set entry, convention 10),
   and `entries ?? []` is not a safe default because `[].every(...)` is vacuously
   true, so it admitted a state with no `entries` key and threw one field over.

   **A guard that refuses to restore state must also DISPOSE of it. Read this
   before adding the second such guard.** `loadActiveEngineState`
   (`src/db/engineState.ts`) returns the FIRST `ended_at IS NULL` row carrying a
   non-null `engine_state`, with no ordering, and a refused row is by construction
   the older one — so merely declining to read it does not cost one abandoned
   workout, it costs every workout: the stale row is handed back on every
   subsequent boot and the live in-progress session behind it is never reached, for
   the life of the install. Nor is there an escape route, since
   `discardInProgressSession` is reachable only from the session UI, which needs the
   session in the store, which the guard refuses. `rehydrateActiveSession` therefore
   clears the row's `engine_state` on the drop path (injected as `RehydrateDeps`, so
   the module stays free of the database singleton; failure is swallowed, because a
   throw here lands on the very error screen the drop avoids). The row itself is
   kept as the audit trail. The pattern, not the instance, is what belongs here.

   The boot path (`rehydrateActiveSession`) follows a successful `hydrate` with `Resume`
   **only when the saved phase is `paused` or `resting`** — the two phases where
   `transition.lv` defines a meaning for it. Paused resumes into a re-armed rest when
   one was frozen (`restRemainingMs`), otherwise back to `prePausePhase`. Resting is
   the kill-mid-rest case: a live deadline re-emits `ScheduleRest`, an expired one gets
   the same phase-from-position recovery `RestElapsed` would have made. That re-emit
   leans on a shell guarantee — rest alerts schedule under a fixed OS notification
   identifier (`REST_NOTIFICATION_ID` in `executors/restTimer.ts`), so the boot re-arm
   *replaces* the pre-kill alert rather than double-notifying, and `CancelRest` can
   silence an alert this process never scheduled. The pair is exhaustive by
   construction rather than enumeration: every rule writing `restDeadlineMs: Some(...)`
   also sets `phase: Resting`, and `PauseSession` clears it on the way out — no
   other phase can hold a deadline to reconcile. Every other phase returns
   `Err`, and rejections are never silent:
   any `Err` from `transition` surfaces as a thrown `TransitionError` that the store's
   `dispatch` catches into `lastError`, which `session.tsx` renders as an error banner.
   So an unconditional Resume at boot greets the user with a red banner rather than
   failing quietly — the same trap awaits any other event dispatched blind at rehydrate.
   The module sits outside `_layout.tsx` so the node jest project covers it (screens are
   not jest-covered), and it takes the store structurally rather than importing the
   global one, so tests can pass a `createActiveSessionStore` instance.
   The kill case is the only one the boot path owns. A warm foreground (backgrounded,
   not killed) past the deadline needs no `AppState` listener: `RestCountdown`
   (`src/components/RestCountdown.tsx`) derives remaining time from the wall clock
   (`deadlineMs - Date.now()`), ticks synchronously on mount and every 250ms while a
   rest is on screen, and dispatches `RestElapsed` on the first tick at or past the
   deadline. The session screen stays mounted across backgrounding, and a dismissed
   session modal re-ticks on remount, so every warm path reconciles as soon as a rest
   is visible again — and nothing outside the session screen reads the phase in the
   meantime. Do not "fix" the warm case with a foreground `Resume` dispatch:
   Resume-in-Paused would silently un-pause a deliberately paused workout on every
   app switch, and Resume in any other phase is the error-banner trap above.

   The *foreground* sibling of that boot path is `AppForegrounded`
   (`src/state/foregroundReconcile.ts`, wired to an AppState listener in
   `_layout.tsx`): an app backgrounded — not killed — past the rest deadline has no
   other reconcile path unless the session screen happens to be mounted. Unlike
   rehydrate, the shell dispatches it **blind** — no phase gate. The store's
   `sessionState` updates only after `dispatch`'s awaits, so a shell gate would read a
   stale phase and race the session screen's own dispatches; the engine applies
   transitions synchronously and is the only race-free authority. The event is
   therefore `Ok` in *every* phase: in `resting` it runs the same shared
   reconciliation as the boot Resume arm (`reconcile_resting_deadline` in
   `transition.lv`), everywhere else it is a no-op — in particular `paused` stays
   paused, because foregrounding the app is not the user asking to resume. The other
   half of that race: `RestCountdown` dispatches `RestElapsed` from a closure, so a
   straggler tick can land after the reconcile already recovered the phase —
   `RestElapsed` is benign (`Ok`, no effects) in `warmup`/`working`, the two phases
   recovery lands in, and still `Err`s everywhere else.

6. **Engine state carries ids and the plan, never display data.** The Rill
   `RoutineEntry` alias (`rules/types.lv`) is a closed record, and
   `toRillRoutineEntry`/`fromRillState` rebuild entries field-by-field in both
   directions — so an extra field such as `title` bolted onto the TS `RoutineEntry`
   survives until the first `dispatch` and then silently vanishes. Anything the UI
   needs beyond `exerciseId` must be resolved
   shell-side against the DB: `getExerciseTitles` (`src/db/repository.ts`) feeds the
   optional `exerciseTitles` map on `createSessionPresenter`, which exposes
   `currentExerciseTitle` and falls back to the raw id when an exercise is missing.

   The closed record now carries `sets: List(RoutineSet)`, and each `RoutineSet`
   carries `weightKg` — so a prescribed **load does** cross the boundary, where the
   old per-entry `target_weight_kg` deliberately did not. No rule branches on it;
   it rides along because the list is one record and splitting the load out of it
   would need a parallel shell-side structure indexed the same way.

   That makes the load's freshness the shell's problem, and the answer is: the
   prefill does **not** read load off engine state. `ReplaceExercise` leaves an
   entry's `sets` intact by design (#276 AC2.11) while
   `updateRoutineExerciseExerciseId` clears every attached `routine_sets` row's
   `target_weight_kg`, so engine state can hold a swapped-away exercise's whole
   ramp. `computeSetPrefill` therefore takes `prescribedSets` — read FRESH from the
   database by the caller (`getPrescribedSetsForEntry` in `routineSetPlans.ts`) —
   as a caller-resolved argument, the same way `exerciseTitles` and
   `historyFallback` do. **Reps and duration come from engine state's own list**,
   because a swap does not clear those, so a failed prescription read costs the
   load and nothing else. Two source arrays, one index; do not "simplify" them into
   one.

7. **`ReplaceExercise` swaps a running entry's identity, under engine guards.** The
   event carries `{ idx, exerciseId }`; the rule requires `idx == exerciseIndex`
   (a pick made after the workout moved on is rejected, not misapplied),
   `setIndex == 0` (an entry with any logged or skipped set is committed), and
   phase `Warmup | Working`. The rule rebuilds `entries` with a position-counting
   `fold` using functional record update (`{ entry | exerciseId: ... }`), so the
   closed-record field-loss hazard in convention 6 cannot occur. The shell's write
   ordering around the dispatch is load-bearing: ensure the exercise record exists →
   dispatch → only on `Ok` re-point the routine row — a rejected swap must never
   leave the routine pointing where the session isn't.

8. **The shell reads sentinels, not `Option`s.** `fromRillState` re-sentinelizes on the
   way out — `rpe: undefined → -1`, `restDeadlineMs`/`restRemainingMs` → `0`,
   `prePausePhase`/`supersetGroup` → `""` — so TS read sites can stay non-nullable.
   `SENTINEL_TO_OPTION_MAP` in `engine/index.ts` is the authoritative list, and
   it is now genuinely authoritative for the fields it covers. This sentence has
   a history worth stating so it is not mistaken for one that drifted: the
   `LogSet` host→Rill conversion once applied three more sentinels inline, off the
   map — `reps === 0`, `weightKg === 0` and `durationSeconds === 0` each became
   `undefined` — which erased real measurements and made this claim and the vault
   contract's `1x0` rule false (#305; filed by #304, which had asserted the
   opposite). #305 removed those three: reps/weightKg/durationSeconds on `LogSet`
   now cross through `toRillOptionalNumber` (only null/undefined → Rill None, a
   logged 0 survives), so no inbound sentinel lives off the map anymore. `rpe`
   keeps its `-1` sentinel on that event *and* is in the map — its scale is
   1.0–10.0, so -1 is a free out-of-range value where 0 is a real measurement.
   The end-to-end pins are `engine/logSetZeroPreservation.test.ts` and the #305
   block in `state/setInputsSerializerMirror.test.ts`. Presenters must treat
   mapped values as *absent*: a plain null check passes `-1` through and renders
   `RPE: -1`. `formatLoggedSetLine` in `sessionPresenter.ts` is where the session
   screen's logged-set formatting (and that filtering) lives.

   **`RoutineSet` is deliberately NOT in the sentinel map**, and that is the one
   place the convention is inverted. Its five optional measurements (`reps`,
   `repsMax`, `weightKg`, `durationSeconds`, `distanceM`) are new surface with no
   legacy read sites to protect, so they cross as honest `undefined` and read sites
   use `!= null`. Five more sentinels would have widened the `-1`-renders-as-`RPE:
   -1` hazard class for nothing.

   That choice has a **test-shape consequence that will bite you**, and it is not
   about sentinels at all: `rillToJs` **keeps a `None` key, with the value
   `undefined`.** Its `Record` case is unconditional — `for (const [key, val] of
   value.fields.entries()) result[key] = rillToJs(val)` — and the `Tag` case maps
   `None` to `undefined`, so the key survives and only its value is empty. Probed
   against the shipping 1.1.1 tarball: `keys ["setType","reps"]`, `'reps' in out`
   → `true`, `out.reps` → `undefined`.

   The practical advice is unchanged and the reason for it is the mirror image of
   what this paragraph used to say. `fromRillRoutineSet` re-spells all five keys
   anyway, so the actual object carries every key; an expectation written
   *without* the absent ones therefore has **fewer** keys than the actual, and
   `toStrictEqual` — which counts an `undefined`-valued key as present — **fails**.
   `toEqual` ignores `undefined`-valued properties on both sides and passes. Use
   `toEqual` on anything containing a `RoutineSet`, or spell every key in the
   expectation (#276 AC2.12).

   **Worth knowing how this one got in:** the sentence was transcribed faithfully
   from AC6.5, which itself named "the `rillToJs`-omits-`None` test hazard" as
   something to record — so a false claim arrived pre-blessed by the AC that
   warned about it, and the identical wording spread to `engine/index.ts` and
   `perSetPlan.test.ts` before anyone ran it. A contract AC should mark which of
   its statements were verified by execution and which were inherited; a
   faithfully-transcribed false AC is indistinguishable from a correct one.

   The wider hazard class this note used to point at — a `null` `target_sets`
   column arriving as a plain `0` that display code had to read as *no plan* —
   died with the column at schema v7. The surviving shape is an empty set list; see
   the zero-planned-set rule in Boundaries.

9. **A superset group round-robins by set, and `setIndex` becomes a
   group-shared round number while advancing through one.** A group is a
   contiguous run of entries sharing a `supersetGroup` label (`h.group_end_idx`
   in `helpers.lv`; a standalone entry is a group of one). Finishing a set
   hands off to the next group member still owed a set *this round*
   (`h.next_active_idx`, curried over `(afterIdx, groupEndIdx, round)`) with no
   rest; only when nobody after the current position qualifies does the group
   decide whether to loop back for another round or move on. A member with
   fewer prescribed sets than its partner is simply skipped once its own
   `sets` list is exhausted — the activity predicate is
   `round < length(entry.sets)` — and the round does *not* end early
   just because the round's last-*visited* member is done; every remaining
   member's sets still get logged. Because a member is visited every round up
   to its own completion and never after, its own count of *visits* always
   equals the shared round number for as long as it keeps being visited (this
   is a visit count, not strictly a logged-set count — `SetDone`/"Skip Set"
   still advances it without logging anything) — this is what keeps
   convention 7's `setIndex == 0` guard sound for a member reached only via a
   superset hop, with no extra state needed. `phase` is re-derived
   (`h.phase_for`) from whichever entry is actually landed on — never carried
   over from the entry being left — on all three ways `advance_after_set` can
   move: the same-round hop, the next-round loop-back, and advancing to a
   genuinely different exercise/group entirely (this last one applies to
   standalone entries too, not just superset groups: exhausting entry A and
   landing on B whose set at the landing round is a `warmup` now correctly
   reads `Warmup`, where the pre-round-robin code carried A's last phase over).

   **Warmup-versus-working comes from each set's own `setType`**, read through
   `h.phase_for` at the position actually landed on. It is not an index compared
   against a warmup count, and that is a real behavioural difference rather than a
   restatement: a plan may interleave. `[warmup, normal, warmup]` is expressible
   and the third set correctly reads `Warmup`, where count arithmetic
   (`setIndex - warmupSets + 1`) rendered "Set 0". `deriveSetPosition` in
   `sessionPresenter.ts` counts preceding sets *of the same type* for the same
   reason; INTERLEAVE is the fixture that discriminates the two, and no single
   warmup count gives the right answer on it.

   `SkipExercise`
   existed once and was removed: its unconditional index-jump could land on a
   group member with real logged history while resetting `setIndex` to 0,
   which would have made that guard unsound with no clean fix (skip *this*
   member only, or the group's whole current round?) — removing the
   affordance was simpler than picking one.

10. **A zero-set entry is never *landed on*, only skipped past.** Convention
    9's `h.next_active_idx` refuses to hand off or loop back to a member whose
    own `sets` list is empty (`round < 0` is never true), but that
    only governs positions *inside* a group already being visited. The two
    sites that land on a *fresh* position — `StartSession`, and
    `advance_after_set`'s "this group is done, move on" branch — took
    `entries[0]` and `groupEndIdx + 1` on faith, so a zero-set entry reached
    either way was landed on and accepted one phantom `LogSet`/`SetDone`
    before the engine moved past it. Both now go through
    `h.next_active_landing(entries)(fromIdx)`, whose predicate is
    `length(entry.sets) > 0` and which returns the first index at
    or after `fromIdx` that prescribes anything **and** the true start of the
    contiguous `supersetGroup` run that index belongs to. Tracking that start
    is not redundant bookkeeping: a landing can skip an entire zero-set group
    to reach a later one whose own leading members are also zero-set, and
    `supersetPosition` has to be `idx - groupStart` for *that* group or the
    next `advance_after_set` rederives `groupStartIdx` — and so `groupEndIdx`
    — from a wrong origin. It is not a drop-in for `h.next_active_idx` at the
    within-group sites: it presumes `fromIdx` is itself a group boundary (0,
    or one past a prior group's end), which is the one thing both call sites
    guarantee and a within-group hop would not. `None` means every entry from
    `fromIdx` on has an empty `sets` list. In `advance_after_set` that is the ordinary
    end of the workout — the existing end-of-routine arm, unchanged. At
    `StartSession` it is `Err`, not a special "instant completion": emitting
    `CreateSession` and `CompleteSession` in the same dispatch has no ordering
    guarantee the host can honor (`activeSession.ts` swaps in the new session
    state only after `dispatch` returns, so effects race against whatever
    session was current a moment earlier) — an earlier version of this fix
    tried the instant-completion arm and it either stranded the new session
    forever on a fresh store, or, starting from `phase: Done`, re-completed
    and re-exported to HealthKit whatever the *previous* session was. Rejecting
    an all-zero routine outright, the same as the empty-routine guard one line
    above, was simpler than teaching the host a new effect-ordering contract
    for a shape a real routine should not produce anyway.

    One more consequence: `landing.idx` is no longer necessarily adjacent to
    `groupEndIdx`, so the group-exhausted branch stopped calling
    `h.rest_duration` for its rest decision (deleted from helpers.lv — this
    was its only caller). `rest_duration`'s "same superset" check was a label
    comparison, sound only between genuinely adjacent entries — group labels
    are contiguous, not routine-unique (`h.group_end_idx`'s own docstring), so
    a landing that skips a zero-set entry can reach a *later* entry that
    happens to reuse an earlier group's label. Landing here already proves the
    current group is exhausted, so `currentEntry.restSeconds` applies
    unconditionally instead — the same value `rest_duration` always resolved
    to at this call site anyway, once nextEntry was guaranteed adjacent.

11. **Both `ScheduleRest` sites read the JUST-COMPLETED set's own rest (#281).**
    `advance_after_set` schedules `h.completed_set_rest(currentEntry)(s.setIndex)`
    — that set's `restSeconds` if it overrides, else the entry-level
    `currentEntry.restSeconds` — at BOTH the round-repeat and group-exhausted
    branches (one concept, not a branch on which site). It is what makes a drop
    set expressible: sets at rest 0 / 0 / full give zero rest between the drops
    and a full rest after the last. The two sites are NOT symmetric in what
    `currentEntry`'s set index means — round-repeat leaves you on the same entry,
    group-exhausted has already advanced — but the completed set is
    `entries[exerciseIndex].sets[setIndex]` at *both*, because `s` is the INPUT
    state: the advancement (`landing.idx`, `setIndex: 0`) lives only in the
    returned record, so `s.setIndex` still names the finished set. Do NOT reach
    for the landing entry or `nextRound` at the group-exhausted site. The
    superset no-rest hop (the `Some(nextIdx)` branch) never calls
    `completed_set_rest` and stays rest-free regardless of a partner's per-set
    value — a per-set rest must not reintroduce a rest there. An all-null-rest
    routine is byte-identical to the pre-#281 behaviour: every set falls back to
    the entry rest. `RoutineSet.restSeconds` is `Option(Int)` in Rill and crosses
    as honest `undefined` — it is NOT in `SENTINEL_TO_OPTION_MAP` (convention 8),
    because a zero rest override must stay a real 0.

