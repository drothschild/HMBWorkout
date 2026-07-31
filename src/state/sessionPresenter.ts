import { SessionState, Event, RoutineEntry, LoggedSet } from '@/engine/types';

/**
 * Session presenter - pure functions for session UI logic.
 * This satisfies AC2.2 (event dispatch on user action) and AC9.1 (RPE rendering).
 * Testable in node project without React setup.
 */
export interface SetInputValues {
  reps?: number;
  weightKg?: number;
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
  restDeadlineMs: number | undefined;
  restRemainingMs: number | undefined;
  loggedSets: LoggedSet[];
  progressionHint: string | undefined;

  // User action handlers
  onLogSet(values: SetInputValues): void;
  onSetDone(): void;
  onPause(): void;
  onResume(): void;
  onSkipRest(): void;
  onRestElapsed(): void;
  onSkipExercise(): void;
  onStartStretching(): void;
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
    parts.push(`${set.reps} x ${set.weightKg}kg`);
  } else if (set.reps != null) {
    parts.push(`${set.reps} reps`);
  } else if (set.weightKg != null) {
    parts.push(`${set.weightKg}kg`);
  }

  if (set.rpe != null && set.rpe !== -1) {
    parts.push(`RPE: ${set.rpe}`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * Create a session presenter from state and dispatch.
 * Pure function - no hooks, no side effects, fully testable.
 *
 * @param progressionHint Optional progression hint (computed by store via progression_hint rule).
 *                          Phase 4 Task 3: display-only hint for strength exercises (e.g., "Increase weight by 2.5 kg").
 * @param exerciseTitles Optional exerciseId → title map resolved by the caller.
 *                          Engine state carries only exercise ids (the Rill boundary strips
 *                          any extra entry fields), so titles must be looked up shell-side.
 */
export function createSessionPresenter(
  sessionState: SessionState,
  dispatch: (event: Event) => Promise<SessionState | null>,
  progressionHint?: string,
  exerciseTitles?: Record<string, string>
): SessionPresenterOutput {
  // I3: Get current exercise from entries by exerciseIndex, not from loggedSets
  // loggedSets[last] shows the PREVIOUS exercise after advancement
  const currentEntry = sessionState.entries?.[sessionState.exerciseIndex];
  const currentExerciseId = currentEntry?.exerciseId || '';
  const currentExerciseTitle = exerciseTitles?.[currentExerciseId] || currentExerciseId;

  // Host sentinel boundary: 0 means "no value" for both rest fields
  const restDeadlineMs = sessionState.restDeadlineMs || undefined;
  const restRemainingMs = sessionState.restRemainingMs || undefined;

  return {
    currentExerciseId,
    currentExerciseTitle,
    currentEntry,
    phase: sessionState.phase,
    isPaused: sessionState.phase === 'paused',
    isResting: sessionState.phase === 'resting',
    isRestPaused: sessionState.phase === 'paused' && restRemainingMs !== undefined,
    restDeadlineMs,
    restRemainingMs,
    loggedSets: sessionState.loggedSets ?? [],
    progressionHint,

    // Handlers dispatch events to the engine
    onLogSet: (values: SetInputValues) => {
      dispatch({
        tag: 'LogSet',
        reps: values.reps,
        weightKg: values.weightKg,
        rpe: values.rpe,
        durationSeconds: values.durationSeconds,
      });
    },

    onSetDone: () => {
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
