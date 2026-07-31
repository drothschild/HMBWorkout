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
  // Dispatch Resume only in the phases where transition.lv defines a meaning
  // for it: paused (thaw a frozen rest / return to the pre-pause phase) and
  // resting (kill-mid-rest reconciliation: re-arm a live deadline's alert or
  // recover the phase from an expired one). Everywhere else the engine
  // rejects the event, and the rejection would park in lastError and render
  // as an error banner on the session screen.
  if (savedState.phase === 'paused' || savedState.phase === 'resting') {
    await store.getState().dispatch({ tag: 'Resume', nowMs });
  }
}
