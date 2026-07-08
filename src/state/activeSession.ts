import { create } from 'zustand';
import { Database } from '@nozbe/watermelondb';
import { createEngine, EffectExecutors, TransitionError } from '@/engine/index';
import { SessionState, Event, LoggedSet } from '@/engine/types';
import { createSession, appendSet, getSessionSets } from '@/db/repository';
import { saveEngineState, clearEngineState } from '@/db/engineState';

// Defer import until needed to avoid loading database singleton at module load time
let database: Database | null = null;

function getDatabase(): Database {
  if (!database) {
    const mod = require('@/db');
    database = mod.database as Database;
  }
  return database as Database;
}

/**
 * Active session store state
 */
interface ActiveSessionState {
  sessionState: SessionState | null;
  lastError: string | null;
  dispatch(event: Event): Promise<SessionState | null>;
  hydrate(state: SessionState): void;
}

/**
 * Create the active session store with real executors.
 * The store holds the current session state and errors, and provides a dispatch function.
 *
 * @param database The database instance
 * @param overrideExecutors Optional executor overrides for testing
 * @returns The Zustand store with dispatch, getState
 */
export function createActiveSessionStore(
  database: Database,
  overrideExecutors?: Partial<EffectExecutors>
) {
  // Track current session state for executors
  let currentSessionState: SessionState | null = null;

  // Create executors that interact with the database
  const executors: Partial<EffectExecutors> = {
    async onCreateSession({ sessionId, routineId, startedAtMs }) {
      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs,
      });
    },

    async onPersistSet(set: LoggedSet) {
      if (!currentSessionState) {
        throw new Error('Cannot persist set: session state is null');
      }

      const sessionId = currentSessionState.sessionId;
      const routineId = currentSessionState.routineId;
      const exerciseIndex = currentSessionState.exerciseIndex;

      // I2: Resolve routine_exercise_id by entry index for deterministic lookup
      // This handles repeated exercises by matching on (routine_id, order: entry.idx)
      const currentEntry = currentSessionState.entries[exerciseIndex];
      if (!currentEntry) {
        throw new Error(`Exercise index ${exerciseIndex} out of range`);
      }

      if (currentEntry.exerciseId !== set.exerciseId) {
        throw new Error(
          `Logged exercise ID mismatch: expected ${currentEntry.exerciseId}, got ${set.exerciseId}`
        );
      }

      // Query routine_exercises by (routine_id, order: currentEntry.idx)
      const routine_exercises = await database.get('routine_exercises').query().fetch();
      const routineExercise = (routine_exercises as any[]).find(
        (re) =>
          re._raw.routine_id === routineId &&
          re._raw.order === currentEntry.idx
      );

      if (!routineExercise) {
        throw new Error(
          `Routine exercise not found for routine=${routineId}, order=${currentEntry.idx}`
        );
      }

      const routineExerciseId = (routineExercise as any).id;

      // Append the set to the database
      await appendSet(database, sessionId, routineExerciseId, {
        setType: set.setType as any,
        reps: set.reps ?? undefined,
        weightKg: set.weightKg ?? undefined,
        durationSeconds: set.durationSeconds ?? undefined,
        rpe: set.rpe ?? undefined,
      });
    },

    async onScheduleRest(deadlineMs: number) {
      // No-op by default; wired with real executor in app bootstrap
    },

    async onCancelRest() {
      // No-op by default; wired with real executor in app bootstrap
    },

    async onNotify(message: string) {
      // No-op by default; wired with real executor in app bootstrap
    },

    async onCompleteSession(summary: unknown) {
      if (!currentSessionState) return;

      const sessionId = currentSessionState.sessionId;

      // Set ended_at on the session
      const session = await database.get('sessions').find(sessionId);
      await database.write(async () => {
        await session.update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      // Clear the engine state
      await clearEngineState(database, sessionId);

      // Attempt sync (fire-and-forget; sync failures must not affect session state)
      // Enqueue by attempting sync immediately; if sync fails, session stays local
      // and will be retried on next sync attempt
      try {
        const { createSyncService } = await import('@/sync/syncService');
        const { createBridgeClient } = await import('@/sync/bridgeClient');
        const { getSettings } = await import('@/state/settings');

        const settings = getSettings();
        const bridgeClient = createBridgeClient(settings);
        const syncService = createSyncService(database, bridgeClient);

        // Fire-and-forget: don't await or propagate errors
        syncService.syncNow().catch((error) => {
          console.error('Sync failed after session completion:', error);
        });
      } catch (error) {
        // Ignore import or initialization errors
        console.error('Failed to initialize sync:', error);
      }
    },

    ...overrideExecutors,
  };

  // Create the engine with the executors
  const engine = createEngine(executors);

  // Create the Zustand store
  const store = create<ActiveSessionState>((set) => ({
    sessionState: null,
    lastError: null,

    hydrate(state: SessionState) {
      // Update both the store state and the engine's internal state
      currentSessionState = state;
      engine.setState(state);
      set({
        sessionState: state,
        lastError: null,
      });
    },

    async dispatch(event: Event) {
      try {
        // Run the engine dispatch
        const newState = await engine.dispatch(event);

        // Track current state for executors
        currentSessionState = newState;

        // After successful transition, save the engine state
        if (newState) {
          await saveEngineState(database, newState.sessionId, newState);
        }

        // Update store state
        set({
          sessionState: newState,
          lastError: null,
        });

        return newState;
      } catch (err) {
        // Handle TransitionError
        const message = err instanceof Error ? err.message : String(err);

        // Set error but preserve prior state
        set((state) => ({
          lastError: message,
          sessionState: state.sessionState, // Keep existing state
        }));

        return null;
      }
    },
  }));

  // Return store interface
  return store;
}

