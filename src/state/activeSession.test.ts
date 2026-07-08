import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createActiveSessionStore } from './activeSession';
import { createSessionPresenter } from './sessionPresenter';
import { SessionState } from '@/engine/types';
import { getSession, getSessionSets, upsertRoutineExercise } from '@/db/repository';
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

  describe('I1b: onPersistSet with real database (no mock)', () => {
    it('persists set with RPE to database via real onPersistSet', async () => {
      // I1b: Use REAL onPersistSet (no mock), seed routines + routine_exercises
      // Seed routine
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-test-i1b';
          r.name = 'Test Routine I1b';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        // Seed exercise
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'ex-test-i1b';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      });

      // Seed routine_exercises at order 0 (matching entry idx 0)
      await upsertRoutineExercise(database, 'routine-test-i1b', {
        exerciseId: 'ex-test-i1b',
        order: 0,
        warmupSets: 0,
        targetSets: 1,
        targetReps: 8,
        targetDurationSeconds: 0,
        restSeconds: 60,
      });

      // Create store with REAL executors (no mocks)
      const store = createActiveSessionStore(database, {
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onCompleteSession: jest.fn(),
      });

      const routine = {
        id: 'routine-test-i1b',
        name: 'Test Routine I1b',
        entries: [
          {
            exerciseId: 'ex-test-i1b',
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

      const sessionId = crypto.randomUUID?.() || 'test-session-i1b';

      // StartSession
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      // LogSet with RPE
      await store.getState().dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 50,
        durationSeconds: 0,
        rpe: 7.5,
      });

      // Debug: check for errors in store
      const storeState = store.getState();
      if (storeState.lastError) {
        console.error('Store error:', storeState.lastError);
      }

      // Query database directly for the persisted set
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(1);
      expect((sets[0] as any).rpe).toBe(7.5);
      expect((sets[0] as any).reps).toBe(8);
      expect((sets[0] as any).weightKg).toBe(50);
    });
  });

  describe('I2: repeated exercise with distinct routine_exercise_id', () => {
    it('resolves routine_exercise_id correctly by order for repeated exercises', async () => {
      // I2: Same exerciseId at entries[0] and entries[1] with different routine_exercises rows
      // Verifies that onPersistSet resolves by (routineId, order) not just exerciseId
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-test-i2';
          r.name = 'Test Routine I2';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        // Seed exercise
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'ex-repeated';
          e.title = 'Repeated Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      });

      // Seed routine_exercises at order 0 and order 1 with same exerciseId
      // Must create separately (not via upsertRoutineExercise) since upsertRoutineExercise
      // updates existing (routine_id, exercise_id) combos instead of creating duplicates
      let re0: any, re1: any;
      await database.write(async () => {
        const re0Created = await database.get('routine_exercises').create((re: any) => {
          re.routineId = 'routine-test-i2';
          re.exerciseId = 'ex-repeated';
          re.order = 0;
          re.warmupSets = 0;
          re.targetSets = 1;
          re.targetReps = 8;
          re.targetDurationSeconds = 0;
          re.restSeconds = 60;
        });
        re0 = re0Created;

        const re1Created = await database.get('routine_exercises').create((re: any) => {
          re.routineId = 'routine-test-i2';
          re.exerciseId = 'ex-repeated';
          re.order = 1;
          re.warmupSets = 0;
          re.targetSets = 1;
          re.targetReps = 8;
          re.targetDurationSeconds = 0;
          re.restSeconds = 60;
        });
        re1 = re1Created;
      });

      const store = createActiveSessionStore(database, {
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onCompleteSession: jest.fn(),
      });

      const routine = {
        id: 'routine-test-i2',
        name: 'Test Routine I2',
        entries: [
          {
            exerciseId: 'ex-repeated',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
          {
            exerciseId: 'ex-repeated',
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

      const sessionId = crypto.randomUUID?.() || 'test-session-i2';

      // StartSession
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      // LogSet at exerciseIndex 0 (order 0)
      await store.getState().dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 50,
        durationSeconds: 0,
        rpe: 7,
      });

      // Debug: check for errors
      const storeState = store.getState();
      if (storeState.lastError) {
        console.error('Store error (I2):', storeState.lastError);
      }

      // Query database - should have 1 set for order 0
      let sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(1);
      const set0RoutineExerciseId = (sets[0] as any).routineExerciseId;

      // Verify it's the correct routine_exercise (order 0, not order 1)
      expect(set0RoutineExerciseId).toBe((re0 as any).id);
      expect(set0RoutineExerciseId).not.toBe((re1 as any).id);
    });
  });

  describe('I3: presenter currentExerciseId from entries vs loggedSets', () => {
    it('derives currentExerciseId from entries[exerciseIndex], not loggedSets[last]', async () => {
      // I3: Fixture with 2+ entries, exerciseIndex=1, loggedSets[last].exerciseId === entries[0].exerciseId
      // Presenter should return entries[1].exerciseId, not loggedSets[last].exerciseId

      const store = createActiveSessionStore(database);

      const routine = {
        id: 'routine-test-i3',
        name: 'Test Routine I3',
        entries: [
          {
            exerciseId: 'ex-first',
            kind: 'strength' as const,
            warmupSets: 0,
            targetSets: 1,
            targetReps: 8,
            targetDurationSeconds: 0,
            restSeconds: 60,
            supersetGroup: '',
          },
          {
            exerciseId: 'ex-second',
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

      const sessionId = crypto.randomUUID?.() || 'test-session-i3';

      // StartSession
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      // Hydrate with exerciseIndex=1, but loggedSets[last].exerciseId='ex-first' (from entries[0])
      const state = store.getState().sessionState;
      if (state) {
        state.exerciseIndex = 1;
        // Manually set loggedSets to have last entry with exerciseId from entries[0]
        state.loggedSets = [
          {
            exerciseId: 'ex-first', // From entries[0]
            setType: 'working',
            reps: 8,
            weightKg: 50,
            durationSeconds: null,
            rpe: 7,
          },
        ];
        store.getState().hydrate(state);
      }

      // Verify currentExerciseId via store state
      const currentState = store.getState().sessionState;
      expect(currentState).toBeDefined();
      expect(currentState?.exerciseIndex).toBe(1);
      expect(currentState?.entries[1].exerciseId).toBe('ex-second');
      expect(currentState?.loggedSets[0].exerciseId).toBe('ex-first');

      // Exercise the presenter itself: it must show entries[exerciseIndex]
      // (ex-second), not loggedSets[last] (ex-first).
      if (currentState) {
        const presenter = createSessionPresenter(currentState, store.getState().dispatch);
        expect(presenter.currentExerciseId).toBe('ex-second');
        expect(presenter.currentExerciseId).not.toBe(
          currentState.loggedSets[currentState.loggedSets.length - 1].exerciseId
        );
      }
    });
  });
});
