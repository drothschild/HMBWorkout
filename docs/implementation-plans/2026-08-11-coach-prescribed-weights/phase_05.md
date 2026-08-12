# Coach-Prescribed Weights — Phase 5: Screen wiring, simulator verification and docs

**Goal:** The prescription actually reaches the input field, verified by hand — because this is the one phase whose code no test suite can see.

**Architecture:** `src/app/session.tsx`'s prefill effect resolves the prescription from the database and hands it to the pure `computeSetPrefill` built in Phase 4. Two things make that harder than it looks. The effect's asynchronous block is structured entirely around *history* and returns early three separate times when there is none, each of which would swallow a prescription that has nothing to do with history — so the block is restructured to fetch both and apply if either is present. And the exercise-swap flow's write races the effect's read, so `exerciseReplaceStore` gains a `routineRevision` counter, bumped after the row is re-pointed, which the effect depends on: rather than winning the race, this guarantees one more read strictly after the write. Then AGENTS.md is updated to describe the code that now exists.

**Tech Stack:** React 19 / React Native 0.86 / expo-router, TypeScript, iOS Simulator.

**Scope:** Phase 5 of 5 from `docs/design-plans/2026-08-11-coach-prescribed-weights.md`.

**Depends on:** Phases 1–4, all merged.

**Codebase verified:** 2026-08-11 against `origin/main` @ `eb0afe0` (rebased after #220), by direct read of `src/app/session.tsx:120-260`.

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### coach-prescribed-weights.AC5: Nothing that exists today changes
- **coach-prescribed-weights.AC5.2 Success:** In the simulator, a routine created before this change
  starts, prefills, logs and completes exactly as it did before. *(human-only)*
- **coach-prescribed-weights.AC5.4 Edge:** In the simulator, a **duration-based** entry's Duration
  field still opens at its target and is not overwritten or cleared a beat later — checked on a
  routine that has both a prescribed and an unprescribed stretch/cardio entry. *(human-only)*

  This criterion exists because Task 2 moves the `kind !== 'strength'` gate
  (`session.tsx:210`). Today that line returns before the async block for every non-strength entry, so
  `apply()` runs exactly once for a duration entry. After Task 2 the block runs for all kinds and
  calls `apply()` a **second** time whenever a prescription is present — and `apply()` writes
  `setDurationText(...)` and `setCurrentRpe(undefined)` as well as the weight, so it can overwrite the
  Duration field. Nothing else in this phase puts a duration entry on screen at all.

### coach-prescribed-weights.AC6: Cross-cutting
- **coach-prescribed-weights.AC6.4:** In the simulator, the coach drafts a routine with a prescribed
  weight, the user accepts it, starts the session, and the weight field opens at the prescribed value
  even though the exercise has heavier or lighter history. *(human-only)*
- **coach-prescribed-weights.AC6.5:** In the simulator, replacing an exercise mid-session leaves the
  substitute's weight field prefilled from the substitute's own history, not from the replaced
  exercise's prescription — verified with a substitute that has **no history at all**, and repeated
  **three times**. *(human-only)*

  Both qualifiers are load-bearing, and without them this criterion is close to worthless. The
  outcome it observes is a ~50/50 race unless Task 2 Step 3 was done (see AC6.9), so a single run
  passes about half the time on a broken implementation; three runs cut that to ~1 in 8. And a
  substitute *with* history can mask a stale prescription behind a plausible number, whereas a
  substitute with none makes the failure unmistakable: `185` in a field that must be empty.
- **coach-prescribed-weights.AC6.6:** In the simulator, the coach's next conversation about that
  routine shows it can see the prescription it made — asked in a **fresh conversation**, never in the
  one where the draft was accepted. *(human-only)*
- **coach-prescribed-weights.AC6.7:** `exerciseReplaceStore` increments its `routineRevision`
  counter only *after* `applyToRoutine` resolves, and does not increment it when the engine rejects
  the swap or the write throws — **and does increment it when the sheet is cancelled mid-write**,
  because the write still committed.
- **coach-prescribed-weights.AC6.8:** In the simulator, the prescribed weight reaches the input for
  an exercise the user has **never logged** — a brand-new coach-authored routine with no
  cross-session history at all. *(human-only)*
- **coach-prescribed-weights.AC6.9 Structural:** `routineRevision` appears in `src/app/session.tsx`
  in **exactly one dependency array — the prefill effect's (~line 254) — and not in the
  progression-hint effect's (~line 182)**, and the file contains a `routineRevision` selector reading
  from `exerciseReplaceStore`. Recorded in the PR description, in the shape of AC4.11.

  This is the only criterion that pins Task 2 Step 3 at all. Skipping that step entirely — never
  subscribing to the counter, leaving line 254's dependency array unchanged — passes all five AC6.7
  tests (they live in `src/state` and never load a screen) and passes AC6.5's manual scenario roughly
  half the time, because the outcome simply reverts to the unarbitrated race of finding 7. A counter
  nothing consumes is not a fix. Trap 11 already names the misplacement half of this — putting it on
  the progression-hint effect too — with no criterion behind it.

**All but two criteria in this phase are human-verified.** `src/app/` is not in `jest.config.js`'s
`testMatch` at all — there is no jest project that can load a screen. AGENTS.md is explicit: *"a green
run proves nothing about it."* Do not add tests under `src/app/` to feel better.

The exceptions are **AC6.7** (automated) and **AC6.9** (a static read-and-record check), and together
they are the most valuable thing in this phase. Task 1's work lands in
`src/state/exerciseReplaceStore.ts`, which *is* covered — so the safety property that AC6.5 checks by
hand gets a real automated test underneath it. Prefer that shape wherever a phase can reach for it:
push the mechanism into a covered module and leave only the user-visible confirmation to the
simulator. AC6.9 is the seam that shape leaves behind: the covered module can be perfect while the
screen never reads it, and only a structural check spans the two.

⚠ **AC6.8 exists because AC6.4 structurally cannot fail on the bug this phase is about.** AC6.4's
fixture has the user log a set and finish a session *first*, so history exists — which is exactly when
the early return at `session.tsx:217` does **not** fire. An implementation that threads
`prescribedWeightKg` through `computeSetPrefill` but leaves that early return in place passes AC6.4,
passes the whole suite, and ships a feature that silently does nothing on new coach-authored
routines. AC6.8 is the no-history case. Do not merge the two; each covers a different half.

---

## Investigation findings

### 1. The effect's three early returns are the whole difficulty of this phase

`src/app/session.tsx:190-254`. The prefill effect does a synchronous pass, then an asynchronous upgrade. The async block is built entirely around history:

```ts
    const entry = sessionState.entries?.[sessionState.exerciseIndex];
    if (!entry || entry.kind !== 'strength') return;          // ← 1

    (async () => {
      try {
        const db = getDatabase();
        const history = await getExerciseWorkingSetHistory(db, entry.exerciseId);
        const latest = history[0];
        if (cancelled || !latest) return;                      // ← 2

        const fallback: SetInputValues = {};
        if (latest.reps != null) fallback.reps = latest.reps;
        if (latest.weightKg != null) fallback.weightLbs = kgToLbs(latest.weightKg);
        if (fallback.reps === undefined && fallback.weightLbs === undefined) return;  // ← 3
```

**All three fire in exactly the situation the feature is for.** A brand-new coach-authored routine has no history for its exercises, so return 2 fires and the prescription never reaches the input. This is the bug this phase exists to not ship, and it is invisible to every test in the repo.

The fix is to fetch both, and gate on *either* being present.

### 2. The lookup key is `entry.idx`, and it is exact

`getRoutineTargetWeightsKg` (Phase 1) is keyed by the row's `order`. `startSessionFromRoutine.ts:45` sets `idx: re._raw.order` with the comment *"Use DB order directly, NOT loop counter"*, and `exerciseReplaceStore.ts`'s `ReplaceTarget` documents `idx` as *"the engine's `idx` and the DB row's `order`"*. So `prescriptions.get(entry.idx)` is a direct hit — no row-id resolution needed.

Do **not** key on `exerciseId`: a routine may list the same exercise twice with different prescriptions.

### 3. `historyPrefillStillApplies` is a generic staleness check despite its name

`src/state/sessionPresenter.ts:229-239`. It checks `sessionId`, `exerciseIndex`, `currentExerciseId` and `!currentExerciseHasLoggedSet`. Keep it guarding the combined apply. Its last clause means a set logged while the queries were in flight aborts the whole upgrade — correct, because an in-session set outranks the prescription anyway (Phase 4's precedence), and the synchronous pass on the next render handles it.

### 4. Let the pure function decide about duration-based entries

Fetch the prescription regardless of kind and let `computeSetPrefill` ignore it when the entry is
duration-based. Keep the `kind === 'strength'` condition on the **history** query only, which is
where it already belongs (`getExerciseWorkingSetHistory` returns working-type sets).

⚠ **Correction to an earlier draft of this plan**, which claimed `kind !== 'strength'` and
`isDurationBasedEntry` "are a different predicate". *They are not.* `ExerciseKind` is the closed
union `'strength' | 'cardio' | 'stretch'` (`src/engine/types.ts:8`) and `isDurationBasedEntry` is
`entry?.kind === 'stretch' || entry?.kind === 'cardio'`
(`src/state/exerciseStopwatch.ts:164-166`) — the exact complement. Today they agree on every input.

The instruction stands, but on a weaker and more honest justification: keeping the decision in the
pure function is *future-proofing*, not a bug fix. If `ExerciseKind` ever gains a fourth member, or
`isDurationBasedEntry` stops keying on `kind` alone, a duplicated predicate in a screen no test can
see is where the two would drift apart silently. That is a real but speculative reason — do not go
looking for a live disagreement between them, because there isn't one.

**It does, however, have a live cost that has to be checked by hand.** Today `session.tsx:210`
returns before the async block for every non-strength entry, so `apply()` runs exactly once on a
duration entry. Moving the gate means the block runs for all kinds, and — because the combined
early-return now fires only when *both* sources are absent — a duration entry that carries a
prescription reaches a **second** `apply()`. `apply()` is not weight-only: it writes
`setDurationText(...)` and `setCurrentRpe(undefined)` too. So the Duration field, which no code path
in this effect could previously touch on a non-strength entry, is now writable by one — and the
freshness guard's `!currentExerciseHasLoggedSet` clause means it fires precisely during the entry's
first set, which is when a stopwatch run happens. A prescribed stretch is reachable because nothing
gates a prescription on `kind` (`validateRoutineDraft` calls `validateHalfStepWeight`
unconditionally, `src/ai/draftSchema.ts:215`). **AC5.4 / Task 3 Step 4b is the only place this is
looked at**; an unprescribed duration entry still returns early and proves nothing about it.

### 5. A one-frame flash is expected and accepted

The synchronous pass runs before the DB reads resolve, so a prescribed exercise briefly shows the target-reps-only prefill. This is exactly how the existing history upgrade already behaves. Do not "fix" it by loading prescriptions into the store at session start — that is more state for a sub-frame gain, and it was considered and rejected in design.

### 6. Confirmed current state

- ✓ `src/app/session.tsx:14,17` — `computeSetPrefill` and `historyPrefillStillApplies` imported from
  `@/state/sessionPresenter`.
- ✓ `src/app/session.tsx:30` — `import { getExerciseTitles, getExerciseWorkingSetHistory, getRoutineDisplay } from '@/db/repository';`
- ✓ `getDatabase` is already imported and used at lines 155 and 214.
- ✓ `kgToLbs` is already imported and used at line 222.
- ✓ `activeSessionStore.getState()` is already used at line 229.
- ✓ Effect deps, line 254: `[sessionState?.sessionId, sessionState?.exerciseIndex, currentEntryExerciseId]`.
  A swap changes `currentEntryExerciseId`, so the effect does re-run — but see finding 7: re-running
  is not the same as reading the *cleared* value, and a fourth dependency is needed.
- ✓ `src/app/session.tsx:24` — `exerciseReplaceStore` is already imported, and the file already
  subscribes to other stores with the `store((s) => s.field)` hook form (lines 125-131). Adding one
  more selector is the established pattern here.
- ✓ `src/state/exerciseReplaceStore.test.ts` exists (465 lines) and `src/state` is in `testMatch`.
- ✓ **Value-pin sweep for this phase's surface:** `ExerciseReplaceState` gains a field, so the risk is
  a test asserting the whole store state. `exerciseReplaceStore.test.ts` asserts field-by-field
  (`status`, `alternates`, `error`) and never compares whole state, so **nothing breaks**. `src/app/`
  has no tests at all. The command:
  `grep -n "getState()).toEqual" src/state/exerciseReplaceStore.test.ts`.
- ✓ `npm test` is **green** on `origin/main` — 86 suites, 1582 tests, verified at `eb0afe0`.
  Your gate is plain green; #219/#220 deleted the vault-backed `src/interop/migrate.test.ts` that an
  earlier draft of this plan carved out.

### 7. The swap has an unresolved read/write race, and the fix is not to resolve it

**An earlier draft of this plan asserted the effect "re-reads the (now cleared) prescription" after a
swap. That was an assumption stated as an analysis, and it is withdrawn.** Here is what the code
actually does.

`src/state/exerciseReplaceStore.ts` `choose()` (declared at `:221` — there is no `replace()`) writes in two deliberate steps:

```ts
:240   const newState = await deps.dispatch({ tag: 'ReplaceExercise', idx: current.idx, exerciseId });
:246   if (!newState) { throw new Error('the engine rejected the replacement'); }
:252   await deps.applyToRoutine(current.routineId, current.idx, exerciseId);
```

The comment at :251 explains the ordering: *"Only now the routine row, so a rejected swap can never
leave the routine pointing somewhere the running session isn't."* That ordering is correct and must
not be changed.

But **the dispatch is also what re-triggers the prefill effect.** It sets
`activeSessionStore.sessionState` (`activeSession.ts:330`), which changes `currentEntryExerciseId`,
which is in the effect's dependency array. So two async paths race from one dispatch:

| Path | Steps |
|---|---|
| the prefill effect | zustand notify → React re-render (scheduler macrotask) → `getRoutineTargetWeightsKg` **read** |
| `applyAlternateToRoutine` | `findRoutineExerciseIdByOrder` (a **read**) → `updateRoutineExerciseExerciseId` (the **write** that clears the column) |

Nothing orders them. The re-render is a scheduler macrotask; AGENTS.md documents that WatermelonDB's
WorkQueue routes a queued write through a real `setTimeout(fn, 0)` — also a macrotask — and there is
an intervening async read before it. **Do not try to settle this by reasoning about microtask order;
it does not settle.**

If the read wins: `prescriptions.get(entry.idx)` returns the *old* prescription,
`historyPrefillStillApplies` passes (session, index and the new exercise id all match, no set logged
against the substitute), and the substitute's weight field is pre-typed with the replaced exercise's
load. Nothing re-triggers the effect afterwards, so it persists until the user navigates away. That
is precisely the failure the swap-clear rule exists to prevent.

**The fix sidesteps the race rather than winning it.** Task 2 adds a monotonic `routineRevision`
counter to `exerciseReplaceStore`, incremented *after* `await deps.applyToRoutine(...)` resolves, and
Task 1 puts it in the effect's dependency array. Whoever wins, a final effect run happens after the
write is committed. The extra run is idempotent: the same guard chain applies and re-applying an
identical prefill is invisible.

The residual risk is a user typing into the weight field in the milliseconds between accepting an
alternate and the write committing, whose entry the extra run would overwrite. They have just tapped
a button in a modal. Accepted.

The payoff beyond correctness: `exerciseReplaceStore` is **jest-covered**, so the counter's contract
becomes AC6.7 — an automated test — instead of resting on H4 happening to catch a race on one manual
run.

---

<!-- START_TASK_1 -->
### Task 1: `routineRevision` — make the swap observable without winning the race

**Verifies:** `coach-prescribed-weights.AC6.7`

**Files:**
- Modify: `src/state/exerciseReplaceStore.ts` — the state interface, the `create<...>` initial state,
  and `choose()`'s success path around line 252
- Test: `src/state/exerciseReplaceStore.test.ts` (unit)

Read investigation finding 7 first. This task exists because clearing `target_weight_kg` (Phase 1)
is not enough on its own: the session screen has to *observe* the clear, and nothing orders the
effect's read against the swap's write.

**Step 1: Add the counter to the state shape**

In the store's state interface (alongside `status`, `alternates`, `error`), add:

```ts
  /**
   * Bumped once each time a swap finishes re-pointing the routine row. The
   * session screen's prefill effect depends on this so it re-reads the routine's
   * prescribed loads *after* the write commits.
   *
   * This exists because the two halves of a swap race. `choose()` dispatches to
   * the engine before it re-points the row (deliberately — a rejected swap must
   * not move the routine), but that same dispatch updates activeSessionStore,
   * which re-runs the prefill effect. The effect's read and
   * applyAlternateToRoutine's write are then independent async paths with no
   * ordering between them: if the read wins, the substitute's weight field is
   * pre-typed with the *replaced* exercise's prescribed load — the exact hazard
   * the swap-clear rule exists to prevent.
   *
   * Rather than trying to win that race, this guarantees one more effect run
   * strictly after the write. The extra run is idempotent.
   *
   * SCOPE: exercise swaps only. `upsertRoutine` is the other writer of
   * target_weight_kg — a coach revising a routine through acceptDraft can change
   * or clear a prescription and bumps nothing here, so a session screen that
   * stays mounted across such an edit keeps the stale value until it remounts.
   * That is not a live defect (nothing reads a prescription outside the session
   * screen's own prefill, and editing a routine mid-session is not a supported
   * flow), and the name is deliberately about the *routine* rather than the swap
   * so that an acceptDraft bump can be added to this same counter later without
   * a rename. Do not assume routine edits are covered today.
   */
  routineRevision: number;
```

Initialize it to `0` in the `create<ExerciseReplaceState>((set) => ({ ... }))` initial object,
beside `status: 'idle'`.

**Step 2: Bump it after the write, and only after**

In `choose()`, immediately after the existing `await deps.applyToRoutine(...)` call (line 252) and
before `target = null;`:

```ts
        await deps.applyToRoutine(current.routineId, current.idx, exerciseId);

        // Strictly after the row is re-pointed and its prescription cleared.
        // Placement is the whole contract: bumped before the await, this would
        // race the write it exists to sequence after; bumped in the catch, it
        // would announce a clear that never happened.
        set((state) => ({ routineRevision: state.routineRevision + 1 }));
```

**Do not** bump it before the `await`, in the `catch`, or on the `if (!newState) throw` rejection
path. Each of those announces a clear that has not happened — and the effect would re-read the *old*
prescription and re-apply it, which is worse than not bumping at all.

Leave the `generation !== gen` guard below untouched, and **do not move the bump below it either.**
The guard governs whether the store's *visible* state is reset after a cancel; the revision bump is
about a write that has already committed to the database and must be announced regardless. Putting
the bump beside the existing `set({ status: 'idle', … })` on line 257 is the tempting placement — it
is where this path's only other `set(...)` lives — and it silently drops the bump for any swap the
user cancels mid-write, leaving the stale prescription in the field. AC6.7's cancelled-mid-write case
is the one that fails on it; the other four do not.

**Step 3: Write the tests**

Add to `src/state/exerciseReplaceStore.test.ts`, reusing the existing `ExerciseReplaceDeps` fake-deps
setup that file already uses (it injects `dispatch`, `ensureExercise` and `applyToRoutine`).

- **AC6.7 (bump):** a successful `choose()` leaves `routineRevision` one higher than before.
- **AC6.7 (ordering):** make the injected `applyToRoutine` record `routineRevision` at the moment it
  is *called*, then assert that recorded value equals the pre-swap value — i.e. the bump had not yet
  happened when the write started. ⚠ This is the assertion that actually pins the contract. A test
  that only checks the counter ends up higher passes against an implementation that bumps *before*
  the await, which is the bug.
- **AC6.7 (rejection):** when the injected `dispatch` resolves `null` (engine rejected),
  `routineRevision` is **unchanged**.
- **AC6.7 (write failure):** when the injected `applyToRoutine` rejects, `routineRevision` is
  **unchanged**.
- **AC6.7 (cancelled mid-write):** hold `applyToRoutine`'s promise open, call `choose()` **without
  awaiting**, call `cancel()` while the write is in flight, then release the promise and await.
  `routineRevision` must be `before + 1`. Use the deferred-promise idiom this file already uses —
  `let release: (value: unknown) => void = () => {};` with a `new Promise` handed to the injected dep
  (`exerciseReplaceStore.test.ts:219` and `:276`, the latter calling `cancel()` mid-flight at `:280`).

  ⚠ **This is the case that pins the bump's placement to the line it is on, rather than to the
  general vicinity.** The four cases above all pass if the bump is moved five lines down — after the
  `generation !== gen` guard, beside the existing `set({ status: 'idle', … })` at
  `exerciseReplaceStore.ts:257` — which is exactly where an implementer adding a `set(...)` call most
  naturally puts it, since that is where the file's other `set(...)` on this path lives. But
  `generation` advances on both `cancel()` (`:272`) and `open()` (declared `:158`, incrementing at
  `:159` — `const gen = ++generation;`),
  so a user who dismisses the sheet while the write is in flight gets a committed write that is never
  announced — the prefill effect never re-runs, and the stale prescription stays in the field. That is
  the identical user-visible failure this whole counter exists to prevent, reached by a different
  route. The comment in Step 2 says the guard must be left untouched *because the write has already
  committed*; this test is what makes that sentence enforceable.

**Step 4: Run**

```bash
npm test -- src/state/exerciseReplaceStore.test.ts
npx tsc --noEmit
```
Expected: whole file passes, including every pre-existing test.

**Step 5: Commit**

```bash
git add src/state/exerciseReplaceStore.ts src/state/exerciseReplaceStore.test.ts
git commit -m "feat(state): announce a completed exercise swap with routineRevision"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire the prescription into the prefill effect

**Verifies:** `coach-prescribed-weights.AC6.9` (a structural read-and-record check — the only thing
that pins Step 3 at all). Nothing else here is automatable: this is `src/app/`, outside every jest
project. Proven by H2/H3/H4/H6/H7 in `test-requirements.md`.

**Files:**
- Modify: `src/app/session.tsx:30` (import)
- Modify: `src/app/session.tsx` around line 129 (a `routineRevision` selector)
- Modify: `src/app/session.tsx:206-246` (the async block inside the prefill effect)
- Modify: `src/app/session.tsx:254` (the effect's dependency array)

**Step 1: Import the reader**

`src/app/session.tsx:30`:
```ts
import {
  getExerciseTitles,
  getExerciseWorkingSetHistory,
  getRoutineDisplay,
  getRoutineTargetWeightsKg,
} from '@/db/repository';
```

**Step 2: Replace the async block**

Replace everything from line 206's comment through line 246 (the closing `})();`) with:

```ts
    // ...then upgrade with the coach's prescribed load and cross-session
    // history. Both are DB reads and neither implies the other: a freshly
    // drafted routine has a prescription and no history at all, which is
    // exactly the case this feature exists for. Fetching them together and
    // applying if EITHER is present is load-bearing — the previous shape
    // returned early whenever history was missing, which would have silently
    // dropped every prescription on a new routine.
    //
    // The async continuation re-reads fresh store state before applying, so a
    // set logged while the queries were in flight is never clobbered by the
    // stale closure.
    const entry = sessionState.entries?.[sessionState.exerciseIndex];
    if (!entry) return;

    (async () => {
      try {
        const db = getDatabase();

        // History is working-set only, so it is strength-only. The prescription
        // is not gated on kind here: computeSetPrefill decides whether a load
        // applies (it ignores one on a duration-based entry), and keeping that
        // decision in the pure function stops two different predicates —
        // `kind === 'strength'` here and `isDurationBasedEntry` there — from
        // drifting apart.
        const [prescriptions, history] = await Promise.all([
          getRoutineTargetWeightsKg(db, sessionState.routineId),
          entry.kind === 'strength'
            ? getExerciseWorkingSetHistory(db, entry.exerciseId)
            : Promise.resolve([] as Awaited<ReturnType<typeof getExerciseWorkingSetHistory>>),
        ]);
        if (cancelled) return;

        // entry.idx IS the routine_exercises row's `order`
        // (startSessionFromRoutine: "Use DB order directly, NOT loop counter"),
        // so this is a direct hit. Keying on exerciseId would be wrong — a
        // routine may list the same exercise twice with different loads.
        const prescribedWeightKg = prescriptions.get(entry.idx);

        const latest = history[0];
        let fallback: SetInputValues | undefined;
        if (latest) {
          const values: SetInputValues = {};
          if (latest.reps != null) values.reps = latest.reps;
          // Stored kg converts to display lbs on the way into the input
          if (latest.weightKg != null) values.weightLbs = kgToLbs(latest.weightKg);
          if (values.reps !== undefined || values.weightLbs !== undefined) {
            fallback = values;
          }
        }

        // Neither source has anything to add; leave the synchronous prefill be.
        if (fallback === undefined && prescribedWeightKg === undefined) return;

        // The closure's sessionState is a snapshot from when the effect ran, so
        // the result is applied only if fresh store state still matches every
        // effect key — including the exercise id, which a swap changes without
        // touching the session or the index.
        const fresh = activeSessionStore.getState().sessionState;
        if (
          !fresh ||
          !historyPrefillStillApplies(fresh, {
            sessionId: sessionState.sessionId,
            exerciseIndex: sessionState.exerciseIndex,
            exerciseId: entry.exerciseId,
          })
        ) {
          return;
        }

        apply(computeSetPrefill(fresh, fallback, prescribedWeightKg));
      } catch (error) {
        // Prefill is best-effort; empty inputs are always a valid state.
        console.error('Failed to prefill set inputs:', error);
      }
    })();
