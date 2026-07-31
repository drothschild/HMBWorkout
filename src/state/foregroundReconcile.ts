// pattern: Imperative Shell
import type { Event, SessionState } from '@/engine/types';

/**
 * The slice of the active-session store the foreground reconcile needs.
 * Structural, so the global store and test stores built by
 * createActiveSessionStore both fit without this module importing the store
 * (and its database singleton).
 */
export type ForegroundSessionStore = {
  getState(): {
    sessionState: SessionState | null;
    dispatch(event: Event): Promise<SessionState | null>;
  };
};

/**
 * Foreground recovery: an app backgrounded (not killed) past the rest deadline
 * has no reconcile path unless the session screen happens to be mounted, so
 * the AppState listener (_layout.tsx) calls this on every foreground. The
 * dispatch is deliberately blind — no phase gate here, because the store's
 * sessionState updates asynchronously after each dispatch and a gate read from
 * it can race the session screen's own dispatches. AppForegrounded is Ok in
 * every phase, so the engine (the only synchronous authority) makes the whole
 * decision. The null check is existence, not phase: no workout, nothing to
 * reconcile. Lives here rather than in _layout.tsx so the node jest project
 * covers it (screens are not jest-covered).
 */
export async function reconcileForegroundedSession(
  store: ForegroundSessionStore,
  nowMs: number
): Promise<void> {
  if (store.getState().sessionState === null) return;
  await store.getState().dispatch({ tag: 'AppForegrounded', nowMs });
}
