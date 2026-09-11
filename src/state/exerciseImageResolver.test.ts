import { closeTestDatabase, createTestDatabase, flush } from '@/db/test-helpers';
import { upsertExercise } from '@/db/repository';
import { runImageResolutionPass, startExerciseImageResolver } from './exerciseImageResolver';
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

describe('exerciseImageResolver scheduler (Task 3)', () => {
  let db: Database;
  const matcher = createCatalogMatcher(EXERCISE_CATALOG);

  beforeEach(() => {
    db = createTestDatabase();
  });

  function makeDeps(overrides: Partial<ExerciseImageResolverDeps> = {}): ExerciseImageResolverDeps & {
    getAiKeyConfigured: jest.Mock;
    ask: jest.Mock;
    log: jest.Mock;
    downloadCalls: readonly { url: string; relativePath: string }[];
    deleteFileCalls: string[];
    logCalls: readonly { message: string; error?: unknown }[];
  } {
    const downloadCalls: { url: string; relativePath: string }[] = [];
    const deleteFileCalls: string[] = [];
    const ask = jest.fn<Promise<string>, [{ system: string; message: string }]>();
    const getAiKeyConfigured = jest.fn(() => true);
    const makeImageSuffix = jest.fn(() => 's1');
    const logCalls: { message: string; error?: unknown }[] = [];

    const deps = {
      database: db,
      catalog: EXERCISE_CATALOG,
      getAiKeyConfigured,
      ask: ask.mockResolvedValue(''),
      download: jest.fn(async (url: string, relativePath: string) => {
        downloadCalls.push({ url, relativePath });
      }),
      deleteFile: jest.fn(async (relativePath: string) => {
        deleteFileCalls.push(relativePath);
      }),
      makeImageSuffix: makeImageSuffix.mockReturnValue('s1'),
      log: jest.fn((message: string, error?: unknown) => {
        logCalls.push({ message, error });
      }),
      ...overrides,
    };

    return {
      ...deps,
      getAiKeyConfigured: deps.getAiKeyConfigured as jest.Mock,
      ask: deps.ask as jest.Mock,
      log: deps.log as jest.Mock,
      downloadCalls,
      deleteFileCalls,
      logCalls,
    };
  }

  async function waitUntilIdle(
    getAiKeyConfiguredMock: jest.Mock,
    maxIterations: number = 200
  ): Promise<void> {
    let lastPassCount = getAiKeyConfiguredMock.mock.calls.length;
    let unchanged = 0;

    for (let i = 0; i < maxIterations; i++) {
      await flush();
      const currentPassCount = getAiKeyConfiguredMock.mock.calls.length;
      if (currentPassCount === lastPassCount) {
        unchanged++;
        if (unchanged >= 5) return;
      } else {
        unchanged = 0;
      }
      lastPassCount = currentPassCount;
    }
  }

  describe('AC2.1: observer backfill at launch', () => {
    it('initial subscribe resolves every null image_source row', async () => {
      // Seed before starting resolver
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await upsertExercise(db, 'plank', 'Plank', 'strength');
      await flush();

      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => false),
      });

      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const ex1 = (await db.get('exercises').find('romanian-deadlift')) as any;
      const ex2 = (await db.get('exercises').find('plank')) as any;

      expect(ex1.imageSource).not.toBeNull();
      expect(ex2.imageSource).not.toBeNull();

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });
  });

  describe('AC2.2: observer triggers on exercise creation', () => {
    it('creation through acceptDraft triggers resolution', async () => {
      const deps = makeDeps();
      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Create an exercise through acceptDraft
      const { acceptDraft } = await import('@/ai/acceptDraft');
      const draftRoutine = {
        name: 'Test Routine',
        exercises: [
          {
            title: 'Plank',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, reps: 10 }],
          },
        ],
      };

      await acceptDraft(db, draftRoutine, { kind: 'create' });
      await waitUntilIdle(deps.getAiKeyConfigured);

      // The new exercise should be resolved (has non-null image_source)
      const exercises = (await db.get('exercises').query().fetch()) as Array<any>;
      const newExercise = exercises.find((ex) => ex.title === 'Plank');
      expect(newExercise?.imageSource).not.toBeNull();

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });

    it('creation through applyRoutineImport triggers resolution', async () => {
      const deps = makeDeps();
      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const { applyRoutineImport } = await import('@/state/applyRoutineImport');
      const routine = {
        name: 'Imported Routine',
        exercises: [
          { id: 'couch-stretch', title: 'Couch Stretch', kind: 'stretch' as const },
        ],
        entries: [],
      };

      await applyRoutineImport(db, routine as any);
      await waitUntilIdle(deps.getAiKeyConfigured);

      // New exercise should be resolved
      const allExercises = (await db.get('exercises').query().fetch()) as Array<any>;
      const couch = allExercises.find((ex) => ex.title === 'Couch Stretch');
      expect(couch?.imageSource).not.toBeNull();

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });
  });

  describe('AC2.6: single-flight with coalescing', () => {
    it('multiple requests during a pass produce exactly one follow-up', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      let askResolve: (() => void) | undefined;
      const askPromise = new Promise<void>((resolve) => {
        askResolve = resolve;
      });

      const askMock = jest.fn(async () => {
        await askPromise;
        return 'Romanian_Deadlift';
      });

      const deps = makeDeps({
        ask: askMock,
      });

      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Verify first pass has started (ask called once)
      for (let i = 0; i < 50; i++) {
        await flush();
        if (askMock.mock.calls.length > 0) break;
      }
      const passCount1 = deps.getAiKeyConfigured.mock.calls.length;
      expect(askMock.mock.calls.length).toBe(1);

      // Request 5 times while pass is running
      resolver.request();
      resolver.request();
      resolver.request();
      resolver.request();
      resolver.request();

      // Pass count should not increase (still running)
      const passCount2 = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCount2).toBe(passCount1);

      // Release the ask
      askResolve!();
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Exactly one follow-up pass should have run. After pass 1 resolves the
      // exercise, the row becomes ineligible, so pass 2 finds nothing to do.
      // askMock is called once total (pass 1 only).
      const passCount3 = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCount3).toBe(passCount1 + 1);
      expect(askMock.mock.calls.length).toBe(1);

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });
  });

  describe('AC2.7: bounded pass count', () => {
    it('resolver does not loop indefinitely on a single exercise creation', async () => {
      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => false),
      });

      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCount0 = deps.getAiKeyConfigured.mock.calls.length;

      // Create exercise with no key
      await upsertExercise(db, 'plank', 'Plank', 'strength');
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCount1 = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCount1 - passCount0).toBeLessThanOrEqual(3);

      // After 10 more flushes, pass count should not increase
      for (let i = 0; i < 10; i++) {
        await flush();
      }
      const passCount2 = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCount2).toBe(passCount1);

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });

    it('bounded passes even with garbage ask reply', async () => {
      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue('???'),
      });

      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCount0 = deps.getAiKeyConfigured.mock.calls.length;

      // Create exercise that will get none result (garbage reply)
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCount1 = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCount1 - passCount0).toBeLessThanOrEqual(3);

      // Verify it ended in 'none', not 'none:nokey'
      const exercise = (await db.get('exercises').find('couch-stretch')) as any;
      expect(exercise.imageSource).toBe('none');

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });
  });

  describe('AC2.8: no failure escapes', () => {
    it('database fetch failure is swallowed', async () => {
      const deps = makeDeps();
      const realDb = deps.database;

      // Wrap database to throw once on fetch
      let throwNext = true;
      const brokenDeps = makeDeps({
        database: {
          ...realDb,
          get: (tableName: string) => {
            if (tableName === 'exercises' && throwNext) {
              throwNext = false;
              throw new Error('database fetch failed');
            }
            return realDb.get(tableName);
          },
          withChangesForTables: (tables: string[]) => realDb.withChangesForTables(tables),
        } as any,
      });

      const resolver = startExerciseImageResolver(brokenDeps);
      await waitUntilIdle(brokenDeps.getAiKeyConfigured);

      // Should have logged the failure
      expect(brokenDeps.logCalls.some((call) => call.message.includes('pass failed'))).toBe(true);

      // Create exercise and verify a later pass still runs
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      const passCountBefore = brokenDeps.getAiKeyConfigured.mock.calls.length;

      resolver.request();
      await waitUntilIdle(brokenDeps.getAiKeyConfigured);

      const passCountAfter = brokenDeps.getAiKeyConfigured.mock.calls.length;
      expect(passCountAfter).toBeGreaterThan(passCountBefore);

      resolver.stop();
      await waitUntilIdle(brokenDeps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });

    it('throwing logger does not escape scheduler (AC2.8b)', async () => {
      const deps = makeDeps({
        log: jest.fn(() => {
          throw new Error('log exploded');
        }),
      });

      // Seed one row that will fail (whose ask rejects)
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await flush();

      const ask = jest.fn<Promise<string>, [{ system: string; message: string }]>();
      ask.mockRejectedValueOnce(new Error('ask failed'));

      deps.ask = ask;

      const resolver = startExerciseImageResolver(deps);

      // Start should not throw even though log throws
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Now make ask work and create a new exercise
      ask.mockResolvedValueOnce('NONE');
      await upsertExercise(db, 'plank', 'Plank', 'strength');

      // This should complete without throwing
      await waitUntilIdle(deps.getAiKeyConfigured);

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);
      await closeTestDatabase(db);
    });

    it('request() after stop() is a no-op', async () => {
      const deps = makeDeps();
      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCountBefore = deps.getAiKeyConfigured.mock.calls.length;

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Create exercise after stop
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();

      const passCountAfter = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCountAfter).toBe(passCountBefore);

      await closeTestDatabase(db);
    });

    it('stop() unsubscribes from table changes', async () => {
      const deps = makeDeps();
      const resolver = startExerciseImageResolver(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      resolver.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCountBefore = deps.getAiKeyConfigured.mock.calls.length;

      // Create exercise after stop
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCountAfter = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCountAfter).toBe(passCountBefore);

      await closeTestDatabase(db);
    });
  });
});