```

⚠ **This step retypes roughly forty lines, and two of them are the staleness guard chain** — the
`if (cancelled) return;` after the reads, and the `historyPrefillStillApplies` block before `apply()`.
Nothing in the repo can fail if one of them is dropped in the retyping: `src/app/` has no test, and
the two guards overlap enough that dropping *either alone* is usually harmless (`cancelled` covers
unmount; the freshness check independently catches a session, index, exercise or logged-set change).
Dropping **both**, or dropping the freshness check, is what puts a previous exercise's numbers into
the current exercise's field. H2 gains a step for exactly this — advance through three exercises in
quick succession — because it is the only thing that will notice.

**Step 3: Subscribe to `routineRevision` and add it to the dependency array**

`currentEntryExerciseId` already re-runs this effect on a swap — but re-running is not the same as
reading the *cleared* prescription, because the effect's read races the swap's write (finding 7).
Task 1's counter is what makes the outcome deterministic.

Add the selector beside the other store subscriptions around line 129:

```ts
  // Bumped after a swap finishes re-pointing the routine row. The prefill effect
  // below depends on it so the prescription is re-read *after* that write lands —
  // the effect's own re-run (via currentEntryExerciseId) races it. See
  // exerciseReplaceStore.routineRevision.
  const routineRevision = exerciseReplaceStore((state) => state.routineRevision);
