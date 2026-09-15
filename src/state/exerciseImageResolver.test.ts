import { closeTestDatabase, createTestDatabase, flush } from '@/db/test-helpers';
import { upsertExercise, setExerciseImage } from '@/db/repository';
import { runImageResolutionPass, startExerciseImageResolver } from './exerciseImageResolver';
import { createCatalogMatcher, type CatalogMatcher } from './exerciseImageMatch';
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
    const downloadCalls: { url: string; relativePath: string }[] = [];
    const deleteFileCalls: string[] = [];
    const ask = jest.fn<Promise<string>, [{ system: string; message: string }]>();
    const makeImageSuffix = jest.fn(() => 's1');
    const logCalls: { message: string; error?: unknown }[] = [];

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

      // Verify download URL is correct
      const downloadMock = deps.download as jest.Mock;
      expect(downloadMock.mock.calls).toHaveLength(1);
      const [url] = downloadMock.mock.calls[0];
      expect(url).toContain('exercises/Romanian_Deadlift/0.jpg');
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
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(0);
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
      expect(exercise.imagePath).toBeNull();
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(0);
    });

    it('hit-side case: fallback when ask returns absent id (threshold fallback)', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const shortlistIds = matcher.shortlist('Romanian Deadlift').map(h => h.entry.id);
      // Verify Barbell_Squat is not in the Romanian Deadlift shortlist
      expect(shortlistIds).not.toContain('Barbell_Squat');

      const deps = makeDeps({
        ask: jest.fn().mockResolvedValue('Barbell_Squat'),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      // When ask returns absent id, fallback to no-key behavior (threshold score):
      // the TOP shortlist hit, not merely some catalog entry.
      expect(exercise.imageSource).toBe('catalog:Romanian_Deadlift');
      expect(exercise.imagePath).toBe('exercise-images/romanian-deadlift-s1.jpg');
      expect((deps.download as jest.Mock).mock.calls).toHaveLength(1);
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
      const exercise = (await db.get('exercises').find('test-exercise')) as any;
      expect(exercise.imageSource).toBe('none');
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
      expect(exercise.imagePath).toBeTruthy();
      expect(exercise.imagePath.startsWith('/')).toBe(false);
      expect(exercise.imagePath.startsWith('file://')).toBe(false);
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

      // Verify deleteFile was called with the exact orphan path
      expect(deleteSpy).toHaveBeenCalledWith('exercise-images/romanian-deadlift-s1.jpg');
    });
  });

  describe('CAS write failure after a successful download', () => {
    /** A database whose FIRST write rejects; everything else is the real test database. */
    function databaseWithFailingFirstWrite(): { database: Database; write: jest.Mock } {
      const write = jest.fn((work: Parameters<Database['write']>[0]) => db.write(work));
      write.mockRejectedValueOnce(new Error('write failed'));
      const database = { get: (table: string) => db.get(table), write } as unknown as Database;
      return { database, write };
    }

    it('deletes the downloaded file and leaves the row eligible', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const { database, write } = databaseWithFailingFirstWrite();
      const deps = makeDeps({ database, ask: jest.fn().mockResolvedValue('Romanian_Deadlift') });

      await runImageResolutionPass(deps, matcher);
      await flush();

      expect(deps.download).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(1);
      expect(deps.deleteFile).toHaveBeenCalledTimes(1);
      expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/romanian-deadlift-s1.jpg');

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toBeNull();
      expect(exercise.imagePath).toBeNull();

      const logged = (deps.log as jest.Mock).mock.calls.map(([message]) => message as string);
      expect(logged).toContain('exercise image: resolving romanian-deadlift failed; will retry on a later pass');
    });

    it('a failing delete is logged and the write error still reaches the per-row catch', async () => {
      await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
      await flush();

      const { database } = databaseWithFailingFirstWrite();
      const deleteError = new Error('delete failed');
      const deps = makeDeps({
        database,
        ask: jest.fn().mockResolvedValue('Romanian_Deadlift'),
        deleteFile: jest.fn().mockRejectedValue(deleteError),
      });

      await runImageResolutionPass(deps, matcher);
      await flush();

      const calls = (deps.log as jest.Mock).mock.calls as [string, unknown][];
      const deleteLog = calls.find(([message]) => message.includes('exercise-images/romanian-deadlift-s1.jpg'));
      expect(deleteLog?.[1]).toBe(deleteError);
      const rowLog = calls.find(([message]) => message.includes('resolving romanian-deadlift failed'));
      expect((rowLog?.[1] as Error | undefined)?.message).toBe('write failed');

      const exercise = (await db.get('exercises').find('romanian-deadlift')) as any;
      expect(exercise.imageSource).toBeNull();
    });
  });
});

