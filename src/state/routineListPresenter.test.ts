import { createTestDatabase } from '@/db/test-helpers';
import { routineListPresenter } from './routineListPresenter';

describe('routineListPresenter', () => {
  it('returns empty array when no routines exist', async () => {
    const db = await createTestDatabase();

    const routines = await routineListPresenter(db);

    expect(routines).toEqual([]);
  });

  it('returns list of routines with exercise counts', async () => {
    const db = await createTestDatabase();

    // Create a routine with exercises
    await db.write(async () => {
      const routine = await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Push Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'ex-1';
        e.title = 'Bench Press';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'ex-2';
        e.title = 'Incline Press';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-1';
        re._raw.order = 0;
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 4;
        re._raw.target_reps = 6;
        re._raw.rest_seconds = 120;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-2';
        re._raw.order = 1;
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
        re._raw.rest_seconds = 90;
      });
    });

    const routines = await routineListPresenter(db);

    expect(routines).toHaveLength(1);
    expect(routines[0]).toEqual({
      id: 'routine-1',
      name: 'Push Day',
      exerciseCount: 2,
      hasActiveExercise: true,
    });
  });

  it('reports hasActiveExercise: false when every exercise plans zero total sets', async () => {
    // Cardio/stretch entries (which parseWorkoutLine rejects sets×reps for)
    // validly carry no target_sets at all (AGENTS.md's zero-planned-set Boundaries rule) —
    // distinct from having no exercises at all, which exerciseCount already
    // covers.
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-all-zero';
        r.name = 'Recovery Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'rowing';
        e.title = 'Rowing';
        e._raw.kind = 'cardio';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-all-zero';
        re._raw.exercise_id = 'rowing';
        re._raw.order = 0;
        re._raw.target_duration_seconds = 1800;
      });
    });

    const routines = await routineListPresenter(db);

    expect(routines).toHaveLength(1);
    expect(routines[0]).toEqual({
      id: 'routine-all-zero',
      name: 'Recovery Day',
      exerciseCount: 1,
      hasActiveExercise: false,
    });
  });

  it('returns multiple routines sorted by creation order', async () => {
    const db = await createTestDatabase();

    const now = Date.now();

    // Create routines out of order to verify sort is load-bearing
    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-2';
        r.name = 'Routine 2';
        r._raw.created_at = now + 2000;
        r._raw.updated_at = now + 2000;
      });
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-0';
        r.name = 'Routine 0';
        r._raw.created_at = now;
        r._raw.updated_at = now;
      });
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Routine 1';
        r._raw.created_at = now + 1000;
        r._raw.updated_at = now + 1000;
      });
    });

    const routines = await routineListPresenter(db);

    expect(routines).toHaveLength(3);
    expect(routines[0].id).toBe('routine-0');
    expect(routines[1].id).toBe('routine-1');
    expect(routines[2].id).toBe('routine-2');
  });

  // ---- #276 Phase 3: "active" is a non-empty set list ---------------------

  it('reports hasActiveExercise: true from routine_sets rows alone, with zero counts', async () => {
    // The whole point of per-set: the plan is the set list. A row that
    // prescribes seven sets but whose (now vestigial) aggregate columns say
    // zero IS startable, and a presenter still summing the counts calls it
    // dead — which would render the routine as un-startable in Today.
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-ramp';
        r.name = 'Push';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await db.get('exercises').create((e: any) => {
        e._raw.id = 'bench-press-dumbbell';
        e.title = 'Bench Press (Dumbbell)';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      const re = await db.get('routine_exercises').create((row: any) => {
        row._raw.routine_id = 'routine-ramp';
        row._raw.exercise_id = 'bench-press-dumbbell';
        row._raw.order = 0;
        row._raw.warmup_sets = 0;
        row._raw.target_sets = 0;
      });
      for (const [order, setType] of ['warmup', 'warmup', 'normal'].entries()) {
        await db.get('routine_sets').create((row: any) => {
          row._raw.routine_exercise_id = re.id;
          row._raw.order = order;
          row._raw.set_type = setType;
        });
      }
    });

    const routines = await routineListPresenter(db);

    expect(routines[0]).toEqual({
      id: 'routine-ramp',
      name: 'Push',
      exerciseCount: 1,
      hasActiveExercise: true,
    });
  });

  it('does not credit one exercise’s sets to a different exercise’s row', async () => {
    // The set rows are keyed by routine_exercise_id; a presenter that queried
    // them by routine alone (or ignored the key) would report the empty
    // routine as startable.
    const db = await createTestDatabase();

    await db.write(async () => {
      for (const id of ['routine-has', 'routine-hasnt']) {
        await db.get('routines').create((r: any) => {
          r._raw.id = id;
          r.name = id;
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
      }
      await db.get('exercises').create((e: any) => {
        e._raw.id = 'squat';
        e.title = 'Squat';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      const withSets = await db.get('routine_exercises').create((row: any) => {
        row._raw.routine_id = 'routine-has';
        row._raw.exercise_id = 'squat';
        row._raw.order = 0;
      });
      await db.get('routine_exercises').create((row: any) => {
        row._raw.routine_id = 'routine-hasnt';
        row._raw.exercise_id = 'squat';
        row._raw.order = 0;
      });
      await db.get('routine_sets').create((row: any) => {
        row._raw.routine_exercise_id = withSets.id;
        row._raw.order = 0;
        row._raw.set_type = 'normal';
      });
    });

    const byId = new Map((await routineListPresenter(db)).map((r) => [r.id, r]));
    expect(byId.get('routine-has')?.hasActiveExercise).toBe(true);
    expect(byId.get('routine-hasnt')?.hasActiveExercise).toBe(false);
  });
});
