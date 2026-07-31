import { create } from 'zustand';
import { Database } from '@nozbe/watermelondb';
import { createEngine, EffectExecutors } from '@/engine/index';
import { SessionState, Event, LoggedSet } from '@/engine/types';
import { createSession, appendSet, discardInProgressSession } from '@/db/repository';
import { saveEngineState } from '@/db/engineState';
import type { HealthKitSaveDeps } from '@/health/saveWorkout';
import type { DebriefMode } from '@/ai/contextBuilder';
import { planPostWorkoutDebrief } from '@/state/postWorkoutDebrief';
import { getSettings } from '@/state/settings';

// Discriminates a failed discard from an engine rejection in lastError. The
// session screen gates its recovery copy on this exact prefix — producer,
// consumer, and tests must all reference this constant, never a literal.
export const DISCARD_FAILURE_PREFIX = 'discard failed: ';

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
 * Re-export HealthKit dependency type for testing convenience
 */
export type HealthKitDeps = HealthKitSaveDeps;

/**
 * Create the active session store with real executors.
 * The store holds the current session state and errors, and provides a dispatch function.
 *
 * @param database The database instance
 * @param overrideExecutors Optional executor overrides for testing
 * @param syncFn Optional injectable sync function for testing; if provided, used instead of real sync logic in onCompleteSession
 * @param healthKitDeps Optional injectable HealthKit dependencies for testing; if provided, used instead of real HealthKit imports in onCompleteSession
 * @param openDebriefChat Optional injectable debrief navigator for testing; if provided, used instead of the real expo-router navigation in onCompleteSession
 * @returns The Zustand store with dispatch, getState
 */
