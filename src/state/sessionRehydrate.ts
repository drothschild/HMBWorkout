// pattern: Imperative Shell
import type { Event, SessionState } from '@/engine/types';

/**
 * The slice of the active-session store the boot rehydrate needs. Structural,
 * so the global store and test stores built by createActiveSessionStore both
 * fit without this module importing the store (and its database singleton).
 */
export type RehydrateSessionStore = {
  getState(): {
    hydrate(state: SessionState): void;
    dispatch(event: Event): Promise<SessionState | null>;
  };
};

/**
 * Restart recovery: hydrate a persisted engine state into the store and
 * reconcile timing. Lives here rather than in _layout.tsx so the node jest
 * project covers it (screens are not jest-covered).
 */
export async function rehydrateActiveSession(
  store: RehydrateSessionStore,
  savedState: SessionState,
  nowMs: number
): Promise<void> {
  store.getState().hydrate(savedState);
  // Dispatch Resume to reconcile any expired rest deadline
  await store.getState().dispatch({ tag: 'Resume', nowMs });
}
