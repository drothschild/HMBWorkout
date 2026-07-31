/**
 * Whether any screen may currently offer to start a new session.
 *
 * The engine already refuses a `StartSession` event dispatched while a
 * session is active (`StartSession` is only valid from the Idle phase), but
 * that rejection must be a safety net nobody ever hits, not the UX. Every
 * start affordance (Today, routine detail, ...) derives its start-vs-resume
 * rendering from this single predicate instead of re-deriving "is a session
 * active" ad hoc per screen.
 */
export function canStartSession(hasActiveSession: boolean): boolean {
  return !hasActiveSession;
}
