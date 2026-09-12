import { existsSync } from 'fs';
import { join } from 'path';
import { createTestDatabase } from '@/db/test-helpers';

const PRESENTER = join(__dirname, 'exerciseLibraryPresenter.ts');

describe('exerciseLibraryPresenter', () => {
  it('filters library items by a trimmed case-insensitive title substring', () => {
    expect(existsSync(PRESENTER)).toBe(true);
    if (!existsSync(PRESENTER)) return;
    const { filterExerciseLibraryItems } = require(PRESENTER);
    const items = [
      { id: 'alpha', title: 'Alpha Press', kind: 'strength', imagePath: null },
      { id: 'beta', title: 'beta Stretch', kind: 'stretch', imagePath: null },
      { id: 'carry', title: "Farmer's Carry", kind: 'cardio', imagePath: null },
    ];

    expect(filterExerciseLibraryItems(items, '')).toBe(items);
    expect(filterExerciseLibraryItems(items, '   ')).toBe(items);
    expect(filterExerciseLibraryItems(items, '  PRESS ')).toEqual([items[0]]);
    expect(filterExerciseLibraryItems(items, 'stretch')).toEqual([items[1]]);
    expect(filterExerciseLibraryItems(items, 'press stretch')).toEqual([]);
  });

  it('returns every local exercise in case-insensitive title order with its display fields', async () => {
    expect(existsSync(PRESENTER)).toBe(true);
    if (!existsSync(PRESENTER)) return;
    const { exerciseLibraryPresenter } = require(PRESENTER);
    const db = await createTestDatabase();

    await db.write(async () => {
      for (const exercise of [
        { id: 'zeta', title: 'zeta carry', kind: 'cardio', imagePath: null },
        { id: 'alpha', title: 'Alpha Press', kind: 'strength', imagePath: 'exercise-images/alpha.jpg' },
        { id: 'beta', title: 'beta stretch', kind: 'stretch', imagePath: null },
      ] as const) {
        await db.get('exercises').create((row: any) => {
          row._raw.id = exercise.id;
          row.title = exercise.title;
          row.kind = exercise.kind;
          row.imagePath = exercise.imagePath;
          row._raw.created_at = Date.now();
        });
      }
    });

    await expect(exerciseLibraryPresenter(db)).resolves.toEqual([
      {
        id: 'alpha',
        title: 'Alpha Press',
        kind: 'strength',
        imagePath: 'exercise-images/alpha.jpg',
      },
      { id: 'beta', title: 'beta stretch', kind: 'stretch', imagePath: null },
      { id: 'zeta', title: 'zeta carry', kind: 'cardio', imagePath: null },
    ]);
  });

  it('returns an empty list when no exercises are loaded', async () => {
    expect(existsSync(PRESENTER)).toBe(true);
    if (!existsSync(PRESENTER)) return;
    const { exerciseLibraryPresenter } = require(PRESENTER);
    const db = await createTestDatabase();

    await expect(exerciseLibraryPresenter(db)).resolves.toEqual([]);
  });
});
