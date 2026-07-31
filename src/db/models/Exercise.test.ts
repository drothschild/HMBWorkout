import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '../test-helpers';
import Exercise from './Exercise';

describe('Exercise model', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('reads description as null for a legacy row created before the column existed', async () => {
    // Simulates a pre-migration row: created without ever touching `description`,
    // exactly like every exercise row written before this column existed.
    await database.write(async () => {
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'legacy-exercise';
        e.title = 'Legacy Exercise';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
    });

    const exercise = (await database.get('exercises').find('legacy-exercise')) as Exercise;

    expect(exercise.description).toBeNull();
  });
});
