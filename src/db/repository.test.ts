import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import { createSession, appendSet, getSession, getSessionSets } from './repository';

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
});
