import { Database, Q } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import { createSession, appendSet, getSession, getSessionSets, upsertRoutineExercise, getSupersetGroups, getExerciseTitles, getExerciseWorkingSetHistory, getRecentSessionSummaries, getRoutineDisplay, upsertExercise, updateExerciseDescription, upsertRoutine, deleteSession, deleteRoutine, RoutineHasUnsyncedSessionsError } from './repository';
import { ValidationError } from './validation';

describe('Repository: session and set helpers', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    // Close database to clean up handles and prevent Jest hang
    await closeTestDatabase(database);
  });

  describe('createSession', () => {
    it('AC1.1/AC1.2: creates a session that can be retrieved', async () => {
      const sessionId = 'session-1';
      const routineId = 'routine-1';
      const startedAtMs = Date.now();

      // Create session (helpers wrap database.write() internally)
      await createSession(database, { sessionId, routineId, startedAtMs });

      // Verify session exists
      const session = await getSession(database, sessionId);
      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
    }, 30000);

    it('AC1.3: created session can be retrieved', async () => {
      const sessionId = 'session-2';
      const routineId = 'routine-2';
      const startedAtMs = Date.now();

      await createSession(database, { sessionId, routineId, startedAtMs });

      const session = await getSession(database, sessionId);
      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
    }, 10000);
  });

  describe('appendSet', () => {
    beforeEach(async () => {
      // Create a routine
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-3';
          r.name = 'Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create an exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-3';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        // Create a routine exercise
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-3';
          re.routine_id = 'routine-3';
          re.exercise_id = 'exercise-3';
          re.order = 0;
          re.warmup_sets = 0;
        });
      });

      // Create a session (helper wraps database.write() internally)
      await createSession(database, {
        sessionId: 'session-3',
        routineId: 'routine-3',
        startedAtMs: Date.now(),
      });
    });

    it('AC9.1: a working set with optional rpe persists and reads back', async () => {
      await appendSet(database, 'session-3', 'routine-exercise-3', {
        setType: 'working',
        reps: 8,
        weightKg: 60,
        rpe: 7.5,
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      const set = sets[0];
      expect((set as any).rpe).toBe(7.5);
      expect((set as any).reps).toBe(8);
      expect((set as any).weightKg).toBe(60);
    }, 10000);

    it('can append a set with only durationSeconds (for cardio/stretch)', async () => {
      await appendSet(database, 'session-3', 'routine-exercise-3', {
        setType: 'working',
        durationSeconds: 300,
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      const set = sets[0];
      expect((set as any).durationSeconds).toBe(300);
      expect((set as any).reps).toBeNull();
      expect((set as any).weightKg).toBeNull();
    }, 10000);

    it('can append a set with setType "warmup"', async () => {
      await appendSet(database, 'session-3', 'routine-exercise-3', {
        setType: 'warmup',
        reps: 15,
        weightKg: 30,
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      expect((sets[0] as any).setType).toBe('warmup');
    }, 10000);

    it('defaults setType to "working" if not provided', async () => {
      await appendSet(database, 'session-3', 'routine-exercise-3', {
        reps: 5,
        weightKg: 70,
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      expect((sets[0] as any).setType).toBe('working');
    }, 10000);

    // AC1.4: appendSet with negative reps throws ValidationError and doesn't persist
    it('AC1.4: appendSet with negative reps throws ValidationError', async () => {
      await expect(
        appendSet(database, 'session-3', 'routine-exercise-3', {
          reps: -5,
          weightKg: 60,
        })
      ).rejects.toThrow(ValidationError);

      // Verify set was not persisted
      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(0);
    }, 10000);

    // AC9.3: appendSet with invalid rpe (11 or 7.3) throws ValidationError and doesn't persist
    it('AC9.3: appendSet with rpe=11 (out of range) throws ValidationError', async () => {
      await expect(
        appendSet(database, 'session-3', 'routine-exercise-3', {
          reps: 8,
          weightKg: 60,
          rpe: 11,
        })
      ).rejects.toThrow(ValidationError);

      // Verify set was not persisted
      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(0);
    }, 10000);

    it('AC9.3: appendSet with rpe=7.3 (invalid increment) throws ValidationError', async () => {
      await expect(
        appendSet(database, 'session-3', 'routine-exercise-3', {
          reps: 8,
          weightKg: 60,
          rpe: 7.3,
        })
      ).rejects.toThrow(ValidationError);

      // Verify set was not persisted
      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(0);
    }, 10000);
  });

  describe('getSession and getSessionSets', () => {
    it('returns undefined if session does not exist', async () => {
      const session = await getSession(database, 'non-existent');
      expect(session).toBeUndefined();
    }, 10000);

    it('returns empty array if session has no sets', async () => {
      await createSession(database, {
        sessionId: 'session-4',
        routineId: 'routine-4',
        startedAtMs: Date.now(),
      });

      const sets = await getSessionSets(database, 'session-4');
      expect(sets).toEqual([]);
    }, 10000);
  });

  describe('deleteSession', () => {
    const setupSessionWithSets = async (options: {
      sessionId: string;
      routineId: string;
      exerciseId: string;
      routineExerciseId: string;
      endSession: boolean;
    }) => {
      const { sessionId, routineId, exerciseId, routineExerciseId, endSession } = options;

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Bench Press';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      await createSession(database, { sessionId, routineId, startedAtMs: Date.now() - 60000 });

      await appendSet(database, sessionId, routineExerciseId, {
        setType: 'working',
        reps: 8,
        weightKg: 60,
      });
      await appendSet(database, sessionId, routineExerciseId, {
        setType: 'working',
        reps: 8,
        weightKg: 62.5,
      });

      if (endSession) {
        await database.write(async () => {
          const session = await database.get('sessions').find(sessionId);
          await (session as any).update((record: any) => {
            record._raw.ended_at = Date.now();
          });
        });
      }
    };

    it('deletes a finished session and all of its logged sets', async () => {
      await setupSessionWithSets({
        sessionId: 'session-delete-1',
        routineId: 'routine-delete-1',
        exerciseId: 'exercise-delete-1',
        routineExerciseId: 'routine-exercise-delete-1',
        endSession: true,
      });

      await deleteSession(database, 'session-delete-1');

      expect(await getSession(database, 'session-delete-1')).toBeUndefined();
      expect(await getSessionSets(database, 'session-delete-1')).toEqual([]);
    }, 15000);

    it('leaves unrelated sessions and their sets untouched', async () => {
      await setupSessionWithSets({
        sessionId: 'session-delete-2a',
        routineId: 'routine-delete-2',
        exerciseId: 'exercise-delete-2',
        routineExerciseId: 'routine-exercise-delete-2',
        endSession: true,
      });

      // A second, unrelated finished session sharing the same routine/exercise.
      await createSession(database, {
        sessionId: 'session-delete-2b',
        routineId: 'routine-delete-2',
        startedAtMs: Date.now() - 30000,
      });
      await appendSet(database, 'session-delete-2b', 'routine-exercise-delete-2', {
        setType: 'working',
        reps: 5,
        weightKg: 40,
      });
      await database.write(async () => {
        const session = await database.get('sessions').find('session-delete-2b');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      await deleteSession(database, 'session-delete-2a');

      expect(await getSession(database, 'session-delete-2a')).toBeUndefined();

      const survivorSession = await getSession(database, 'session-delete-2b');
      expect(survivorSession).toBeDefined();

      const survivorSets = await getSessionSets(database, 'session-delete-2b');
      expect(survivorSets).toHaveLength(1);
      expect((survivorSets[0] as any).reps).toBe(5);
    }, 15000);

    it('throws and leaves data intact when the session is still in progress', async () => {
      await setupSessionWithSets({
        sessionId: 'session-delete-3',
        routineId: 'routine-delete-3',
        exerciseId: 'exercise-delete-3',
        routineExerciseId: 'routine-exercise-delete-3',
        endSession: false,
      });

      await expect(deleteSession(database, 'session-delete-3')).rejects.toThrow(
        'cannot delete session session-delete-3: still in progress'
      );

      expect(await getSession(database, 'session-delete-3')).toBeDefined();
      expect(await getSessionSets(database, 'session-delete-3')).toHaveLength(2);
    }, 15000);

    it('throws when the session does not exist', async () => {
      await expect(deleteSession(database, 'session-does-not-exist')).rejects.toThrow(
        'cannot delete session session-does-not-exist: not found'
      );
    }, 10000);
  });

  describe('deleteRoutine', () => {
    const setupRoutineWithExercise = async (options: {
      routineId: string;
      exerciseId: string;
      routineExerciseId: string;
    }) => {
      const { routineId, exerciseId, routineExerciseId } = options;

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Bench Press';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });
    };

    const endSession = async (sessionId: string) => {
      await database.write(async () => {
        const session = await database.get('sessions').find(sessionId);
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });
    };

    it('deletes the routine but retains routine_exercises as history carriers', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-del-1',
        exerciseId: 'exercise-del-1',
        routineExerciseId: 'routine-exercise-del-1',
      });

      await deleteRoutine(database, 'routine-del-1');

      await expect(database.get('routines').find('routine-del-1')).rejects.toThrow();

      // routine_exercises are retained (not deleted) to preserve session_set history
      const remainingRoutineExercises = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', 'routine-del-1'))
        .fetch();
      expect(remainingRoutineExercises).toHaveLength(1);
    }, 15000);

    it('does not delete the shared exercise', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-del-2',
        exerciseId: 'exercise-del-2',
        routineExerciseId: 'routine-exercise-del-2',
      });

      await deleteRoutine(database, 'routine-del-2');

      const exercise = await database.get('exercises').find('exercise-del-2');
      expect(exercise).toBeDefined();
    }, 15000);

    it('leaves other routines and their routine_exercise rows untouched', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-del-3a',
        exerciseId: 'exercise-del-3',
        routineExerciseId: 'routine-exercise-del-3a',
      });

      // A second routine sharing the same exercise.
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-del-3b';
          r.name = 'Other Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-del-3b';
          re._raw.routine_id = 'routine-del-3b';
          re._raw.exercise_id = 'exercise-del-3';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      await deleteRoutine(database, 'routine-del-3a');

      const survivorRoutine = await database.get('routines').find('routine-del-3b');
      expect(survivorRoutine).toBeDefined();

      const survivorRoutineExercises = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', 'routine-del-3b'))
        .fetch();
      expect(survivorRoutineExercises).toHaveLength(1);
    }, 15000);

    it('allows deletion when every referencing session is already synced', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-del-5',
        exerciseId: 'exercise-del-5',
        routineExerciseId: 'routine-exercise-del-5',
      });

      await createSession(database, {
        sessionId: 'session-del-5',
        routineId: 'routine-del-5',
        startedAtMs: Date.now() - 60000,
      });
      await endSession('session-del-5');

      await deleteRoutine(database, 'routine-del-5');

      await expect(database.get('routines').find('routine-del-5')).rejects.toThrow();
    }, 15000);

    it('blocks deletion when a local unsynced finished session references the routine, and deletes nothing', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-del-6',
        exerciseId: 'exercise-del-6',
        routineExerciseId: 'routine-exercise-del-6',
      });

      await createSession(database, {
        sessionId: 'session-del-6',
        routineId: 'routine-del-6',
        startedAtMs: Date.now() - 60000,
      });
      await endSession('session-del-6');
      // customSyncStatus defaults to 'local' from createSession and is never flipped.

      await expect(deleteRoutine(database, 'routine-del-6')).rejects.toThrow(
        RoutineHasUnsyncedSessionsError
      );
      await expect(deleteRoutine(database, 'routine-del-6')).rejects.toThrow(
        'cannot delete routine routine-del-6: unsynced sessions reference it'
      );

      const routine = await database.get('routines').find('routine-del-6');
      expect(routine).toBeDefined();

      const routineExercises = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', 'routine-del-6'))
        .fetch();
      expect(routineExercises).toHaveLength(1);
    }, 15000);

    it('blocks deletion when an in-progress session references the routine', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-del-7',
        exerciseId: 'exercise-del-7',
        routineExerciseId: 'routine-exercise-del-7',
      });

      await createSession(database, {
        sessionId: 'session-del-7',
        routineId: 'routine-del-7',
        startedAtMs: Date.now() - 60000,
      });
      // Not ended: still in progress. sync_status defaults to 'local'.

      await expect(deleteRoutine(database, 'routine-del-7')).rejects.toThrow(
        RoutineHasUnsyncedSessionsError
      );
      await expect(deleteRoutine(database, 'routine-del-7')).rejects.toThrow(
        'cannot delete routine routine-del-7: unsynced sessions reference it'
      );

      const routine = await database.get('routines').find('routine-del-7');
      expect(routine).toBeDefined();
    }, 15000);

    it('throws when the routine does not exist', async () => {
      await expect(deleteRoutine(database, 'routine-does-not-exist')).rejects.toThrow(
        'cannot delete routine routine-does-not-exist: not found'
      );
    }, 10000);

    it('retains working-set history after the routine is deleted', async () => {
      await setupRoutineWithExercise({
        routineId: 'routine-history-test',
        exerciseId: 'exercise-history-test',
        routineExerciseId: 'routine-exercise-history-test',
      });

      // Create and complete a session
      await createSession(database, {
        sessionId: 'session-history-test',
        routineId: 'routine-history-test',
        startedAtMs: Date.now() - 60000,
      });

      // Log a working set
      await appendSet(database, 'session-history-test', 'routine-exercise-history-test', {
        setType: 'working',
        reps: 10,
        weightKg: 100,
      });

      // End the session
      await endSession('session-history-test');

      // Get history before deletion to verify it exists
      const historyBefore = await getExerciseWorkingSetHistory(database, 'exercise-history-test');
      expect(historyBefore).toHaveLength(1);

      // Delete the routine
      await deleteRoutine(database, 'routine-history-test');

      // History should still be accessible after routine deletion
      const historyAfter = await getExerciseWorkingSetHistory(database, 'exercise-history-test');
      expect(historyAfter).toHaveLength(1);

      // Verify the routine_exercises rows still exist (not deleted)
      const routineExercises = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', 'routine-history-test'))
        .fetch();
      expect(routineExercises).toHaveLength(1);

      // Verify the session_sets rows still exist
      const sets = await getSessionSets(database, 'session-history-test');
      expect(sets).toHaveLength(1);
    }, 15000);
  });

  describe('upsertRoutineExercise and getSupersetGroups', () => {
    it('AC8.1: two routine exercises sharing a superset_group come back grouped, contiguous by order', async () => {
      const routineId = 'routine-superset';
      const exerciseId1 = 'exercise-barbell-bench';
      const exerciseId2 = 'exercise-dumbbell-bench';
      const supersetGroup = 'chest-superset';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Push Day';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercises
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId1;
          e.title = 'Barbell Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId2;
          e.title = 'Dumbbell Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // Upsert routine exercises in superset (helpers wrap database.write() internally)
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId1,
        order: 1,
        supersetGroup,
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId2,
        order: 2,
        supersetGroup,
      });

      // Get superset groups and verify grouping
      const groups = await getSupersetGroups(database, routineId);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(2);

      // Verify exercises are grouped together and contiguous by order
      const group = groups[0];
      expect((group[0] as any).order).toBe(1);
      expect((group[1] as any).order).toBe(2);
      expect((group[0] as any).supersetGroup).toBe(supersetGroup);
      expect((group[1] as any).supersetGroup).toBe(supersetGroup);
    }, 10000);

    it('I2: getSupersetGroups returns standalone (null) exercises as singleton groups', async () => {
      const routineId = 'routine-standalone';
      const exerciseId1 = 'exercise-standalone-1';
      const exerciseId2 = 'exercise-standalone-2';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Solo Exercises';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercises
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId1;
          e.title = 'Exercise 1';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId2;
          e.title = 'Exercise 2';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // Upsert standalone exercises (no superset_group)
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId1,
        order: 1,
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId2,
        order: 2,
      });

      // Get superset groups - should return 2 singleton groups
      const groups = await getSupersetGroups(database, routineId);
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(1);
      expect(groups[1]).toHaveLength(1);
      expect((groups[0][0] as any).order).toBe(1);
      expect((groups[1][0] as any).order).toBe(2);
    }, 10000);

    it('I2: getSupersetGroups splits non-contiguous same-label groups', async () => {
      const routineId = 'routine-noncontiguous';
      const exerciseId1 = 'exercise-nc-1';
      const exerciseId2 = 'exercise-nc-2';
      const exerciseId3 = 'exercise-nc-3';
      const exerciseId4 = 'exercise-nc-4';
      const supersetGroup = 'chest-superset';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Non-Contiguous Superset';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercises
        const exercisesTable = database.get('exercises');
        for (let i = 1; i <= 4; i++) {
          await exercisesTable.create((e: any) => {
            e._raw.id = `exercise-nc-${i}`;
            e.title = `Exercise ${i}`;
            e.kind = 'strength';
            e.created_at = Date.now();
          });
        }
      });

      // Upsert exercises: superset, standalone, superset, standalone
      // This creates: [superset, standalone, superset, standalone]
      // After grouping by contiguity: [superset], [standalone], [superset], [standalone]
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId1,
        order: 1,
        supersetGroup,
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId2,
        order: 2,
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId3,
        order: 3,
        supersetGroup,
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: exerciseId4,
        order: 4,
      });

      // Get superset groups - should split into 4 groups due to non-contiguity
      const groups = await getSupersetGroups(database, routineId);
      expect(groups).toHaveLength(4);
      expect(groups[0]).toHaveLength(1);
      expect(groups[1]).toHaveLength(1);
      expect(groups[2]).toHaveLength(1);
      expect(groups[3]).toHaveLength(1);
      expect((groups[0][0] as any).supersetGroup).toBe(supersetGroup);
      expect((groups[1][0] as any).supersetGroup).toBeNull();
      expect((groups[2][0] as any).supersetGroup).toBe(supersetGroup);
      expect((groups[3][0] as any).supersetGroup).toBeNull();
    }, 10000);

    it('AC8.2: a routine exercise with warmupSets=2 persists; appending sets with setType warmup vs working are distinguishable', async () => {
      const routineId = 'routine-warmup';
      const exerciseId = 'exercise-squat';
      const sessionId = 'session-warmup';
      const routineExerciseId = 'routine-exercise-squat';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Leg Day';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        // Manually create routine exercise record to link session sets
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 1;
          re._raw.warmup_sets = 2;
        });
      });

      // Upsert routine exercise with warmupSets=2 (helper wraps database.write() internally)
      await upsertRoutineExercise(database, routineId, {
        exerciseId,
        order: 1,
        warmupSets: 2,
      });

      // Create session (helper wraps database.write() internally)
      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now(),
      });

      // Append warmup set first (helper wraps database.write() internally)
      await appendSet(database, sessionId, routineExerciseId, {
        setType: 'warmup',
        reps: 15,
        weightKg: 20,
      });

      // Append working set second (deterministic ordering by position, no sleep needed)
      await appendSet(database, sessionId, routineExerciseId, {
        setType: 'working',
        reps: 8,
        weightKg: 60,
      });

      // Verify sets are distinguishable by setType and in correct order
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(2);
      expect((sets[0] as any).setType).toBe('warmup');
      expect((sets[1] as any).setType).toBe('working');
      expect((sets[0] as any).reps).toBe(15);
      expect((sets[1] as any).reps).toBe(8);
    }, 10000);

    it('AC8.3: a kind=stretch exercise logs a set via durationSeconds with null reps/weight', async () => {
      const exerciseId = 'exercise-stretch';
      const sessionId = 'session-stretch';
      const routineId = 'routine-stretch';
      const routineExerciseId = 'routine-exercise-stretch';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Stretching';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create stretch exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Hamstring Stretch';
          e.kind = 'stretch';
          e.created_at = Date.now();
        });

        // Manually create routine exercise record
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 1;
          re._raw.target_duration_seconds = 30;
          re._raw.warmup_sets = 0;
        });
      });

      // Upsert routine exercise with duration (helper wraps database.write() internally)
      await upsertRoutineExercise(database, routineId, {
        exerciseId,
        order: 1,
        targetDurationSeconds: 30,
      });

      // Create session (helper wraps database.write() internally)
      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now(),
      });

      // Log stretch via durationSeconds (helper wraps database.write() internally)
      await appendSet(database, sessionId, routineExerciseId, {
        setType: 'working',
        durationSeconds: 30,
      });

      // Verify set has duration but null reps/weight
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(1);
      expect((sets[0] as any).durationSeconds).toBe(30);
      expect((sets[0] as any).reps).toBeNull();
      expect((sets[0] as any).weightKg).toBeNull();
    }, 10000);

    it('AC8.3: a kind=cardio warm-up logs a set via durationSeconds with null reps/weight', async () => {
      const exerciseId = 'exercise-cardio-warmup';
      const sessionId = 'session-cardio';
      const routineId = 'routine-cardio';
      const routineExerciseId = 'routine-exercise-cardio';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Cardio Day';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create cardio exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Treadmill Warm-up';
          e.kind = 'cardio';
          e.created_at = Date.now();
        });

        // Manually create routine exercise record
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 1;
          re._raw.target_duration_seconds = 300;
          re._raw.warmup_sets = 1;
        });
      });

      // Upsert routine exercise with duration (helper wraps database.write() internally)
      await upsertRoutineExercise(database, routineId, {
        exerciseId,
        order: 1,
        targetDurationSeconds: 300,
        warmupSets: 1,
      });

      // Create session (helper wraps database.write() internally)
      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now(),
      });

      // Log cardio warm-up via durationSeconds (helper wraps database.write() internally)
      await appendSet(database, sessionId, routineExerciseId, {
        setType: 'warmup',
        durationSeconds: 300,
      });

      // Verify set has duration but null reps/weight
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(1);
      expect((sets[0] as any).durationSeconds).toBe(300);
      expect((sets[0] as any).setType).toBe('warmup');
      expect((sets[0] as any).reps).toBeNull();
      expect((sets[0] as any).weightKg).toBeNull();
    }, 10000);

    it('Phase 2 cycle-4 (Important): upsertRoutineExercise update branch persists all field changes', async () => {
      const routineId = 'routine-upsert-test';
      const exerciseId = 'exercise-upsert-test';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Upsert Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Upsert Test Exercise';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // First upsert: create new routine exercise with initial values
      await upsertRoutineExercise(database, routineId, {
        exerciseId,
        order: 1,
        supersetGroup: 'initial-group',
        warmupSets: 2,
        targetSets: 3,
        targetReps: 8,
        targetDurationSeconds: 100,
        restSeconds: 60,
      });

      // Verify initial values persisted
      const routineExercisesTable = database.get('routine_exercises');
      const initial = (await routineExercisesTable
        .query(
          Q.and(Q.where('routine_id', routineId), Q.where('exercise_id', exerciseId))
        )
        .fetch()) as any[];
      expect(initial).toHaveLength(1);
      expect(initial[0].supersetGroup).toBe('initial-group');
      expect(initial[0].warmupSets).toBe(2);
      expect(initial[0].targetSets).toBe(3);
      expect(initial[0].targetReps).toBe(8);
      expect(initial[0].targetDurationSeconds).toBe(100);
      expect(initial[0].restSeconds).toBe(60);

      // Second upsert: update the same routine+exercise with new values
      await upsertRoutineExercise(database, routineId, {
        exerciseId,
        order: 2,
        supersetGroup: 'updated-group',
        warmupSets: 1,
        targetSets: 4,
        targetReps: 10,
        targetDurationSeconds: 200,
        restSeconds: 90,
      });

      // Verify updated values persisted (this tests the update branch fix)
      const updated = (await routineExercisesTable
        .query(
          Q.and(Q.where('routine_id', routineId), Q.where('exercise_id', exerciseId))
        )
        .fetch()) as any[];
      expect(updated).toHaveLength(1);
      expect(updated[0].order).toBe(2);
      expect(updated[0].supersetGroup).toBe('updated-group');
      expect(updated[0].warmupSets).toBe(1);
      expect(updated[0].targetSets).toBe(4);
      expect(updated[0].targetReps).toBe(10);
      expect(updated[0].targetDurationSeconds).toBe(200);
      expect(updated[0].restSeconds).toBe(90);
    }, 15000);
  });

  describe('getExerciseWorkingSetHistory', () => {
    it('returns empty array if exercise has no prior working sets', async () => {
      const exerciseId = 'exercise-no-history';

      const history = await getExerciseWorkingSetHistory(database, exerciseId);
      expect(history).toEqual([]);
    }, 10000);

    it('returns working sets only, excluding warmups and other set types', async () => {
      const routineId = 'routine-history';
      const exerciseId = 'exercise-with-history';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        // Create routine exercise
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re.routineId = routineId;
          re.exerciseId = exerciseId;
          re.order = 0;
          re.warmupSets = 0;
        });
      });

      // Create a session and append sets. Each Date.now() call yields a
      // distinct, increasing timestamp: with the real clock, back-to-back
      // appends share a created_at millisecond only when the machine is fast
      // enough, which made the ordering assertions below load-dependent.
      const baseTimeMs = 1700000000000;
      const nowSpy = jest.spyOn(Date, 'now');
      let tick = 0;
      nowSpy.mockImplementation(() => baseTimeMs + tick++ * 1000);
      try {
        await createSession(database, {
          sessionId: 'session-history-1',
          routineId: routineId,
          startedAtMs: baseTimeMs - 100000,
        });

        // Append a warmup set (should be excluded)
        await appendSet(database, 'session-history-1', 'routine-exercise-1', {
          setType: 'warmup',
          reps: 12,
          weightKg: 50,
        });

        // Append a working set (should be included)
        await appendSet(database, 'session-history-1', 'routine-exercise-1', {
          setType: 'working',
          reps: 8,
          weightKg: 100,
          rpe: 8,
        });

        // Append another working set (should be included)
        await appendSet(database, 'session-history-1', 'routine-exercise-1', {
          setType: 'working',
          reps: 8,
          weightKg: 100,
          rpe: 8.5,
        });

        // Append a stretch set (should be excluded)
        await appendSet(database, 'session-history-1', 'routine-exercise-1', {
          setType: 'stretch',
          durationSeconds: 60,
        });
      } finally {
        nowSpy.mockRestore();
      }

      // Get history and verify only working sets returned, most recent first
      const history = await getExerciseWorkingSetHistory(database, exerciseId);
      expect(history).toHaveLength(2);
      expect((history[0] as any).setType).toBe('working');
      expect((history[1] as any).setType).toBe('working');
      expect((history[0] as any).reps).toBe(8);
      expect((history[0] as any).weightKg).toBe(100);
      expect((history[0] as any).rpe).toBe(8.5);
      expect((history[1] as any).rpe).toBe(8);
    }, 15000);

    it('orders same-millisecond sets most-recent-first (created_at tie breaks by position)', async () => {
      const routineId = 'routine-tie';
      const exerciseId = 'exercise-tie';

      await upsertExercise(database, exerciseId, 'Deadlift', 'strength');
      await upsertRoutine(database, routineId, 'Tie Routine', [
        { exerciseId, order: 0, targetSets: 2, targetReps: 8 },
      ]);

      const routineExercisesTable = database.get('routine_exercises');
      const [routineExercise] = (await routineExercisesTable
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];
      expect(routineExercise).toBeDefined();

      await createSession(database, {
        sessionId: 'session-tie',
        routineId,
        startedAtMs: 1700000000000 - 60000,
      });

      // Pin the clock so both appends land in the same millisecond — the
      // collision that only happens by chance on a fast machine. Same-ms sets
      // must sort exactly like sets logged milliseconds apart: the
      // later-position set is the more recent one either way.
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1700000000000);
      try {
        await appendSet(database, 'session-tie', routineExercise.id, {
          setType: 'working',
          reps: 8,
          weightKg: 100,
          rpe: 8,
        });
        await appendSet(database, 'session-tie', routineExercise.id, {
          setType: 'working',
          reps: 8,
          weightKg: 100,
          rpe: 8.5,
        });
      } finally {
        nowSpy.mockRestore();
      }

      const history = await getExerciseWorkingSetHistory(database, exerciseId);
      expect(history.map((s: any) => s.rpe)).toEqual([8.5, 8]);
    }, 15000);

    it('Phase 4 Task 3: returns prior working sets for progression hint evaluation', async () => {
      const routineId = 'routine-progression-hint';
      const exerciseId = 'exercise-progression-hint';

      await database.write(async () => {
        // Create routine
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        // Create exercise
        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        // Create routine exercise
        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-progression';
          re.routineId = routineId;
          re.exerciseId = exerciseId;
          re.order = 0;
          re.warmupSets = 0;
        });
      });

      // Create a prior session with working sets
      await createSession(database, {
        sessionId: 'session-prior',
        routineId: routineId,
        startedAtMs: Date.now() - 1000000,
      });

      // Log some working sets in the prior session
      await appendSet(database, 'session-prior', 'routine-exercise-progression', {
        setType: 'working',
        reps: 8,
        weightKg: 100,
        rpe: 7,
      });

      await appendSet(database, 'session-prior', 'routine-exercise-progression', {
        setType: 'working',
        reps: 8,
        weightKg: 100,
        rpe: 7.5,
      });

      // Query history (simulating what happens when computing progression hint)
      const history = await getExerciseWorkingSetHistory(database, exerciseId);

      // Verify the history can be used to compute a progression hint
      expect(history).toHaveLength(2);
      expect(history.every((set: any) => set.setType === 'working')).toBe(true);
      expect((history[0] as any).weightKg).toBe(100);
      expect((history[1] as any).weightKg).toBe(100);
    }, 15000);

    describe('identity resolution: the recorded exercise_id wins over the join', () => {
      // The routine_exercises row is permanent and its exercise_id is now
      // mutable (ReplaceExercise). A set's own recorded identity is therefore
      // the authority; the join is the fallback for rows written before the
      // column existed.
      const ROUTINE_ID = 'routine-identity';
      const RECORDED = 'exercise-recorded';
      const ROW_NAMES = 'exercise-row-names';
      const ROW_ID = 're-identity';

      beforeEach(async () => {
        await upsertExercise(database, RECORDED, 'Recorded Movement', 'strength');
        await upsertExercise(database, ROW_NAMES, 'Row-Named Movement', 'strength');

        await database.write(async () => {
          await database.get('routines').create((r: any) => {
            r._raw.id = ROUTINE_ID;
            r.name = 'Identity Routine';
          });
          await database.get('routine_exercises').create((re: any) => {
            re._raw.id = ROW_ID;
            re.routineId = ROUTINE_ID;
            re.exerciseId = ROW_NAMES;
            re.order = 0;
            re.warmupSets = 0;
          });
        });

        await createSession(database, {
          sessionId: 'session-identity',
          routineId: ROUTINE_ID,
          startedAtMs: Date.now(),
        });
      });

      it('stamps the exercise id appendSet was given onto the row', async () => {
        await appendSet(database, 'session-identity', ROW_ID, {
          setType: 'working',
          reps: 5,
          exerciseId: RECORDED,
        });

        const [set] = await database.get('session_sets').query().fetch();
        expect((set as any)._raw.exercise_id).toBe(RECORDED);
      });

      it('reads a stamped set as history for the exercise it recorded, not the one the row names', async () => {
        await appendSet(database, 'session-identity', ROW_ID, {
          setType: 'working',
          reps: 5,
          exerciseId: RECORDED,
        });

        expect(await getExerciseWorkingSetHistory(database, RECORDED)).toHaveLength(1);
        expect(await getExerciseWorkingSetHistory(database, ROW_NAMES)).toHaveLength(0);
      });

      it('falls back to the routine_exercises join for a set with no recorded identity', async () => {
        // Exactly a pre-v3 row: exercise_id is null, so the join is all it has.
        await appendSet(database, 'session-identity', ROW_ID, {
          setType: 'working',
          reps: 5,
        });

        const [set] = await database.get('session_sets').query().fetch();
        expect((set as any)._raw.exercise_id ?? null).toBeNull();

        expect(await getExerciseWorkingSetHistory(database, ROW_NAMES)).toHaveLength(1);
        expect(await getExerciseWorkingSetHistory(database, RECORDED)).toHaveLength(0);
      });

      it('returns stamped and legacy sets together, still ordered most-recent-first', async () => {
        const baseTimeMs = 1700000000000;
        const nowSpy = jest.spyOn(Date, 'now');
        let tick = 0;
        nowSpy.mockImplementation(() => baseTimeMs + tick++ * 1000);
        try {
          // Legacy first, stamped second: one of each identity path, and the
          // merge must not disturb the ordering contract.
          await appendSet(database, 'session-identity', ROW_ID, {
            setType: 'working',
            reps: 5,
            rpe: 7,
          });
          await appendSet(database, 'session-identity', ROW_ID, {
            setType: 'working',
            reps: 5,
            rpe: 8,
            exerciseId: ROW_NAMES,
          });
        } finally {
          nowSpy.mockRestore();
        }

        const history = await getExerciseWorkingSetHistory(database, ROW_NAMES);
        expect(history.map((set: any) => set.rpe)).toEqual([8, 7]);
      });

      it('still excludes warmups whichever identity path a set takes', async () => {
        await appendSet(database, 'session-identity', ROW_ID, {
          setType: 'warmup',
          reps: 12,
          exerciseId: ROW_NAMES,
        });
        await appendSet(database, 'session-identity', ROW_ID, {
          setType: 'warmup',
          reps: 12,
        });

        expect(await getExerciseWorkingSetHistory(database, ROW_NAMES)).toHaveLength(0);
      });

      it('finds a stamped set even when its routine_exercises row is gone', async () => {
        // deleteRoutine deliberately leaves orphaned rows as history carriers,
        // but a stamped set no longer depends on one existing.
        await appendSet(database, 'session-identity', ROW_ID, {
          setType: 'working',
          reps: 5,
          exerciseId: RECORDED,
        });

        await database.write(async () => {
          const row = await database.get('routine_exercises').find(ROW_ID);
          await row.destroyPermanently();
        });

        expect(await getExerciseWorkingSetHistory(database, RECORDED)).toHaveLength(1);
      });
    });
  });

  describe('upsertExercise and updateExerciseDescription', () => {
    it('creates an exercise without a description when none is provided', async () => {
      await upsertExercise(database, 'exercise-no-desc', 'Goblet Squat', 'strength');

      const exercise = await database.get('exercises').find('exercise-no-desc');
      expect((exercise as any).description).toBeNull();
    }, 10000);

    it('creates an exercise with a description when one is provided', async () => {
      await upsertExercise(
        database,
        'exercise-with-desc',
        'Goblet Squat',
        'strength',
        'Hold a dumbbell at chest height, squat between your knees.'
      );

      const exercise = await database.get('exercises').find('exercise-with-desc');
      expect((exercise as any).description).toBe(
        'Hold a dumbbell at chest height, squat between your knees.'
      );
    }, 10000);

    it('updateExerciseDescription sets the description without touching title or kind', async () => {
      await upsertExercise(database, 'exercise-update-desc', 'Overhead Press', 'strength');

      await updateExerciseDescription(
        database,
        'exercise-update-desc',
        'Press from shoulder height to lockout overhead.'
      );

      const exercise = await database.get('exercises').find('exercise-update-desc');
      expect((exercise as any).description).toBe('Press from shoulder height to lockout overhead.');
      expect((exercise as any).title).toBe('Overhead Press');
      expect((exercise as any).kind).toBe('strength');
    }, 10000);

    it('updateExerciseDescription can clear a description back to null', async () => {
      await upsertExercise(
        database,
        'exercise-clear-desc',
        'Lat Pulldown',
        'strength',
        'Pull the bar to your upper chest.'
      );

      await updateExerciseDescription(database, 'exercise-clear-desc', null);

      const exercise = await database.get('exercises').find('exercise-clear-desc');
      expect((exercise as any).description).toBeNull();
    }, 10000);

    it('updateExerciseDescription normalizes empty string to null', async () => {
      await upsertExercise(database, 'exercise-empty-str', 'Curl', 'strength', 'Original description');

      await updateExerciseDescription(database, 'exercise-empty-str', '');

      const exercise = await database.get('exercises').find('exercise-empty-str');
      expect((exercise as any).description).toBeNull();
    }, 10000);

    it('updateExerciseDescription normalizes whitespace-only string to null', async () => {
      await upsertExercise(database, 'exercise-ws-str', 'Row', 'strength', 'Original description');

      await updateExerciseDescription(database, 'exercise-ws-str', '   ');

      const exercise = await database.get('exercises').find('exercise-ws-str');
      expect((exercise as any).description).toBeNull();
    }, 10000);

    it('stores trimmed text (decorator + boundary agree)', async () => {
      await upsertExercise(database, 'exercise-trim', 'Press', 'strength', 'Original');

      await updateExerciseDescription(database, 'exercise-trim', '  squat cues  ');

      const exercise = await database.get('exercises').find('exercise-trim');
      expect((exercise as any).description).toBe('squat cues');
    }, 10000);

    it('upsertExercise create normalizes empty string description to null', async () => {
      await upsertExercise(database, 'exercise-create-empty', 'Bench', 'strength', '');

      const exercise = await database.get('exercises').find('exercise-create-empty');
      expect((exercise as any).description).toBeNull();
    }, 10000);

    it('upsertExercise create normalizes whitespace-only description to null', async () => {
      await upsertExercise(database, 'exercise-create-ws', 'Squat', 'strength', '   ');

      const exercise = await database.get('exercises').find('exercise-create-ws');
      expect((exercise as any).description).toBeNull();
    }, 10000);

    it('create stores trimmed text (decorator + boundary agree)', async () => {
      await upsertExercise(database, 'exercise-create-trim', 'Deadlift', 'strength', '  keep your chest up  ');

      const exercise = await database.get('exercises').find('exercise-create-trim');
      expect((exercise as any).description).toBe('keep your chest up');
    }, 10000);
  });

  describe('upsertRoutine reconcile', () => {
    it('preserves working-set history when a routine is re-upserted with the same exercises', async () => {
      const routineId = 'routine-reupsert';
      const exerciseId = 'exercise-ohp';

      await upsertExercise(database, exerciseId, 'Overhead Press', 'strength');
      await upsertRoutine(database, routineId, 'Push Day', [
        { exerciseId, order: 0, targetSets: 3, targetReps: 8, restSeconds: 90 },
      ]);

      // Log sets against the routine_exercise row, as the live session flow does
      const routineExercisesTable = database.get('routine_exercises');
      const [before] = (await routineExercisesTable
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];
      expect(before).toBeDefined();

      await createSession(database, {
        sessionId: 'session-reupsert',
        routineId,
        startedAtMs: Date.now() - 60000,
      });
      await appendSet(database, 'session-reupsert', before.id, {
        setType: 'working',
        reps: 8,
        weightKg: 40,
      });
      await appendSet(database, 'session-reupsert', before.id, {
        setType: 'working',
        reps: 8,
        weightKg: 42.5,
      });

      // Sanity: history is visible before the edit
      expect(await getExerciseWorkingSetHistory(database, exerciseId)).toHaveLength(2);

      // Re-upsert the same routine with the same exercise (a routine edit)
      await upsertRoutine(database, routineId, 'Push Day (edited)', [
        { exerciseId, order: 0, targetSets: 4, targetReps: 10, restSeconds: 90 },
      ]);

      const history = await getExerciseWorkingSetHistory(database, exerciseId);
      expect(history).toHaveLength(2);
      expect(
        history.map((s: any) => s.weightKg).sort((a: number, b: number) => a - b)
      ).toEqual([40, 42.5]);
    }, 15000);

    it('reconciles routine_exercises in place: surviving rows keep ids, fields update and clear, removed rows are deleted', async () => {
      const routineId = 'routine-reconcile';
      await upsertExercise(database, 'ex-keep', 'Kept Exercise', 'strength');
      await upsertExercise(database, 'ex-drop', 'Dropped Exercise', 'strength');
      await upsertExercise(database, 'ex-add', 'Added Exercise', 'strength');

      await upsertRoutine(database, routineId, 'Original', [
        {
          exerciseId: 'ex-keep',
          order: 0,
          supersetGroup: 'group-a',
          warmupSets: 2,
          targetSets: 3,
          targetReps: 8,
          notes: 'old note',
        },
        { exerciseId: 'ex-drop', order: 1, targetSets: 3, targetReps: 12 },
      ]);

      const routineExercisesTable = database.get('routine_exercises');
      const fetchRows = async () =>
        (await routineExercisesTable
          .query(Q.where('routine_id', routineId))
          .fetch()) as any[];

      const keptBefore = (await fetchRows()).find((re) => re.exerciseId === 'ex-keep');
      expect(keptBefore).toBeDefined();

      await upsertRoutine(database, routineId, 'Edited', [
        // supersetGroup/notes omitted → must clear, matching previous replace semantics
        { exerciseId: 'ex-keep', order: 1, warmupSets: 0, targetSets: 5, targetReps: 5 },
        { exerciseId: 'ex-add', order: 0, targetSets: 3, targetReps: 10 },
      ]);

      const after = await fetchRows();
      expect(after).toHaveLength(2);
      expect(after.find((re) => re.exerciseId === 'ex-drop')).toBeUndefined();

      const keptAfter = after.find((re) => re.exerciseId === 'ex-keep');
      // Same row id → session_sets.routine_exercise_id references stay attached
      expect(keptAfter.id).toBe(keptBefore.id);
      expect(keptAfter.order).toBe(1);
      expect(keptAfter.warmupSets).toBe(0);
      expect(keptAfter.targetSets).toBe(5);
      expect(keptAfter.targetReps).toBe(5);
      expect(keptAfter.supersetGroup).toBeNull();
      expect(keptAfter.notes).toBeNull();

      const added = after.find((re) => re.exerciseId === 'ex-add');
      expect(added).toBeDefined();
      expect(added.order).toBe(0);
    }, 15000);

    it('freezes a dropped entry’s legacy sets at its exercise before deleting the row', async () => {
      // A pre-v3 set has no recorded identity, so the routine_exercises row is
      // the only thing that says what it was. Destroying that row without
      // stamping first loses the answer permanently — the same hazard
      // updateRoutineExerciseExerciseId defends against when it re-points a row.
      const routineId = 'routine-drop-legacy';
      await upsertExercise(database, 'ex-stays', 'Stays', 'strength');
      await upsertExercise(database, 'ex-dropped', 'Dropped', 'strength');

      await upsertRoutine(database, routineId, 'Original', [
        { exerciseId: 'ex-stays', order: 0, targetSets: 3, targetReps: 8 },
        { exerciseId: 'ex-dropped', order: 1, targetSets: 3, targetReps: 12 },
      ]);

      const [droppedRow] = (await database
        .get('routine_exercises')
        .query(Q.and(Q.where('routine_id', routineId), Q.where('exercise_id', 'ex-dropped')))
        .fetch()) as any[];

      await createSession(database, {
        sessionId: 'session-legacy',
        routineId,
        startedAtMs: Date.now() - 60000,
      });
      // No exerciseId: exactly what an install that logged these before v3 has.
      await appendSet(database, 'session-legacy', droppedRow.id, {
        setType: 'working',
        reps: 12,
        weightKg: 20,
      });
      await appendSet(database, 'session-legacy', droppedRow.id, {
        setType: 'working',
        reps: 10,
        weightKg: 22.5,
      });

      expect(await getExerciseWorkingSetHistory(database, 'ex-dropped')).toHaveLength(2);

      await upsertRoutine(database, routineId, 'Edited', [
        { exerciseId: 'ex-stays', order: 0, targetSets: 3, targetReps: 8 },
      ]);

      // The row is gone, so the join can no longer answer — the sets must carry
      // the identity themselves.
      const history = await getExerciseWorkingSetHistory(database, 'ex-dropped');
      expect(history).toHaveLength(2);
      expect(
        history.map((s: any) => s.weightKg).sort((a: number, b: number) => a - b)
      ).toEqual([20, 22.5]);
    }, 15000);

    it('leaves an already-stamped set at the identity it was earned under', async () => {
      // A set logged under one exercise, on a row later re-pointed at another
      // (ReplaceExercise), then dropped from the routine. The freeze must skip
      // it: stamping it with the row's *current* exercise would hand the
      // substitute history it never earned — the very re-attribution the stamp
      // exists to prevent.
      const routineId = 'routine-drop-stamped';
      await upsertExercise(database, 'ex-earned', 'Earned It', 'strength');
      await upsertExercise(database, 'ex-substitute', 'Substitute', 'strength');

      await upsertRoutine(database, routineId, 'Original', [
        { exerciseId: 'ex-substitute', order: 0, targetSets: 3, targetReps: 8 },
      ]);

      const [row] = (await database
        .get('routine_exercises')
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];

      await createSession(database, {
        sessionId: 'session-stamped',
        routineId,
        startedAtMs: Date.now() - 60000,
      });
      await appendSet(database, 'session-stamped', row.id, {
        setType: 'working',
        reps: 8,
        weightKg: 60,
        exerciseId: 'ex-earned',
      });

      // Drop the entry entirely.
      await upsertRoutine(database, routineId, 'Edited', []);

      expect(await getExerciseWorkingSetHistory(database, 'ex-earned')).toHaveLength(1);
      expect(await getExerciseWorkingSetHistory(database, 'ex-substitute')).toHaveLength(0);
    }, 15000);

    it('defaults targetSets to 1 for duration-based entries where targetSets is undefined and warmupSets is zero', async () => {
      // Defense-in-depth: if a zero-total entry (targetSets undefined, warmupSets 0)
      // reaches upsertRoutine, it should default targetSets to 1 here — regardless of
      // whether targetDurationSeconds is set. This protects against zero-total entries
      // being silently skipped by the engine, and catches cases where the sync-side or
      // AI-side defaulting was missed.
      const routineId = 'routine-defense-depth';
      await upsertExercise(database, 'plank', 'Plank', 'strength');

      await upsertRoutine(database, routineId, 'Defense Depth Test', [
        {
          exerciseId: 'plank',
          order: 0,
          targetDurationSeconds: 30,
          // targetSets is undefined (not passed), warmupSets is undefined
        },
      ]);

      const routineExercisesTable = database.get('routine_exercises');
      const [plankRow] = (await routineExercisesTable
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];

      // Should have defaulted to 1, not left as null
      expect(plankRow.targetSets).toBe(1);
      expect(plankRow.targetDurationSeconds).toBe(30);
    }, 10000);

    it('does not default targetSets when warmupSets is already set (avoids changing zero-total to one-set if warmup exists)', async () => {
      // If an entry has warmup=2 and no targetSets, the total is already 2.
      // We should not add another working set on top of it.
      const routineId = 'routine-warmup-guard';
      await upsertExercise(database, 'easy-cardio', 'Easy Cardio', 'cardio');

      await upsertRoutine(database, routineId, 'Warmup Guard Test', [
        {
          exerciseId: 'easy-cardio',
          order: 0,
          warmupSets: 2,
          targetDurationSeconds: 60,
          // targetSets is undefined (not passed)
        },
      ]);

      const routineExercisesTable = database.get('routine_exercises');
      const [cardioRow] = (await routineExercisesTable
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];

      // Should remain null because warmupSets is already 2 (non-zero total)
      expect(cardioRow.targetSets).toBeNull();
      expect(cardioRow.warmupSets).toBe(2);
      expect(cardioRow.targetDurationSeconds).toBe(60);
    }, 10000);

    it('defaults targetSets to 1 even when targetDurationSeconds is undefined (AI draft case)', async () => {
      // Important 2: An AI draft can have neither targetSets nor targetDurationSeconds set
      // (only title and kind required by the schema). This entry would be zero-total
      // (no warmup, no target sets, no duration), so it should still get defaulted to 1.
      const routineId = 'routine-ai-draft';
      await upsertExercise(database, 'plank', 'Plank', 'strength');

      await upsertRoutine(database, routineId, 'AI Draft Test', [
        {
          exerciseId: 'plank',
          order: 0,
          // targetSets is undefined, targetDurationSeconds is undefined, warmupSets is undefined
        },
      ]);

      const routineExercisesTable = database.get('routine_exercises');
      const [plankRow] = (await routineExercisesTable
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];

      // Should default to 1 even without duration, preventing zero-total entries
      expect(plankRow.targetSets).toBe(1);
      expect(plankRow.targetDurationSeconds).toBeNull();
      expect(plankRow.warmupSets).toBe(0);
    }, 10000);

    it('UPDATE branch also applies the targetSets default for zero-total entries', async () => {
      // Minor 3b: The UPDATE path (when updating an existing routine_exercise row)
      // must also apply the defaulting logic, not just the CREATE path.
      const routineId = 'routine-update-branch';
      await upsertExercise(database, 'walk', 'Walk', 'cardio');

      // First upsert: create with targetSets=2
      await upsertRoutine(database, routineId, 'First Version', [
        {
          exerciseId: 'walk',
          order: 0,
          targetSets: 2,
          warmupSets: 0,
        },
      ]);

      // Second upsert: update to be zero-total (no targetSets, no warmup)
      // The UPDATE path should default it to 1, not leave it null
      await upsertRoutine(database, routineId, 'Updated Version', [
        {
          exerciseId: 'walk',
          order: 0,
          warmupSets: 0,
          // targetSets is undefined (not passed)
        },
      ]);

      const routineExercisesTable = database.get('routine_exercises');
      const [walkRow] = (await routineExercisesTable
        .query(Q.where('routine_id', routineId))
        .fetch()) as any[];

      // Should have defaulted to 1, not reverted to null
      expect(walkRow.targetSets).toBe(1);
      expect(walkRow.warmupSets).toBe(0);
    }, 10000);
  });

  describe('getRecentSessionSummaries', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const JULY_29 = Date.parse('2026-07-29T18:00:00.000Z');

    interface SeedSessionOptions {
      sessionId: string;
      routineId: string;
      routineName?: string;
      /** Omit to leave the session in progress. */
      endedAtMs?: number;
      exercises?: { exerciseId: string; workingSets: number; warmupSets?: number }[];
    }

    async function seedSession(options: SeedSessionOptions): Promise<void> {
      const {
        sessionId,
        routineId,
        routineName = routineId,
        endedAtMs,
        exercises = [],
      } = options;

      await database.write(async () => {
        try {
          await database.get('routines').find(routineId);
        } catch {
          await database.get('routines').create((r: any) => {
            r._raw.id = routineId;
            r.name = routineName;
            r._raw.created_at = Date.now();
            r._raw.updated_at = Date.now();
          });
        }
      });

      const routineExerciseIds: string[] = [];
      for (const [index, entry] of exercises.entries()) {
        await upsertExercise(database, entry.exerciseId, entry.exerciseId, 'strength');
        const routineExercise = await upsertRoutineExercise(database, routineId, {
          exerciseId: entry.exerciseId,
          order: index,
        });
        routineExerciseIds.push((routineExercise as any).id);
      }

      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: (endedAtMs ?? Date.now()) - 3600000,
      });

      for (const [index, entry] of exercises.entries()) {
        for (let i = 0; i < entry.workingSets; i++) {
          await appendSet(database, sessionId, routineExerciseIds[index], {
            setType: 'working',
            reps: 8,
          });
        }
        for (let i = 0; i < (entry.warmupSets ?? 0); i++) {
          await appendSet(database, sessionId, routineExerciseIds[index], {
            setType: 'warmup',
            reps: 5,
          });
        }
      }

      if (endedAtMs !== undefined) {
        await database.write(async () => {
          const session = await database.get('sessions').find(sessionId);
          await session.update((record: any) => {
            record._raw.ended_at = endedAtMs;
          });
        });
      }
    }

    it('returns an empty list when no session has been completed', async () => {
      await seedSession({ sessionId: 'session-open', routineId: 'routine-a' });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries).toEqual([]);
    }, 15000);

    it('orders completed sessions most recent first, whatever order they were seeded in', async () => {
      // Seeded out of chronological order on purpose: insertion order must not
      // be what makes this pass.
      await seedSession({
        sessionId: 'session-middle',
        routineId: 'routine-a',
        endedAtMs: JULY_29 - DAY_MS,
      });
      await seedSession({
        sessionId: 'session-oldest',
        routineId: 'routine-a',
        endedAtMs: JULY_29 - 2 * DAY_MS,
      });
      await seedSession({
        sessionId: 'session-newest',
        routineId: 'routine-a',
        endedAtMs: JULY_29,
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries.map((s) => s.sessionId)).toEqual([
        'session-newest',
        'session-middle',
        'session-oldest',
      ]);
      expect(summaries[0].endedAtMs).toBe(JULY_29);
    }, 15000);

    it('excludes a session that has not ended', async () => {
      await seedSession({
        sessionId: 'session-done',
        routineId: 'routine-a',
        endedAtMs: JULY_29,
      });
      await seedSession({ sessionId: 'session-in-progress', routineId: 'routine-a' });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries.map((s) => s.sessionId)).toEqual(['session-done']);
    }, 15000);

    it('respects the limit, dropping the sessions beyond it', async () => {
      await seedSession({
        sessionId: 'session-1',
        routineId: 'routine-a',
        endedAtMs: JULY_29 - 2 * DAY_MS,
      });
      await seedSession({
        sessionId: 'session-2',
        routineId: 'routine-a',
        endedAtMs: JULY_29 - DAY_MS,
      });
      await seedSession({
        sessionId: 'session-3',
        routineId: 'routine-a',
        endedAtMs: JULY_29,
      });

      const summaries = await getRecentSessionSummaries(database, 2);

      expect(summaries.map((s) => s.sessionId)).toEqual(['session-3', 'session-2']);
    }, 15000);

    it('names the routine that was performed', async () => {
      await seedSession({
        sessionId: 'session-named',
        routineId: 'routine-upper',
        routineName: 'Upper Body',
        endedAtMs: JULY_29,
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries[0].routineName).toBe('Upper Body');
      expect(summaries[0].routineId).toBe('routine-upper');
    }, 15000);

    it('falls back to the routine id when the routine has been deleted', async () => {
      await seedSession({
        sessionId: 'session-orphan',
        routineId: 'routine-gone',
        routineName: 'Deleted Routine',
        endedAtMs: JULY_29,
      });

      await database.write(async () => {
        const routine = await database.get('routines').find('routine-gone');
        await routine.destroyPermanently();
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries[0].routineName).toBe('routine-gone');
    }, 15000);

    it('MINOR 7: falls back to the routine id when the routine name is blank', async () => {
      await seedSession({
        sessionId: 'session-blank-name',
        routineId: 'routine-blank-name',
        routineName: 'Will Be Blanked',
        endedAtMs: JULY_29,
      });

      // Blank the routine name
      await database.write(async () => {
        const routine = await database.get('routines').find('routine-blank-name');
        await routine.update((record: any) => {
          record.name = '';
        });
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries[0].routineName).toBe('routine-blank-name');
    }, 15000);

    it('counts distinct exercises and working sets, ignoring warmups', async () => {
      await seedSession({
        sessionId: 'session-volume',
        routineId: 'routine-volume',
        endedAtMs: JULY_29,
        exercises: [
          { exerciseId: 'bench', workingSets: 3, warmupSets: 2 },
          { exerciseId: 'rows', workingSets: 4 },
        ],
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries[0].exerciseCount).toBe(2);
      expect(summaries[0].workingSetCount).toBe(7);
    }, 15000);

    it('counts an exercise the routine repeats as one exercise trained', async () => {
      await upsertExercise(database, 'bench', 'Bench Press', 'strength');
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-repeat';
          r.name = 'Repeats';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
      });

      // Two rows for the same exercise: upsertRoutineExercise keys on
      // (routine, exercise) and would collapse them, so create them directly.
      const routineExerciseIds = await database.write(async () => {
        const first = await database.get('routine_exercises').create((re: any) => {
          re.routineId = 'routine-repeat';
          re.exerciseId = 'bench';
          re.order = 0;
          re.warmupSets = 0;
        });
        const second = await database.get('routine_exercises').create((re: any) => {
          re.routineId = 'routine-repeat';
          re.exerciseId = 'bench';
          re.order = 1;
          re.warmupSets = 0;
        });
        return [first.id, second.id];
      });

      await createSession(database, {
        sessionId: 'session-repeat',
        routineId: 'routine-repeat',
        startedAtMs: JULY_29 - 3600000,
      });
      for (const routineExerciseId of routineExerciseIds) {
        await appendSet(database, 'session-repeat', routineExerciseId, {
          setType: 'working',
          reps: 8,
        });
      }
      await database.write(async () => {
        const session = await database.get('sessions').find('session-repeat');
        await session.update((record: any) => {
          record._raw.ended_at = JULY_29;
        });
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries[0].exerciseCount).toBe(1);
      expect(summaries[0].workingSetCount).toBe(2);
    }, 15000);

    it('reports zero volume for a completed session with nothing logged', async () => {
      await seedSession({
        sessionId: 'session-bailed',
        routineId: 'routine-bailed',
        endedAtMs: JULY_29,
        exercises: [{ exerciseId: 'bench', workingSets: 0, warmupSets: 2 }],
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      expect(summaries[0].exerciseCount).toBe(0);
      expect(summaries[0].workingSetCount).toBe(0);
    }, 15000);

    it('IMPORTANT 3: counts orphaned routine_exercise as its own distinct exercise', async () => {
      const routineId = 'routine-orphan-test';
      const exerciseId = 'exercise-orphan-test';

      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Orphan Test';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        await database.get('exercises').create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Bench Press';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        await database.get('exercises').create((e: any) => {
          e._raw.id = `${exerciseId}-b`;
          e.title = 'Squat';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      });

      // TWO routine_exercise rows (distinct exercises — upsertRoutineExercise
      // is keyed on routine+exercise): with both orphaned, distinct-counting
      // (2) and collapsing-all-orphans-to-one (1) become distinguishable — a
      // single orphan cannot discriminate the semantic this test pins.
      const routineExerciseA = await upsertRoutineExercise(database, routineId, {
        exerciseId,
        order: 0,
      });
      const routineExerciseB = await upsertRoutineExercise(database, routineId, {
        exerciseId: `${exerciseId}-b`,
        order: 1,
      });
      const routineExerciseIdA = routineExerciseA.id;
      const routineExerciseIdB = routineExerciseB.id;

      await createSession(database, {
        sessionId: 'session-orphan-test',
        routineId,
        startedAtMs: JULY_29 - 3600000,
      });

      // Log a set against each routine_exercise
      await appendSet(database, 'session-orphan-test', routineExerciseIdA, {
        setType: 'working',
        reps: 8,
      });
      await appendSet(database, 'session-orphan-test', routineExerciseIdB, {
        setType: 'working',
        reps: 8,
      });

      // End the session
      await database.write(async () => {
        const session = await database.get('sessions').find('session-orphan-test');
        await session.update((record: any) => {
          record._raw.ended_at = JULY_29;
        });
      });

      // Destroy both routine_exercise rows (both sets become orphaned)
      await database.write(async () => {
        const reA = await database.get('routine_exercises').find(routineExerciseIdA);
        await reA.destroyPermanently();
        const reB = await database.get('routine_exercises').find(routineExerciseIdB);
        await reB.destroyPermanently();
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      // Each orphaned set keeps its routine_exercise id as residual identity, so
      // the two orphans count as TWO distinct exercises. Collapsing orphans into
      // a shared bucket would report 1 and fail here.
      expect(summaries[0].exerciseCount).toBe(2);
      expect(summaries[0].workingSetCount).toBe(2);
    }, 15000);

    it('MINOR 4: breaks tiebreak on ended_at using started_at as secondary sort', async () => {
      // Two sessions ending at exactly the same time, but different start times
      const sharedEndTime = JULY_29;
      const startTime1 = sharedEndTime - 7200000; // 2 hours before end
      const startTime2 = sharedEndTime - 3600000; // 1 hour before end

      // Seed them in ascending started_at order; the query must return them descending
      // when both ended at the same time
      await database.write(async () => {
        const sessionsTable = database.get('sessions');
        const routinesTable = database.get('routines');

        // Create the routine first
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-tie';
          r.name = 'Tiebreak Test';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        // Seed session 1 (earlier start)
        await sessionsTable.create((s: any) => {
          s._raw.id = 'session-tie-1';
          s._raw.routine_id = 'routine-tie';
          s._raw.started_at = startTime1;
          s._raw.ended_at = sharedEndTime;
        });

        // Seed session 2 (later start) — inserted second; the sort, not insertion order, must put it first
        await sessionsTable.create((s: any) => {
          s._raw.id = 'session-tie-2';
          s._raw.routine_id = 'routine-tie';
          s._raw.started_at = startTime2;
          s._raw.ended_at = sharedEndTime;
        });
      });

      const summaries = await getRecentSessionSummaries(database, 10);

      // Should be ordered by started_at descending: session 2 (later start) first
      expect(summaries.map((s) => s.sessionId)).toEqual([
        'session-tie-2',
        'session-tie-1',
      ]);
    }, 15000);

    it('MINOR 5: returns empty array when limit is zero or negative', async () => {
      await seedSession({
        sessionId: 'session-1',
        routineId: 'routine-a',
        endedAtMs: JULY_29,
      });

      const zeroSummaries = await getRecentSessionSummaries(database, 0);
      const negativeSummaries = await getRecentSessionSummaries(database, -5);

      expect(zeroSummaries).toEqual([]);
      expect(negativeSummaries).toEqual([]);
    }, 15000);
  });

  describe('getRoutineDisplay', () => {
    it('returns the routine name and notes', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Push Day';
          r._raw.notes = 'Focus on bar speed today.';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
      });

      const display = await getRoutineDisplay(database, 'routine-1');

      expect(display).toEqual({ name: 'Push Day', notes: 'Focus on bar speed today.' });
    }, 15000);

    it('returns null notes when the routine has none', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-2';
          r.name = 'Pull Day';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
      });

      const display = await getRoutineDisplay(database, 'routine-2');

      expect(display).toEqual({ name: 'Pull Day', notes: null });
    }, 15000);

    it('normalizes whitespace-only notes to null', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-3';
          r.name = 'Leg Day';
          // Raw write bypasses the model's trim, so the helper must normalize.
          r._raw.notes = '   ';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
      });

      const display = await getRoutineDisplay(database, 'routine-3');

      expect(display).toEqual({ name: 'Leg Day', notes: null });
    }, 15000);

    it('returns null when the routine does not exist', async () => {
      const display = await getRoutineDisplay(database, 'routine-gone');

      expect(display).toBeNull();
    }, 15000);
  });

  describe('getExerciseTitles', () => {
    it('maps exercise ids to titles, skipping ids that no longer exist', async () => {
      await database.write(async () => {
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'ex-1';
          e.title = 'Demo Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'ex-2';
          e.title = 'Overhead Press';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      });

      const titles = await getExerciseTitles(database, ['ex-1', 'ex-2', 'ex-gone']);

      expect(titles).toEqual({ 'ex-1': 'Demo Exercise', 'ex-2': 'Overhead Press' });
    }, 15000);

    it('returns an empty map for an empty id list', async () => {
      const titles = await getExerciseTitles(database, []);

      expect(titles).toEqual({});
    }, 15000);
  });
});
