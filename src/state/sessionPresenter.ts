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
  currentEntry: RoutineEntry | undefined;
  phase: string;
  isPaused: boolean;
  loggedSets: LoggedSet[];
  progressionHint: string | undefined;

  // User action handlers
  onLogSet(values: SetInputValues): void;
  onSetDone(): void;
  onPause(): void;
  onResume(): void;
  onSkipExercise(): void;
  onStartStretching(): void;
  onFinishSession(): void;
}

/**
 * Create a session presenter from state and dispatch.
 * Pure function - no hooks, no side effects, fully testable.
 *
 * @param progressionHint Optional progression hint (computed by store via progression_hint rule).
 *                          Phase 4 Task 3: display-only hint for strength exercises (e.g., "Increase weight by 2.5 kg").
 */
export function createSessionPresenter(
  sessionState: SessionState,
  dispatch: (event: Event) => Promise<SessionState | null>,
  progressionHint?: string
): SessionPresenterOutput {
  // I3: Get current exercise from entries by exerciseIndex, not from loggedSets
  // loggedSets[last] shows the PREVIOUS exercise after advancement
  const currentEntry = sessionState.entries?.[sessionState.exerciseIndex];
  const currentExerciseId = currentEntry?.exerciseId || '';

  return {
    currentExerciseId,
    currentEntry,
    phase: sessionState.phase,
    isPaused: sessionState.phase === 'paused',
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
