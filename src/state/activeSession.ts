import { create } from 'zustand';
import { Database } from '@nozbe/watermelondb';
import { createEngine, EffectExecutors, TransitionError } from '@/engine/index';
import { SessionState, Event, LoggedSet } from '@/engine/types';
import { createSession, appendSet, getSessionSets } from '@/db/repository';
import { saveEngineState, clearEngineState } from '@/db/engineState';

/**
 * Active session store state
 */
interface ActiveSessionState {
  sessionState: SessionState | null;
  lastError: string | null;
  dispatch(event: Event): Promise<SessionState | null>;
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
        return;
      }

      const sessionId = currentSessionState.sessionId;
      const exerciseId = set.exerciseId;
      const routineId = currentSessionState.routineId;

      // Query database for routine_exercises with this routine_id and exercise_id
      const routine_exercises = await database.get('routine_exercises').query().fetch();
      const routineExercise = (routine_exercises as any[]).find(
        (re) => re._raw.routine_id === routineId && re._raw.exercise_id === exerciseId
      );

      if (!routineExercise) {
        return;
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
      // No-op for now; implemented in Task 4
    },

    async onCancelRest() {
      // No-op for now; implemented in Task 4
    },

    async onNotify(message: string) {
      // No-op for now; implemented in Task 4
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
    },

    ...overrideExecutors,
  };

  // Create the engine with the executors
  const engine = createEngine(executors);

  // Create the Zustand store
  const store = create<ActiveSessionState>((set) => ({
    sessionState: null,
    lastError: null,

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