```

`exerciseReplaceStore` is already imported at line 24; no import change is needed.

Then extend the prefill effect's dependency array (line 254):

```ts
  }, [
    sessionState?.sessionId,
    sessionState?.exerciseIndex,
    currentEntryExerciseId,
    routineRevision,
  ]);
```

Add it to **this effect only.** The progression-hint effect above it does not read the prescription
and does not need re-running on a swap-commit; widening its deps would just refire a DB query.

**Step 3c: Record the structural check (AC6.9)**

Before committing, read `src/app/session.tsx` back and record one line in the PR description:
`routineRevision` appears in **exactly one dependency array — the prefill effect's, ~line 254 — and
not in the progression-hint effect's, ~line 182** — and there is exactly one selector reading it off
`exerciseReplaceStore`.

⚠ This is not ceremony. Task 1's counter is in a jest-covered module and Task 2's consumption of it
is in a file no suite can load, so **nothing but this check spans the two.** An implementation that
does Task 1 perfectly and skips Step 3 entirely passes all five AC6.7 tests and passes AC6.5's manual
scenario roughly half the time — the outcome just reverts to the unarbitrated race of finding 7,
which resolves benignly about as often as not. "The tests pass and it worked when I tried it" is the
expected appearance of that bug, which is why the criterion is structural rather than behavioural.

**Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

⚠ If `tsc` reports a route-shaped error mentioning `/workout/${string}` or a long "… 52 more …" union, that is the stale `.expo/types/router.d.ts` false positive documented in AGENTS.md, not your change. Run the dev server once to regenerate the route types and re-run.

**Step 5: Commit**

```bash
git add src/app/session.tsx
git commit -m "feat(app): session prefill applies the coach's prescribed load"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Simulator verification

