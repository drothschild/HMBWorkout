import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import { createSession } from './repository';
import { saveEngineState, loadActiveEngineState, clearEngineState } from './engineState';
import { SessionState } from '@/engine/types';

describe('engineState', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('saveEngineState', () => {
    it('should save a SessionState to the session row as JSON', async () => {
      // Create a session
      const sessionId = 'test-session-1';
      const routineId = 'test-routine-1';
      const startedAtMs = Date.now();

      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs,
      });

      // Create a SessionState
      const state: SessionState = {
        sessionId,
        routineId,
        phase: 'working',
        exerciseIndex: 2,
        setIndex: 1,
        restDeadlineMs: 1000,
        loggedSets: [
          {
            exerciseId: 'ex-1',
            setType: 'warmup',
            reps: 10,
            weightKg: 20,
            durationSeconds: null,
            rpe: null,
          },
        ],
        startedAtMs,
        prePausePhase: '',
        entries: [],
      };

      // Save the state
      await saveEngineState(database, sessionId, state);

      // Retrieve and verify
      const session = await database.get('sessions').find(sessionId);
      const savedState = JSON.parse((session as any)._raw.engine_state);

      expect(savedState).toEqual(state);
      expect(savedState.phase).toBe('working');
      expect(savedState.exerciseIndex).toBe(2);
    });
  });

  describe('loadActiveEngineState', () => {
    it('should return null when no active session exists', async () => {
      const state = await loadActiveEngineState(database);
      expect(state).toBeNull();
    });

    it('should return the active session state when one exists', async () => {
      // Create two sessions: one active, one completed
      const activeSessionId = 'active-1';
      const completedSessionId = 'completed-1';

      await createSession(database, {
        sessionId: activeSessionId,
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      await createSession(database, {
        sessionId: completedSessionId,
        routineId: 'routine-2',
        startedAtMs: Date.now(),
      });

      // Create a state for the active session
      const activeState: SessionState = {
        sessionId: activeSessionId,
        routineId: 'routine-1',
        phase: 'working',
        exerciseIndex: 1,
        setIndex: 0,
        loggedSets: [],
        startedAtMs: Date.now(),
        prePausePhase: '',
        entries: [],
      };

      // Save state to active session
      await saveEngineState(database, activeSessionId, activeState);

      // Mark the completed session as ended
      await database.write(async () => {
        const completedSession = await database.get('sessions').find(completedSessionId);
        await completedSession.update((session: any) => {
          session._raw.ended_at = Date.now();
        });
      });

      // Also save engine state to the completed session (should be ignored)
      const completedState: SessionState = {
        ...activeState,
        sessionId: completedSessionId,
        phase: 'done',
      };
      await saveEngineState(database, completedSessionId, completedState);

      // Load and verify only the active session is returned
      const loaded = await loadActiveEngineState(database);
      expect(loaded).toBeDefined();
      expect(loaded?.sessionId).toBe(activeSessionId);
      expect(loaded?.phase).toBe('working');
    });

    it('should return null if active session has no engine_state set', async () => {
      // Create a session without engine_state
      await createSession(database, {
        sessionId: 'session-no-state',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      const loaded = await loadActiveEngineState(database);
      expect(loaded).toBeNull();
    });
  });

  describe('clearEngineState', () => {
    it('should clear the engine_state from a session', async () => {
      const sessionId = 'test-session-clear';
      await createSession(database, {
        sessionId,
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      // Save a state
      const state: SessionState = {
        sessionId,
        routineId: 'routine-1',
        phase: 'working',
        exerciseIndex: 1,
        setIndex: 0,
        loggedSets: [],
        startedAtMs: Date.now(),
        prePausePhase: '',
        entries: [],
      };

      await saveEngineState(database, sessionId, state);

      // Verify it's saved
      let session = await database.get('sessions').find(sessionId);
      expect((session as any)._raw.engine_state).toBeDefined();

      // Clear it
      await clearEngineState(database, sessionId);

      // Verify it's cleared (empty string represents cleared for text field)
      session = await database.get('sessions').find(sessionId);
      expect((session as any)._raw.engine_state).toBe('');
    });

    it('should not affect other sessions when clearing', async () => {
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';

      await createSession(database, {
        sessionId: sessionId1,
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      await createSession(database, {
        sessionId: sessionId2,
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      const state: SessionState = {
        sessionId: sessionId1,
        routineId: 'routine-1',
        phase: 'working',
        exerciseIndex: 1,
        setIndex: 0,
        loggedSets: [],
        startedAtMs: Date.now(),
        prePausePhase: '',
        entries: [],
      };

      await saveEngineState(database, sessionId1, state);
      await saveEngineState(database, sessionId2, state);

      // Clear only session 1
      await clearEngineState(database, sessionId1);

      // Verify session 1 is cleared (empty string represents cleared for text field)
      let session1 = await database.get('sessions').find(sessionId1);
      expect((session1 as any)._raw.engine_state).toBe('');

      // Verify session 2 still has its state
      let session2 = await database.get('sessions').find(sessionId2);
      expect((session2 as any)._raw.engine_state).toBeDefined();
    });
  });

  describe('round-trip serialization', () => {
    it('should preserve deep equality through save and load cycle', async () => {
      const sessionId = 'roundtrip-test';
      await createSession(database, {
        sessionId,
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      const originalState: SessionState = {
        sessionId,
        routineId: 'routine-1',
        phase: 'resting',
        exerciseIndex: 3,
        setIndex: 2,
        restDeadlineMs: Date.now() + 30000,
        supersetPosition: 1,
        loggedSets: [
          {
            exerciseId: 'ex-1',
            setType: 'working',
            reps: 8,
            weightKg: 50.5,
            durationSeconds: null,
            rpe: 8.5,
          },
          {
            exerciseId: 'ex-2',
            setType: 'warmup',
            reps: 10,
            weightKg: 40,
            durationSeconds: null,
            rpe: null,
          },
        ],
        lastLoggedSet: {
          exerciseId: 'ex-2',
          setType: 'warmup',
          reps: 10,
          weightKg: 40,
          durationSeconds: null,
          rpe: null,
        },
        startedAtMs: Date.now(),
        prePausePhase: 'working',
        entries: [
          {
            idx: 0,
            exerciseId: 'ex-1',
            kind: 'strength',
            restSeconds: 60,
            supersetGroup: 'A',
            sets: [
              { setType: 'warmup', reps: 8 },
              { setType: 'normal', reps: 8 },
              { setType: 'normal', reps: 8 },
              { setType: 'normal', reps: 8 },
            ],
          },
        ],
      };

      // Save and load
      await saveEngineState(database, sessionId, originalState);
      const loadedState = await loadActiveEngineState(database);

      // Deep equality check
      expect(loadedState).toEqual(originalState);
    });
  });
});
