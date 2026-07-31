import { Database, Q } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import { createSession, appendSet, getSession, getSessionSets, upsertRoutineExercise, getSupersetGroups, getExerciseWorkingSetHistory, getRecentSessionSummaries, upsertExercise, upsertRoutine } from './repository';
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

    it('AC1.3: created session defaults syncStatus to "local"', async () => {
      const sessionId = 'session-2';
      const routineId = 'routine-2';
      const startedAtMs = Date.now();

      await createSession(database, { sessionId, routineId, startedAtMs });

      const session = await getSession(database, sessionId);
      expect((session as any).customSyncStatus).toBe('local');
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

      // Create a session and append sets
      await createSession(database, {
        sessionId: 'session-history-1',
        routineId: routineId,
        startedAtMs: Date.now() - 100000,
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

      // Append a drop set (should be excluded)
      await appendSet(database, 'session-history-1', 'routine-exercise-1', {
        setType: 'drop',
        reps: 15,
        weightKg: 70,
      });

      // Get history and verify only working sets returned
      const history = await getExerciseWorkingSetHistory(database, exerciseId);
      expect(history).toHaveLength(2);
      expect((history[0] as any).setType).toBe('working');
      expect((history[1] as any).setType).toBe('working');
      expect((history[0] as any).reps).toBe(8);
      expect((history[0] as any).weightKg).toBe(100);
      expect((history[0] as any).rpe).toBe(8);
      expect((history[1] as any).rpe).toBe(8.5);
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
      const routineExerciseIdA = (routineExerciseA as any).id;
      const routineExerciseIdB = (routineExerciseB as any).id;

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

      // Seed them out of chronological order to verify they're sorted by start time
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

        // Seed session 2 (later start) - inserted first to verify ordering works
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
});