**Verifies:** `coach-prescribed-weights.AC5.2`, `coach-prescribed-weights.AC5.4`, `coach-prescribed-weights.AC6.4`, `coach-prescribed-weights.AC6.5`, `coach-prescribed-weights.AC6.6`, `coach-prescribed-weights.AC6.8`

**This task has no code. It is the only proof this feature works.**

**Step 1: Build and install**

This change adds no native module, so a prebuild is not required. Follow the simulator recipe in AGENTS.md (or the `running-in-simulator` skill if available):

```bash
npm run ios
```

If the app was last built before schema v5 landed, **do not uninstall it** for the AC5.2 run — see Step 3.

**Step 2: AC6.4 — the prescription beats history**

1. Log at least one working set for an exercise at a distinctly different load (e.g. 135 lbs).
   Finish that session so the set becomes cross-session history.
2. Open the AI Coach and ask for a routine containing that same exercise **with a specific prescribed
   weight clearly different from what you just logged** (e.g. "programme back squat at 185"). Accept
   the draft.
3. Start the routine.
4. **Expected:** the weight field opens at `185`, not `135`.
5. Wait a beat before judging — the synchronous pass renders first and the prescription lands on the
   async upgrade (finding 5). A value that appears and then changes to 185 is correct behaviour.

Evidence: screenshot of the SetLogger, plus a screenshot of the coach's draft showing the prescribed
number.

