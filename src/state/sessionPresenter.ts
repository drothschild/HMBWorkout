// pattern: Imperative Shell
import { SessionState, Event, RoutineEntry, RoutineSet, LoggedSet } from '@/engine/types';
import { entrySets } from '@/engine/entrySets';
import { formatWeightLbs, kgToLbs, lbsToKg } from './weightUnits';
import { isDurationBasedEntry } from './exerciseStopwatch';

/**
 * Session presenter - derives session-screen view data from engine state.
 * Shell-classified for its handler closures alone: they stamp Date.now()
 * onto dispatched events; every derivation here is pure.
 * This satisfies AC2.2 (event dispatch on user action) and AC9.1 (RPE rendering).
 * Testable in node project without React setup.
 */
export interface SetInputValues {
  reps?: number;
  /** Display unit: the weight input carries lbs; kg stays canonical past the presenter. */
  weightLbs?: number;
  rpe?: number;
  durationSeconds?: number;
}

export interface SessionPresenterOutput {
  currentExerciseId: string;
  currentExerciseTitle: string;
  currentEntry: RoutineEntry | undefined;
  phase: string;
  isPaused: boolean;
  /**
   * Wall-clock ms the session started (engine state, passed through
   * unchanged). The header stopwatch computes elapsed time itself on its own
   * ticking interval — see `computeElapsedSeconds`/`computeElapsedMs`
   * (`@/state/workoutStopwatch`) for why it keeps running through
   * pause/resume and only freezes once the session reaches `done`:
   * `SessionState` has no accumulated-pause-duration field to freeze
   * against.
   */
  startedAtMs: number;
  isResting: boolean;
  isRestPaused: boolean;
  restDeadlineMs: number | undefined;
  restRemainingMs: number | undefined;
  loggedSets: LoggedSet[];
  // The current exercise's sets only, newest first, for the session screen's
  // internally-scrolling list (the fixed chrome must fit a phone screen).
  // Matched by exerciseId — a routine listing the same exercise twice merges
  // both entries' sets here, since the engine's LoggedSet carries no entry row
  // id; that matches how progression hints already key on exerciseId.
  currentExerciseLoggedSets: LoggedSet[];
  /** Total sets logged this session across all exercises. */
  loggedSetCount: number;
  progressionHint: string | undefined;

  // Routine display data resolved shell-side by the caller (engine state
  // carries only routineId). The description is "at the beginning" chrome:
  // routineNotes is present only while the workout hasn't started in earnest
  // (first exercise, nothing logged, not done) — a display gate on existing
  // engine state, not a flow decision.
  routineName: string | undefined;
  routineNotes: string | undefined;

  // Copy for the finish-confirmation dialog. Finishing is irreversible (it
  // triggers the HealthKit export and the debrief), so the screen
  // always confirms; the message carries how much planned work remains so an
  // early finish reads as an informed choice. Derived here to stay jest-covered.
  finishConfirmation: { title: string; message: string };

  // Exercise progress through the routine. A skipped exercise counts as
  // completed (exerciseIndex advances on skip, so the bar tracks position);
  // at phase done the bar reads full regardless of index.
  totalExerciseCount: number;
  completedExerciseCount: number;
  /** 0..1 fill fraction for the progress bar; 0 for an empty routine. */
  exerciseProgress: number;

  // Set position within the current entry (one-tap logging advances on log,
  // so the screen needs to show where the workout stands). setNumber counts
  // within the warmup or working segment; 0 when there is no current entry.
  isWarmupSet: boolean;
  setNumber: number;
  totalSetsForEntry: number;
  setPositionLabel: string;
  /**
   * The duration the CURRENT set prescribes, or undefined (#276). The
   * stopwatch counts up to this, so a plan whose timed sets differ — 30s then
   * 45s — must not show one figure for both. Undefined when the entry is not
   * duration-based, when the set prescribes no duration, or when `setIndex`
   * points past the list.
   */
  currentSetDurationSeconds: number | undefined;

  // True when the current set is the exercise's last set (warmup or working).
  // Used to gate the RPE popup trigger: show RPE input only after final set.
  isLastSetOfExercise: boolean;

