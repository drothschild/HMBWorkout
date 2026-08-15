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
  getRecentSessionSummaries,
  getSessionExerciseLog,
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

    // #225. The swap's three effects — stamp attached sets, clear the
    // prescription, re-point the row — must all land in ONE `database.write`.
    // The code is correct; nothing pinned it. Splitting the clear into a second
    // write left the whole suite green.
    //
    // Fault injection is the obvious way to test this and the repo has no
    // harness for it. But WatermelonDB's writer is a serialization primitive
    // over a FIFO queue, not a rollback-capable transaction, so the single-write
    // property has a *directly observable* consequence: no other writer can ever
    // see the row half-swapped. That is what this asserts.
    //
    // The interleaving is deterministic, not a race. The swap is started and
    // deliberately NOT awaited, then a competing writer is queued in the same
    // tick. Queue order is therefore [swap, observer] when the swap is one
    // write — the observer runs after it and sees the finished row. Split the
    // swap in two and the second write is only queued from the continuation
    // after the first resolves, i.e. AFTER the observer: order becomes
    // [swap-part-1, observer, swap-part-2] and the observer lands squarely in
    // the gap. Either half being deferred fails this, in both directions.
    it('never lets another writer observe a half-applied swap', async () => {
      // Legacy (null-stamped) sets, so all THREE effects have something to do.
      // Without them the stamping step is a no-op and hoisting it into its own
      // write would slip past this test.
      await logPastSessions(undefined);
      await database.write(async () => {
        const row = await database.get('routine_exercises').find(rowId);
        await row.update((r: any) => {
          r.targetWeightKg = 60;
        });
      });

      const observed: {
        exerciseId: string | null;
        targetWeightKg: number | null;
        stampedSets: number;
      }[] = [];

      const swap = updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);
      const observer = database.write(async () => {
        const row = (await database.get('routine_exercises').find(rowId)) as any;
        const sets = await database.get('session_sets').query().fetch();
        observed.push({
          exerciseId: row._raw.exercise_id ?? null,
          targetWeightKg: row._raw.target_weight_kg ?? null,
          stampedSets: sets.filter((s: any) => (s._raw.exercise_id ?? null) !== null).length,
        });
      });

      await Promise.all([swap, observer]);

      // All of it, or none of it. Never the re-point without the clear (a stale
      // prescribed load on a substitute, the case the clear exists to prevent),
      // never the clear without the re-point, and never the re-point without
      // the stamps (the PR #65 history-corruption shape).
      expect(observed).toStrictEqual([
        { exerciseId: REPLACEMENT_EXERCISE, targetWeightKg: null, stampedSets: 6 },
      ]);
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

  describe('getSessionExerciseLog after a swap', () => {
    // The history drilldown reads through this. A past session's sets must
    // render under the exercise they were performed as, not under whatever the
    // routine entry names today.
    it('titles a past session’s sets by the exercise they were logged as', async () => {
      await logPastSessions(ORIGINAL_EXERCISE, ['session-week-1']);

      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const log = await getSessionExerciseLog(database, 'session-week-1', ROUTINE_ID);

      expect(log).toHaveLength(1);
      expect(log[0].exerciseId).toBe(ORIGINAL_EXERCISE);
      expect(log[0].title).toBe('Barbell Bench Press');
      expect(log[0].sets).toHaveLength(2);
      // The entry is still the same routine row, and its prescription — which
      // belongs to the plan, not the exercise — is unchanged by the swap.
      expect(log[0].routineExerciseId).toBe(rowId);
      expect(log[0].targetSets).toBe(4);
      expect(log[0].targetReps).toBe(6);
    });

    it('titles a legacy set by the row’s exercise, the same fallback history uses', async () => {
      // Never swapped, so the row still names what the sets were performed as.
      await logPastSessions(undefined, ['session-week-1']);

      const log = await getSessionExerciseLog(database, 'session-week-1', ROUTINE_ID);

      expect(log[0].exerciseId).toBe(ORIGINAL_EXERCISE);
      expect(log[0].title).toBe('Barbell Bench Press');
      expect(log[0].sets).toHaveLength(2);
    });

    it('titles a session performed after the swap by the substitute', async () => {
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      await createSession(database, {
        sessionId: 'session-today',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-today', rowId, {
        setType: 'working',
        reps: 8,
        exerciseId: REPLACEMENT_EXERCISE,
      });

      const log = await getSessionExerciseLog(database, 'session-today', ROUTINE_ID);

      expect(log[0].exerciseId).toBe(REPLACEMENT_EXERCISE);
      expect(log[0].title).toBe('Dumbbell Floor Press');
      expect(log[0].sets).toHaveLength(1);
    });

    it('still reports a planned entry the session never logged, under its current name', async () => {
      // No sets at all for this entry: there is no performed identity to read,
      // so the plan's own name is the only honest answer.
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);
      await createSession(database, {
        sessionId: 'session-skipped',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });

      const log = await getSessionExerciseLog(database, 'session-skipped', ROUTINE_ID);

      expect(log).toHaveLength(1);
      expect(log[0].exerciseId).toBe(REPLACEMENT_EXERCISE);
      expect(log[0].title).toBe('Dumbbell Floor Press');
      expect(log[0].sets).toEqual([]);
    });

    it('keeps two entries of the same routine apart when only one was swapped', async () => {
      let secondRowId = '';
      await database.write(async () => {
        const row = await database.get('routine_exercises').create((re: any) => {
          re.routineId = ROUTINE_ID;
          re.exerciseId = ORIGINAL_EXERCISE;
          re.order = 1;
          re.warmupSets = 0;
        });
        secondRowId = (row as any).id;
      });

      await createSession(database, {
        sessionId: 'session-week-1',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-week-1', rowId, {
        setType: 'working',
        reps: 6,
        exerciseId: ORIGINAL_EXERCISE,
      });
      await appendSet(database, 'session-week-1', secondRowId, {
        setType: 'working',
        reps: 6,
        exerciseId: ORIGINAL_EXERCISE,
      });

      await updateRoutineExerciseExerciseId(database, secondRowId, REPLACEMENT_EXERCISE);

      const log = await getSessionExerciseLog(database, 'session-week-1', ROUTINE_ID);

      expect(log.map((entry) => [entry.routineExerciseId, entry.exerciseId])).toEqual([
        [rowId, ORIGINAL_EXERCISE],
        [secondRowId, ORIGINAL_EXERCISE],
      ]);
      expect(log.every((entry) => entry.sets.length === 1)).toBe(true);
    });
  });

  describe('getRecentSessionSummaries after a swap', () => {
    // exerciseCount is a count of DISTINCT exercises trained. Resolving that
    // through the routine_exercises join collapses two entries onto one
    // exercise the moment a swap makes them name the same movement — so a
    // finished workout that trained two exercises retroactively reports one.
    it('counts the exercises a past session actually trained, not the ones its routine names now', async () => {
      let secondRowId = '';
      await database.write(async () => {
        const row = await database.get('routine_exercises').create((re: any) => {
          re.routineId = ROUTINE_ID;
          re.exerciseId = REPLACEMENT_EXERCISE;
          re.order = 1;
          re.warmupSets = 0;
        });
        secondRowId = (row as any).id;
      });

      await createSession(database, {
        sessionId: 'session-week-1',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-week-1', rowId, {
        setType: 'working',
        reps: 6,
        exerciseId: ORIGINAL_EXERCISE,
      });
      await appendSet(database, 'session-week-1', secondRowId, {
        setType: 'working',
        reps: 10,
        exerciseId: REPLACEMENT_EXERCISE,
      });
      await database.write(async () => {
        const session = await database.get('sessions').find('session-week-1');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      // Both entries now name the same exercise.
      await updateRoutineExerciseExerciseId(database, rowId, REPLACEMENT_EXERCISE);

      const [summary] = await getRecentSessionSummaries(database, 10);

      expect(summary.exerciseCount).toBe(2);
      expect(summary.workingSetCount).toBe(2);
    });

    it('still counts a routine’s duplicate entries as one exercise trained', async () => {
      // The rule the join was there to enforce, and which must survive: the
      // same movement listed twice is one exercise trained, not two.
      let secondRowId = '';
      await database.write(async () => {
        const row = await database.get('routine_exercises').create((re: any) => {
          re.routineId = ROUTINE_ID;
          re.exerciseId = ORIGINAL_EXERCISE;
          re.order = 1;
          re.warmupSets = 0;
        });
        secondRowId = (row as any).id;
      });

      await createSession(database, {
        sessionId: 'session-week-1',
        routineId: ROUTINE_ID,
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-week-1', rowId, {
        setType: 'working',
        reps: 6,
        exerciseId: ORIGINAL_EXERCISE,
      });
      await appendSet(database, 'session-week-1', secondRowId, {
        setType: 'working',
        reps: 6,
        exerciseId: ORIGINAL_EXERCISE,
      });
      await database.write(async () => {
        const session = await database.get('sessions').find('session-week-1');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      const [summary] = await getRecentSessionSummaries(database, 10);

      expect(summary.exerciseCount).toBe(1);
      expect(summary.workingSetCount).toBe(2);
    });

    it('falls back to the join for legacy sets, the priority order used everywhere', async () => {
      await logPastSessions(undefined, ['session-week-1']);
      await database.write(async () => {
        const session = await database.get('sessions').find('session-week-1');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      const [summary] = await getRecentSessionSummaries(database, 10);

      expect(summary.exerciseCount).toBe(1);
      expect(summary.workingSetCount).toBe(2);
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
