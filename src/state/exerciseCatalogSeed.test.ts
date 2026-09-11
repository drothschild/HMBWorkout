import type { Database } from '@nozbe/watermelondb';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import type { CatalogEntry } from './exerciseCatalog';
import { seedExerciseCatalog } from './exerciseCatalogSeed';

describe('seedExerciseCatalog', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  it('creates every missing catalog exercise with mapped on-device metadata', async () => {
    const catalog: readonly CatalogEntry[] = [
      {
        id: 'strength-id-marker',
        name: 'Strength title marker',
        category: 'powerlifting',
        equipment: 'barbell marker',
        primaryMuscles: ['quadriceps marker', 'glutes marker'],
        instructions: ['Strength first line marker', 'Strength second line marker'],
        image: 'strength/image-marker.jpg',
      },
      {
        id: 'stretch-id-marker',
        name: 'Stretch title marker',
        category: 'stretching',
        equipment: null,
        primaryMuscles: ['hamstrings marker'],
        instructions: ['Stretch description marker'],
        image: 'stretch/image-marker.jpg',
      },
      {
        id: 'cardio-id-marker',
        name: 'Cardio title marker',
        category: 'cardio',
        equipment: 'machine marker',
        primaryMuscles: [],
        instructions: [],
        image: 'cardio/image-marker.jpg',
      },
    ];

    expect(await seedExerciseCatalog(db, catalog, 123_456)).toBe(3);

    const rows = (await db.get('exercises').query().fetch()) as any[];
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(rows).toHaveLength(3);
    expect(byId['strength-id-marker']._raw).toMatchObject({
      title: 'Strength title marker',
      kind: 'strength',
      muscle_group: 'quadriceps marker',
      equipment: 'barbell marker',
      description: 'Strength first line marker\nStrength second line marker',
      image_path: null,
      image_source: null,
      created_at: 123_456,
    });
    expect(byId['stretch-id-marker']._raw).toMatchObject({
      title: 'Stretch title marker',
      kind: 'stretch',
      muscle_group: 'hamstrings marker',
      equipment: null,
      description: 'Stretch description marker',
    });
    expect(byId['cardio-id-marker']._raw).toMatchObject({
      title: 'Cardio title marker',
      kind: 'cardio',
      muscle_group: null,
      equipment: 'machine marker',
      description: null,
    });
  });

  it('preserves an existing exercise and creates only missing rows on reruns', async () => {
    await db.write(async () => {
      await db.get('exercises').create((row: any) => {
        row._raw.id = 'existing-id';
        row.title = 'User title';
        row.kind = 'cardio';
        row.muscleGroup = 'user muscle';
        row.equipment = 'user equipment';
        row.description = 'User description';
        row.imagePath = 'exercise-images/user.jpg';
        row.imageSource = 'url:https://example.com/user.jpg';
        row._raw.created_at = 7;
      });
    });
    const catalog: readonly CatalogEntry[] = [
      {
        id: 'existing-id',
        name: 'Catalog title',
        category: 'strength',
        equipment: 'catalog equipment',
        primaryMuscles: ['catalog muscle'],
        instructions: ['Catalog description'],
        image: 'existing/image.jpg',
      },
      {
        id: 'missing-id',
        name: 'Missing title',
        category: 'strength',
        equipment: null,
        primaryMuscles: [],
        instructions: [],
        image: 'missing/image.jpg',
      },
    ];

    expect(await seedExerciseCatalog(db, catalog, 99)).toBe(1);
    expect(await seedExerciseCatalog(db, catalog, 100)).toBe(0);

    const existing = (await db.get('exercises').find('existing-id')) as any;
    expect(existing._raw).toMatchObject({
      title: 'User title',
      kind: 'cardio',
      muscle_group: 'user muscle',
      equipment: 'user equipment',
      description: 'User description',
      image_path: 'exercise-images/user.jpg',
      image_source: 'url:https://example.com/user.jpg',
      created_at: 7,
    });
    expect(await db.get('exercises').query().fetchCount()).toBe(2);
  });
});
