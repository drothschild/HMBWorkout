import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { todayStartPresenter } from './todayStartPresenter';

interface SeedRoutine {
  id: string;
  name: string;
  exerciseCount: number;
  createdAt: number;
}

async function seedRoutine(db: Database, routine: SeedRoutine): Promise<void> {
  await db.write(async () => {
    await db.get('routines').create((r: any) => {
      r._raw.id = routine.id;
      r.name = routine.name;
      r._raw.created_at = routine.createdAt;
      r._raw.updated_at = routine.createdAt;
    });

    for (let order = 0; order < routine.exerciseCount; order++) {
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = routine.id;
        re._raw.exercise_id = `${routine.id}-ex-${order}`;
        re._raw.order = order;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
        re._raw.rest_seconds = 90;
      });
    }
  });
}

describe('todayStartPresenter', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  it('reports no routines when none are saved', async () => {
    const options = await todayStartPresenter(db);

    expect(options).toEqual({ kind: 'no-routines' });
  });

  it('offers every saved routine as a choice, in creation order', async () => {
    const now = Date.now();
    // Seed out of insertion order to verify sort is actually load-bearing
    await seedRoutine(db, {
      id: 'routine-pull',
      name: 'Pull Day',
      exerciseCount: 2,
      createdAt: now + 1000,
    });
    await seedRoutine(db, { id: 'routine-push', name: 'Push Day', exerciseCount: 1, createdAt: now });

    const options = await todayStartPresenter(db);

    expect(options).toEqual({
      kind: 'choose-routine',
      routines: [
        { id: 'routine-push', name: 'Push Day', exerciseCount: 1, startable: true },
        { id: 'routine-pull', name: 'Pull Day', exerciseCount: 2, startable: true },
      ],
    });
  });

  it('shows routines-need-exercises when all routines are unstartable (no exercises)', async () => {
    const now = Date.now();
    await seedRoutine(db, { id: 'routine-empty-1', name: 'Empty Day 1', exerciseCount: 0, createdAt: now });
    await seedRoutine(db, { id: 'routine-empty-2', name: 'Empty Day 2', exerciseCount: 0, createdAt: now + 1000 });

    const options = await todayStartPresenter(db);

    expect(options).toEqual({
      kind: 'routines-need-exercises',
      routines: [
        { id: 'routine-empty-1', name: 'Empty Day 1', exerciseCount: 0, startable: false },
        { id: 'routine-empty-2', name: 'Empty Day 2', exerciseCount: 0, startable: false },
      ],
    });
  });

  it('offers mixed routines when some are startable and others are not', async () => {
    const now = Date.now();
    await seedRoutine(db, { id: 'routine-empty', name: 'Empty Day', exerciseCount: 0, createdAt: now });
    await seedRoutine(db, { id: 'routine-full', name: 'Full Day', exerciseCount: 3, createdAt: now + 1000 });

    const options = await todayStartPresenter(db);

    expect(options).toEqual({
      kind: 'choose-routine',
      routines: [
        { id: 'routine-empty', name: 'Empty Day', exerciseCount: 0, startable: false },
        { id: 'routine-full', name: 'Full Day', exerciseCount: 3, startable: true },
      ],
    });
  });
});
