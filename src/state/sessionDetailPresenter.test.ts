import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, appendSet } from '@/db/repository';
import { sessionDetailPresenter } from './sessionDetailPresenter';

describe('sessionDetailPresenter', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  async function seedRoutine() {
    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Push Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-bench';
        e.title = 'Bench Press';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-row';
        e.title = 'Barbell Row';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      // Created out of routine order to prove the presenter sorts by it.
      await database.get('routine_exercises').create((re: any) => {
        re._raw.id = 're-row';
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-row';
        re._raw.order = 1;
        re._raw.warmup_sets = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 10;
      });
      await database.get('routine_exercises').create((re: any) => {
        re._raw.id = 're-bench';
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-bench';
        re._raw.order = 0;
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
      });
    });
  }

  it('returns null when the session does not exist', async () => {
    const detail = await sessionDetailPresenter(database, 'nonexistent');
    expect(detail).toBeNull();
  });

  it('returns routine name, end date, and planned exercises in routine order with their logged sets (warmups included)', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'warmup',
      reps: 10,
      weightKg: 20,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
      rpe: 7.5,
    });
    // Barbell Row (order 1) was planned but never logged this session.
    const endedAt = Date.now();
    await database.write(async () => {
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = endedAt;
      });
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    expect(detail!.sessionId).toBe('session-1');
    expect(detail!.routineName).toBe('Push Day');
    expect(detail!.endedAt).toBe(endedAt);
    expect(detail!.exercises).toHaveLength(2);

    // Routine order, not creation order.
    expect(detail!.exercises[0].title).toBe('Bench Press');
    expect(detail!.exercises[0].routineExerciseId).toBe('re-bench');
    expect(detail!.exercises[0].targetSets).toBe(3);
    expect(detail!.exercises[0].targetReps).toBe(8);
    // Warmup set is included, not filtered out.
    expect(detail!.exercises[0].sets).toHaveLength(2);
    expect(detail!.exercises[0].sets[0].setType).toBe('warmup');
    expect(detail!.exercises[0].sets[0].line).toBe('10 x 44lbs');
    expect(detail!.exercises[0].sets[1].setType).toBe('working');
    expect(detail!.exercises[0].sets[1].line).toBe('8 x 132.5lbs RPE: 7.5');

    // Planned exercise that was skipped: present with an empty sets array,
    // not omitted — that it was planned and never logged is information.
    expect(detail!.exercises[1].title).toBe('Barbell Row');
    expect(detail!.exercises[1].routineExerciseId).toBe('re-row');
    expect(detail!.exercises[1].sets).toEqual([]);

    expect(detail!.otherSets).toEqual([]);
  });

  it('falls back to the routine id when the routine has been deleted, but still lists its exercises', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });
    await database.write(async () => {
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    // Routine deletion only removes the routines row; routine_exercises
    // survive as history carriers (deleteRoutine's documented contract).
    await database.write(async () => {
      const routine = await database.get('routines').find('routine-1');
      await routine.destroyPermanently();
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    // Same fallback convention as sessionHistoryPresenter: the raw routine id.
    expect(detail!.routineName).toBe('routine-1');
    expect(detail!.exercises).toHaveLength(2);
    expect(detail!.exercises[0].title).toBe('Bench Press');
    expect(detail!.exercises[0].sets).toHaveLength(1);
  });

  it('surfaces sets whose routine_exercise row no longer exists under otherSets instead of dropping them', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });
    await appendSet(database, 'session-1', 're-row', {
      setType: 'working',
      reps: 10,
      weightKg: 40,
    });
    await database.write(async () => {
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    // Simulate the routine being edited after the session ended: the
    // Barbell Row entry is removed from the routine, destroying its
    // routine_exercises row (upsertRoutine's reconciliation behavior).
    await database.write(async () => {
      const re = await database.get('routine_exercises').find('re-row');
      await re.destroyPermanently();
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    // The removed exercise no longer appears in the planned list...
    expect(detail!.exercises).toHaveLength(1);
    expect(detail!.exercises[0].title).toBe('Bench Press');
    // ...but its logged set is not silently lost.
    expect(detail!.otherSets).toHaveLength(1);
    expect(detail!.otherSets[0].line).toBe('10 x 88lbs');
  });

  it('filters the -1 RPE sentinel and renders duration-only sets, matching formatLoggedSetLine conventions', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    // RPE recorded as the host's -1 "absent" sentinel must not render.
    await database.write(async () => {
      await database.get('session_sets').create((s: any) => {
        s._raw.id = 'set-rpe-sentinel';
        s.sessionId = 'session-1';
        s.routineExerciseId = 're-bench';
        s.setType = 'working';
        s.reps = 5;
        s._raw.rpe = -1;
        s.position = 0;
        s._raw.created_at = Date.now();
      });
      // A duration-only (e.g. stretch/cardio) set with no reps/weight.
      await database.get('session_sets').create((s: any) => {
        s._raw.id = 'set-duration';
        s.sessionId = 'session-1';
        s.routineExerciseId = 're-bench';
        s.setType = 'stretch';
        s.durationSeconds = 30;
        s.position = 1;
        s._raw.created_at = Date.now();
      });
      // A set with no metrics logged at all.
      await database.get('session_sets').create((s: any) => {
        s._raw.id = 'set-empty';
        s.sessionId = 'session-1';
        s.routineExerciseId = 're-bench';
        s.setType = 'working';
        s.position = 2;
        s._raw.created_at = Date.now();
      });
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    const [rpeSentinelSet, durationSet, emptySet] = detail!.exercises[0].sets;
    expect(rpeSentinelSet.line).toBe('5 reps');
    expect(durationSet.line).toBe('30s');
    expect(emptySet.line).toBe('—');
  });
});
