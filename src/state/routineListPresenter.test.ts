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
});
