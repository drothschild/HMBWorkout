import type { Database } from '@nozbe/watermelondb';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import {
  EXERCISE_LIBRARY_CATALOG,
  EXERCISE_CATALOG,
  type CatalogEntry,
  type ExerciseLibraryEntry,
} from './exerciseCatalog';
import { seedExerciseCatalog } from './exerciseCatalogSeed';
import { createCatalogMatcher } from './exerciseImageMatch';
import { runImageResolutionPass } from './exerciseImageResolver';

describe('seedExerciseCatalog', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  it('creates every missing catalog exercise with mapped on-device metadata', async () => {
    const catalog: readonly ExerciseLibraryEntry[] = [
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
      {
        id: 'imageless-id-marker',
        name: 'Imageless title marker',
        category: 'strongman',
        equipment: 'kettlebell marker',
        primaryMuscles: ['triceps marker'],
        instructions: ['Imageless description marker'],
        image: null,
      },
    ];

    expect(await seedExerciseCatalog(db, catalog, 123_456)).toBe(4);

    const rows = (await db.get('exercises').query().fetch()) as any[];
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(rows).toHaveLength(4);
    expect(byId['strength-id-marker']._raw).toMatchObject({
      title: 'Strength title marker',
      kind: 'strength',
      muscle_group: 'quadriceps marker',
      equipment: 'barbell marker',
      description: 'Strength first line marker\nStrength second line marker',
      image_path: null,
      image_source: 'catalog:strength-id-marker',
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
      image_source: 'catalog:cardio-id-marker',
    });
    expect(byId['imageless-id-marker']._raw).toMatchObject({
      title: 'Imageless title marker',
      kind: 'strength',
      muscle_group: 'triceps marker',
      equipment: 'kettlebell marker',
      description: 'Imageless description marker',
      image_path: null,
      image_source: 'catalog:imageless-id-marker',
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

  it('loads all 876 entries from the pinned production library without resolving images', async () => {
    expect(await seedExerciseCatalog(db, EXERCISE_LIBRARY_CATALOG, 42)).toBe(876);
    const rows = (await db.get('exercises').query().fetch()) as any[];
    expect(rows).toHaveLength(876);
    expect(rows.filter((row) => row.imageSource?.startsWith('catalog:'))).toHaveLength(876);
    expect(rows.filter((row) => row.imageSource === null)).toHaveLength(0);
  });

  it('does not turn a production seed into model calls or image downloads', async () => {
    await seedExerciseCatalog(db, EXERCISE_LIBRARY_CATALOG, 42);
    const ask = jest.fn(async () => 'NONE');
    const download = jest.fn(async () => undefined);

    await runImageResolutionPass(
      {
        database: db,
        catalog: EXERCISE_CATALOG,
        getAiKeyConfigured: () => true,
        ask,
        download,
        deleteFile: async () => undefined,
        makeImageSuffix: () => 'seed',
        log: jest.fn(),
      },
      createCatalogMatcher(EXERCISE_CATALOG)
    );

    expect(ask).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});
