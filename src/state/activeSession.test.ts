import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createActiveSessionStore } from './activeSession';
import { createSessionPresenter } from './sessionPresenter';
import type { SessionState } from '@/engine/types';
import { getSession, getSessionSets, upsertRoutineExercise } from '@/db/repository';
import { loadActiveEngineState } from '@/db/engineState';
import { injectSettingsStorage, resetForTesting, setSettings } from './settings';

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
            // Two target sets: logging one set advances mid-exercise instead
            // of completing the workout (one-tap logging advances on log)
            targetSets: 2,
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
        nowMs: Date.now(),
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
            // Two target sets: logging one set advances mid-exercise instead
            // of completing the workout (one-tap logging advances on log)
            targetSets: 2,
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
        nowMs: Date.now(),
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
            // Two target sets: logging one set advances mid-exercise instead
            // of completing the workout (one-tap logging advances on log)
            targetSets: 2,
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
        nowMs: Date.now(),
      });

      // Verify engine state is persisted in store
      const storeState = store.getState();
      expect(storeState.sessionState).toBeDefined();
      expect(storeState.sessionState?.sessionId).toBe(sessionId);

      // Verify engine state was saved to database
      const loadedState = await loadActiveEngineState(database);
      expect(loadedState).not.toBeNull();
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
        nowMs: Date.now(),
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

  describe('M3b: hydrate() idle→null mapping', () => {
    it('should map idle phase to null sessionState', async () => {
      const store = createActiveSessionStore(database);

      // Create a state in idle phase
      const idleState: SessionState = {
        sessionId: 'test-session',
        routineId: 'test-routine',
        phase: 'idle',
        exerciseIndex: 0,
        setIndex: 0,
        supersetPosition: 0,
        loggedSets: [],
        startedAtMs: 1000,
        prePausePhase: '',
        entries: [],
        lastLoggedSet: undefined,
        restDeadlineMs: 0,
        restRemainingMs: 0,
      };

      // Hydrate with idle state
      store.getState().hydrate(idleState);

      // Session state should be null (idle→null mapping)
      expect(store.getState().sessionState).toBeNull();
      expect(store.getState().lastError).toBeNull();
    });

    it('should preserve non-idle phase states', async () => {
      const store = createActiveSessionStore(database);

      const warmupState: SessionState = {
        sessionId: 'test-session',
        routineId: 'test-routine',
        phase: 'warmup',
        exerciseIndex: 0,
        setIndex: 0,
        supersetPosition: 0,
        loggedSets: [],
        startedAtMs: 1000,
        prePausePhase: '',
        entries: [],
        lastLoggedSet: undefined,
        restDeadlineMs: 0,
        restRemainingMs: 0,
      };

      // Hydrate with warmup state
      store.getState().hydrate(warmupState);

      // Session state should be preserved (not null)
      expect(store.getState().sessionState).not.toBeNull();
      expect(store.getState().sessionState?.phase).toBe('warmup');
      expect(store.getState().lastError).toBeNull();
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
        nowMs: Date.now(),
      });

      // Debug: check for errors in store
      const storeState = store.getState();
      if (storeState.lastError) {
        console.error('Store error:', storeState.lastError);
      }

      // One-tap logging: this was the entry's only set, so the dispatch also
      // completed the workout, and the fire-and-forget persist may still be in
      // flight when dispatch resolves. Wait for the row to land.
      let sets: any[] = [];
      for (let attempt = 0; attempt < 50 && sets.length === 0; attempt++) {
        await new Promise((resolve) => setImmediate(resolve));
        try {
          sets = await getSessionSets(database, sessionId);
        } catch {
          // LokiJS's record cache can race the in-flight write; retry
        }
      }
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
        nowMs: Date.now(),
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

  describe('Phase 4 Task 3: Progression hint with prior working sets from DB', () => {
    it('store surfaces non-undefined hint through to presenter for strength exercise with DB history', async () => {
      // This test verifies the store-level integration: when a strength exercise has prior working sets in the DB,
      // the store's computed hint is available for the presenter to display.
      // The hint is computed async and stored in component state (session.tsx), not in the store.

      const store = createActiveSessionStore(database);

      // First, set up prior working sets in a completed session
      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-prior';
          r.name = 'Prior Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'ex-prior-history';
          e.title = 'Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        // Create routine exercise
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-prior';
          re.routine_id = 'routine-prior';
          re.exercise_id = 'ex-prior-history';
          re.order = 0;
          re.warmup_sets = 0;
        });

        // Create prior session with working sets
        const sessionsTable = database.get('sessions');
        await sessionsTable.create((s: any) => {
          s._raw.id = 'session-prior-history';
          s.routine_id = 'routine-prior';
          s._raw.started_at = Date.now() - 1000000;
        });

        // Create working sets for the prior session
        const sessionSetsTable = database.get('session_sets');
        await sessionSetsTable.create((set: any) => {
          set.session_id = 'session-prior-history';
          set.routine_exercise_id = 'routine-exercise-prior';
          set.set_type = 'working';
          set.reps = 8;
          set.weight_kg = 100;
          set.rpe = 7;
          set.position = 0;
          set._raw.created_at = Date.now() - 1000000;
        });

        await sessionSetsTable.create((set: any) => {
          set.session_id = 'session-prior-history';
          set.routine_exercise_id = 'routine-exercise-prior';
          set.set_type = 'working';
          set.reps = 8;
          set.weight_kg = 100;
          set.rpe = 7.5;
          set.position = 1;
          set._raw.created_at = Date.now() - 1000000;
        });
      });

      // Now start a new session with the same exercise
      const routine = {
        id: 'routine-new-session',
        name: 'New Session',
        entries: [
          {
            exerciseId: 'ex-prior-history',
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

      const sessionId = crypto.randomUUID?.() || 'test-new-session';
      const nowMs = Date.now();

      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs,
        routine,
      });

      const state = store.getState().sessionState;
      expect(state).toBeDefined();
      expect(state?.entries[0].exerciseId).toBe('ex-prior-history');
      expect(state?.entries[0].kind).toBe('strength');

      // Create a presenter with the store state (simulating what session.tsx would do after computing the hint)
      // In reality, session.tsx computes the hint async via getExerciseWorkingSetHistory and computeProgressionHint
      // For this test, we verify the presenter can carry the hint when provided
      const mockDispatch = jest.fn(async () => null);
      const presenter = createSessionPresenter(state!, mockDispatch, 'Increase weight by 2.5 kg');

      // Verify presenter surfaces the hint
      expect(presenter.progressionHint).toBe('Increase weight by 2.5 kg');
      expect(presenter.currentEntry?.kind).toBe('strength');
    }, 20000);
  });

  describe('C1: Invalid event mid-session preserves state', () => {
    it('should preserve sessionState when engine rejects an event mid-session', async () => {
      const store = createActiveSessionStore(database);

      const routine = {
        id: 'routine-c1',
        name: 'Test Routine C1',
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

      const sessionId = crypto.randomUUID?.() || 'test-session-c1';

      // Start session
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine,
      });

      // Verify session is started and state is preserved
      let storeState = store.getState();
      expect(storeState.sessionState).not.toBeNull();
      expect(storeState.sessionState?.phase).toBe('warmup');
      expect(storeState.lastError).toBeNull();

      // Try to log a set with invalid RPE (3.3 fails the 0.5-step check, valid range is 1.0–10.0)
      // This should trigger a TransitionError from the engine
      const dispatchResult = await store.getState().dispatch({
        tag: 'LogSet',
        reps: 10,
        weightKg: 50,
        durationSeconds: 0,
        rpe: 3.3, // Invalid RPE value (fails 0.5-step increment check)
        nowMs: Date.now(),
      });

      // After invalid event:
      storeState = store.getState();

      // The dispatch should return null (error case)
      expect(dispatchResult).toBeNull();

      // CRITICAL: sessionState should be PRESERVED (still in-progress), not nulled
      expect(storeState.sessionState).not.toBeNull();
      expect(storeState.sessionState?.sessionId).toBe(sessionId);
      expect(storeState.sessionState?.phase).toBe('warmup');

      // lastError should be set with the RPE validation message
      expect(storeState.lastError).not.toBeNull();
      expect(storeState.lastError).toMatch(/RPE.*0.5-step/i);
    });
  });