**Ground-truth check if the number looks wrong**, per the simulator-verification recipe — read the
column directly rather than guessing:
```sql
select order_, exercise_id, target_weight_kg from routine_exercises where routine_id = '<id>';
```
(Column is `"order"` in SQLite; quote it.) A stored `83.91` rendering as `185` is correct. A stored
`185` means the lbs→kg conversion in `acceptDraft` was skipped.

**Step 3: AC5.2 — an existing routine is unchanged**

On the **upgraded** install (installed over the pre-v5 build, not a fresh one — uninstalling destroys
the v4 database and turns this into a fresh-install test that proves nothing):

1. Open a routine that existed before this change.
2. Start it, arrive at an exercise with logged history.
3. **Expected:** the weight field prefills from history exactly as it did before. No prescription
   exists, so the precedence chain is untouched.
4. Log sets and complete the session normally.
5. **Advance through at least three exercises in quick succession** — log or skip a set and move on
   without waiting for each field to settle — and confirm each exercise's inputs show *that*
   exercise's numbers. Then repeat once slowly for comparison.

   Task 2 retypes the whole async block, including the `if (cancelled) return;` check and the
   `historyPrefillStillApplies` guard, and no test in the repo can fail on a dropped one. The symptom
   is specific and easy to miss if you only ever change exercise slowly: the *previous* exercise's
   reps and weight landing in the current exercise's field, a fraction of a second after arriving.
   Moving fast is what widens the window enough to see it.