/**
 * Global active session store instance.
 * Initialized lazily on first use to avoid importing database at module load time.
 * This allows tests to import and use the factory without triggering SQLiteAdapter.
 */
let globalStore: ReturnType<typeof createActiveSessionStore> | null = null;

/**
 * Get or create the global active session store.
 * On first call, creates the store with the database singleton.
 * Subsequent calls return the same instance.
 */
export function getActiveSessionStore(): ReturnType<typeof createActiveSessionStore> {
  if (!globalStore) {
    globalStore = createActiveSessionStore(getDatabase());
  }
  return globalStore;
}

/**
 * Proxy for the global active session store.
 * Supports both function calls (with selectors) and property/method access.
 *
 * Usage:
 *   activeSessionStore((state) => state.sessionState)  // selector call
 *   activeSessionStore.getState()                       // method access
 *   activeSessionStore.dispatch({tag: 'LogSet'})        // method access
 */
export const activeSessionStore = new Proxy(getActiveSessionStore as any, {
  apply(target, thisArg, args: any[]) {
    // When called as a function with a selector
    return getActiveSessionStore()(args[0]);
  },
  get(target, prop: string | symbol) {
    // When accessing properties/methods
    if (prop === 'getState' || prop === 'setState' || prop === 'subscribe' || prop === 'hydrate' || prop === 'dispatch') {
      return (getActiveSessionStore() as any)[prop];
    }
    return undefined;
  },
}) as any as ReturnType<typeof createActiveSessionStore>;

/**
 * Inject real executors into the global store.
 * Called from app bootstrap (_layout.tsx) to wire production notification APIs.
 *
 * M1: Avoid double-creation by rebuilding the store once with all executors.
 * This replaces the no-op store created on first access with one that has
 * real effect executors (rest timer, notifications).
 *
 * Note: Called once at bootstrap before any store access (getActiveSessionStore is not called until needed).
 * If called after first access, rebuilds with real executors. Guard: only call once from _layout.tsx.
 *
 * @param executors The real executors to inject (e.g., rest timer, notifications)
 */
export function injectRealExecutors(executors: Partial<EffectExecutors>): void {
  // Always rebuild the store with real executors, whether this is first access or not
  // This ensures all executors (no-ops + real) are wired before any dispatch calls
  globalStore = createActiveSessionStore(getDatabase(), executors);
}
