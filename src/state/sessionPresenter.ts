import { SessionState, Event, RoutineEntry, LoggedSet } from '@/engine/types';
import { formatWeightLbs, kgToLbs, lbsToKg } from './weightUnits';

/**
 * Session presenter - pure functions for session UI logic.
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
  isResting: boolean;
  isRestPaused: boolean;
  isStretching: boolean;
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

  // Copy for the finish-confirmation dialog. Finishing is irreversible (it
  // triggers vault sync, the HealthKit export, and the debrief), so the screen
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

  // Default input values for the next set (see computeSetPrefill). Undefined
  // when there is nothing sensible to prefill.
  setPrefill: SetInputValues | undefined;

  // Set position within the current entry (one-tap logging advances on log,
  // so the screen needs to show where the workout stands). setNumber counts
  // within the warmup or working segment; 0 when there is no current entry.
  isWarmupSet: boolean;
  setNumber: number;
  totalSetsForEntry: number;
  setPositionLabel: string;

  // User action handlers
  onLogSet(values: SetInputValues): void;
  onSkipSet(): void;
  onPause(): void;
  onResume(): void;
  onSkipRest(): void;
  onRestElapsed(): void;
  onSkipExercise(): void;
  onStartStretching(): void;
  onStopStretching(): void;
  onFinishSession(): void;
  onAbandonSession(): Promise<SessionState | null>;
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
  const parts: string[] = [];

  if (set.setType === 'stretch' || set.setType === 'cardio') {
    if (set.durationSeconds != null) {
      parts.push(`${set.durationSeconds}s`);
    }
  } else if (set.reps != null && set.weightKg != null) {
    parts.push(`${set.reps} x ${formatWeightLbs(set.weightKg)}`);
  } else if (set.reps != null) {
    parts.push(`${set.reps} reps`);
  } else if (set.weightKg != null) {
    parts.push(formatWeightLbs(set.weightKg));
  }

  if (set.rpe != null && set.rpe !== -1) {
    parts.push(`RPE: ${set.rpe}`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * Default input values for the next set of the current exercise.
 *
 * Precedence: the exercise's own last in-session set (matched by exerciseId —
 * the engine's LoggedSet carries no entry row id, and duplicate entries of the
 * same movement sharing a prefill is the desired behavior), then the caller's
 * cross-session history fallback (strength only), then the routine targets.
 * RPE is never prefilled: it is per-set perceived effort, and the -1 sentinel
 * must not leak into an input. Zero/absent metrics are omitted rather than
 * prefilled — the host maps 0 values to "not logged" on dispatch, so a
 * prefilled 0 would silently vanish from the logged set.
 */
export function computeSetPrefill(
  sessionState: SessionState,
  historyFallback?: SetInputValues
): SetInputValues | undefined {
  const entry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!entry) return undefined;

  const isDurationBased = entry.kind === 'stretch' || entry.kind === 'cardio';
  const sets = sessionState.loggedSets ?? [];

  let lastMatch: LoggedSet | undefined;
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i].exerciseId === entry.exerciseId) {
      lastMatch = sets[i];
      break;
    }
  }

  const prefill: SetInputValues = {};
  if (lastMatch) {
    if (isDurationBased) {
      if (lastMatch.durationSeconds != null && lastMatch.durationSeconds > 0) {
        prefill.durationSeconds = lastMatch.durationSeconds;
      }
    } else {
      if (lastMatch.reps != null && lastMatch.reps > 0) prefill.reps = lastMatch.reps;
      if (lastMatch.weightKg != null && lastMatch.weightKg > 0) {
        prefill.weightLbs = kgToLbs(lastMatch.weightKg);
      }
    }
    if (Object.keys(prefill).length > 0) return prefill;
    // A fully-empty logged set contributed nothing; fall through to the
    // fallbacks below rather than returning an all-undefined prefill.
  }

  // No usable in-session set for this exercise.
  if (isDurationBased) {
    // Cross-session history is structurally unavailable here (the history
    // query returns working-type sets only), so targets are the only fallback.
    return entry.targetDurationSeconds > 0
      ? { durationSeconds: entry.targetDurationSeconds }
      : undefined;
  }
  if (historyFallback) {
    if (historyFallback.reps != null && historyFallback.reps > 0) {
      prefill.reps = historyFallback.reps;
    }
    if (historyFallback.weightLbs != null && historyFallback.weightLbs > 0) {
      prefill.weightLbs = historyFallback.weightLbs;
    }
    if (Object.keys(prefill).length > 0) return prefill;
  }
  return entry.targetReps > 0 ? { reps: entry.targetReps } : undefined;
}

