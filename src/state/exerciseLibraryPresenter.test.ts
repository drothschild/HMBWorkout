import { existsSync } from 'fs';
import { join } from 'path';
import { createTestDatabase } from '@/db/test-helpers';

const PRESENTER = join(__dirname, 'exerciseLibraryPresenter.ts');

describe('exerciseLibraryPresenter', () => {
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
