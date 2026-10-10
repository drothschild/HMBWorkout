import { createTestDatabase } from '@/db/test-helpers';
import { createExercise, exerciseCreationMessage } from './exerciseCreation';

async function seed(database: any, id: string, title: string, kind: string) {
  await database.write(async () => {
    await database.get('exercises').create((exercise: any) => {
      exercise._raw.id = id;
      exercise.title = title;
      exercise.kind = kind;
      exercise._raw.created_at = 1000;
    });
  });
}

describe('createExercise (#379)', () => {
  it('trims the title and collapses internal whitespace', async () => {
    const database = createTestDatabase();
    const outcome = await createExercise(database, { title: '  Dumbbell   Rear-Delt \t Fly  ', kind: 'strength' });
    expect(outcome).toStrictEqual({ kind: 'created', exerciseId: 'dumbbell-rear-delt-fly' });
    const row: any = await database.get('exercises').find('dumbbell-rear-delt-fly');
    expect(row.title).toBe('Dumbbell Rear-Delt Fly');
  });

  it('returns invalid-title and writes no row when the title has no letters or digits', async () => {
    const database = createTestDatabase();
    await expect(createExercise(database, { title: '  !!! -- ', kind: 'cardio' })).resolves.toStrictEqual({
      kind: 'invalid-title',
    });
    await expect(createExercise(database, { title: '   ', kind: 'cardio' })).resolves.toStrictEqual({
      kind: 'invalid-title',
    });
    await expect(database.get('exercises').query().fetchCount()).resolves.toBe(0);
  });

  it('returns duplicate naming the existing exercise, writes nothing and leaves the row unchanged', async () => {
    const database = createTestDatabase();
    await seed(database, 'farmer-s-carry', "Farmer's Carry", 'strength');

    const outcome = await createExercise(database, { title: 'Farmer’s  Carry', kind: 'cardio' });

    expect(outcome).toStrictEqual({
      kind: 'duplicate',
      exerciseId: 'farmer-s-carry',
      existingTitle: "Farmer's Carry",
    });
    await expect(database.get('exercises').query().fetchCount()).resolves.toBe(1);
    const row: any = await database.get('exercises').find('farmer-s-carry');
    expect({ title: row.title, kind: row.kind, createdAt: row._raw.created_at }).toStrictEqual({
      title: "Farmer's Carry",
      kind: 'strength',
      createdAt: 1000,
    });
  });

  it('inserts exactly one row with id = slug, normalized title, chosen kind and created_at set', async () => {
    const database = createTestDatabase();
    const before = Date.now();
    const outcome = await createExercise(database, { title: ' Sled  Push ', kind: 'stretch' });
    expect(outcome).toStrictEqual({ kind: 'created', exerciseId: 'sled-push' });
    await expect(database.get('exercises').query().fetchCount()).resolves.toBe(1);
    const row: any = await database.get('exercises').find('sled-push');
    expect(row.title).toBe('Sled Push');
    expect(row.kind).toBe('stretch');
    expect(row._raw.created_at).toBeGreaterThanOrEqual(before);
  });
});

describe('exerciseCreationMessage (#379)', () => {
  it('gives an inline message for an invalid title', () => {
    expect(exerciseCreationMessage({ kind: 'invalid-title' })).toBe(
      'Enter a letter or number in the exercise name.'
    );
  });

  it('names the existing exercise for a duplicate', () => {
    expect(
      exerciseCreationMessage({ kind: 'duplicate', exerciseId: 'sled-push', existingTitle: 'Sled Push' })
    ).toContain('Sled Push');
  });

  it('has no message for a created exercise', () => {
    expect(exerciseCreationMessage({ kind: 'created', exerciseId: 'sled-push' })).toBeNull();
  });
});