export function createActiveSessionStore(
  database: Database,
  overrideExecutors?: Partial<EffectExecutors>,
  syncFn?: () => Promise<void>,
  healthKitDeps?: HealthKitDeps,
  openDebriefChat?: (mode: DebriefMode) => void
) {
  // Track current session state for executors
  let currentSessionState: SessionState | null = null;

  // Queue of pending discard promises. The queue is shared across all dispatches and
  // drained by whichever dispatch reaches the drain first. Safety comes from the rules
  // permitting at most one in-flight discard (a second AbandonSession from idle errors),
  // combined with the confirm dialog blocking user interaction during discard.
  // This ensures all discard side effects are observed by the caller before dispatch returns.
  const pendingDiscardPromises: Promise<void>[] = [];

  // Queue of pending set persists. One-tap logging emits the final set's
  // PersistSet and CompleteSession in the same transition, and rill invokes
  // executors fire-and-forget — so completion must wait for the persist or
  // syncNow() can serialize the session without its last set (posting is
  // idempotent by session id, so the missing set would never re-sync).
  const pendingPersistPromises: Promise<unknown>[] = [];

  async function drainPendingPersists(): Promise<void> {
    while (pendingPersistPromises.length > 0) {
      const p = pendingPersistPromises.shift()!;
      try {
        await p;
      } catch (err) {
        // The persist's own rejection is already logged by the engine host's
        // onExecutorError handler; completion must proceed regardless.
      }
    }
  }

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
      // CRITICAL: idx uses canonical 0-based order (matches routine_exercises.order from syncService import).
      // This is resilient to repeated exercises and superset structures where many exercises share exerciseId.
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

    onDiscardSession(sessionId: string) {
      // Abandon: delete the session and its sets outright. Sync and HealthKit
      // are untouched here by construction — both hang off onCompleteSession,
      // which an abandoned workout never emits. An in-flight LogSet persist
      // must land before the delete (mirroring onCompleteSession's drain), or
      // it would land afterwards and orphan a session_sets row for a session
      // that no longer exists.
      const p = drainPendingPersists().then(() =>
        discardInProgressSession(database, sessionId)
      );
      pendingDiscardPromises.push(p);
      return p;
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

      // Read both halves of the finished workout up front: the executor awaits
      // several times below, and by the end currentSessionState may already
      // belong to a different session.
      const sessionId = currentSessionState.sessionId;
      const finishedRoutineId = currentSessionState.routineId;

      // The final set's persist was dispatched in the same transition as this
      // completion; it must be on disk before the session closes and sync
      // serializes the sets.
      await drainPendingPersists();

      // Set ended_at and clear engine_state on the session in a single transaction
      // (using a fresh find() inside the write to ensure latest session instance)
      await database.write(async () => {
        const session = await database.get('sessions').find(sessionId) as any;
        await session.update((record: any) => {
          record._raw.ended_at = Date.now();
          record._raw.engine_state = '';
        });
      });

      // Attempt sync (fire-and-forget; sync failures must not affect session state)
      // Enqueue by attempting sync immediately; if sync fails, session stays local
      // and will be retried on next sync attempt
      if (syncFn) {
        // Use injected sync function (for testing)
        syncFn().catch((error) => {
          console.error('Sync failed after session completion:', error);
        });
      } else {
        // Real sync logic
        try {
          const { createSyncService } = await import('@/sync/syncService');
          const { createBridgeClient } = await import('@/sync/bridgeClient');

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
      }

      // Write to HealthKit (isolated; errors must not affect DB or sync)
      try {
        const { saveWorkout } = await import('@/health/saveWorkout');

        if (healthKitDeps) {
          // Use injected HealthKit deps (for testing)
          await saveWorkout(summary as any, healthKitDeps);
        } else {
          // Real HealthKit imports
          const { ensureAuthorized } = await import('@/health/healthkit');
          const HealthKit = await import('@kingstinct/react-native-healthkit');

          const realHealthKitDeps: HealthKitDeps = {
            ensureAuthorized: ensureAuthorized as any,
            requestAuthorization: HealthKit.requestAuthorization,
            saveWorkoutSample: HealthKit.saveWorkoutSample,
          };

          await saveWorkout(summary as any, realHealthKitDeps);
        }
      } catch (error) {
        // HealthKit is write-only; errors must not affect session state
        console.error('HealthKit write failed:', error);
      }

      // Aftermath, deliberately last: the session record is already closed and
      // sync and the Health write are under way, so nothing about finishing a
      // workout depends on the chat opening — or on it working.
      try {
        const debrief = planPostWorkoutDebrief(
          { routineId: finishedRoutineId, sessionId },
          getSettings()
        );

        if (debrief) {
          if (openDebriefChat) {
            // Injected navigator (for testing)
            openDebriefChat(debrief);
          } else {
            const { navigateToDebrief } = await import('@/state/debriefNavigation');
            navigateToDebrief(debrief);
          }
        }
      } catch (error) {
        console.error('Failed to open post-workout debrief:', error);
      }
    },

    ...overrideExecutors,
  };

  // Whatever persist executor is active — the default above or an injected
  // one — its promise joins the queue so onCompleteSession can wait for it.
  const activePersist = executors.onPersistSet;
  if (activePersist) {
    executors.onPersistSet = (set: LoggedSet) => {
      const p = Promise.resolve(activePersist(set));
      pendingPersistPromises.push(p);
      return p;
    };
  }

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
      // Apply the same idle→null mapping as dispatch(): the store's null and the
      // engine's idle phase represent the same state (no active workout).
      const hasSession = state.phase !== 'idle';
      set({
        sessionState: hasSession ? state : null,
        lastError: null,
      });
    },

    async dispatch(event: Event) {
      try {
        // Run the engine dispatch
        const newState = await engine.dispatch(event);

        // Track current state for executors
        currentSessionState = newState;

        // Settle any pending discards from this dispatch (queued by onDiscardSession).
        // This ensures a caller that awaits dispatch observes all side effects completed.
        // If a discard fails, it's caught by its own try/catch below.
        try {
          while (pendingDiscardPromises.length > 0) {
            const p = pendingDiscardPromises.shift()!;
            await p;
          }
        } catch (drainErr) {
          // Discard failure: roll the store FORWARD to match the engine's reality
          // (which has transitioned to idle), rather than preserving the old in-progress
          // state. This prevents store/engine disagreement. The error is surfaced via
          // lastError so the UI can inform the user; the row remains on disk for later
          // inspection and cleanup. Prefix with 'discard failed:' to discriminate from
          // engine rejection errors (which also null sessionState but have different root causes).
          const message = drainErr instanceof Error ? drainErr.message : String(drainErr);
          set({
            sessionState: null,
            lastError: `${DISCARD_FAILURE_PREFIX}${message}`,
          });
          return null;
        }

        // Neither an abandoned nor a completed session has a live row to persist
        // into: abandon deletes the row, and onCompleteSession clears the column.
        const hasSession = newState.phase !== 'idle';
        if (hasSession && newState.phase !== 'done') {
          await saveEngineState(database, newState.sessionId, newState);
        }

        // The store's `null` and the engine's `idle` phase are one state in two
        // encodings — no workout in progress. Abandon returns the engine to idle,
        // and the screens gate their start/resume affordances on the null.
        set({
          sessionState: hasSession ? newState : null,
          lastError: null,
        });

        // Deliberate asymmetry: successful dispatch returns the truthy idle state;
        // failed dispatch (above) returns null. This is load-bearing for the screen's
        // abandon confirmation logic: it distinguishes success (returns idle state)
        // from failure (returns null). See abandonSession.integration.test.ts for the
        // regression test that enforces this contract.
        return newState;
      } catch (err) {
        // TransitionError from engine: preserve the prior in-progress state and surface the error.
        // The engine rejected the event (e.g., invalid LogSet), but the session is still active
        // and should remain visible in the store.
        const message = err instanceof Error ? err.message : String(err);

        set({
          lastError: message,
          // sessionState is NOT changed here — preserved as-is
        });

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
