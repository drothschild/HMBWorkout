/**
 * The exercise-question prompt's description half: reads the exercise's
 * user-authored `description` straight off the `exercises` table, the same
 * way `getExerciseTitles` resolves titles — engine state carries only
 * exerciseId, so display/prompt data is resolved shell-side.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise } from '@/db/repository';
import { loadExerciseDescription } from './exerciseQuestionContext';

describe('loadExerciseDescription', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('returns the description when the exercise has one', async () => {
    await upsertExercise(database, 'bench-press', 'Bench Press', 'strength', 'Pause at the chest.');

    await expect(loadExerciseDescription(database, 'bench-press')).resolves.toBe(
      'Pause at the chest.'
    );
  });

  it('returns null when the exercise has no description', async () => {
    await upsertExercise(database, 'bench-press', 'Bench Press', 'strength');

    await expect(loadExerciseDescription(database, 'bench-press')).resolves.toBeNull();
  });

  it('returns null when the exercise no longer exists', async () => {
    await expect(loadExerciseDescription(database, 'does-not-exist')).resolves.toBeNull();
  });
});
