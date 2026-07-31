/**
 * Swapping the exercise on a routine entry, in place.
 *
 * A routine entry is identified by its `routine_exercises` row id — never by
 * `exercise_id` — because `session_sets.routine_exercise_id` references that
 * row and `getExerciseWorkingSetHistory` joins through it. So the swap rewrites
 * one column on the existing row; delete-and-recreate would orphan every set
 * ever logged against the entry.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import {
  appendSet,
  createSession,
  findRoutineExerciseIdByOrder,
  getExerciseWorkingSetHistory,
  updateRoutineExerciseExerciseId,
} from './repository';

const ROUTINE_ID = 'routine-swap';
const ORIGINAL_EXERCISE = 'barbell-bench-press';
const REPLACEMENT_EXERCISE = 'dumbbell-floor-press';

describe('Repository: replacing a routine entry’s exercise in place', () => {
  let database: Database;
  let rowId: string;

  beforeEach(async () => {
    database = createTestDatabase();

    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = ROUTINE_ID;
        r.name = 'Push Day';
      });

      for (const [id, title] of [
        [ORIGINAL_EXERCISE, 'Barbell Bench Press'],
        [REPLACEMENT_EXERCISE, 'Dumbbell Floor Press'],
      ]) {
        await database.get('exercises').create((e: any) => {
          e._raw.id = id;
          e.title = title;
          e.kind = 'strength';
        });
      }

      const row = await database.get('routine_exercises').create((re: any) => {
        re.routineId = ROUTINE_ID;
        re.exerciseId = ORIGINAL_EXERCISE;
        re.order = 0;
        re.warmupSets = 1;
        re.targetSets = 4;
        re.targetReps = 6;
        re.restSeconds = 150;
      });
      rowId = (row as any).id;
    });
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('updateRoutineExerciseExerciseId', () => {
    it('rewrites exercise_id and keeps the row id', async () => {
      const updated = await updateRoutineExerciseExerciseId(
        database,
        rowId,
        REPLACEMENT_EXERCISE
      );

      expect((updated as any).id).toBe(rowId);
      expect((updated as any).exerciseId).toBe(REPLACEMENT_EXERCISE);

      const reread = await database.get('routine_exercises').find(rowId);
      expect((reread as any)._raw.exercise_id).toBe(REPLACEMENT_EXERCISE);
    });

    it('leaves the prescription alone — the swap changes identity only', async () => {
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const row = (await database.get('routine_exercises').find(rowId)) as any;
      expect(row._raw.order).toBe(0);
      expect(row.warmupSets).toBe(1);
      expect(row.targetSets).toBe(4);
      expect(row.targetReps).toBe(6);
      expect(row.restSeconds).toBe(150);
      expect(row._raw.routine_id).toBe(ROUTINE_ID);
    });

    it('does not add or remove rows', async () => {
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const rows = await database.get('routine_exercises').query().fetch();
      expect(rows).toHaveLength(1);
    });

    it('keeps logged sets attached to the row, so history follows the replacement', async () => {
      await createSession(database, {
        sessionId: 'session-swap',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-swap', rowId, {
        setType: 'working',
        reps: 6,
        weightKg: 80,
      });

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const sets = await database.get('session_sets').query().fetch();
      expect(sets).toHaveLength(1);
      expect((sets[0] as any)._raw.routine_exercise_id).toBe(rowId);

      // The join goes through routine_exercises.exercise_id, so the set now
      // reads as history for the replacement — and not for the original.
      expect(await getExerciseWorkingSetHistory(database, REPLACEMENT_EXERCISE)).toHaveLength(1);
      expect(await getExerciseWorkingSetHistory(database, ORIGINAL_EXERCISE)).toHaveLength(0);
    });

    it('throws when the row does not exist', async () => {
      await expect(
        updateRoutineExerciseExerciseId(database, 'no-such-row', REPLACEMENT_EXERCISE)
      ).rejects.toThrow();
    });

    it('rejects an empty exercise id rather than writing one', async () => {
      await expect(updateRoutineExerciseExerciseId(database, rowId, '  ')).rejects.toThrow(
        /exercise id/i
      );

      const row = (await database.get('routine_exercises').find(rowId)) as any;
      expect(row._raw.exercise_id).toBe(ORIGINAL_EXERCISE);
    });
  });

  describe('findRoutineExerciseIdByOrder', () => {
    it('resolves the row id from (routineId, order) — the canonical lookup', async () => {
      expect(await findRoutineExerciseIdByOrder(database, ROUTINE_ID, 0)).toBe(rowId);
    });

    it('returns null when nothing matches', async () => {
      expect(await findRoutineExerciseIdByOrder(database, ROUTINE_ID, 7)).toBeNull();
      expect(await findRoutineExerciseIdByOrder(database, 'other-routine', 0)).toBeNull();
    });

    it('distinguishes rows of the same routine by order, including duplicate exercises', async () => {
      let secondRowId = '';
      await database.write(async () => {
        const row = await database.get('routine_exercises').create((re: any) => {
          re.routineId = ROUTINE_ID;
          // Same exercise twice: the row id, not exercise_id, is the identity.
          re.exerciseId = ORIGINAL_EXERCISE;
          re.order = 1;
          re.warmupSets = 0;
        });
        secondRowId = (row as any).id;
      });

      expect(await findRoutineExerciseIdByOrder(database, ROUTINE_ID, 0)).toBe(rowId);
      expect(await findRoutineExerciseIdByOrder(database, ROUTINE_ID, 1)).toBe(secondRowId);

      await updateRoutineExerciseExerciseId(database, secondRowId, REPLACEMENT_EXERCISE);

      const first = (await database.get('routine_exercises').find(rowId)) as any;
      expect(first._raw.exercise_id).toBe(ORIGINAL_EXERCISE);
    });
  });
});
