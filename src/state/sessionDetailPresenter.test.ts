import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, appendSet, updateRoutineExerciseExerciseId } from '@/db/repository';
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
    expect(detail!.exercises[0].sets[0].label).toBe('Warmup 1');
    expect(detail!.exercises[0].sets[1].setType).toBe('working');
    expect(detail!.exercises[0].sets[1].line).toBe('8 x 132.5lbs RPE: 7.5');
    expect(detail!.exercises[0].sets[1].label).toBe('Set 1');

    // Planned exercise that was skipped: present with an empty sets array,
    // not omitted — that it was planned and never logged is information.
    expect(detail!.exercises[1].title).toBe('Barbell Row');
    expect(detail!.exercises[1].routineExerciseId).toBe('re-row');
    expect(detail!.exercises[1].sets).toEqual([]);

    expect(detail!.otherSets).toEqual([]);
  });

  it('labels warmup and working sets independently with multiple sets per type', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    // Three warmup sets
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'warmup',
      reps: 10,
      weightKg: 20,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'warmup',
      reps: 8,
      weightKg: 40,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'warmup',
      reps: 5,
      weightKg: 50,
    });
    // Two working sets
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
      rpe: 7.5,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
      rpe: 8.0,
    });
    const endedAt = Date.now();
    await database.write(async () => {
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = endedAt;
      });
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    expect(detail!.exercises[0].sets).toHaveLength(5);

    // Three warmup sets labeled independently
    expect(detail!.exercises[0].sets[0].label).toBe('Warmup 1');
    expect(detail!.exercises[0].sets[0].setType).toBe('warmup');
    expect(detail!.exercises[0].sets[1].label).toBe('Warmup 2');
    expect(detail!.exercises[0].sets[1].setType).toBe('warmup');
    expect(detail!.exercises[0].sets[2].label).toBe('Warmup 3');
    expect(detail!.exercises[0].sets[2].setType).toBe('warmup');

    // Two working sets labeled independently
    expect(detail!.exercises[0].sets[3].label).toBe('Set 1');
    expect(detail!.exercises[0].sets[3].setType).toBe('working');
    expect(detail!.exercises[0].sets[4].label).toBe('Set 2');
    expect(detail!.exercises[0].sets[4].setType).toBe('working');
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

  it('renders a past session under the exercise performed, not the substitute swapped in later', async () => {
    // The history drilldown for a workout done weeks ago must not be rewritten
    // by a mid-session Replace that happened afterwards. The sets are stamped
    // with what they were performed as; the routine row has moved on.
    await seedRoutine();
    await database.write(async () => {
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-floor-press';
        e.title = 'Dumbbell Floor Press';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
    });

    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
      exerciseId: 'ex-bench',
    });
    await database.write(async () => {
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    await updateRoutineExerciseExerciseId(database, 're-bench', 'ex-floor-press');

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail!.exercises[0].title).toBe('Bench Press');
    expect(detail!.exercises[0].exerciseId).toBe('ex-bench');
    expect(detail!.exercises[0].sets).toHaveLength(1);
    expect(detail!.exercises[0].sets[0].line).toBe('8 x 132.5lbs');
    // The set is accounted for by a planned entry, so it is not swept into the
    // generically-labelled orphan list.
    expect(detail!.otherSets).toEqual([]);
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

  it('handles routine with zero routine_exercises rows: all sets land in otherSets', async () => {
    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = 'routine-empty';
        r.name = 'Empty Routine';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-push';
        e.title = 'Push';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
    });

    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-empty',
      startedAtMs: Date.now() - 60000,
    });

    // Log sets against a routine that has no routine_exercises
    // (This can happen if the routine was edited after the session)
    await database.write(async () => {
      await database.get('session_sets').create((s: any) => {
        s._raw.id = 'set-1';
        s.sessionId = 'session-1';
        s.routineExerciseId = 're-missing';
        s.setType = 'working';
        s.reps = 10;
        s.weightKg = 50;
        s.position = 0;
        s._raw.created_at = Date.now();
      });
      await database.get('session_sets').create((s: any) => {
        s._raw.id = 'set-2';
        s.sessionId = 'session-1';
        s.routineExerciseId = 're-missing';
        s.setType = 'working';
        s.reps = 8;
        s.weightKg = 50;
        s.position = 1;
        s._raw.created_at = Date.now();
      });
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    // No planned exercises
    expect(detail!.exercises).toHaveLength(0);
    // All sets are orphaned, numbered 1..n in position order
    expect(detail!.otherSets).toHaveLength(2);
    expect(detail!.otherSets[0].line).toBe('10 x 110lbs');
    expect(detail!.otherSets[1].line).toBe('8 x 110lbs');
    expect(detail!.otherSets[0].label).toBe('1');
    expect(detail!.otherSets[1].label).toBe('2');
  });

  it('returns null for endedAt when the session has not been marked ended', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    // Do not update ended_at, leaving it null (session still in progress)

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    expect(detail!.sessionId).toBe('session-1');
    expect(detail!.endedAt).toBeNull();
  });

  it('keeps duplicate-exercise entries as separate exercises with distinct routineExerciseIds', async () => {
    await seedRoutine();
    // Add the same exercise (Bench Press) a second time at order 2
    await database.write(async () => {
      await database.get('routine_exercises').create((re: any) => {
        re._raw.id = 're-bench-2';
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-bench';
        re._raw.order = 2;
        re._raw.warmup_sets = 0;
        re._raw.target_sets = 2;
        re._raw.target_reps = 10;
      });
    });

    await createSession(database, {
      sessionId: 'session-1',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });

    // Log different sets against each routine_exercises row
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });
    await appendSet(database, 'session-1', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });
    await appendSet(database, 'session-1', 're-bench-2', {
      setType: 'working',
      reps: 10,
      weightKg: 50,
    });

    await database.write(async () => {
      const session = await database.get('sessions').find('session-1');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    const detail = await sessionDetailPresenter(database, 'session-1');

    expect(detail).not.toBeNull();
    expect(detail!.exercises).toHaveLength(3);

    // First Bench Press entry (order 0) has 2 sets
    expect(detail!.exercises[0].title).toBe('Bench Press');
    expect(detail!.exercises[0].routineExerciseId).toBe('re-bench');
    expect(detail!.exercises[0].targetReps).toBe(8);
    expect(detail!.exercises[0].sets).toHaveLength(2);
    expect(detail!.exercises[0].sets[0].line).toBe('8 x 132.5lbs');
    expect(detail!.exercises[0].sets[1].line).toBe('8 x 132.5lbs');

    // Row entry (order 1) has 0 sets (skipped)
    expect(detail!.exercises[1].title).toBe('Barbell Row');
    expect(detail!.exercises[1].routineExerciseId).toBe('re-row');
    expect(detail!.exercises[1].sets).toHaveLength(0);

    // Second Bench Press entry (order 2) has 1 set
    expect(detail!.exercises[2].title).toBe('Bench Press');
    expect(detail!.exercises[2].routineExerciseId).toBe('re-bench-2');
    expect(detail!.exercises[2].targetReps).toBe(10);
    expect(detail!.exercises[2].sets).toHaveLength(1);
    expect(detail!.exercises[2].sets[0].line).toBe('10 x 110lbs');

    expect(detail!.otherSets).toEqual([]);
  });

  // ---- #276 Phase 3: the plan lookup moves to routine_sets ----------------

  it('carries the row’s prescribed set list, keyed by row id and not shared between rows', async () => {
    await seedRoutine();
    await database.write(async () => {
      // A ramp on the bench row; a single flat set on the row row. If the
      // presenter looked the plan up by anything other than the row id, the
      // two would cross.
      for (const [order, weight] of [9.07, 11.34, 18.14].entries()) {
        await database.get('routine_sets').create((row: any) => {
          row._raw.routine_exercise_id = 're-bench';
          row._raw.order = order;
          row._raw.set_type = 'warmup';
          row._raw.target_reps = 5;
          row._raw.target_weight_kg = weight;
        });
      }
      await database.get('routine_sets').create((row: any) => {
        row._raw.routine_exercise_id = 're-bench';
        row._raw.order = 3;
        row._raw.set_type = 'normal';
        row._raw.target_reps = 8;
        row._raw.target_weight_kg = 22.68;
      });
      await database.get('routine_sets').create((row: any) => {
        row._raw.routine_exercise_id = 're-row';
        row._raw.order = 0;
        row._raw.set_type = 'normal';
        row._raw.target_reps = 10;
      });
    });

    await createSession(database, {
      sessionId: 'session-plan',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-plan', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });

    const detail = await sessionDetailPresenter(database, 'session-plan');
    const bench = detail!.exercises.find((e) => e.routineExerciseId === 're-bench')!;
    const row = detail!.exercises.find((e) => e.routineExerciseId === 're-row')!;

    expect(bench.plannedSets.map((s) => s.targetWeightKg)).toEqual([9.07, 11.34, 18.14, 22.68]);
    expect(row.plannedSets).toEqual([{ setType: 'normal', targetReps: 10 }]);
  });

  it('reports plannedSets: [] for a row with no prescribed sets', async () => {
    await seedRoutine();
    await createSession(database, {
      sessionId: 'session-noplan',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-noplan', 're-bench', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });

    const detail = await sessionDetailPresenter(database, 'session-noplan');
    expect(detail!.exercises.every((e) => e.plannedSets.length === 0)).toBe(true);
  });
});