  // User action handlers
  onLogSet(values: SetInputValues): void;
  onSkipSet(): void;
  onPause(): void;
  onResume(): void;
  onSkipRest(): void;
  onRestElapsed(): void;
  onFinishSession(): void;
  onAbandonSession(): Promise<SessionState | null>;
}

/**
 * True when the session is in a resting or paused-mid-rest state.
 * Encodes the presenter's combined isResting/isRestPaused predicate as one
 * check for restCommentaryTarget's use; the presenter itself still derives
 * the two flags separately for display.
 */
export function isRestingPhase(sessionState: SessionState): boolean {
  return sessionState.phase === 'resting' || (sessionState.phase === 'paused' && Boolean(sessionState.restRemainingMs));
}

/** How many of `sets` are of the same kind (warmup / not-warmup) as `isWarmup`. */
export function countSetsOfType(sets: readonly RoutineSet[], isWarmup: boolean): number {
  return sets.filter((set) => (set.setType === 'warmup') === isWarmup).length;
}

/**
 * Derive the set position within the current entry's run of same-typed sets.
 * Both the presenter (for display) and restCommentaryTarget (for the prompt)
 * need the same calculation.
 *
 * PER-SET (#276 AC3.3): the position is a COUNT of preceding sets of the same
 * type, not `setIndex - warmupSets + 1`. The old arithmetic assumed every
 * warmup precedes every working set, which a real plan need not honour — on
 * INTERLEAVE (`[warmup, normal, warmup]`) it renders "Set 0" at index 2. No
 * value of `warmupSets` gives the right answer there, which is what makes that
 * fixture the discriminator.
 *
 * `totalOfType` is the denominator the two label builders need. It is returned
 * from here rather than recomputed by each of them so the numerator and the
 * denominator can never come from different readings of the plan.
 *
 * An out-of-range `setIndex` — reachable through `hydrate`, which no rule
 * validates (engine convention 5) — reports `totalOfType: 0`, which both label
 * builders read as *hide*.
 *
 * @returns { isWarmupSet, setNumber, totalOfType } or null if there is no
 *          current entry
 */
export function deriveSetPosition(
  sessionState: SessionState,
  entry: RoutineEntry | undefined
): { isWarmupSet: boolean; setNumber: number; totalOfType: number } | null {
  if (!entry) return null;

  const sets = entrySets(entry);
  const current = sets[sessionState.setIndex];

  // No set at this position: nothing to count and nothing to count against.
  if (!current) return { isWarmupSet: false, setNumber: 1, totalOfType: 0 };

  const isWarmupSet = current.setType === 'warmup';
  const setNumber =
    countSetsOfType(sets.slice(0, sessionState.setIndex), isWarmupSet) + 1;

  return { isWarmupSet, setNumber, totalOfType: countSetsOfType(sets, isWarmupSet) };
}

/**
 * Shared formatter for logged sets across session and history detail screens.
 * Handles sentinel conventions: rpe -1 and null reps/weight/duration mean "absent"
 * and must be omitted, never rendered.
 *
 * @param setType The set type (strength/stretch/cardio/etc)
 * @param reps Logged reps (null/undefined = absent)
 * @param weightKg Logged weight in kg (null/undefined = absent)
 * @param durationSeconds Logged duration (null/undefined = absent)
 * @param rpe Logged RPE (-1 sentinel or null/undefined = absent)
 */
