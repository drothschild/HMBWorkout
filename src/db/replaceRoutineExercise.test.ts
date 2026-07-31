/**
 * Swapping the exercise on a routine entry, in place.
 *
 * A routine entry is identified by its `routine_exercises` row id — never by
 * `exercise_id` — because `session_sets.routine_exercise_id` references that
 * row. So the swap rewrites one column on the existing row; delete-and-recreate
 * would orphan every set ever logged against the entry.
 *
 * But that row is *permanent and shared by every past session*, so re-pointing
 * it must not rewrite history. The invariant these tests pin: sets logged
 * before a swap keep the identity they were recorded under, forever, across
 * however many sessions logged them. The fixtures are deliberately
 * multi-session — a session-scoped guard (setIndex == 0) says nothing about the
 * twelve weeks of history already hanging off the row, and a single-session
 * fixture would hide exactly that.
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

/** Weeks of history: three completed sessions, two working sets each. */
const PAST_SESSIONS = ['session-week-1', 'session-week-2', 'session-week-3'];

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

  /** Log `count` working sets against the entry, under the given identity. */
  async function logPastSessions(
    exerciseId: string | undefined,
    sessions: string[] = PAST_SESSIONS
  ): Promise<void> {
    for (const sessionId of sessions) {
      await createSession(database, {
        sessionId,
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });

      for (const reps of [6, 5]) {
        await appendSet(database, sessionId, rowId, {
          setType: 'working',
          reps,
          weightKg: 80,
          exerciseId,
        });
      }
    }
  }

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

    it('leaves history for the original exercise intact across every past session', async () => {
      await logPastSessions(ORIGINAL_EXERCISE);

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      // Six working sets across three sessions, all still the original's.
      const original = await getExerciseWorkingSetHistory(database, ORIGINAL_EXERCISE);
      expect(original).toHaveLength(6);
      expect(
        new Set(original.map((set) => (set as any).sessionId))
      ).toEqual(new Set(PAST_SESSIONS));
    });

    it('starts the substitute with no history at all', async () => {
      await logPastSessions(ORIGINAL_EXERCISE);

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      expect(await getExerciseWorkingSetHistory(database, REPLACEMENT_EXERCISE)).toHaveLength(0);
    });

    it('attributes sets logged after the swap to the substitute, and only those', async () => {
      await logPastSessions(ORIGINAL_EXERCISE);
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      await createSession(database, {
        sessionId: 'session-today',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-today', rowId, {
        setType: 'working',
        reps: 8,
        weightKg: 30,
        exerciseId: REPLACEMENT_EXERCISE,
      });

      const replacement = await getExerciseWorkingSetHistory(database, REPLACEMENT_EXERCISE);
      expect(replacement).toHaveLength(1);
      expect((replacement[0] as any).sessionId).toBe('session-today');

      expect(await getExerciseWorkingSetHistory(database, ORIGINAL_EXERCISE)).toHaveLength(6);
    });

    it('keeps every logged set attached to the row it was logged against', async () => {
      await logPastSessions(ORIGINAL_EXERCISE);

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const sets = await database.get('session_sets').query().fetch();
      expect(sets).toHaveLength(6);
      for (const set of sets) {
        expect((set as any)._raw.routine_exercise_id).toBe(rowId);
      }
    });

    it('freezes legacy sets — those written before exercise_id existed — at the old identity', async () => {
      // A row with no recorded identity is exactly what a pre-v3 install has.
      // The swap must stamp it before re-pointing, or the routine_exercises
      // join is the only identity it has left and it follows the substitute.
      await logPastSessions(undefined);

      const before = await database.get('session_sets').query().fetch();
      expect(before).toHaveLength(6);
      for (const set of before) {
        expect((set as any)._raw.exercise_id ?? null).toBeNull();
      }

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const after = await database.get('session_sets').query().fetch();
      for (const set of after) {
        expect((set as any)._raw.exercise_id).toBe(ORIGINAL_EXERCISE);
      }

      expect(await getExerciseWorkingSetHistory(database, ORIGINAL_EXERCISE)).toHaveLength(6);
      expect(await getExerciseWorkingSetHistory(database, REPLACEMENT_EXERCISE)).toHaveLength(0);
    });

    it('survives a second swap — history stays with whoever earned it', async () => {
      const THIRD_EXERCISE = 'machine-chest-press';
      await database.write(async () => {
        await database.get('exercises').create((e: any) => {
          e._raw.id = THIRD_EXERCISE;
          e.title = 'Machine Chest Press';
          e.kind = 'strength';
        });
      });

      // Legacy history under the original, then a swap...
      await logPastSessions(undefined, ['session-week-1']);
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      // ...work under the substitute, then a second swap.
      await createSession(database, {
        sessionId: 'session-week-2',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-week-2', rowId, {
        setType: 'working',
        reps: 8,
        exerciseId: REPLACEMENT_EXERCISE,
      });

      await updateRoutineExerciseExerciseId(database, rowId, THIRD_EXERCISE);

      expect(await getExerciseWorkingSetHistory(database, ORIGINAL_EXERCISE)).toHaveLength(2);
      expect(await getExerciseWorkingSetHistory(database, REPLACEMENT_EXERCISE)).toHaveLength(1);
      expect(await getExerciseWorkingSetHistory(database, THIRD_EXERCISE)).toHaveLength(0);
    });

    it('does not touch sets on other entries that happen to name the same exercise', async () => {
      let otherRowId = '';
      await database.write(async () => {
        const row = await database.get('routine_exercises').create((re: any) => {
          re.routineId = ROUTINE_ID;
          re.exerciseId = ORIGINAL_EXERCISE;
          re.order = 1;
          re.warmupSets = 0;
        });
        otherRowId = (row as any).id;
      });

      await createSession(database, {
        sessionId: 'session-week-1',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      // Legacy (unstamped) on both entries.
      await appendSet(database, 'session-week-1', rowId, { setType: 'working', reps: 6 });
      await appendSet(database, 'session-week-1', otherRowId, { setType: 'working', reps: 6 });

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const stamped = await database
        .get('session_sets')
        .query()
        .fetch();
      const byRow = new Map(
        stamped.map((set) => [(set as any)._raw.routine_exercise_id, (set as any)._raw.exercise_id])
      );
      // The swapped entry's set was frozen; the untouched entry's was left alone,
      // still resolving through the join.
      expect(byRow.get(rowId)).toBe(ORIGINAL_EXERCISE);
      expect(byRow.get(otherRowId) ?? null).toBeNull();

      // Both still read as the original's history: one by its stamp, one by the join.
      expect(await getExerciseWorkingSetHistory(database, ORIGINAL_EXERCISE)).toHaveLength(2);
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

    it('leaves logged sets untouched when it rejects the write', async () => {
      await logPastSessions(undefined, ['session-week-1']);

      await expect(updateRoutineExerciseExerciseId(database, rowId, '  ')).rejects.toThrow();

      const sets = await database.get('session_sets').query().fetch();
      for (const set of sets) {
        expect((set as any)._raw.exercise_id ?? null).toBeNull();
      }
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

    it('does not match an order that belongs to a different routine', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-other';
          r.name = 'Pull Day';
        });
        await database.get('routine_exercises').create((re: any) => {
          re.routineId = 'routine-other';
          re.exerciseId = ORIGINAL_EXERCISE;
          re.order = 0;
          re.warmupSets = 0;
        });
      });

      // Both routines have an entry at order 0; the pair is the key, not either half.
      expect(await findRoutineExerciseIdByOrder(database, ROUTINE_ID, 0)).toBe(rowId);
      expect(await findRoutineExerciseIdByOrder(database, 'routine-other', 0)).not.toBe(rowId);
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