Evidence: screenshots before/after; a screenshot or short screen recording of the fast-advance pass;
and note in the PR that the install was an upgrade, not a fresh one.

**Step 3b: AC6.8 — the prescription reaches an exercise with NO history**

**This is the step that can actually fail on the bug this phase exists to fix.** Step 2's fixture has
history by construction, so it passes even if `session.tsx:217`'s early return was left in place.
This one does not.

1. Ask the coach for a routine containing an exercise **you have never logged a set for** — a
   brand-new movement name, or a fresh simulator install. Give it a prescribed weight (e.g. 95).
   Accept the draft.
2. Confirm there is genuinely no history before you judge the result. **The obvious one-table query
   is not enough** — `getExerciseWorkingSetHistory` (`src/db/repository.ts:386-425`) resolves identity
   on *two* paths: the v3 `session_sets.exercise_id` stamp, and a legacy join through
   `routine_exercises` for sets whose stamp is null. A query counting only the stamp can report `0`
   while `history[0]` is non-empty, at which point this step silently becomes Step 2 and the bug it
   exists to catch survives with the evidence looking clean. That matters here because Steps 3 and 3b
   run on the *upgraded* install H1 and H2 mandate, which carries pre-existing data.

   Mirror the reader instead:
   ```sql
   select count(*) from session_sets s
     left join routine_exercises re on s.routine_exercise_id = re.id
    where s.set_type = 'working'
      and (s.exercise_id = '<slug>' or (s.exercise_id is null and re.exercise_id = '<slug>'));
   ```
   Expect `0`. If it is non-zero, pick a different exercise — otherwise you are re-running Step 2.
   (The `set_type = 'working'` filter matches the history query, which excludes warmups; without it a
   warmup-only exercise reads as having history when the prefill path sees none.)
3. Start the routine and arrive at that exercise.
4. **Expected: the weight field opens at 95.** Empty means the async block still bails when history
   is absent, and the feature is broken for every new coach-authored routine — the most likely single
   defect in this phase.

Evidence: screenshot of the SetLogger, plus the `count(*) = 0` query output. The query output is not
optional; without it the screenshot does not distinguish this case from Step 2.

**Step 4: AC6.5 — a swap drops the prescription**

1. Start the prescribed routine from Step 2.
2. On the prescribed exercise, **before logging any set**, tap Replace and accept an alternate.
   **Pick a substitute you have never logged a set for** — verify it the same way Step 3b does, with
   the two-path query, not by memory. A substitute *with* history hides the failure behind a
   plausible-looking number; a substitute with none makes it unmistakable, because the field must be
   **empty** and the failure shows as `185`.
3. **Expected:** the weight field is empty. (If you could not find a history-free substitute, the
   weaker expectation is the substitute's own history and definitely not `185` — say which case you
   ran, in the PR.)
4. **Repeat the swap three times**, restarting the routine each time. Record all three outcomes.
5. This is the safety case: a prescription overrides history, so a stale one would pre-type an
   impossible load into the field.

⚠ **A single pass here is close to worthless, which is why step 4 says three.** Finding 7 explains
that the effect's read races the swap's write. If Task 2 Step 3 was skipped — the counter added but
never consumed — the outcome is exactly that unarbitrated race, which resolves benignly something
like half the time. One run therefore passes a broken implementation on a coin flip; three runs get
you to roughly 7-in-8 confidence, which is the most a manual check can buy here.

⚠ **And even three passes are confirmation, not proof.** The things that actually pin this are
AC6.7's five automated tests (the store's half) and AC6.9's structural check (the screen's half —
that `routineRevision` is in the prefill effect's dependency array and only there). If this step
fails, suspect the counter wiring — Task 1 Step 2's placement, or Task 2 Step 3's dependency array —
before suspecting Phase 1's clear; AC1.6 already proves the column is cleared.

Evidence: screenshots before and after each of the three swaps, plus the history-check query output
for the substitute.

**Step 4b: AC5.4 — a duration entry's Duration field is untouched**

Task 2 moves the `kind !== 'strength'` gate at `session.tsx:210`, so the async block now runs for
stretch and cardio entries too, and calls `apply()` a **second** time whenever a prescription exists.
`apply()` writes `setDurationText(...)` and `setCurrentRpe(undefined)` alongside the weight, so the
Duration field is now reachable by a code path that never touched it before. **No other step in this
phase puts a duration-based entry on screen.**

1. Build (or ask the coach for) a routine containing **two** stretch or cardio entries: one the coach
   gave a `targetWeightLbs`, one it did not. Nothing gates a prescription on `kind` —
   `validateRoutineDraft` calls `validateHalfStepWeight` unconditionally
   (`src/ai/draftSchema.ts:215`) — so ask for it directly if the coach will not volunteer one, and
   confirm with `select order_, exercise_id, target_weight_kg from routine_exercises where
   routine_id = '<id>';` that the column really is set on one row and null on the other.
2. Start the routine and arrive at each entry in turn.
3. **Expected:** the Duration field opens at the entry's target and **stays** there — no flicker to a
   different value, no reset to empty a beat after arriving. No weight input should appear.