export function formatSetLine(
  setType: string,
  reps: number | null | undefined,
  weightKg: number | null | undefined,
  durationSeconds: number | null | undefined,
  rpe: number | null | undefined
): string {
  const parts: string[] = [];

  if (setType === 'stretch' || setType === 'cardio') {
    if (durationSeconds != null) {
      parts.push(`${durationSeconds}s`);
    }
  } else if (reps != null && weightKg != null) {
    parts.push(`${reps} x ${formatWeightLbs(weightKg)}`);
  } else if (reps != null) {
    parts.push(`${reps} reps`);
  } else if (weightKg != null) {
    parts.push(formatWeightLbs(weightKg));
  }

  if (rpe != null && rpe !== -1) {
    parts.push(`RPE: ${rpe}`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * Format one logged set for the session screen's Logged Sets list.
 * Reps/weight/duration may legitimately be null or undefined, and rpe carries
 * the host's -1 sentinel for "not logged" (see SENTINEL_TO_OPTION_MAP in
 * engine/index.ts) — absent metrics are omitted rather than rendered.
 * Each set formats from its own setType, so a session mixing strength and
 * duration exercises renders every line correctly.
 */
export function formatLoggedSetLine(set: LoggedSet): string {
  return formatSetLine(set.setType, set.reps, set.weightKg, set.durationSeconds, set.rpe);
}

/**
 * The exercise currently being performed, or '' when there is none.
 *
 * The session screen's per-exercise effects (set prefill, progression hint)
 * derive per-exercise data, so they must re-run whenever the exercise changes —
 * and `exerciseIndex` alone does not say that. ReplaceExercise rewrites
 * `entries[exerciseIndex].exerciseId` in place, leaving the index untouched, so
 * an effect keyed on the index would keep showing the replaced exercise's
 * numbers. A primitive (rather than the entry object, whose identity changes on
 * every dispatch) so it works as a React dependency.
 */
export function currentExerciseId(
  sessionState: SessionState | null | undefined
): string {
  return sessionState?.entries?.[sessionState.exerciseIndex]?.exerciseId ?? '';
}

/** What a fetched cross-session prefill was fetched *for*. */
export interface PrefillTarget {
  sessionId: string;
  exerciseIndex: number;
  exerciseId: string;
  setIndex: number;
}

/**
 * Whether a cross-session history prefill is still the right thing to apply.
 *
 * The history query is async, and the workout keeps moving while it is in
 * flight: the user can log a set, advance to the next exercise, finish and
 * start another session, or swap the exercise out from under the request. The
 * result is applied only if the state it was fetched for is still the state on
 * screen.
 *
 * All four keys matter, and two of them are easy to miss:
 *
 *  - the exerciseId, because a swap leaves sessionId and exerciseIndex
 *    identical while changing what is being performed, so checking only the
 *    first two would prefill the substitute's inputs with the original's last
 *    set;
 *  - the setIndex, because the prefill is now per-set (#276): a result fetched
 *    for set 1 must not be applied to set 2.
 *
 * The setIndex check REPLACED an older "and the current exercise has no logged
 * set" clause, which existed for the same reason — a set logged while the query
 * was in flight — but expressed it as a property of the whole exercise rather
 * than of the position. That was harmless while the prescription was one value
 * per exercise; per-set it was fatal, because it meant the DB-backed upgrade
 * silently stopped applying after an exercise's very first set and the athlete
 * saw set 0's numbers for the entire ramp. Every LogSet moves `setIndex` or
 * `exerciseIndex` (a superset hop changes the latter, engine convention 9), so
 * the position pair detects the same race exactly, and detects nothing else.
 */
export function historyPrefillStillApplies(
  fresh: SessionState,
  target: PrefillTarget
): boolean {
  return (
    fresh.sessionId === target.sessionId &&
    fresh.exerciseIndex === target.exerciseIndex &&
    currentExerciseId(fresh) === target.exerciseId &&
    fresh.setIndex === target.setIndex
  );
}

/**
 * Default input values for the next set of the current exercise.
 *
 * THE PRECEDENCE, PER-SET (#276 AC3.8, revised). Three terms became four, and
 * the new top term is the one that makes a per-set plan mean anything:
 *
 *   weight    0. the current set's own `target_weight_kg`, WHEN THE PLAN
 *                INTENDS A CHANGE HERE (see below)
 *             1. the exercise's own last set **this session** (matched by
 *                exerciseId — the engine's LoggedSet carries no entry row id,
 *                and duplicate entries of the same movement sharing a prefill
 *                is the desired behavior)
 *             2. **the current set's own** `target_weight_kg`
 *             3. the caller's cross-session history fallback
 *             (no terminal: a plan with no load prefills no weight)
 *
 *   reps      0. the current set's own `target_reps`, when the plan intends a
 *                change here
 *             1. the exercise's own last set this session
 *             2. the cross-session history fallback
 *             3. the current set's own `target_reps` (a range prefills its
 *                lower bound; `target_reps_max` is guidance, not a default)
 *
 *   duration  0. the current set's own `target_duration_seconds`, when the plan
 *                intends a change here
 *             1. the exercise's own last set this session
 *             2. the current set's own `target_duration_seconds`
 *             (no history — the history query returns working sets only)
 *
 * **"The plan intends a change here" is decided FIELD BY FIELD, not set by
 * set.** For field F at set i, the plan asserts itself iff F's planned value at
 * i differs from F's planned value at i-1. At i = 0 there is no previous set to
 * inherit from, so the plan asserts itself iff F is not uniform across the
 * entry — i.e. iff this is a genuinely per-set plan at all.
 *
 * Why field-wise, and why the uniformity clause. Three scenarios, and only this
 * rule gets all three right:
 *
 *   RAMP 5x20 / 5x25 / 3x40 / 8x50 — the loads and reps must ramp. Rank 1 alone
 *   flattens the whole thing to set 0's numbers.
 *
 *   FLAT 3x8 @ 50, athlete drops to 45 — the deviation must stick. A rule that
 *   let the plan win unconditionally would re-offer 50 on every set and fight
 *   the athlete, which is rank 1's entire reason for existing.
 *
 *   REPS DROP 8/8/6 @ 50, athlete drops to 45 — the planned rep change must
 *   land AND the deviated load must survive. Comparing whole SETS fails here:
 *   set 2 differs as a set, so a set-wise rule drags the weight back to 50.
 *
 * The uniformity clause at set 0 is what keeps this free of regression on every
 * routine that exists today. An aggregate-derived list is uniform in every
 * field by construction, so the override never fires on one and the ranks below
 * behave byte-identically to the pre-#276 code — including the documented
 * weight/reps asymmetry there ("the coach programs the load, the reps come from
 * what the athlete does"): with a prescribed 185 and a history set of 8 x 175,
 * a flat plan still prefills 8 reps at 185. What changes is that a per-set plan
 * — a ramp — now owns its own rep counts from the very first set instead of
 * inheriting last week's.
 *
 * Not repaired here, and pre-existing: `lastMatch` matches by exerciseId across
 * the whole session, so a routine listing the same movement twice shares one
 * prefill between the two entries. With a uniform plan the second entry's set 0
 * therefore still inherits the first entry's logged values. That sharing is
 * deliberate (see rank 1) and changing it needs an entry identity on
 * `LoggedSet`, which the engine does not carry.
 *
 * `prescribedSets` is the current entry's set list read FRESH from the database
 * by the caller, indexed here by `setIndex`. It is deliberately not taken off
 * engine state: `ReplaceExercise` leaves an entry's `sets` intact while
 * `updateRoutineExerciseExerciseId` clears every `target_weight_kg` in the DB,
 * so only a DB read makes an exercise swap's clear visible to the running
 * session. See `routineSetPlans.ts`. Reps and duration, which a swap does NOT
 * clear, come from engine state's own list, so a failed prescription read costs
 * the load and nothing else.
 *
 * RPE is never prefilled: it is per-set perceived effort, and the -1 sentinel
 * must not leak into an input. Zero/absent metrics are omitted rather than
 * prefilled — the host maps 0 values to "not logged" on dispatch, so a prefilled
 * 0 would silently vanish from the logged set. A prescribed weight of 0 is
 * therefore read as *no prescription*, not as a prescribed zero.
 */

/**
 * Convert a SessionSet from history into SetInputValues for prefilling.
 * Pure transformation: maps null/undefined columns to the display format (kg→lbs)
 * and returns undefined if neither reps nor weight are available.
 * Testable: no DB, no side effects, only data transformation.
 */
export function historyToSetInputValues(historySet: {
  reps?: number | null | undefined;
  weightKg?: number | null | undefined;
}): SetInputValues | undefined {
  const values: SetInputValues = {};
  if (historySet.reps != null) {
    values.reps = historySet.reps;
  }
  if (historySet.weightKg != null) {
    values.weightLbs = kgToLbs(historySet.weightKg);
  }
  if (values.reps !== undefined || values.weightLbs !== undefined) {
    return values;
  }
  return undefined;
}

/**
 * One entry's prescribed sets as the caller read them out of `routine_sets`,
 * in `order`. Structurally satisfied by `RoutineSetEntry` from the repository;
 * spelled minimally here so the presenter keeps no dependency on `src/db`.
 */
export type PrescribedSets = readonly { targetWeightKg?: number | null }[];

/** A metric's value, with the codebase's "0 and null both mean absent" reading. */
function positiveOrUndefined(value: number | null | undefined): number | undefined {
  return value != null && value > 0 ? value : undefined;
}

/**
 * Whether the plan asserts field F at `index` — the (b′) rule, applied to one
 * field's values across an entry's prescribed sets.
 *
 * `values[i]` is F's planned value at set i, already normalized so that absent
 * and zero compare equal. Returns false when the plan says nothing at `index`:
 * there is no value to assert, and "the plan intends to REMOVE the load here"
 * is not a thing a routine can express.
 */
function planAssertsField(
  values: readonly (number | undefined)[],
  index: number
): boolean {
  const here = values[index];
  if (here === undefined) return false;
  if (index > 0) return values[index - 1] !== here;

  // Set 0 has no previous set to inherit from. The plan asserts itself only if
  // it is per-set at all; a uniform list (every aggregate-derived one) leaves
  // the ranks below exactly as they were before #276.
  return values.some((value) => value !== here);
}

export function computeSetPrefill(
  sessionState: SessionState,
  historyFallback?: SetInputValues,
  prescribedSets?: PrescribedSets
): SetInputValues | undefined {
  const entry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!entry) return undefined;

  const isDurationBased = isDurationBasedEntry(entry);
  const sets = sessionState.loggedSets ?? [];
  const setIndex = sessionState.setIndex;

  // The set actually being performed. Out of range — reachable through
  // `hydrate`, which no rule validates (convention 5) — means no plan, not
  // set 0's plan.
  const plannedSets = entrySets(entry);
  const plannedSet: RoutineSet | undefined = plannedSets[setIndex];

  // The prescribed load for THAT set, converted to display lbs once, here.
  // Absent for a duration-based entry (there is no weight input to fill) and
  // for any non-positive value (0 means "no prescription", matching the > 0
  // absence convention every other metric in this function uses).
  const prescribedWeightKg = prescribedSets?.[setIndex]?.targetWeightKg;
  const prescribedLbs =
    !isDurationBased && prescribedWeightKg != null && prescribedWeightKg > 0
      ? kgToLbs(prescribedWeightKg)
      : undefined;

  // ---- R0: the fields where the plan intends a change AT THIS SET ---------
  // Two source arrays, one index. The load comes from the DB list the caller
  // read (a swap clears those, and engine state would not know); reps and
  // duration come from engine state's own list, which a swap deliberately
  // preserves. See this function's docstring and `routineSetPlans.ts`.
  const plannedReps = positiveOrUndefined(plannedSet?.reps);
  const plannedDuration = positiveOrUndefined(plannedSet?.durationSeconds);

  const planAssertsWeight =
    prescribedLbs !== undefined &&
    planAssertsField(
      (prescribedSets ?? []).map((set) => positiveOrUndefined(set.targetWeightKg)),
      setIndex
    );
  const planAssertsReps =
    !isDurationBased &&
    planAssertsField(plannedSets.map((set) => positiveOrUndefined(set.reps)), setIndex);
  const planAssertsDuration =
    isDurationBased &&
    planAssertsField(
      plannedSets.map((set) => positiveOrUndefined(set.durationSeconds)),
      setIndex
    );

  let lastMatch: LoggedSet | undefined;
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i].exerciseId === entry.exerciseId) {
      lastMatch = sets[i];
      break;
    }
  }

  const prefill: SetInputValues = {};

  // A field the plan asserts is claimed here, before any lower rank can write
  // it. Every rank below fills only what is still undefined, which is what
  // makes the override field-wise rather than set-wise.
  if (planAssertsWeight) prefill.weightLbs = prescribedLbs;
  if (planAssertsReps) prefill.reps = plannedReps;
  if (planAssertsDuration) prefill.durationSeconds = plannedDuration;

  // ---- R2: this session's own last set for this exercise ----------------
  if (lastMatch) {
    // `contributed` is computed from the LOGGED SET ALONE, never from
    // `prefill`'s key count. See "The bug class" below: a return gated on
    // "prefill is non-empty" is wrong the moment the prescription can populate
    // prefill, and this function has produced that defect twice.
    let contributed = false;

    if (isDurationBased) {
      if (lastMatch.durationSeconds != null && lastMatch.durationSeconds > 0) {
        if (prefill.durationSeconds === undefined) {
          prefill.durationSeconds = lastMatch.durationSeconds;
        }
        contributed = true;
      }
    } else {
      if (lastMatch.reps != null && lastMatch.reps > 0) {
        if (prefill.reps === undefined) prefill.reps = lastMatch.reps;
        contributed = true;
      }
      if (lastMatch.weightKg != null && lastMatch.weightKg > 0) {
        if (prefill.weightLbs === undefined) prefill.weightLbs = kgToLbs(lastMatch.weightKg);
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
    // The history query returns working-type sets only, so the planned set is
    // the only fallback here. A duration entry's prefill can hold nothing but
    // this one field, so returning it alone loses nothing.
    if (prefill.durationSeconds === undefined && plannedDuration !== undefined) {
      prefill.durationSeconds = plannedDuration;
    }
    return prefill.durationSeconds !== undefined
      ? { durationSeconds: prefill.durationSeconds }
      : undefined;
  }

  // ---- The override: the prescription claims the weight field ahead of
  // ---- history. Reps are untouched and still come from history below.
  if (prefill.weightLbs === undefined && prescribedLbs !== undefined) {
    prefill.weightLbs = prescribedLbs;
  }

  // ---- R4: cross-session history ----------------------------------------
  if (historyFallback) {
    // Both predicates read `historyFallback` alone, never `prefill`. That is
    // what keeps R4's firing independent of whether a prescription exists.
    const historyHasReps = historyFallback.reps != null && historyFallback.reps > 0;
    const historyHasWeight =
      historyFallback.weightLbs != null && historyFallback.weightLbs > 0;

    if (prefill.reps === undefined && historyHasReps) prefill.reps = historyFallback.reps;
    if (prefill.weightLbs === undefined && historyHasWeight) {
      prefill.weightLbs = historyFallback.weightLbs;
    }

    if (historyHasReps || historyHasWeight) return prefill;
  }

  // ---- R5: the planned set's own reps (terminal) -------------------------
  // A range prefills its lower bound; `repsMax` is guidance for the athlete,
  // not a default to type into the input.
  if (prefill.reps === undefined && plannedReps !== undefined) prefill.reps = plannedReps;
  return Object.keys(prefill).length > 0 ? prefill : undefined;
}

/**
 * Create a session presenter from state and dispatch.
 * No hooks; the derivations are pure, and the returned handlers' only side
 * effects are stamping Date.now() and calling the injected dispatch.
 *
 * @param progressionHint Optional progression hint (computed by store via progression_hint rule).
 *                          Phase 4 Task 3: display-only hint for strength exercises (e.g., "Increase weight by 5 lbs").
 * @param exerciseTitles Optional exerciseId → title map resolved by the caller.
 *                          Engine state carries only exercise ids (the Rill boundary strips
 *                          any extra entry fields), so titles must be looked up shell-side.
 * @param routineDisplay Optional routine name/description resolved by the caller
 *                          (getRoutineDisplay) — engine state carries only routineId,
 *                          so display fields must be looked up shell-side.
 */
export function createSessionPresenter(
  sessionState: SessionState,
  dispatch: (event: Event) => Promise<SessionState | null>,
  progressionHint?: string,
  exerciseTitles?: Record<string, string>,
  routineDisplay?: { name: string; notes: string | null }
): SessionPresenterOutput {
  // I3: Get current exercise from entries by exerciseIndex, not from loggedSets
  // loggedSets[last] shows the PREVIOUS exercise after advancement
  const currentEntry = sessionState.entries?.[sessionState.exerciseIndex];
  const currentExerciseId = currentEntry?.exerciseId || '';
  const currentExerciseTitle = exerciseTitles?.[currentExerciseId] || currentExerciseId;

  // Host sentinel boundary: 0 means "no value" for both rest fields
  const restDeadlineMs = sessionState.restDeadlineMs || undefined;
  const restRemainingMs = sessionState.restRemainingMs || undefined;

  // Derived set position: the label counts within the current run of same-typed
  // sets ("Warmup 2 of 3" / "Set 1 of 4"), with the denominator being the count
  // of that type within the entry's own list (#276 AC3.4).
  //
  // An empty list is legitimate — a routine entry may prescribe nothing — and
  // must suppress the label: "Set 1 of 0" is nonsense, and SetLogger already
  // hides the empty string. `totalOfType > 0` is the guard rather than
  // `sets.length > 0` because it also covers an out-of-range `setIndex`
  // restored by `hydrate` (engine convention 5); for any in-range position the
  // two are the same question.
  const setPos = deriveSetPosition(sessionState, currentEntry);
  const isWarmupSet = setPos?.isWarmupSet ?? false;
  const setNumber = setPos?.setNumber ?? 0;
  const currentEntrySets = entrySets(currentEntry);
  const totalSetsForEntry = currentEntrySets.length;
  const setPositionLabel =
    setPos && setPos.totalOfType > 0
      ? isWarmupSet
        ? `Warmup ${setNumber} of ${setPos.totalOfType}`
        : `Set ${setNumber} of ${setPos.totalOfType}`
      : '';

  // True when this is the exercise's final set. The comparison setIndex ===
  // sets.length - 1 correctly identifies a superset member's own last visit
  // (engine convention 9) without needing extra group logic: a member is
  // visited once per round up to its own list length and never after.
  //
  // The `> 0` half is defensive only and provably so: `setIndex` is never
  // negative, so an empty list makes the comparison `setIndex === -1`, which is
  // already false. A mutation that drops it therefore survives the suite, and
  // that is expected — it is kept because reading "is the last set" off an
  // entry with no sets should be false by statement, not by arithmetic luck.
  const isLastSetOfExercise = Boolean(
    currentEntry && totalSetsForEntry > 0 && sessionState.setIndex === totalSetsForEntry - 1
  );

  // The stopwatch target comes from the set being performed, not the entry —
  // two timed sets of the same hold may legitimately prescribe different
  // durations.
  const currentSetDuration = currentEntrySets[sessionState.setIndex]?.durationSeconds;
  const currentSetDurationSeconds =
    currentSetDuration != null && currentSetDuration > 0 ? currentSetDuration : undefined;

  // Exercise progress: min defensively clamps exerciseIndex to the total (it
  // should never exceed entries.length, but progress math must stay safe if
  // it ever does), and the done override corrects for natural completion
  // leaving exerciseIndex at length-1.
  const totalExerciseCount = sessionState.entries?.length ?? 0;
  const completedExerciseCount =
    sessionState.phase === 'done'
      ? totalExerciseCount
      : Math.min(sessionState.exerciseIndex, totalExerciseCount);
  const exerciseProgress =
    totalExerciseCount > 0 ? completedExerciseCount / totalExerciseCount : 0;

  // The routine description shows only at the beginning of the workout — the
  // entry the engine actually lands a fresh session on, nothing logged,
  // session not done — then yields the space back. Null notes stay undefined
  // so the screen never renders a blank line. The starting index is not
  // hardcoded to 0: engine convention 10 has StartSession skip a leading
  // zero-set entry, so a session can legitimately begin already sitting on a
  // later index. findIndex returns -1 when entries is empty or every entry
  // has an empty set list — both now rejected at StartSession, so unreachable
  // via a real session — but Math.max keeps this defensively correct (falls
  // back to 0, matching the prior hardcoded behavior) rather than leaning on
  // that guarantee holding forever.
  const startingExerciseIndex = Math.max(
    0,
    sessionState.entries?.findIndex((entry) => entrySets(entry).length > 0) ?? 0
  );
  const atBeginning =
    sessionState.exerciseIndex === startingExerciseIndex &&
    (sessionState.loggedSets ?? []).length === 0 &&
    sessionState.phase !== 'done';
  const routineNotes = atBeginning ? routineDisplay?.notes ?? undefined : undefined;

  // Finish-confirmation copy: the engine decides which phases allow
  // FinishSession; the screen only confirms intent, with this message.
  const totalEntries = totalExerciseCount;
  const remainingEntries = Math.max(0, totalEntries - sessionState.exerciseIndex);
  const loggedCount = (sessionState.loggedSets ?? []).length;
  const remainingClause =
    remainingEntries > 0
      ? ` ${remainingEntries} planned ${remainingEntries === 1 ? 'exercise remains' : 'exercises remain'}.`
      : '';
  const finishConfirmation = {
    title: 'Finish workout?',
    message: `You've logged ${loggedCount} ${loggedCount === 1 ? 'set' : 'sets'}.${remainingClause} Finish and save this workout?`,
  };

  return {
    currentExerciseId,
    currentExerciseTitle,
    currentEntry,
    phase: sessionState.phase,
    isPaused: sessionState.phase === 'paused',
    startedAtMs: sessionState.startedAtMs,
    isResting: sessionState.phase === 'resting',
    isRestPaused: sessionState.phase === 'paused' && restRemainingMs !== undefined,
    restDeadlineMs,
    restRemainingMs,
    loggedSets: sessionState.loggedSets ?? [],
    currentExerciseLoggedSets: (sessionState.loggedSets ?? [])
      .filter((set) => set.exerciseId === currentExerciseId)
      .reverse(),
    loggedSetCount: (sessionState.loggedSets ?? []).length,
    progressionHint,
    routineName: routineDisplay?.name,
    routineNotes,
    finishConfirmation,
    totalExerciseCount,
    completedExerciseCount,
    exerciseProgress,
    isWarmupSet,
    setNumber,
    totalSetsForEntry,
    setPositionLabel,
    currentSetDurationSeconds,
    isLastSetOfExercise,

    // Handlers dispatch events to the engine
    onLogSet: (values: SetInputValues) => {
      dispatch({
        tag: 'LogSet',
        reps: values.reps,
        // The input carries display lbs; the engine and DB stay kg
        weightKg: values.weightLbs !== undefined ? lbsToKg(values.weightLbs) : undefined,
        rpe: values.rpe,
        durationSeconds: values.durationSeconds,
        nowMs: Date.now(),
      });
    },

    // Advance without logging a set (the engine's SetDone event). LogSet
    // already advances on its own, so this is the "Skip Set" affordance.
    onSkipSet: () => {
      dispatch({
        tag: 'SetDone',
        nowMs: Date.now(),
      });
    },

    onPause: () => {
      dispatch({
        tag: 'PauseSession',
        nowMs: Date.now(),
      });
    },

    onResume: () => {
      dispatch({
        tag: 'Resume',
        nowMs: Date.now(),
      });
    },

    onSkipRest: () => {
      dispatch({
        tag: 'SkipRest',
      });
    },

    onRestElapsed: () => {
      dispatch({
        tag: 'RestElapsed',
        nowMs: Date.now(),
      });
    },

    onFinishSession: () => {
      dispatch({
        tag: 'FinishSession',
        nowMs: Date.now(),
      });
    },

    // Throws the workout away. The engine decides which phases allow it and
    // emits the discard; the screen only has to confirm the intent.
    // Returns the dispatch promise for the screen to await and handle success/failure.
    onAbandonSession: () =>
      dispatch({
        tag: 'AbandonSession',
      }),
  };
}

/**
 * React hook wrapper for the presenter - for use in actual components.
 * This delegates to createSessionPresenter and handles component lifecycle if needed.
 */
export function useSessionPresenter(
  sessionState: SessionState,
  dispatch: (event: Event) => Promise<SessionState | null>
): SessionPresenterOutput {
  return createSessionPresenter(sessionState, dispatch);
}