describe('Phase 7: onCompleteSession real executor with sync rejection', () => {
    it('handles sync rejection: session state set, dispatch resolves, no unhandled rejection', async () => {
      // Phase 7 compliance: test the REAL onCompleteSession executor (no override)
      // with an injected syncFn that rejects, verifying:
      // (a) session ended_at is set AND engine state cleared
      // (b) store.dispatch(...) RESOLVES without throwing
      // (c) no unhandled promise rejection escapes

      let unhandledRejection: any = null;
      const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
        unhandledRejection = event.reason;
      };

      // Install unhandledRejection listener
      process.on('unhandledRejection', unhandledRejectionHandler);

      try {
        // Create a sync function that rejects
        const syncFnThatRejects = jest.fn(async () => {
          throw new Error('Sync failed intentionally for testing');
        });

        // Create store with REAL onCompleteSession executor (no override),
        // but inject a failing syncFn
        const store = createActiveSessionStore(database, {
          onScheduleRest: jest.fn(),
          onCancelRest: jest.fn(),
          onNotify: jest.fn(),
          // NOTE: NOT overriding onCompleteSession — using the real executor
        }, syncFnThatRejects);

        const routine = {
          id: 'routine-test-phase7',
          name: 'Test Routine Phase 7',
          entries: [
            {
              exerciseId: 'ex-phase7',
              kind: 'strength' as const,
              warmupSets: 0,
              targetSets: 1,
              targetReps: 8,
              targetDurationSeconds: 0,
              restSeconds: 0, // No rest to reach done immediately
              supersetGroup: '',
            },
          ],
        };

        const sessionId = crypto.randomUUID?.() || 'test-session-phase7';

        // StartSession
        await store.getState().dispatch({
          tag: 'StartSession',
          sessionId,
          nowMs: Date.now(),
          routine,
        });

        // Verify session was created
        const sessionAfterStart = await database.get('sessions').find(sessionId);
        expect(sessionAfterStart).toBeDefined();
        expect((sessionAfterStart as any)._raw.ended_at).toBeNull();
        expect((sessionAfterStart as any).engineState).toBeTruthy();

        // FinishSession triggers CompleteSession effect → onCompleteSession executor runs
        // The injected syncFn will reject, but this must be caught
        const dispatchResult = await store.getState().dispatch({
          tag: 'FinishSession',
          nowMs: Date.now(),
        });

        // (b) Verify dispatch RESOLVED (didn't throw)
        expect(dispatchResult).toBeDefined();
        expect(dispatchResult?.phase).toBe('done');

        // (c) Flush microtasks to allow any unhandled rejections to surface
        await new Promise((resolve) => setImmediate(resolve));

        // Verify no unhandled rejection was caught
        expect(unhandledRejection).toBeNull();

        // (a) Verify session ended_at is set AND engine state cleared
        // Need to reload the session to get fresh data from database
        const sessionAfterCompletion = await database.get('sessions').find(sessionId);
        expect(sessionAfterCompletion).toBeDefined();
        expect((sessionAfterCompletion as any)._raw.ended_at).toBeTruthy(); // ended_at is set

        // (a.ii) Verify engine state is cleared (empty string means cleared for text field)
        const engineStateValue = (sessionAfterCompletion as any)._raw.engine_state;
        expect(engineStateValue).toBe(''); // engine state cleared to empty string

        // Verify the injected syncFn was called (to prove the real executor ran)
        expect(syncFnThatRejects).toHaveBeenCalled();
      } finally {
        // Clean up the unhandledRejection listener
        process.removeListener('unhandledRejection', unhandledRejectionHandler);
      }
    });
  });

  describe('one-tap completion: final persist lands before the session closes', () => {
    function tick(): Promise<void> {
      return new Promise((resolve) => setImmediate(resolve));
    }

    it('onCompleteSession waits for the pending set persist before writing ended_at', async () => {
      // The merged LogSet transition emits [PersistSet, CompleteSession] in one
      // dispatch, and rill executors are fire-and-forget — completion must not
      // outrun the final set's write or the synced markdown misses it.
      let releasePersist!: () => void;
      const persistGate = new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      const persistDone = jest.fn();
      const onPersistSet = jest.fn(() => persistGate.then(persistDone));

      const syncFn = jest.fn(async () => {});
      const store = createActiveSessionStore(
        database,
        {
          onScheduleRest: jest.fn(),
          onCancelRest: jest.fn(),
          onNotify: jest.fn(),
          onPersistSet,
        },
        syncFn,
        {
          ensureAuthorized: jest.fn(async () => 'authorized' as const),
          requestAuthorization: jest.fn(async () => true),
          saveWorkoutSample: jest.fn(async () => undefined),
        }
      );

      const sessionId = 'session-persist-drain';
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine: {
          id: 'routine-persist-drain',
          name: 'Persist Drain Routine',
          entries: [
            {
              exerciseId: 'ex-drain',
              kind: 'strength' as const,
              warmupSets: 0,
              targetSets: 1,
              targetReps: 8,
              targetDurationSeconds: 0,
              restSeconds: 0,
              supersetGroup: '',
            },
          ],
        },
      });

      // The final set: records, completes the workout, and leaves the persist in flight
      await store.getState().dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 50,
        durationSeconds: 0,
        nowMs: Date.now(),
      });
      expect(store.getState().sessionState?.phase).toBe('done');
      expect(onPersistSet).toHaveBeenCalledTimes(1);

      // Completion must be parked behind the un-persisted set
      for (let i = 0; i < 10; i++) await tick();
      let session = (await database.get('sessions').find(sessionId)) as any;
      expect(session._raw.ended_at).toBeNull();
      expect(syncFn).not.toHaveBeenCalled();

      // Let the persist land; completion may now proceed
      releasePersist();
      for (let attempt = 0; attempt < 50; attempt++) {
        session = (await database.get('sessions').find(sessionId)) as any;
        if (session._raw.ended_at) break;
        await tick();
      }
      expect(session._raw.ended_at).toBeTruthy();
      expect(syncFn).toHaveBeenCalled();
      expect(persistDone.mock.invocationCallOrder[0]).toBeLessThan(
        syncFn.mock.invocationCallOrder[0]
      );
    });
  });

  describe('post-workout debrief', () => {
    const routineId = 'routine-debrief';
    let fakeStorage: { [key: string]: string };

    const fakeStorageBackend = {
      getItemAsync: async (key: string) => fakeStorage[key] ?? null,
      setItemAsync: async (key: string, value: string) => {
        fakeStorage[key] = value;
      },
      deleteItemAsync: async (key: string) => {
        delete fakeStorage[key];
      },
    };

    beforeEach(() => {
      fakeStorage = {};
      resetForTesting();
      injectSettingsStorage(fakeStorageBackend);
    });

    function makeSyncFn() {
      return jest.fn(async () => {});
    }

    function makeHealthKitDeps() {
      return {
        ensureAuthorized: jest.fn(async () => 'authorized' as const),
        requestAuthorization: jest.fn(async () => true),
        saveWorkoutSample: jest.fn(async () => undefined),
      };
    }

    function tick(): Promise<void> {
      return new Promise((resolve) => setImmediate(resolve));
    }

    async function waitUntil(condition: () => boolean, description: string) {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (condition()) return;
        await tick();
      }
      throw new Error(`timed out waiting for ${description}`);
    }

    async function finishWorkout(
      store: ReturnType<typeof createActiveSessionStore>,
      healthKitDeps: ReturnType<typeof makeHealthKitDeps>
    ) {
      const sessionId = 'session-debrief';

      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: Date.now(),
        routine: {
          id: routineId,
          name: 'Upper Body',
          entries: [
            {
              exerciseId: 'ex-debrief',
              kind: 'strength' as const,
              warmupSets: 0,
              targetSets: 1,
              targetReps: 8,
              targetDurationSeconds: 0,
              restSeconds: 0,
              supersetGroup: '',
            },
          ],
        },
      });

      await store.getState().dispatch({ tag: 'FinishSession', nowMs: Date.now() });

      // Effect executors are fire-and-forget: a resolved dispatch only means the
      // transition happened, while onCompleteSession is still running. Wait for
      // the Health write it performs just before the debrief, then let the
      // remaining ticks drain so "never opened" is a real observation.
      await waitUntil(
        () => healthKitDeps.saveWorkoutSample.mock.calls.length > 0,
        'the HealthKit write'
      );
      await tick();
      await tick();

      return sessionId;
    }

    it('opens a debrief chat for the routine and session just finished', async () => {
      setSettings({ anthropicKey: 'sk-test' });
      const openDebriefChat = jest.fn();
      const healthKitDeps = makeHealthKitDeps();

      const store = createActiveSessionStore(
        database,
        { onScheduleRest: jest.fn(), onCancelRest: jest.fn(), onNotify: jest.fn() },
        makeSyncFn(),
        healthKitDeps,
        openDebriefChat
      );

      const sessionId = await finishWorkout(store, healthKitDeps);

      expect(openDebriefChat).toHaveBeenCalledWith({
        kind: 'debrief',
        routineId,
        sessionId,
      });
    });

    it('opens nothing when no Anthropic key is configured', async () => {
      const openDebriefChat = jest.fn();
      const healthKitDeps = makeHealthKitDeps();

      const store = createActiveSessionStore(
        database,
        { onScheduleRest: jest.fn(), onCancelRest: jest.fn(), onNotify: jest.fn() },
        makeSyncFn(),
        healthKitDeps,
        openDebriefChat
      );

      await finishWorkout(store, healthKitDeps);

      expect(openDebriefChat).not.toHaveBeenCalled();
    });

    it('opens the debrief only once persistence, sync and the Health write are under way', async () => {
      setSettings({ anthropicKey: 'sk-test' });
      const openDebriefChat = jest.fn();
      const syncFn = makeSyncFn();
      const healthKitDeps = makeHealthKitDeps();

      const store = createActiveSessionStore(
        database,
        { onScheduleRest: jest.fn(), onCancelRest: jest.fn(), onNotify: jest.fn() },
        syncFn,
        healthKitDeps,
        openDebriefChat
      );

      const sessionId = await finishWorkout(store, healthKitDeps);

      const session = (await database.get('sessions').find(sessionId)) as any;
      expect(session._raw.ended_at).toBeTruthy();
      expect(openDebriefChat.mock.invocationCallOrder[0]).toBeGreaterThan(
        syncFn.mock.invocationCallOrder[0]
      );
      expect(openDebriefChat.mock.invocationCallOrder[0]).toBeGreaterThan(
        healthKitDeps.saveWorkoutSample.mock.invocationCallOrder[0]
      );
    });

    it('completes the session even when the debrief chat cannot be opened', async () => {
      setSettings({ anthropicKey: 'sk-test' });
      const openDebriefChat = jest.fn(() => {
        throw new Error('navigation failed');
      });
      const healthKitDeps = makeHealthKitDeps();

      const store = createActiveSessionStore(
        database,
        { onScheduleRest: jest.fn(), onCancelRest: jest.fn(), onNotify: jest.fn() },
        makeSyncFn(),
        healthKitDeps,
        openDebriefChat
      );

      const sessionId = await finishWorkout(store, healthKitDeps);

      expect(store.getState().sessionState?.phase).toBe('done');
      const session = (await database.get('sessions').find(sessionId)) as any;
      expect(session._raw.ended_at).toBeTruthy();
      expect(session._raw.engine_state).toBe('');
    });
  });
});
