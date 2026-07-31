import { canStartSession } from './canStartSession';

/**
 * What the routine detail screen's primary action button should do.
 *
 * A session already in progress always wins over this routine's own
 * startability: resuming the in-progress workout is the only honest option,
 * even if this particular routine has no exercises to start.
 */
export type RoutineStartMode = { kind: 'resume' } | { kind: 'start'; enabled: boolean };

export interface RoutineStartModeInput {
  readonly hasActiveSession: boolean;
  readonly isRoutineStartable: boolean;
}

export function routineStartMode(input: Readonly<RoutineStartModeInput>): RoutineStartMode {
  if (!canStartSession(input.hasActiveSession)) {
    return { kind: 'resume' };
  }

  return { kind: 'start', enabled: input.isRoutineStartable };
}