describe('explicit exercise image refresh (#376)', () => {
  let db: Database;
  const matcher = createCatalogMatcher(EXERCISE_CATALOG);

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  function makeDeps(overrides: Partial<ExerciseImageResolverDeps> = {}): ExerciseImageResolverDeps {
    return {
      database: db,
      catalog: EXERCISE_CATALOG,
      getAiKeyConfigured: jest.fn(() => true),
      ask: jest.fn().mockResolvedValue('Romanian_Deadlift'),
      download: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      makeImageSuffix: jest.fn(() => 'refresh'),
      log: jest.fn(),
      ...overrides,
    };
  }

  function refreshEntryPoint(deps: ExerciseImageResolverDeps, exerciseId: string): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- red-first optional entry point.
    const implementation = (require('./exerciseImageResolver') as {
      refreshExerciseImage?: (refreshDeps: ExerciseImageResolverDeps, refreshMatcher: CatalogMatcher, id: string) => Promise<unknown>;
    }).refreshExerciseImage;
    return implementation ? implementation(deps, matcher, exerciseId) : Promise.resolve({ kind: 'not-implemented' });
  }

  it('refreshes an explicit user image through the normal decision path only after the replacement downloads', async () => {
    await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
    await setExerciseImage(db, 'romanian-deadlift', {
      imagePath: 'exercise-images/manual-old.jpg',
      imageSource: 'user',
    });
    const deps = makeDeps({
      download: jest.fn(async () => {
        const before = (await db.get('exercises').find('romanian-deadlift')) as any;
        expect(before.imagePath).toBe('exercise-images/manual-old.jpg');
        expect(before.imageSource).toBe('user');
      }),
    });

    await expect(refreshEntryPoint(deps, 'romanian-deadlift')).resolves.toEqual({ kind: 'updated' });
    const row = (await db.get('exercises').find('romanian-deadlift')) as any;
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(row.imageSource).toBe('catalog:Romanian_Deadlift');
    expect(row.imagePath).toBe('exercise-images/romanian-deadlift-refresh.jpg');
    expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/manual-old.jpg');
  });

  it('keeps an existing user image when no new match is found', async () => {
    await upsertExercise(db, 'no-match', '!!!', 'strength');
    await setExerciseImage(db, 'no-match', {
      imagePath: 'exercise-images/manual-old.jpg',
      imageSource: 'user',
    });
    const deps = makeDeps();

    await expect(refreshEntryPoint(deps, 'no-match')).resolves.toEqual({ kind: 'no-match' });
    const row = (await db.get('exercises').find('no-match')) as any;
    expect(row.imageSource).toBe('user');
    expect(row.imagePath).toBe('exercise-images/manual-old.jpg');
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.deleteFile).not.toHaveBeenCalled();
  });

  it('keeps the existing image when downloading a new match fails', async () => {
    await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
    await setExerciseImage(db, 'romanian-deadlift', {
      imagePath: 'exercise-images/manual-old.jpg',
      imageSource: 'user',
    });
    const deps = makeDeps({
      download: jest.fn().mockRejectedValue(new Error('offline')),
    });

    await expect(refreshEntryPoint(deps, 'romanian-deadlift')).resolves.toEqual({ kind: 'failed' });
    const row = (await db.get('exercises').find('romanian-deadlift')) as any;
    expect(row.imageSource).toBe('user');
    expect(row.imagePath).toBe('exercise-images/manual-old.jpg');
    expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/romanian-deadlift-refresh.jpg');
  });

  it('preserves a competing user replacement with the same source and cleans the refresh orphan', async () => {
    await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
    await setExerciseImage(db, 'romanian-deadlift', {
      imagePath: 'exercise-images/manual-old.jpg',
      imageSource: 'user',
    });
    const deps = makeDeps({
      download: jest.fn(async () => {
        await setExerciseImage(db, 'romanian-deadlift', {
          imagePath: 'exercise-images/manual-new.jpg',
          imageSource: 'user',
        });
      }),
    });

    await expect(refreshEntryPoint(deps, 'romanian-deadlift')).resolves.toEqual({ kind: 'unchanged' });
    const row = (await db.get('exercises').find('romanian-deadlift')) as any;
    expect(row.imageSource).toBe('user');
    expect(row.imagePath).toBe('exercise-images/manual-new.jpg');
    expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/romanian-deadlift-refresh.jpg');
    expect(deps.deleteFile).not.toHaveBeenCalledWith('exercise-images/manual-new.jpg');
  });

  it('does not treat a replaced bundled catalog image as a Documents file', async () => {
    await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
    await setExerciseImage(db, 'romanian-deadlift', {
      imagePath: 'bundle:Romanian_Deadlift',
      imageSource: 'catalog:Romanian_Deadlift',
    });
    const deps = makeDeps();

    await expect(refreshEntryPoint(deps, 'romanian-deadlift')).resolves.toEqual({ kind: 'updated' });
    expect(deps.deleteFile).not.toHaveBeenCalledWith('bundle:Romanian_Deadlift');
  });

  it('returns busy while an explicit refresh for the same exercise is downloading', async () => {
    await upsertExercise(db, 'romanian-deadlift', 'Romanian Deadlift', 'strength');
    await setExerciseImage(db, 'romanian-deadlift', {
      imagePath: 'exercise-images/manual-old.jpg',
      imageSource: 'user',
    });

    let releaseDownload: (() => void) | undefined;
    const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve; });
    const deps = makeDeps({ download: jest.fn(() => downloadGate) });
    const resolver = startExerciseImageResolver(deps) as unknown as {
      refresh?: (exerciseId: string) => Promise<unknown>;
      stop(): void;
    };
    const refresh = resolver.refresh;
    if (!refresh) {
      await expect(Promise.resolve({ kind: 'not-implemented' })).resolves.toEqual({ kind: 'busy' });
      resolver.stop();
      return;
    }

    const first = refresh('romanian-deadlift');
    for (let attempt = 0; attempt < 20 && !(deps.download as jest.Mock).mock.calls.length; attempt++) {
      await flush();
    }
    await expect(refresh('romanian-deadlift')).resolves.toEqual({ kind: 'busy' });
    releaseDownload!();
    await expect(first).resolves.toEqual({ kind: 'updated' });
    resolver.stop();
  });
});