/**
 * Create a session presenter from state and dispatch.
 * Pure function - no hooks, no side effects, fully testable.
 *
 * @param progressionHint Optional progression hint (computed by store via progression_hint rule).
 *                          Phase 4 Task 3: display-only hint for strength exercises (e.g., "Increase weight by 5 lbs").
 * @param exerciseTitles Optional exerciseId → title map resolved by the caller.
 *                          Engine state carries only exercise ids (the Rill boundary strips
 *                          any extra entry fields), so titles must be looked up shell-side.
 * @param historyPrefill Optional cross-session prefill fallback resolved by the caller
 *                          (most recent working set of the current exercise); only used
 *                          when the exercise has no in-session set yet.
 */
export function createSessionPresenter(
  sessionState: SessionState,
  dispatch: (event: Event) => Promise<SessionState | null>,
  progressionHint?: string,
  exerciseTitles?: Record<string, string>,
  historyPrefill?: SetInputValues
): SessionPresenterOutput {
  // I3: Get current exercise from entries by exerciseIndex, not from loggedSets
  // loggedSets[last] shows the PREVIOUS exercise after advancement
  const currentEntry = sessionState.entries?.[sessionState.exerciseIndex];
  const currentExerciseId = currentEntry?.exerciseId || '';
  const currentExerciseTitle = exerciseTitles?.[currentExerciseId] || currentExerciseId;

  // Host sentinel boundary: 0 means "no value" for both rest fields
  const restDeadlineMs = sessionState.restDeadlineMs || undefined;
  const restRemainingMs = sessionState.restRemainingMs || undefined;

  // Derived set position: setIndex spans warmups then working sets, so the
  // label counts within the current segment ("Warmup 1 of 2" / "Set 3 of 4").
  const isWarmupSet = currentEntry ? sessionState.setIndex < currentEntry.warmupSets : false;
  const setNumber = currentEntry
    ? isWarmupSet
      ? sessionState.setIndex + 1
      : sessionState.setIndex - currentEntry.warmupSets + 1
    : 0;
  const totalSetsForEntry = currentEntry ? currentEntry.warmupSets + currentEntry.targetSets : 0;
  const setPositionLabel = currentEntry
    ? isWarmupSet
      ? `Warmup ${setNumber} of ${currentEntry.warmupSets}`
      : `Set ${setNumber} of ${currentEntry.targetSets}`
    : '';

  // Exercise progress: min clamps the skip-past-the-end index (SkipExercise on
  // the last entry), and the done override corrects for natural completion
  // leaving exerciseIndex at length-1.
  const totalExerciseCount = sessionState.entries?.length ?? 0;
  const completedExerciseCount =
    sessionState.phase === 'done'
      ? totalExerciseCount
      : Math.min(sessionState.exerciseIndex, totalExerciseCount);
  const exerciseProgress =
    totalExerciseCount > 0 ? completedExerciseCount / totalExerciseCount : 0;

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
    isResting: sessionState.phase === 'resting',
    isRestPaused: sessionState.phase === 'paused' && restRemainingMs !== undefined,
    isStretching: sessionState.phase === 'stretching',
    restDeadlineMs,
    restRemainingMs,
    loggedSets: sessionState.loggedSets ?? [],
    currentExerciseLoggedSets: (sessionState.loggedSets ?? [])
      .filter((set) => set.exerciseId === currentExerciseId)
      .reverse(),
    loggedSetCount: (sessionState.loggedSets ?? []).length,
    progressionHint,
    finishConfirmation,
    totalExerciseCount,
    completedExerciseCount,
    exerciseProgress,
    setPrefill: computeSetPrefill(sessionState, historyPrefill),
    isWarmupSet,
    setNumber,
    totalSetsForEntry,
    setPositionLabel,

    // Handlers dispatch events to the engine
    onLogSet: (values: SetInputValues) => {
      dispatch({
        tag: 'LogSet',
        reps: values.reps,
        // The input carries display lbs; the engine, DB, and vault stay kg
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

    onSkipExercise: () => {
      dispatch({
        tag: 'SkipExercise',
      });
    },

    onStartStretching: () => {
      dispatch({
        tag: 'StartStretching',
      });
    },

    onStopStretching: () => {
      dispatch({
        tag: 'StopStretching',
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
