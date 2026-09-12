import { createTestDatabase } from '@/db/test-helpers';
import { createExercise } from './exerciseCreation';

describe('createExercise', () => {
  it('creates a normalized exercise with its title-derived slug and chosen kind', async () => {
    const database = await createTestDatabase();

    const outcome = await createExercise(database, {
      title: '  Dumbbell   Rear-Delt Fly  ',
      kind: 'strength',
    });

    expect(outcome).toStrictEqual({ kind: 'created', exerciseId: 'dumbbell-rear-delt-fly' });
    const exercise = await database.get('exercises').find('dumbbell-rear-delt-fly');
    expect({ title: (exercise as any).title, kind: (exercise as any).kind }).toStrictEqual({
      title: 'Dumbbell Rear-Delt Fly',
      kind: 'strength',
    });
  });

  it('rejects a title that cannot produce an exercise slug', async () => {
    const database = await createTestDatabase();

    await expect(createExercise(database, { title: '  !!! ', kind: 'cardio' })).resolves.toStrictEqual({
      kind: 'invalid-title',
    });
    await expect(database.get('exercises').query().fetchCount()).resolves.toBe(0);
  });

  it('reports a duplicate slug without changing the existing exercise', async () => {
    const database = await createTestDatabase();
    await database.write(async () => {
      await database.get('exercises').create((exercise: any) => {
        exercise._raw.id = 'farmer-s-carry';
        exercise.title = "Farmer's Carry";
        exercise.kind = 'strength';
        exercise._raw.created_at = Date.now();
      });
    });

    await expect(createExercise(database, { title: 'Farmer’s Carry', kind: 'cardio' })).resolves.toStrictEqual({
      kind: 'duplicate',
      exerciseId: 'farmer-s-carry',
    });

    const exercise = await database.get('exercises').find('farmer-s-carry');
    expect({ title: (exercise as any).title, kind: (exercise as any).kind }).toStrictEqual({
      title: "Farmer's Carry",
      kind: 'strength',
    });
  });
});