4. On the **prescribed** entry, run the stopwatch and stop it, then wait a few seconds.
   **Expected:** the recorded duration stays in the field. The second `apply()` fires only while no
   set has been logged for the entry — which is exactly the window a stopwatch run happens in — so
   this is the narrow case where it could clobber a real value.

⚠ The unprescribed entry is a **control**, not a second test of the same thing: with no prescription
and no history (history is strength-only), the async block still returns early for it, so its
behaviour is byte-identical to today's. It is there to make a difference between the two entries
visible. The prescribed entry is the one that can fail.

Evidence: screenshots of both entries' Duration fields, taken a couple of seconds after arriving
(not on the first frame), plus the `target_weight_kg` query output showing one set and one null.

**Step 5: AC6.6 — the coach sees its own prescription**

⚠ **Do not ask this in the conversation where you accepted the draft.** That is the short route, it
is the one you will already be standing in after Step 2, and it makes the check vacuous: the model
answers correctly from **its own previous turn**, with `formatExerciseLine` contributing nothing at
all. Two things keep that conversation stale. The screen only re-initialises when its `modeKey`
changes (`ai-coach.tsx:66-83` — a `startedModeRef` guard, and `router.push('/routine/<id>')` after an
accept leaves the coach screen mounted in the stack), and the system prompt is cached until
`reset`/`openDebrief` bumps `systemEpoch` (`aiChatStore.ts`). So the prompt in play was built
*before* the routine existed. A pass proves the model has a memory, which was never in question.

1. **Force-quit the app and relaunch it.** The chat is never persisted, so this is the cheapest way to
   guarantee a genuinely new conversation and a freshly built system prompt.
2. Open the routine, and from *its* screen open the AI Coach in **edit mode** (or finish the workout
   and use the debrief — either is fine, both build a new prompt).
3. Ask something that requires it to know the programmed load — e.g. "what weight did you programme
   for squats?"
4. **Expected:** it answers with the prescribed number, in lbs.
5. **Sharper variant, worth the extra minute:** prescribe two *different* loads on two exercises in
   Step 2, and ask about the **second** one here. A model reconstructing an answer from context it
   does not actually have is much likelier to produce the first or the more memorable number.
6. This exercises the Phase 3 read path end to end.

Evidence: screenshot of the exchange, and state in the PR that the app was relaunched first — a
screenshot of the answer alone does not distinguish this from the vacuous version.

**Step 6: Record the results**

Put every screenshot and a one-line pass/fail for each of AC5.2, AC5.4, AC6.4, AC6.5, AC6.6 and
AC6.8 in the PR description, plus:

- the `count(*) = 0` output from Step 3b,
- **all three** swap outcomes from Step 4, not just the last one,
- the `target_weight_kg` query output from Step 4b,
- a note that the app was force-quit before Step 5,
- and the AC6.9 structural line from Task 2 Step 3c.

A phase whose only verification is manual is not done until the evidence is written down somewhere a
reviewer can see it — and for the repeated and structural checks, "it passed" without the count or
the line is indistinguishable from the shortcut version of the same step.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: AGENTS.md

**Verifies:** None (documentation). Required for the phase to be complete.

**Files:**
- Modify: `AGENTS.md`

**Step 1: Record the column and its unit boundary**

In the Boundaries section, near the existing rules about `routine_exercises` row identity and the
nullable `target_sets` column, add a paragraph covering:

- `routine_exercises.target_weight_kg` is a coach-prescribed target load, nullable, added at schema
  v5.
- **It is stored in kg and the coach speaks lbs.** There is exactly one write-side conversion,
  `lbsToKg` in `acceptDraft`, and the read edges are `computeSetPrefill` (`kgToLbs`) and
  `formatExerciseLine` (`formatWeightLbs`). A second conversion site is how a value gets converted
  twice.
- The bound is a **positive multiple of 0.5 lbs**, enforced in `validateRoutineDraft` and stated in
  `personaSection()`. It is the first non-integer field in the draft contract, which is why the
  persona's numeric guidance carries an explicit exception. `AI_TURN_SCHEMA` declares it as `number`
  with **no** bound keyword — `minimum` and `multipleOf` are both on `UNSUPPORTED_SCHEMA_KEYWORDS`.
- A prescription **overrides** the history-derived prefill and is **outranked** by the exercise's own
  last set this session. It is scoped to the weight field: reps still come from history.

**Step 2: Extend the `updateRoutineExerciseExerciseId` rule**

AGENTS.md's Boundaries section currently states that `updateRoutineExerciseExerciseId` is the only
path allowed to re-point a row, and that it must stamp attached null-stamped sets first. Add that it
must **also clear `target_weight_kg`**, and why: sets/reps/rest are near-dimensionless across
substitutes while load is not, and because a prescription overrides history rather than deferring to
it, a stale one wins over the substitute's own correct numbers instead of quietly losing to them.

**Step 3: Record the interop gap**

In the vault markdown contract section, add that `serializeRoutine` **does not** emit
`target_weight_kg` and the grammar was deliberately not extended, because `serializeRoutine`,
`exportRoutine` and all of `parse.ts` have no production caller. Note that wiring an export path to a
screen means adding a **distinct** flag key — not reusing `weight=`, which already means logged kg on
a session line.

While there, record the related finding: **the "session sets only" restriction on `weight=` is a
comment, not a rule.** `parseFlags` keeps one global `knownFlags` allowlist for both contexts
(`format.ts:247`), `parse.ts` consults its `context` parameter exactly once (line 171, the zero-reps
rule), and a routine line carrying `weight=60` parses cleanly today.

**Step 3b: Record the `routineRevision` ordering contract**

Next to the swap rule from Step 2, record that clearing the column is only half of it: the session
screen's prefill effect and `applyAlternateToRoutine`'s write are independent async paths off the
same dispatch, with no ordering between them, so `exerciseReplaceStore.routineRevision` is bumped
**after** the write and the prefill effect depends on it. State the two halves of the contract that a
future edit could break: bump strictly after `applyToRoutine` resolves, and never on a rejected swap
or a thrown write. Note that this is pinned by tests in `src/state/exerciseReplaceStore.test.ts`, so
it is one of the few session-screen behaviours with automated cover.

