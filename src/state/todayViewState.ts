import { TodayRoutineChoice, TodayStartOptions } from './todayStartPresenter';
import { canStartSession } from './canStartSession';

/**
 * Render-branch decision for the Today screen.
 * Pure function that encodes guard precedence and discriminant mapping
 * so rendering becomes an exhaustive switch statement.
 *
 * Precedence:
 * 1. Resume (active session) — highest priority, user is mid-workout
 * 2. Error (loadError) — stays visible while any load is in flight (retry or
 *    focus reload); it clears only on a successful load
 * 3. Loading — a load is in flight, or the first load has not resolved yet
 *    (the initial render happens before the focus effect fires)
 * 4. Presenter kind — once data is loaded, render per presenter state
 */
export type TodayViewState =
  | { kind: 'resume' }
  | { kind: 'error'; error: string }
  | { kind: 'loading' }
  | { kind: 'no-routines' }
  | { kind: 'routines-need-exercises'; routines: TodayRoutineChoice[] }
  | { kind: 'choose-routine'; routines: TodayRoutineChoice[] };

export interface TodayViewStateInput {
  hasActiveSession: boolean;
  loading: boolean;
  loadError: string | null;
  startOptions: TodayStartOptions | null;
}

export function todayViewState(input: TodayViewStateInput): TodayViewState {
  const { hasActiveSession, loading, loadError, startOptions } = input;

  if (!canStartSession(hasActiveSession)) {
    return { kind: 'resume' };
  }

  if (loadError) {
    return { kind: 'error', error: loadError };
  }

  if (loading || !startOptions) {
    return { kind: 'loading' };
  }

  switch (startOptions.kind) {
    case 'no-routines':
      return { kind: 'no-routines' };

    case 'routines-need-exercises':
      return {
        kind: 'routines-need-exercises',
        routines: startOptions.routines,
      };

    case 'choose-routine':
      return {
        kind: 'choose-routine',
        routines: startOptions.routines,
      };

    default: {
      const _never: never = startOptions;
      return _never;
    }
  }
}
