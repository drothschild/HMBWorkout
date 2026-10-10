import type { Database } from '@nozbe/watermelondb';

import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import { upsertExercise } from '@/db/repository';
import { routineDetailPresenter } from './routineDetailPresenter';
import { ManualRoutineCreationError, createManualRoutine } from './manualRoutineCreation';

describe('createManualRoutine', () => {
  let db: Database;

  beforeEach(async () => {
    db = createTestDatabase();
    await upsertExercise(db, 'bench-press', 'Bench Press', 'strength');
    await upsertExercise(db, 'cable-row', 'Cable Row', 'strength');
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  it('creates a trimmed routine from catalog exercises in the selected order', async () => {
    const routineId = await createManualRoutine(db, {
      name: '  Upper body  ',
      exerciseIds: ['cable-row', 'bench-press'],
      createRoutineId: () => 'routine-manual',
    });

    const routine = await routineDetailPresenter(db, routineId);

    expect(routine).toMatchObject({
      id: 'routine-manual',
      name: 'Upper body',
      standaloneExercises: [
        { exerciseId: 'cable-row', order: 0, sets: [{ setType: 'normal' }] },
        { exerciseId: 'bench-press', order: 1, sets: [{ setType: 'normal' }] },
      ],
    });
  });

  it('rejects a blank name before writing a routine', async () => {
    await expect(
      createManualRoutine(db, {
        name: '  \n ',
        exerciseIds: ['bench-press'],
        createRoutineId: () => 'routine-blank',
      })
    ).rejects.toEqual(new ManualRoutineCreationError('Enter a routine name.'));

    expect(await db.get('routines').query().fetchCount()).toBe(0);
  });

  it('rejects a stale selection before writing a partial routine', async () => {
    await expect(
      createManualRoutine(db, {
        name: 'Upper body',
        exerciseIds: ['bench-press', 'missing-exercise'],
        createRoutineId: () => 'routine-stale',
      })
    ).rejects.toEqual(new ManualRoutineCreationError('That exercise is no longer available.'));

    expect(await db.get('routines').query().fetchCount()).toBe(0);
  });

  it('saves a named routine with no exercises as one routine and zero entries', async () => {
    const routineId = await createManualRoutine(db, {
      name: 'Empty plan',
      exerciseIds: [],
      createRoutineId: () => 'routine-empty',
    });

    expect(routineId).toBe('routine-empty');
    expect(await db.get('routines').query().fetchCount()).toBe(1);
    expect(await db.get('routine_exercises').query().fetchCount()).toBe(0);
  });

  it('creates one routine row and one routine_exercises row per editor row, preserving duplicates, with no new global exercise', async () => {
    const exercisesBefore = await db.get('exercises').query().fetchCount();

    await createManualRoutine(db, {
      name: 'Pull day',
      exerciseIds: ['cable-row', 'bench-press', 'cable-row'],
      createRoutineId: () => 'routine-dupes',
    });

    expect(await db.get('routines').query().fetchCount()).toBe(1);
    const rows = (await db.get('routine_exercises').query().fetch()) as unknown as {
      exerciseId: string;
      order: number;
    }[];
    expect(rows).toHaveLength(3);
    const ordered = [...rows].sort((a, b) => a.order - b.order);
    expect(ordered.map((r) => [r.order, r.exerciseId])).toEqual([
      [0, 'cable-row'],
      [1, 'bench-press'],
      [2, 'cable-row'],
    ]);
    expect(await db.get('exercises').query().fetchCount()).toBe(exercisesBefore);
  });
});
