import type { SessionState } from '@/engine/types';

/**
 * Whether any screen may currently offer to start a new session.
 *
 * The engine accepts `StartSession` only from the Idle or Done phase and
 * rejects it from every in-progress phase, but that rejection must be a
 * safety net nobody ever hits, not the UX. Every
 * start affordance (Today, routine detail, ...) derives its start-vs-resume
 * rendering from this single predicate instead of re-deriving "is a session
 * active" ad hoc per screen.
 *
 * Sessions in 'done' phase are startable (workout completed); only
 * in-progress phases block starting a new session.
 */
export function canStartSession(sessionState: SessionState | null): boolean {
  if (sessionState === null) {
    return true;
  }
  return sessionState.phase === 'done';
}