describe('exerciseImageResolver scheduler (Task 3)', () => {
  let db: Database;
  let resolver: ReturnType<typeof startExerciseImageResolver> | null = null;
  /** The deps the running resolver was started with; its getAiKeyConfigured call count is the pass count. */
  let currentDeps: { readonly getAiKeyConfigured: jest.Mock } | null = null;

  beforeEach(() => {
    db = createTestDatabase();
    resolver = null;
    currentDeps = null;
  });

  // Teardown per phase_04.md: stop() does not wait for an in-flight pass, and
  // closing the database under a writing pass is a flake source — so stop,
  // wait until the pass count settles, THEN close.
  afterEach(async () => {
    if (resolver !== null && currentDeps !== null) {
      resolver.stop();
      await waitUntilIdle(currentDeps.getAiKeyConfigured);
    }
    resolver = null;
    currentDeps = null;
    await closeTestDatabase(db);
  });

  function start(deps: ExerciseImageResolverDeps & { readonly getAiKeyConfigured: jest.Mock }) {
    currentDeps = deps;
    resolver = startExerciseImageResolver(deps);
    return resolver;
  }

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

      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const ex1 = (await db.get('exercises').find('romanian-deadlift')) as any;
      const ex2 = (await db.get('exercises').find('plank')) as any;

      expect(ex1.imageSource).not.toBeNull();
      expect(ex2.imageSource).not.toBeNull();
    });
  });

  describe('AC2.2: observer triggers on exercise creation', () => {
    it('creation through acceptDraft triggers resolution', async () => {
      const deps = makeDeps();
      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const { acceptDraft } = await import('@/ai/acceptDraft');

      // Create an exercise through acceptDraft
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
      const exercises = (await db.get('exercises').query().fetch()) as any[];
      const newExercise = exercises.find((ex) => ex.title === 'Plank');
      expect(newExercise).toBeDefined();
      expect(newExercise.imageSource).not.toBeNull();
    });

    it('creation through applyRoutineImport triggers resolution', async () => {
      const deps = makeDeps();
      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const { applyRoutineImport } = await import('@/state/applyRoutineImport');
      const { importRoutine } = await import('@/interop/importRoutine');
      // The document shape src/state/applyRoutineImport.test.ts imports.
      const markdown = `---\ntype: workout-routine\nid: routine-1\nname: Good\nupdated: 2026-08-16\ntags: []\ncreated: 2026-08-16\n---\n\n\`\`\`workout\n- back-squat: 1x5\n\`\`\`\n`;
      const parsed = importRoutine(markdown);
      if (!parsed.ok) throw new Error(`import refused: ${parsed.error.code}`);

      await applyRoutineImport(db, parsed.routine);
      await waitUntilIdle(deps.getAiKeyConfigured);

      // New exercise should be resolved
      const allExercises = (await db.get('exercises').query().fetch()) as any[];
      const imported = allExercises.find((ex) => ex.id === 'back-squat');
      expect(imported).toBeDefined();
      expect(imported.imageSource).not.toBeNull();
    });

    it('creation through ensureAlternateExercise triggers resolution', async () => {
      const deps = makeDeps();
      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const { ensureAlternateExercise } = await import('@/ai/acceptAlternate');

      // The alternate shape src/ai/acceptAlternate.test.ts uses: title + description.
      const alternate = {
        title: 'Dumbbell Floor Press',
        description: 'Press from the floor with elbows tucked, pausing when the triceps touch.',
      };

      const alternateExercise = await ensureAlternateExercise(db, alternate, 'strength');
      expect(alternateExercise).toEqual({
        exerciseId: 'dumbbell-floor-press',
        kind: 'strength',
      });
      await waitUntilIdle(deps.getAiKeyConfigured);

      // The new exercise should be resolved
      const allExercises = (await db.get('exercises').query().fetch()) as any[];
      const newExercise = allExercises.find((ex) => ex.id === alternateExercise.exerciseId);
      expect(newExercise).toBeDefined();
      expect(newExercise.imageSource).not.toBeNull();
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

      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Verify first pass has started (ask called once)
      for (let i = 0; i < 50; i++) {
        await flush();
        if (askMock.mock.calls.length > 0) break;
      }
      const passCount1 = deps.getAiKeyConfigured.mock.calls.length;
      expect(askMock.mock.calls.length).toBe(1);

      // Request 5 times while pass is running
      resolver!.request();
      resolver!.request();
      resolver!.request();
      resolver!.request();
      resolver!.request();

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
    });
  });

  describe('AC2.7: bounded pass count', () => {
    it('resolver does not loop indefinitely on a single exercise creation', async () => {
      const deps = makeDeps({
        getAiKeyConfigured: jest.fn(() => false),
      });

      start(deps);
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
    });

    it('bounded passes even with garbage ask reply', async () => {
      // ask replies after a macrotask, like a real network round trip, so every
      // pass spans timer turns. If the terminal outcome were none:nokey (the M5
      // mutant), the row would stay eligible and each write would trigger another
      // pass: waitUntilIdle gives up at its iteration cap and the <= 3 bound below
      // fails cleanly (~1.5 s) — the test does not hang.
      const askMock = jest.fn(() => new Promise<string>((r) => setTimeout(() => r('???'), 0)));

      const deps = makeDeps({
        ask: askMock,
      });

      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCount0 = deps.getAiKeyConfigured.mock.calls.length;

      // Create exercise that will get none result (garbage reply)
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCount1 = deps.getAiKeyConfigured.mock.calls.length;

      // The pass count must stay put across 10 more flushes while still subscribed.
      for (let i = 0; i < 10; i++) {
        await flush();
      }
      const passCount2 = deps.getAiKeyConfigured.mock.calls.length;

      // Quiesce before asserting on the database: no pass may still be writing.
      resolver!.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);

      expect(passCount1 - passCount0).toBeLessThanOrEqual(3);
      expect(passCount2).toBe(passCount1);

      // Verify it ended in 'none', not 'none:nokey'
      const exercise = (await db.get('exercises').find('couch-stretch')) as any;
      expect(exercise.imageSource).toBe('none');
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
          write: (fn: (cb: any) => Promise<any>) => realDb.write(fn),
          withChangesForTables: (tables: string[]) => realDb.withChangesForTables(tables),
        } as any,
      });

      start(brokenDeps);
      await waitUntilIdle(brokenDeps.getAiKeyConfigured);

      // Should have logged the failure
      expect(brokenDeps.logCalls.some((call) => call.message.includes('pass failed'))).toBe(true);

      // Create exercise and verify a later pass still runs
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      const passCountBefore = brokenDeps.getAiKeyConfigured.mock.calls.length;

      resolver!.request();
      await waitUntilIdle(brokenDeps.getAiKeyConfigured);

      const passCountAfter = brokenDeps.getAiKeyConfigured.mock.calls.length;
      expect(passCountAfter).toBeGreaterThan(passCountBefore);

      // The recovered pass must actually WRITE through the wrapper, not merely run.
      const recovered = (await db.get('exercises').find('test-exercise')) as any;
      expect(recovered.imageSource).not.toBeNull();
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

      // Make the first call reject, but subsequent calls resolve
      (deps.ask as jest.Mock).mockRejectedValueOnce(new Error('ask failed'));

      start(deps);

      // Start should not throw even though log throws
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Now make ask return NONE for subsequent calls
      (deps.ask as jest.Mock).mockResolvedValue('NONE');
      await upsertExercise(db, 'plank', 'Plank', 'strength');

      // This should complete without throwing
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Verify the plank row resolved successfully
      const plank = (await db.get('exercises').find('plank')) as any;
      expect(plank.imageSource).toBe('none');
    });

    it('a throwing logger in the per-row catch does not end the SAME pass early', async () => {
      // Both rows exist before start, so pass 1 (the subscribe emission) visits both.
      await upsertExercise(db, 'couch-stretch', 'Couch Stretch', 'stretch');
      await upsertExercise(db, 'plank', 'Plank', 'strength');
      await flush();

      const getAiKeyConfigured = jest.fn(() => true);
      // The pass number (= getAiKeyConfigured calls so far) at each ask. The
      // FIRST ask rejects, whichever row the fetch returned first, so this
      // holds regardless of query().fetch() ordering.
      const askPasses: number[] = [];
      const ask = jest.fn(async () => {
        askPasses.push(getAiKeyConfigured.mock.calls.length);
        if (askPasses.length === 1) throw new Error('ask failed');
        return 'NONE';
      });
      const log = jest.fn<void, [string, unknown?]>(() => {
        throw new Error('log exploded');
      });
      const deps = makeDeps({ getAiKeyConfigured, ask, log });

      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      // The first row's failure was routed through the (throwing) per-row logger ...
      expect(log.mock.calls.some(([message]) => message.startsWith('exercise image: resolving '))).toBe(true);
      // ... and the second row was STILL asked in pass 1. If the pass received the
      // raw logger instead of safeLog, its throw would escape the per-row catch and
      // end pass 1 there; with no write, no follow-up pass would ever come.
      expect(askPasses.slice(0, 2)).toEqual([1, 1]);
    });

    it('request() after stop() is a no-op', async () => {
      const deps = makeDeps();
      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCountBefore = deps.getAiKeyConfigured.mock.calls.length;

      resolver!.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);

      // Call request() after stop
      resolver!.request();
      await flush();

      const passCountAfter = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCountAfter).toBe(passCountBefore);
    });

    it('stop() unsubscribes from table changes', async () => {
      const deps = makeDeps();
      start(deps);
      await waitUntilIdle(deps.getAiKeyConfigured);

      resolver!.stop();
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCountBefore = deps.getAiKeyConfigured.mock.calls.length;

      // Create exercise after stop
      await upsertExercise(db, 'test-exercise', 'Test Exercise', 'strength');
      await flush();
      await waitUntilIdle(deps.getAiKeyConfigured);

      const passCountAfter = deps.getAiKeyConfigured.mock.calls.length;
      expect(passCountAfter).toBe(passCountBefore);
    });
  });
});
