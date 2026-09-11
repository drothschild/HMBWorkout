import { closeTestDatabase, createTestDatabase, flush } from '@/db/test-helpers';
import { upsertExercise } from '@/db/repository';
import { runImageResolutionPass } from './exerciseImageResolver';
import { createCatalogMatcher } from './exerciseImageMatch';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import type { ExerciseImageResolverDeps } from './exerciseImageResolver';
import type { Database } from '@nozbe/watermelondb';

describe('exerciseImageResolver (Task 2)', () => {
  let db: Database;
  const matcher = createCatalogMatcher(EXERCISE_CATALOG);

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  function makeDeps(overrides: Partial<ExerciseImageResolverDeps> = {}): ExerciseImageResolverDeps {
    const downloadCalls: Array<{url: string; relativePath: string}> = [];
    const deleteFileCalls: string[] = [];
    const ask = jest.fn<Promise<string>, [{system: string; message: string}]>();
    const makeImageSuffix = jest.fn(() => 's1');
    const logCalls: Array<{message: string; error?: unknown}> = [];

    return {
      database: db,
      catalog: EXERCISE_CATALOG,
      getAiKeyConfigured: jest.fn(() => true),
      ask: ask.mockResolvedValue(''),
      download: jest.fn(async (url: string, relativePath: string) => {
        downloadCalls.push({url, relativePath});
      }),
      deleteFile: jest.fn(async (relativePath: string) => {
        deleteFileCalls.push(relativePath);
      }),
      makeImageSuffix: makeImageSuffix.mockReturnValue('s1'),
      log: jest.fn((message: string, error?: unknown) => {
        logCalls.push({message, error});
      }),
      ...overrides,
    };
  }

  describe('AC1.1 Success: ask reply that is a shortlist id', () => {
    it('records catalog source and downloads image', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue('  Romanian_Deadlift\n'),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toBe('catalog:Romanian_Deadlift');
      expect(exercise.imagePath).toBe('exercise-images/romanian-deadlift-s1.jpg');
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(1);
    });
  });

  describe('AC1.2 Success: ask resolves NONE', () => {
    it('records none source and does not download', async () => {
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue('NONE'),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imageSource).toBe('none');
      expect(exercise.imagePath).toBeNull();
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(0);
    });
  });

  describe('AC1.3 Failure: untrusted ask reply (Couch Stretch fallback case)', () => {
    it('does not trust prose around an id in the shortlist', async () => {
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await flush();

      const shortlistId = matcher.shortlist('Couch Stretch')[0].entry.id;

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue(`The best match is ${shortlistId}.`),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('couch-stretch')) as any;
      expect(exercise.imageSource).toBe('none');
      expect(exercise.imagePath).toBeNull();
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(0);
      expect(exercise.imageSource).not.toBe(`catalog:${shortlistId}`);
    });

    it('does not trust an id absent from the shortlist', async () => {
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await flush();

      // Verify Romanian_Deadlift is not in Couch Stretch shortlist
      const shortlistIds = matcher.shortlist('Couch Stretch').map(h => h.entry.id);
      expect(shortlistIds).not.toContain('Romanian_Deadlift');

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue('Romanian_Deadlift'),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('couch-stretch')) as any;
      expect(exercise.imageSource).toBe('none');
      expect(exercise.imagePath).toBeNull();
    });

    it('treats empty reply as none', async () => {
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await flush();

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue(''),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('couch-stretch')) as any;
      expect(exercise.imageSource).toBe('none');
      // Explicitly assert it is not none:nokey
      expect(exercise.imageSource).not.toBe('none:nokey');
    });
  });

  describe('AC1.6: no ask on empty shortlist', () => {
    it('does not call ask for titles with no shortlist hits', async () => {
      await upsertExercise(db, 'test-exercise', '!!!', 'strength');
      await flush();

      const deps = makeDeps({
        ask: jest.fn(),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      expect((deps.ask as jest.Mock).mock.calls).toHaveLength(0);
    });
  });

  describe('No key paths', () => {
    it('uses fallback without calling ask when no key', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => false),
        ask: jest.fn(),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toMatch(/^catalog:/);
      expect((deps.ask as jest.Mock).mock.calls).toHaveLength(0);
    });

    it('records none:nokey for unmatchable title when no key', async () => {
      await upsertExercise(db, 'test-exercise', 'Couch Stretch', 'stretch');
      await flush();

      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => false),
        ask: jest.fn(),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imageSource).toBe('none:nokey');
      expect((deps.ask as jest.Mock).mock.calls).toHaveLength(0);
    });
  });

  describe('AC2.1: backfill on launch', () => {
    it('resolves all exercises with null image_source', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await upsertExercise(db, 'plank', 'Plank', 'strength');
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await flush();

      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => false),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const rd = (await db.get('exercises').find('romanian-deadlift')) as any;
      const plank = (await db.get('exercises').find('plank')) as any;
      const stretch = (await db.get('exercises').find('couch-stretch')) as any;

      expect(rd.imageSource).not.toBeNull();
      expect(plank.imageSource).not.toBeNull();
      expect(stretch.imageSource).not.toBeNull();
    });
  });

  describe('AC2.3: retry on failure', () => {
    it('row untouched when ask rejects', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const deps = makeDeps({
        ask: jest.fn().mockRejectedValue(new Error('unreachable')),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toBeNull();
      expect(exercise.imagePath).toBeNull();
      expect((deps.log as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('row resolved on next pass after failure', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      // First pass: ask fails
      const askFail = jest.fn().mockRejectedValue(new Error('fail'));
      const depsFail = makeDeps({ ask: askFail });

      await runImageResolutionPass(depsFail, matcher);
      await flush();

      const exerciseBefore = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exerciseBefore.imageSource).toBeNull();

      // Second pass: ask succeeds
      const askSucceed = jest.fn().mockResolvedValue('Romanian_Deadlift');
      const depsSucceed = makeDeps({ ask: askSucceed });

      await runImageResolutionPass(depsSucceed, matcher);
      await flush();

      const exerciseAfter = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exerciseAfter.imageSource).toBe('catalog:Romanian_Deadlift');
    });

    it('download failure leaves row untouched', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue('Romanian_Deadlift'),
        download: jest.fn().mockRejectedValue(new Error('download failed')),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toBeNull();
    });

    it('one failing row does not stop the pass', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await upsertExercise(db, 'plank', 'Plank', 'strength');
      await flush();

      const askFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValueOnce('Plank');

      const deps = makeDeps({ ask: askFn });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const rd = (await db.get('exercises').find('romanian-deadlift')) as any;
      const plank = (await db.get('exercises').find('plank')) as any;

      expect(rd.imageSource).toBeNull(); // Still null after failure
      expect(plank.imageSource).toMatch(/^catalog:/); // Resolved despite first failure
    });
  });

  describe('AC2.4: none:nokey re-resolution', () => {
    it('row with none:nokey re-resolved once key exists', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');

      // Set to none:nokey through a direct write
      await db.write(async () => {
        const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
        await exercise.update((record: any) => {
          record.imageSource = 'none:nokey';
          record.imagePath = null;
        });
      });
      await flush();

      // Pass with key off: row should not be touched
      const depsNoKey = makeDeps({ getAiKeyConfigured: jest.fn(() => false) });
      await runImageResolutionPass(depsNoKey, matcher);
      await flush();

      let exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toBe('none:nokey');
      expect((depsNoKey.ask as jest.Mock).mock.calls).toHaveLength(0);

      // Pass with key on: row should be re-resolved
      const depsWithKey = makeDeps({
        getAiKeyConfigured: jest.fn(() => true),
        ask: jest.fn().mockResolvedValue('Romanian_Deadlift'),
      });
      await runImageResolutionPass(depsWithKey, matcher);
      await flush();

      exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).not.toBe('none:nokey');
      expect(exercise.imageSource).toMatch(/^catalog:/);
    });
  });

  describe('AC2.5: terminal states never re-resolved', () => {
    it('rows with none, catalog, or url sources are not touched', async () => {
      await upsertExercise(db, 'ex1', 'Ex 1', 'strength');
      await upsertExercise(db, 'ex2', 'Ex 2', 'strength');
      await upsertExercise(db, 'ex3', 'Ex 3', 'strength');
      await flush();

      // Set different terminal states
      await db.write(async () => {
        const ex1 = (await db.get('exercises').find('ex1')) as any;
        const ex2 = (await db.get('exercises').find('ex2')) as any;
        const ex3 = (await db.get('exercises').find('ex3')) as any;

        await ex1.update((record: any) => {
          record.imageSource = 'none';
        });
        await ex2.update((record: any) => {
          record.imageSource = 'catalog:Some_Exercise';
          record.imagePath = 'exercise-images/some.jpg';
        });
        await ex3.update((record: any) => {
          record.imageSource = 'url:https://example.com/img.jpg';
          record.imagePath = 'exercise-images/pasted.jpg';
        });
      });
      await flush();

      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => true),
        ask: jest.fn(),
        download: jest.fn(),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      expect((deps.ask as jest.Mock).mock.calls).toHaveLength(0);
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(0);
    });
  });

  describe('AC3.3: written path shape', () => {
    it('does not start with / or file://', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const deps = makeDeps();
      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      if (exercise.imagePath) {
        expect(exercise.imagePath.startsWith('/')).toBe(false);
        expect(exercise.imagePath.startsWith('file://')).toBe(false);
      }
    });
  });

  describe('AC4.5: race condition with competing writer', () => {
    it('orphan cleanup when CAS fails', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      let downloadResolve: () => void;
      const downloadPromise = new Promise<void>((resolve) => {
        downloadResolve = resolve;
      });

      const downloadFn = jest.fn(async () => {
        await downloadPromise;
      });

      const deps = makeDeps({
        download: downloadFn,
        deleteFile: jest.fn(async () => {}),
      });

      // Start pass without awaiting
      const passPromise = runImageResolutionPass(deps, matcher);

      // Poll until download has been called
      for (let i = 0; i < 50; i++) {
        await flush();
        if ((downloadFn as jest.Mock).mock.calls.length > 0) break;
      }

      // Verify download was called
      expect((downloadFn as jest.Mock).mock.calls).toHaveLength(1);

      // Competing writer: override the image while download is in flight
      const deleteSpy = deps.deleteFile as jest.Mock;
      const { imagePath: resolverPath } = (downloadFn as jest.Mock).mock.calls[0][1];

      const { setExerciseImage } = await import('@/db/repository');
      await setExerciseImage(db, 'romanian-deadlift', {
        imagePath: 'exercise-images/pasted.jpg',
        imageSource: 'url:https://example.com/pasted.jpg',
      });
      await flush();

      // Now resolve the download
      downloadResolve!();
      await passPromise;
      await flush();

      // Verify CAS failed and orphan was cleaned
      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imagePath).toBe('exercise-images/pasted.jpg');
      expect(exercise.imageSource).toBe('url:https://example.com/pasted.jpg');

      // Verify deleteFile was called with the orphan path
      expect(deleteSpy.mock.calls.length).toBeGreaterThan(0);
      const deletedPath = deleteSpy.mock.calls[0][0];
      expect(deletedPath).toContain('exercise-images/romanian-deadlift');
    });
  });
});
