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
 * `entries` ITSELF gets the same `Array.isArray` treatment, one level up, and
 * for the same reason. `entries ?? []` looks like a harmless default and is not:
 * `[].every(...)` is vacuously true, so a state with no `entries` key was
 * ADMITTED and then threw `Cannot read properties of undefined (reading 'map')`
 * out of `fromRillState`'s `tsState.entries.map(toRillRoutineEntry)` — the same
 * unrecoverable boot screen this guard exists to prevent, one field over. A
 * build predating the field is this guard's stated threat model and `entries` is
 * a field like any other.
 *
 * Every entry is checked, not just the current one. A later entry is reached by
 * advancing rather than at boot, so a positional check would admit the session
 * and throw mid-workout instead — losing the set the athlete just logged.
 */
function hasRunnablePlan(savedState: SessionState): boolean {
  const entries = savedState.entries as unknown;
  if (!Array.isArray(entries)) return false;
  return (entries as { sets?: unknown }[]).every((entry) => Array.isArray(entry?.sets));
}

/**
 * Restart recovery: hydrate a persisted engine state into the store and
 * reconcile timing. Lives here rather than in _layout.tsx so the node jest
 * project covers it (screens are not jest-covered).
 *
 * A state this build cannot run is DROPPED rather than restored — see
 * `hasRunnablePlan`. Restoring it throws out of the boot effect, which
 * `_layout.tsx` catches into `RuleErrorScreen`, leaving the user on an
 * unrecoverable error screen with no way to clear the offending session.
 *
 * **A drop must also DISPOSE of the state, not merely decline to read it.** The
 * row is kept (a null `ended_at` session is the audit trail that something was
 * abandoned) but its `engine_state` is cleared, and that clear is the whole
 * point rather than tidying. `loadActiveEngineState` returns the FIRST
 * `ended_at IS NULL` row carrying a non-null `engine_state`, with no ordering,
 * and a dropped row is by construction the older one — so leaving the state in
 * place does not cost "one abandoned workout", it costs EVERY workout: the
 * stale row is handed back on every subsequent boot and the live in-progress
 * session behind it is never reached. There is no escape route, either:
 * `discardInProgressSession` is reachable only from the session UI, which needs
 * the session in the store, which the drop refuses. Clearing the state makes
 * the row invisible to `loadActiveEngineState` and restart recovery survives.
 *
 * The clear is injected rather than imported so this module stays free of the
 * database singleton (the same reason it takes the store structurally), and its
 * failure is swallowed: a throw here would escape into `RuleErrorScreen`, which
 * is the outcome the drop exists to avoid.
 */
export type RehydrateDeps = {
  /**
   * Clear a session's persisted `engine_state`. `clearEngineState` in
   * `src/db/engineState.ts` is the production implementation.
   */
  clearEngineState: (sessionId: string) => Promise<void>;
};

export async function rehydrateActiveSession(
  store: RehydrateSessionStore,
  savedState: SessionState,
  nowMs: number,
  deps: RehydrateDeps
): Promise<void> {
  if (!hasRunnablePlan(savedState)) {
    try {
      await deps.clearEngineState(savedState.sessionId);
    } catch (error) {
      console.error(
        `Failed to clear the engine_state of unrunnable session ${savedState.sessionId}:`,
        error
      );
    }
    return;
  }

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
