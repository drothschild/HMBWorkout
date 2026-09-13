import { closeTestDatabase, createTestDatabase, flush } from './test-helpers';
import {
  upsertExercise,
  setExerciseImageIfSourceUnchanged,
  setExerciseImage,
  getExerciseImagePaths,
} from './repository';
import type { Database } from '@nozbe/watermelondb';

describe('exerciseImageWrites (AC4.5)', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  describe('setExerciseImageIfSourceUnchanged (CAS)', () => {
    it('applies when the expected source matches (null → writes both columns, returns true)', async () => {
      // Seed an exercise with null image columns
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();

      // CAS should apply when expected is null
      const applied = await setExerciseImageIfSourceUnchanged(
        db,
        'test-exercise',
        null,
        {
          imagePath: 'exercise-images/test-s1.jpg',
          imageSource: 'catalog:Test_Exercise',
        }
      );
      await flush();

      expect(applied).toBe(true);

      // Verify both columns were written
      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imagePath).toBe('exercise-images/test-s1.jpg');
      expect(exercise.imageSource).toBe('catalog:Test_Exercise');
    });

    it('refuses when expected source does not match (row untouched, returns false)', async () => {
      // Seed with a URL source
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await db.write(async () => {
        const exercise = (await db.get('exercises').find('test-exercise')) as any;
        await exercise.update((record: any) => {
          record.imagePath = 'exercise-images/existing.jpg';
          record.imageSource = 'url:https://example.com/old.jpg';
        });
      });
      await flush();

      // CAS should fail when expected is null but row has url source
      const applied = await setExerciseImageIfSourceUnchanged(
        db,
        'test-exercise',
        null,
        {
          imagePath: 'exercise-images/test-s1.jpg',
          imageSource: 'catalog:Test_Exercise',
        }
      );
      await flush();

      expect(applied).toBe(false);

      // Verify row was not changed
      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imagePath).toBe('exercise-images/existing.jpg');
      expect(exercise.imageSource).toBe('url:https://example.com/old.jpg');
    });

    it('returns true and applies when expected source matches existing catalog', async () => {
      // Seed with a catalog source
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await db.write(async () => {
        const exercise = (await db.get('exercises').find('test-exercise')) as any;
        await exercise.update((record: any) => {
          record.imageSource = 'catalog:Old_Exercise';
        });
      });
      await flush();

      // CAS should apply when expected matches
      const applied = await setExerciseImageIfSourceUnchanged(
        db,
        'test-exercise',
        'catalog:Old_Exercise',
        {
          imagePath: 'exercise-images/test-s2.jpg',
          imageSource: 'catalog:New_Exercise',
        }
      );
      await flush();

      expect(applied).toBe(true);

      // Verify the new values were written
      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imagePath).toBe('exercise-images/test-s2.jpg');
      expect(exercise.imageSource).toBe('catalog:New_Exercise');
    });
  });

  describe('setExerciseImageIfUnchanged (source-and-path CAS)', () => {
    it('refuses a same-source write when a competing user path replaced the observed path', async () => {
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await setExerciseImage(db, 'test-exercise', {
        imagePath: 'exercise-images/manual-old.jpg',
        imageSource: 'user',
      });
      await setExerciseImage(db, 'test-exercise', {
        imagePath: 'exercise-images/manual-new.jpg',
        imageSource: 'user',
      });

      const setIfUnchanged = (require('./repository') as {
        setExerciseImageIfUnchanged?: (
          database: Database,
          exerciseId: string,
          expected: { imagePath: string | null; imageSource: string | null },
          next: { imagePath: string | null; imageSource: string }
        ) => Promise<boolean>;
      }).setExerciseImageIfUnchanged;
      const applied = await (setIfUnchanged
        ? setIfUnchanged(db, 'test-exercise', {
          imagePath: 'exercise-images/manual-old.jpg',
          imageSource: 'user',
        }, {
          imagePath: 'exercise-images/catalog.jpg',
          imageSource: 'catalog:Test_Exercise',
        })
        : Promise.resolve('not-implemented'));

      expect(applied).toBe(false);
      const row = (await db.get('exercises').find('test-exercise')) as any;
      expect(row.imagePath).toBe('exercise-images/manual-new.jpg');
      expect(row.imageSource).toBe('user');
    });
  });

  describe('setExerciseImage', () => {
    it('returns previous path (null first, then the earlier path on a second write)', async () => {
      // Seed an exercise with null image columns
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();

      // First write should return null
      const firstPrevious = await setExerciseImage(db, 'test-exercise', {
        imagePath: 'exercise-images/first.jpg',
        imageSource: 'catalog:Test_Exercise',
      });
      await flush();

      expect(firstPrevious).toBe(null);

      // Verify the write happened
      let exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imagePath).toBe('exercise-images/first.jpg');

      // Second write should return the previous path
      const secondPrevious = await setExerciseImage(db, 'test-exercise', {
        imagePath: 'exercise-images/second.jpg',
        imageSource: 'url:https://example.com/new.jpg',
      });
      await flush();

      expect(secondPrevious).toBe('exercise-images/first.jpg');

      // Verify the second write happened
      exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imagePath).toBe('exercise-images/second.jpg');
      expect(exercise.imageSource).toBe('url:https://example.com/new.jpg');
    });

    it('leaves the new values after writing', async () => {
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();

      await setExerciseImage(db, 'test-exercise', {
        imagePath: 'exercise-images/pasted.jpg',
        imageSource: 'url:https://example.com/pasted.jpg',
      });
      await flush();

      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imagePath).toBe('exercise-images/pasted.jpg');
      expect(exercise.imageSource).toBe('url:https://example.com/pasted.jpg');
    });

    it('is unconditional (does not check source before writing)', async () => {
      // Seed with a catalog source
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await db.write(async () => {
        const exercise = (await db.get('exercises').find('test-exercise')) as any;
        await exercise.update((record: any) => {
          record.imageSource = 'catalog:Original_Exercise';
        });
      });
      await flush();

      // Unconditional write should succeed even though source differs
      const previous = await setExerciseImage(db, 'test-exercise', {
        imagePath: 'exercise-images/override.jpg',
        imageSource: 'url:https://example.com/override.jpg',
      });
      await flush();

      expect(previous).toBe(null);

      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imageSource).toBe('url:https://example.com/override.jpg');
    });
  });

  describe('getExerciseImagePaths (#335)', () => {
    beforeEach(async () => {
      await upsertExercise(db, 'bench-press', 'Bench Press', 'strength');
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await setExerciseImage(db, 'bench-press', {
        imagePath: 'exercise-images/bench-press-a1.jpg',
        imageSource: 'catalog:Barbell_Bench_Press',
      });
      await flush();
    });

    it('maps a resolved exercise to its relative path and leaves an unresolved one out', async () => {
      const paths = await getExerciseImagePaths(db, ['bench-press', 'couch-stretch']);

      expect(paths).toEqual({ 'bench-press': 'exercise-images/bench-press-a1.jpg' });
      expect('couch-stretch' in paths).toBe(false);
    });

    it('leaves an unknown id out instead of throwing, and keeps reading the ids after it', async () => {
      const paths = await getExerciseImagePaths(db, ['no-such-exercise', 'bench-press']);

      expect(paths).toEqual({ 'bench-press': 'exercise-images/bench-press-a1.jpg' });
    });

    it('is unaffected by duplicate ids (a routine may list an exercise twice)', async () => {
      const paths = await getExerciseImagePaths(db, ['bench-press', 'couch-stretch', 'bench-press']);

      expect(paths).toEqual({ 'bench-press': 'exercise-images/bench-press-a1.jpg' });
    });

    it('returns an empty map for no ids', async () => {
      expect(await getExerciseImagePaths(db, [])).toEqual({});
    });
  });
});