**State its scope explicitly, because the name is broader than the behaviour.** It bumps on exercise
swaps only. `upsertRoutine` is the other writer of `target_weight_kg`, so a coach revising a routine
through `acceptDraft` can change or clear a prescription and bump nothing — a session screen that
stays mounted across such an edit keeps the stale value until it remounts. That is not a live defect
(editing a routine mid-session is not a supported flow, and nothing outside the session screen's own
prefill reads a prescription), and the name is deliberately about the *routine* so an `acceptDraft`
bump can join the same counter later without a rename. Write that down; a reader who assumes routine
edits are already covered will not find out otherwise from the code.

**Step 4: Add the engine-convention note**

Under engine convention 6 ("Engine state carries ids, never display data"), add the prescribed weight
as a worked example: it is per-entry plan data that deliberately does **not** cross into
`RoutineEntry`, because no rule branches on load and the Rill record is closed. It reaches
`computeSetPrefill` as a caller-resolved argument, the same way `exerciseTitles` and
`historyFallback` do.

**Step 5: Update the freshness date**

Change AGENTS.md's `Last verified:` line to today's date.

**Step 6: Read the whole file back**

Seven separate passages change. A surviving cross-reference to a rule you rewrote shows up in no grep —
read it start to finish.

**Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "docs: record the coach-prescribed weight contract"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Final gate

**Verifies:** `coach-prescribed-weights.AC6.1`, `coach-prescribed-weights.AC6.2`, `coach-prescribed-weights.AC6.3`

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

**Step 4: Full-change review**

```bash
git diff origin/main...HEAD --stat
```

⚠ Three-dot, against the merge base. Phases 1–4 have merged into `origin/main` by the time this runs,
so a two-dot `git diff origin/main` compares your tip against a `main` that already contains them —
their files appear in your stat with inverted line counts, and this step's whole job is to confirm a
file list. Same reason as Phase 4's AC5.1/AC5.3 checks.

Confirm the change set is exactly: `src/db/{schema,migrations,repository}.ts`,
`src/db/models/RoutineExercise.ts`, `src/ai/{draftSchema,contextBuilder,acceptDraft}.ts`,
`src/state/{routineDetailPresenter,sessionPresenter,exerciseReplaceStore}.ts`, `src/app/session.tsx`,
`src/ai/provider/subset.test.ts` (the re-approved snapshot), `AGENTS.md`, the matching `*.test.ts`
files, and this plan's docs. **Nothing under `src/engine/`, nothing under `src/interop/`, nothing
under `src/components/`.**
<!-- END_TASK_5 -->

---

## Traps

1. **Leaving the async block's history-shaped early returns in place.** A new coach-authored routine has no history, so the prescription would never be applied — the feature would appear to do nothing, and no test in the repo would notice.
2. **Gating the prescription fetch on `entry.kind === 'strength'`.** Let `computeSetPrefill` decide instead. Note this is future-proofing, not a live bug — `kind !== 'strength'` and `isDurationBasedEntry` are currently the exact complement of one another (finding 4). An earlier draft of this plan claimed otherwise; do not go looking for a disagreement between them.
3. **Keying the lookup on `exerciseId`.** A routine may list the same exercise twice with different prescriptions. The key is `entry.idx`.
4. **Adding tests under `src/app/`.** No jest project loads that directory. The verification is the simulator.
5. **Uninstalling before the AC5.2 run.** It destroys the pre-v5 database and turns an upgrade test into a fresh-install test.
6. **Judging AC6.4 on the first frame.** The synchronous pass renders before the DB reads resolve; a value that changes to the prescribed number is correct.
7. **Chasing a route-shaped `tsc` error.** Stale `.expo/types/router.d.ts`, documented in AGENTS.md. Regenerate, do not edit code.
8. **Skipping the AGENTS.md read-through.** Seven passages change and cross-references do not grep.
9. **Assuming `routineRevision` covers routine edits.** It bumps on swaps only; an `acceptDraft` revision changes `target_weight_kg` and bumps nothing. Not a defect today — mid-session routine editing is not a supported flow — but the docblock and AGENTS.md must say so, or the next reader will assume otherwise.
10. **Bumping `routineRevision` before `await deps.applyToRoutine(...)`, or in the `catch`.** Either announces a clear that has not happened, and the effect re-reads and re-applies the *old* prescription — worse than not bumping at all. AC6.7's ordering test is the one that catches it.
11. **Adding `routineRevision` to the progression-hint effect's deps as well.** It does not read the prescription; widening its deps just refires a DB query on every swap. AC6.9 is the criterion behind this trap — it requires the counter to appear in exactly one dependency array, the prefill effect's.
12. **Treating a green AC6.5 as proof the ordering is right.** Before Task 1 it passed or failed on a coin flip. AC6.7's five automated tests and AC6.9's structural check are the real evidence; AC6.5 is confirmation, and only at three runs against a history-free substitute.
13. **Doing Task 1 and skipping Task 2 Step 3.** A counter nothing consumes changes nothing. All five AC6.7 tests still pass — they never load a screen — and AC6.5 still passes about half the time, because the outcome reverts to the raw race. AC6.9 is the only check that spans the covered module and the untestable screen.
14. **Moving the `routineRevision` bump below the `generation !== gen` guard.** It looks like tidying — that is where the path's other `set(...)` call lives — and four of AC6.7's five cases pass. But `generation` advances on `cancel()` and `open()`, so a sheet dismissed mid-write commits a swap that is never announced, and the stale prescription stays in the field. AC6.7's cancelled-mid-write case exists for this.
15. **Asking AC6.6's question in the conversation where you accepted the draft.** The model answers from its own prior turn and the prompt-building path under test contributes nothing. Force-quit first. This is the same defect class as trap 8 in test-requirements.md — a scenario whose setup guarantees the failure mode cannot occur.
16. **Leaving duration entries unexercised.** Task 2 moves the `kind !== 'strength'` gate, so `apply()` — which also writes the Duration field and resets RPE — now runs a second time on a prescribed stretch or cardio entry. AC5.4 is the only step that puts one on screen.
17. **Two-dot `git diff origin/main` in Task 5.** By this phase, four other PRs have landed on `main`; a two-dot diff reports them as part of your change set, which defeats the point of a file-list check.
