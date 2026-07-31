import { TodayRoutineChoice, TodayStartOptions } from './todayStartPresenter';

/**
 * Render-branch decision for the Today screen.
 * Pure function that encodes guard precedence and discriminant mapping
 * so rendering becomes an exhaustive switch statement.
 *
 * Precedence:
 * 1. Resume (active session) — highest priority, user is mid-workout
 * 2. Error (loadError) — visible even during retry (loading=true)
 * 3. Loading (no error, startOptions not yet resolved)
 * 4. Presenter kind — once data is loaded, render per presenter state
 */
export interface TodayViewState {
  kind: 'resume' | 'error' | 'loading' | 'no-routines' | 'routines-need-exercises' | 'choose-routine';
  error?: string;
  routines?: TodayRoutineChoice[];
}

export interface TodayViewStateInput {
  hasActiveSession: boolean;
  loading: boolean;
  loadError: string | null;
  startOptions: TodayStartOptions | null;
}

export function todayViewState(input: TodayViewStateInput): TodayViewState {
  const { hasActiveSession, loading, loadError, startOptions } = input;

  // 1. Resume: active session always wins
  if (hasActiveSession) {
    return { kind: 'resume' };
  }

  // 2. Error: visible even while loading (retry in flight)
  if (loadError) {
    return { kind: 'error', error: loadError };
  }

  // 3. Loading: only when no error and data not yet resolved
  if (loading) {
    return { kind: 'loading' };
  }

  // 4. Presenter state: startOptions must be resolved at this point
  if (!startOptions) {
    throw new Error('unexpected: startOptions is null but loading is false and no loadError');
  }

  // Exhaustive switch on presenter kind
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

    default:
      // @ts-expect-error exhaustiveness check
      const _never: never = startOptions.kind;
      return _never;
  }
}
