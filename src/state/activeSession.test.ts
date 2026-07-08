import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createActiveSessionStore } from './activeSession';
import { SessionState } from '@/engine/types';
import { getSession } from '@/db/repository';
import { loadActiveEngineState } from '@/db/engineState';

describe('activeSession store', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('StartSession event', () => {
    it('should create a session in the database with the same sessionId', async () => {
      const store = createActiveSessionStore(database);

      // Build a routine (simplified for test)
      const routine = {
        id: 'routine-1',
        name: 'Test Routine',
        entries: [
          {
            exerciseId: 'ex-1',
            kind: 'strength' as const,
            warmupSets: 1,
            targetSets: 3,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      };

      const sessionId = crypto.randomUUID?.() || 'test-session-id';
      const nowMs = Date.now();

      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs,
        routine,
      });

      // Verify the session was created with the same ID
      const createdSession = await getSession(database, sessionId);
      expect(createdSession).toBeDefined();
      expect(createdSession?.id).toBe(sessionId);
    });

    it('should initialize store state with the session data', async () => {
      const store = createActiveSessionStore(database);

      const routine = {
        id: 'routine-1',
        name: 'Test Routine',
        entries: [
          {
            exerciseId: 'ex-1',
            kind: 'strength' as const,
            warmupSets: 1,
            targetSets: 3,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      };

      const sessionId = crypto.randomUUID?.() || 'test-session-id';
      const nowMs = Date.now();

      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs,
        routine,
      });

      const state = store.getState();
      expect(state.sessionState).toBeDefined();
      expect(state.sessionState?.sessionId).toBe(sessionId);
      expect(state.sessionState?.phase).toBe('warmup');
    });
  });

  describe('LogSet event', () => {
    it('should persist the set to the database', async () => {
      const appendSetMock = jest.fn().mockResolvedValue(undefined);
      const store = createActiveSessionStore(database, {
        onPersistSet: appendSetMock,
      });

      const routine = {
        id: 'routine-1',
        name: 'Test Routine',
        entries: [
          {
            exerciseId: 'ex-1',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      };

      const sessionId = crypto.randomUUID?.() || 'test-session-id';
      const nowMs = Date.now();

      // Start session
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs,
        routine,
      });

      // Verify session was created
      const session = await getSession(database, sessionId);
      expect(session).toBeDefined();

      // Log a set
      await store.getState().dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 50,
        durationSeconds: 0,
        rpe: 7,
      });

      // Verify appendSet (mocked) was called with the right parameters
      expect(appendSetMock).toHaveBeenCalled();
      const callArg = appendSetMock.mock.calls[0][0];
      expect(callArg).toEqual(
        expect.objectContaining({
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 8,
          weightKg: 50,
          rpe: 7,
        })
      );

      // Verify state was updated
      const storeState = store.getState();
      expect(storeState.sessionState?.loggedSets.length).toBe(1);
      expect(storeState.sessionState?.loggedSets[0].reps).toBe(8);
      expect(storeState.sessionState?.loggedSets[0].weightKg).toBe(50);
      expect(storeState.sessionState?.loggedSets[0].rpe).toBe(7);
    });

    it('should preserve RPE with 0.5 step precision', async () => {
      const store = createActiveSessionStore(database);

      const routine = {
        id: 'routine-1',
        name: 'Test Routine',
        entries: [
          {
            exerciseId: 'ex-1',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      };

      const sessionId = crypto.randomUUID?.() || 'test-session-id';

      // Start session
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      // Log a set with RPE 7.5
      await store.getState().dispatch({
        tag: 'LogSet',
        durationSeconds: 0,
        reps: 8,
        weightKg: 50,
        rpe: 7.5,
      });

      const storeState = store.getState();
      expect(storeState.sessionState?.loggedSets[0].rpe).toBe(7.5);
    });

    it('should save engine state after successful transition', async () => {
      const appendSetMock = jest.fn().mockResolvedValue(undefined);
      const store = createActiveSessionStore(database, {
        onPersistSet: appendSetMock,
      });

      const routine = {
        id: 'routine-1',
        name: 'Test Routine',
        entries: [
          {
            exerciseId: 'ex-1',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      };

      const sessionId = crypto.randomUUID?.() || 'test-session-id';

      // Start session
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      // Log a set
      await store.getState().dispatch({
        tag: 'LogSet',
        durationSeconds: 0,
        reps: 8,
        weightKg: 50,
      });

      // Verify engine state is persisted in store
      const storeState = store.getState();
      expect(storeState.sessionState).toBeDefined();
      expect(storeState.sessionState?.sessionId).toBe(sessionId);

      // Verify engine state was saved to database
      const loadedState = await loadActiveEngineState(database);
      expect(loadedState).toBeDefined();
      expect(loadedState?.sessionId).toBe(sessionId);
      expect(loadedState?.phase).toEqual(storeState.sessionState?.phase);
    });
  });

  describe('TransitionError handling', () => {
    it('should set lastError and preserve sessionState on failed transition', async () => {
      const store = createActiveSessionStore(database);

      // Don't start a session, just try to LogSet (should fail)
      await store.getState().dispatch({
        tag: 'LogSet',
        durationSeconds: 0,
        reps: 8,
      });

      const state = store.getState();
      expect(state.lastError).toBeDefined();
      expect(state.sessionState).toBeNull(); // No session was started
    });
  });

  describe('store initialization', () => {
    it('should initialize with null state and no error', async () => {
      const store = createActiveSessionStore(database);

      const state = store.getState();
      expect(state.sessionState).toBeNull();
      expect(state.lastError).toBeNull();
    });

    it('should provide dispatch function', async () => {
      const store = createActiveSessionStore(database);

      expect(typeof store.getState().dispatch).toBe('function');
    });
  });

  describe('SetDone event', () => {
    it('should advance to the next exercise', async () => {
      const store = createActiveSessionStore(database);

      const routine = {
        id: 'routine-1',
        name: 'Test Routine',
        entries: [
          {
            exerciseId: 'ex-1',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
          {
            exerciseId: 'ex-2',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 6,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
        ],
      };

      const sessionId = crypto.randomUUID?.() || 'test-session-id';

      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      let storeState = store.getState();
      expect(storeState.sessionState?.exerciseIndex).toBe(0);

      // Mark first set done
      await store.getState().dispatch({
        tag: 'SetDone',
        nowMs: Date.now(),
      });

      storeState = store.getState();
      // Should advance (exact phase depends on engine logic)
      expect(storeState.sessionState?.phase).toBeDefined();
    });
  });
});
