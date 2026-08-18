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
 * Whether every entry in a restored state carries a set list this build can run.
 *
 * `hydrate` is not a dispatch and no rule validates what it restores (engine
 * convention 5), so this is the only layer that can ask the question. It exists
 * because #276 Phase 6 deleted the derivation seam that used to answer it
 * silently: through Phase 5 an entry with aggregate counts and no `sets` was
 * expanded on the way into Rill, and since Phase 6 it reaches
 * `toRillRoutineEntry`'s `entry.sets.map(...)` and throws.
 *
 * An ABSENT list and an EMPTY one are deliberately different. `sets: []` is a
 * legitimate entry that prescribes nothing (convention 10) and restores fine; a
 * missing key is a state written by a build that predates the field.
 *
 * Every entry is checked, not just the current one. A later entry is reached by
 * advancing rather than at boot, so a positional check would admit the session
 * and throw mid-workout instead — losing the set the athlete just logged.
 */
function hasRunnablePlan(savedState: SessionState): boolean {
  const entries = (savedState.entries ?? []) as { sets?: unknown }[];
  return entries.every((entry) => Array.isArray(entry?.sets));
}

/**
 * Restart recovery: hydrate a persisted engine state into the store and
 * reconcile timing. Lives here rather than in _layout.tsx so the node jest
 * project covers it (screens are not jest-covered).
 *
 * A state this build cannot run is DROPPED rather than restored — see
 * `hasRunnablePlan`. Dropping it costs one abandoned in-progress workout;
 * restoring it throws out of the boot effect, which `_layout.tsx` catches into
 * `RuleErrorScreen`, leaving the user on an unrecoverable error screen with no
 * way to clear the offending session. The row stays in the database with a null
 * `ended_at`, so it is skipped the same way on every subsequent boot rather than
 * being silently destroyed.
 */
export async function rehydrateActiveSession(
  store: RehydrateSessionStore,
  savedState: SessionState,
  nowMs: number
): Promise<void> {
  if (!hasRunnablePlan(savedState)) return;

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
