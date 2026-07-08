import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import { createSession, appendSet, getSession, getSessionSets, upsertRoutineExercise, getSupersetGroups } from './repository';

/**
 * Helper to access model fields that may have undefined instance properties
 * shadowing the getters. This works around a WatermelonDB quirk with optional fields.
 */
function getField(model: any, fieldName: string): any {
  // First try the descriptor chain to find the getter
  let obj = model;
  while (obj) {
    const desc = Object.getOwnPropertyDescriptor(obj, fieldName);
    if (desc && desc.get) {
      return desc.get.call(model);
    }
    obj = Object.getPrototypeOf(obj);
  }
  // Fallback to direct property access
  return model[fieldName];
}

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

      // Create session
      await database.write(async () => {
        await createSession(database, { sessionId, routineId, startedAtMs });
      });

      // Verify session exists
      const session = await getSession(database, sessionId);
      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
    }, 30000);

    it('AC1.3: created session defaults syncStatus to "local"', async () => {
      const sessionId = 'session-2';
      const routineId = 'routine-2';
      const startedAtMs = Date.now();

      await database.write(async () => {
        await createSession(database, { sessionId, routineId, startedAtMs });
      });

      const session = await getSession(database, sessionId);
      expect(getField(session, 'customSyncStatus')).toBe('local');
    }, 10000);
  });

  describe('appendSet', () => {
    beforeEach(async () => {
      await database.write(async () => {
        // Create a routine
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
          re.order = 1;
          re.warmup_sets = 0;
        });

        // Create a session
        await createSession(database, {
          sessionId: 'session-3',
          routineId: 'routine-3',
          startedAtMs: Date.now(),
        });
      });
    });

    it('AC9.1: a working set with optional rpe persists and reads back', async () => {
      await database.write(async () => {
        await appendSet(database, 'session-3', 'routine-exercise-3', {
          setType: 'working',
          reps: 8,
          weightKg: 60,
          rpe: 7.5,
        });
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      const set = sets[0];
      expect(getField(set, 'rpe')).toBe(7.5);
      expect(getField(set, 'reps')).toBe(8);
      expect(getField(set, 'weightKg')).toBe(60);
    }, 10000);

    it('can append a set with only durationSeconds (for cardio/stretch)', async () => {
      await database.write(async () => {
        await appendSet(database, 'session-3', 'routine-exercise-3', {
          setType: 'working',
          durationSeconds: 300,
        });
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      const set = sets[0];
      expect(getField(set, 'durationSeconds')).toBe(300);
      expect(getField(set, 'reps')).toBeNull();
      expect(getField(set, 'weightKg')).toBeNull();
    }, 10000);

    it('can append a set with setType "warmup"', async () => {
      await database.write(async () => {
        await appendSet(database, 'session-3', 'routine-exercise-3', {
          setType: 'warmup',
          reps: 15,
          weightKg: 30,
        });
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      expect(getField(sets[0], 'setType')).toBe('warmup');
    }, 10000);

    it('defaults setType to "working" if not provided', async () => {
      await database.write(async () => {
        await appendSet(database, 'session-3', 'routine-exercise-3', {
          reps: 5,
          weightKg: 70,
        });
      });

      const sets = await getSessionSets(database, 'session-3');
      expect(sets).toHaveLength(1);
      expect(getField(sets[0], 'setType')).toBe('working');
    }, 10000);
  });

  describe('getSession and getSessionSets', () => {
    it('returns undefined if session does not exist', async () => {
      const session = await getSession(database, 'non-existent');
      expect(session).toBeUndefined();
    }, 10000);

    it('returns empty array if session has no sets', async () => {
      await database.write(async () => {
        await createSession(database, {
          sessionId: 'session-4',
          routineId: 'routine-4',
          startedAtMs: Date.now(),
        });
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

        // Upsert routine exercises in superset
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
      });

      // Get superset groups and verify grouping
      const groups = await getSupersetGroups(database, routineId);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(2);

      // Verify exercises are grouped together and contiguous by order
      const group = groups[0];
      expect(getField(group[0], 'order')).toBe(1);
      expect(getField(group[1], 'order')).toBe(2);
      expect(getField(group[0], 'supersetGroup')).toBe(supersetGroup);
      expect(getField(group[1], 'supersetGroup')).toBe(supersetGroup);
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

        // Upsert routine exercise with warmupSets=2
        await upsertRoutineExercise(database, routineId, {
          exerciseId,
          order: 1,
          warmupSets: 2,
        });

        // Create session
        await createSession(database, {
          sessionId,
          routineId,
          startedAtMs: Date.now(),
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

      // Append warmup set first
      await database.write(async () => {
        await appendSet(database, sessionId, routineExerciseId, {
          setType: 'warmup',
          reps: 15,
          weightKg: 20,
        });
      });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      // Append working set second
      await database.write(async () => {
        await appendSet(database, sessionId, routineExerciseId, {
          setType: 'working',
          reps: 8,
          weightKg: 60,
        });
      });

      // Verify sets are distinguishable by setType
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(2);
      expect(getField(sets[0], 'setType')).toBe('warmup');
      expect(getField(sets[1], 'setType')).toBe('working');
      expect(getField(sets[0], 'reps')).toBe(15);
      expect(getField(sets[1], 'reps')).toBe(8);
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

        // Upsert routine exercise with duration
        await upsertRoutineExercise(database, routineId, {
          exerciseId,
          order: 1,
          targetDurationSeconds: 30,
        });

        // Create session
        await createSession(database, {
          sessionId,
          routineId,
          startedAtMs: Date.now(),
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

      // Log stretch via durationSeconds
      await database.write(async () => {
        await appendSet(database, sessionId, routineExerciseId, {
          setType: 'working',
          durationSeconds: 30,
        });
      });

      // Verify set has duration but null reps/weight
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(1);
      expect(getField(sets[0], 'durationSeconds')).toBe(30);
      expect(getField(sets[0], 'reps')).toBeNull();
      expect(getField(sets[0], 'weightKg')).toBeNull();
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

        // Upsert routine exercise with duration
        await upsertRoutineExercise(database, routineId, {
          exerciseId,
          order: 1,
          targetDurationSeconds: 300,
          warmupSets: 1,
        });

        // Create session
        await createSession(database, {
          sessionId,
          routineId,
          startedAtMs: Date.now(),
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

      // Log cardio warm-up via durationSeconds
      await database.write(async () => {
        await appendSet(database, sessionId, routineExerciseId, {
          setType: 'warmup',
          durationSeconds: 300,
        });
      });

      // Verify set has duration but null reps/weight
      const sets = await getSessionSets(database, sessionId);
      expect(sets).toHaveLength(1);
      expect(getField(sets[0], 'durationSeconds')).toBe(300);
      expect(getField(sets[0], 'setType')).toBe('warmup');
      expect(getField(sets[0], 'reps')).toBeNull();
      expect(getField(sets[0], 'weightKg')).toBeNull();
    }, 10000);
  });
});
