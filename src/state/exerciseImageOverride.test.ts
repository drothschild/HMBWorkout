import type { Database } from '@nozbe/watermelondb';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import { setExerciseImage, upsertExercise } from '@/db/repository';
import type Exercise from '@/db/models/Exercise';
import {
  exerciseImageOverrideMessage,
  overrideExerciseImage,
  parseImageUrl,
  replaceExerciseImageFromLocalUri,
} from './exerciseImageOverride';
import type { ExerciseImageOverrideDeps, LocalExerciseImageOverrideDeps } from './exerciseImageOverride';
import { NotAnImageError } from './imageSignature';

const EXERCISE_ID = 'bench-press';
const OLD_PATH = 'exercise-images/old-a.jpg';
const OLD_SOURCE = 'catalog:X';
const NEW_URL = 'https://example.com/p.jpg';
const NEW_PATH = 'exercise-images/bench-press-n1.jpg';

type Recorder = {
  readonly deps: ExerciseImageOverrideDeps;
  readonly downloadCalls: { url: string; relativePath: string }[];
  readonly deleteCalls: { path: string; rowPathAtDeleteTime: string | null }[];
  readonly logCalls: { message: string; error: unknown }[];
};

type LocalRecorder = {
  readonly deps: LocalExerciseImageOverrideDeps;
  readonly copyCalls: { uri: string; relativePath: string }[];
  readonly deleteCalls: { path: string; rowPathAtDeleteTime: string | null }[];
  readonly logCalls: { message: string; error: unknown }[];
};

async function readRow(db: Database, id: string): Promise<{ imagePath: string | null; imageSource: string | null }> {
  const row = (await db.get('exercises').find(id)) as Exercise;
  return { imagePath: row.imagePath ?? null, imageSource: row.imageSource ?? null };
}

function makeRecorder(
  db: Database,
  options: {
    readonly downloadError?: Error;
    readonly deleteError?: Error;
  } = {}
): Recorder {
  const downloadCalls: { url: string; relativePath: string }[] = [];
  const deleteCalls: { path: string; rowPathAtDeleteTime: string | null }[] = [];
  const logCalls: { message: string; error: unknown }[] = [];
  const deps: ExerciseImageOverrideDeps = {
    database: db,
    download: async (url, relativePath) => {
      downloadCalls.push({ url, relativePath });
      if (options.downloadError) throw options.downloadError;
    },
    // Reads the row AT CALL TIME, so the recorded path proves whether the row
    // write had already landed when the delete began (AC4.2 ordering).
    deleteFile: async (path) => {
      const row = await readRow(db, EXERCISE_ID);
      deleteCalls.push({ path, rowPathAtDeleteTime: row.imagePath });
      if (options.deleteError) throw options.deleteError;
    },
    makeImageSuffix: () => 'n1',
    log: (message, error) => {
      logCalls.push({ message, error });
    },
  };
  return { deps, downloadCalls, deleteCalls, logCalls };
}

function makeLocalRecorder(
  db: Database,
  options: { readonly copyError?: Error; readonly deleteError?: Error } = {}
): LocalRecorder {
  const copyCalls: { uri: string; relativePath: string }[] = [];
  const deleteCalls: { path: string; rowPathAtDeleteTime: string | null }[] = [];
  const logCalls: { message: string; error: unknown }[] = [];
  return {
    deps: {
      database: db,
      copy: async (uri, relativePath) => {
        copyCalls.push({ uri, relativePath });
        if (options.copyError) throw options.copyError;
      },
      deleteFile: async (path) => {
        const row = await readRow(db, EXERCISE_ID);
        deleteCalls.push({ path, rowPathAtDeleteTime: row.imagePath });
        if (options.deleteError) throw options.deleteError;
      },
      makeImageSuffix: () => 'n1',
      log: (message, error) => {
        logCalls.push({ message, error });
      },
    },
    copyCalls,
    deleteCalls,
    logCalls,
  };
}

describe('exercise image override — #335', () => {
  let db: Database;

  beforeEach(async () => {
    db = createTestDatabase();
    await upsertExercise(db, EXERCISE_ID, 'Bench Press', 'strength');
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  async function seedPreviousImage(): Promise<void> {
    await setExerciseImage(db, EXERCISE_ID, { imagePath: OLD_PATH, imageSource: OLD_SOURCE });
  }

  describe('AC4.3 parseImageUrl', () => {
    it.each([
      ['https://example.com/a.jpg', 'https://example.com/a.jpg'],
      ['http://example.com/a', 'http://example.com/a'],
      ['  https://x.y/z.png  ', 'https://x.y/z.png'],
      ['HTTPS://EXAMPLE.COM/A.JPG', 'HTTPS://EXAMPLE.COM/A.JPG'],
    ])('accepts %j', (raw, expectedUrl) => {
      expect(parseImageUrl(raw)).toStrictEqual({ kind: 'ok', url: expectedUrl });
    });

    it.each([
      'file:///var/mobile/a.jpg',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'example.com/a.jpg',
      'just some text',
      '',
      'https://',
      'https:// spaced.com/a.jpg',
      '//example.com/a.jpg',
      // Anchor fixtures: each carries a valid-looking http(s) run AFTER a bad
      // prefix or BEFORE a space, so dropping `^` or `$` from the pattern
      // accepts it. Without these, every other reject above still rejects
      // an unanchored pattern.
      "javascript:alert('https://evil.example')",
      'file:///a?u=https://x',
      'https://example.com/a b.jpg',
    ])('rejects %j', (raw) => {
      expect(parseImageUrl(raw)).toStrictEqual({ kind: 'invalid' });
    });
  });

  it('AC4.3: an invalid URL through the override downloads nothing and leaves the row unchanged', async () => {
    await seedPreviousImage();
    const rec = makeRecorder(db);

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, 'javascript:alert(1)');

    expect(outcome).toStrictEqual({ kind: 'invalid-url' });
    expect(rec.downloadCalls).toStrictEqual([]);
    expect(rec.deleteCalls).toStrictEqual([]);
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: OLD_PATH, imageSource: OLD_SOURCE });
  });

  it('AC4.2: downloads to a NEW file, writes the row, then deletes the previous file strictly after the write', async () => {
    await seedPreviousImage();
    const rec = makeRecorder(db);

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, NEW_URL);

    expect(outcome).toStrictEqual({ kind: 'saved', imagePath: NEW_PATH });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({
      imagePath: NEW_PATH,
      imageSource: 'url:https://example.com/p.jpg',
    });
    expect(rec.downloadCalls).toStrictEqual([{ url: NEW_URL, relativePath: NEW_PATH }]);
    // Exactly one delete, of the OLD path, and at that moment the row already
    // pointed at the new path — deletion strictly after the row write.
    expect(rec.deleteCalls).toStrictEqual([{ path: OLD_PATH, rowPathAtDeleteTime: NEW_PATH }]);
    // A new file, never an overwrite of the one a render may be reading.
    expect(NEW_PATH).not.toBe(OLD_PATH);
    expect(rec.logCalls).toStrictEqual([]);
  });

  it('AC4.2 edge: an exercise with no previous image saves and deletes nothing', async () => {
    const rec = makeRecorder(db);

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, NEW_URL);

    expect(outcome).toStrictEqual({ kind: 'saved', imagePath: NEW_PATH });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({
      imagePath: NEW_PATH,
      imageSource: 'url:https://example.com/p.jpg',
    });
    expect(rec.deleteCalls).toStrictEqual([]);
  });

  it('copies a selected local photo to a new owned file, records the user choice, then deletes the previous image', async () => {
    await seedPreviousImage();
    const rec = makeLocalRecorder(db);

    const outcome = await replaceExerciseImageFromLocalUri(rec.deps, EXERCISE_ID, 'file:///cache/chosen-photo.jpg');

    expect(outcome).toStrictEqual({ kind: 'saved', imagePath: NEW_PATH });
    expect(rec.copyCalls).toStrictEqual([{ uri: 'file:///cache/chosen-photo.jpg', relativePath: NEW_PATH }]);
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: NEW_PATH, imageSource: 'user' });
    expect(rec.deleteCalls).toStrictEqual([{ path: OLD_PATH, rowPathAtDeleteTime: NEW_PATH }]);
  });

  it('leaves the row and previous image untouched when copying the selected local photo fails', async () => {
    await seedPreviousImage();
    const copyError = new Error('disk full');
    const rec = makeLocalRecorder(db, { copyError });

    const outcome = await replaceExerciseImageFromLocalUri(rec.deps, EXERCISE_ID, 'file:///cache/chosen-photo.jpg');

    expect(outcome).toStrictEqual({ kind: 'copy-failed' });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: OLD_PATH, imageSource: OLD_SOURCE });
    expect(rec.deleteCalls).toStrictEqual([]);
    expect(rec.logCalls).toStrictEqual([
      { message: 'exercise image override: copy failed for bench-press', error: copyError },
    ]);
  });

  it('deletes only the new copied photo when its row write fails', async () => {
    await seedPreviousImage();
    const rec = makeLocalRecorder(db);
    const missingId = 'no-such-exercise';
    const missingPath = 'exercise-images/no-such-exercise-n1.jpg';

    await expect(
      replaceExerciseImageFromLocalUri(rec.deps, missingId, 'file:///cache/chosen-photo.jpg')
    ).rejects.toThrow(missingId);

    expect(rec.copyCalls).toStrictEqual([{ uri: 'file:///cache/chosen-photo.jpg', relativePath: missingPath }]);
    expect(rec.deleteCalls).toStrictEqual([{ path: missingPath, rowPathAtDeleteTime: OLD_PATH }]);
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: OLD_PATH, imageSource: OLD_SOURCE });
  });

  it('keeps the saved local photo when deleting the previous image fails, and logs the cleanup failure', async () => {
    await seedPreviousImage();
    const deleteError = new Error('EACCES');
    const rec = makeLocalRecorder(db, { deleteError });

    const outcome = await replaceExerciseImageFromLocalUri(rec.deps, EXERCISE_ID, 'file:///cache/chosen-photo.jpg');

    expect(outcome).toStrictEqual({ kind: 'saved', imagePath: NEW_PATH });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: NEW_PATH, imageSource: 'user' });
    expect(rec.logCalls).toStrictEqual([
      { message: `exercise image override: deleting previous ${OLD_PATH} failed`, error: deleteError },
    ]);
  });

  it('AC4.2 edge: never deletes the file the row now points at when the suffix repeats the previous path', async () => {
    await setExerciseImage(db, EXERCISE_ID, { imagePath: NEW_PATH, imageSource: OLD_SOURCE });
    const rec = makeRecorder(db);

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, NEW_URL);

    expect(outcome).toStrictEqual({ kind: 'saved', imagePath: NEW_PATH });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({
      imagePath: NEW_PATH,
      imageSource: 'url:https://example.com/p.jpg',
    });
    expect(rec.deleteCalls).toStrictEqual([]);
  });

  it('AC4.4: a failed download returns download-failed and leaves the row and previous file untouched', async () => {
    await seedPreviousImage();
    const downloadError = new Error('HTTP 404');
    const rec = makeRecorder(db, { downloadError });

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, NEW_URL);

    expect(outcome).toStrictEqual({ kind: 'download-failed' });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: OLD_PATH, imageSource: OLD_SOURCE });
    expect(rec.deleteCalls).toStrictEqual([]);
    expect(rec.logCalls).toStrictEqual([
      { message: 'exercise image override: download failed for bench-press', error: downloadError },
    ]);
  });

  it('AC4.4: a download that is not an image (a pasted page URL) returns download-failed and touches nothing', async () => {
    // The real download (exerciseImageFiles.ts) rejects with NotAnImageError
    // when the bytes fail looksLikeImageBytes, because downloadFileAsync checks
    // only the HTTP status. This pins that the override treats that rejection
    // like any failed download: the previous, working image survives.
    await seedPreviousImage();
    const downloadError = new NotAnImageError('https://example.com/some-page');
    const rec = makeRecorder(db, { downloadError });

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, 'https://example.com/some-page');

    expect(outcome).toStrictEqual({ kind: 'download-failed' });
    expect(exerciseImageOverrideMessage(outcome)).toBe(
      "Couldn't download that image. Use a direct https:// link to the image file."
    );
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: OLD_PATH, imageSource: OLD_SOURCE });
    expect(rec.deleteCalls).toStrictEqual([]);
    expect(rec.logCalls).toStrictEqual([
      { message: 'exercise image override: download failed for bench-press', error: downloadError },
    ]);
  });

  it('a deleteFile failure after a successful write still returns saved, and is logged', async () => {
    await seedPreviousImage();
    const deleteError = new Error('EACCES');
    const rec = makeRecorder(db, { deleteError });

    const outcome = await overrideExerciseImage(rec.deps, EXERCISE_ID, NEW_URL);

    expect(outcome).toStrictEqual({ kind: 'saved', imagePath: NEW_PATH });
    expect(await readRow(db, EXERCISE_ID)).toStrictEqual({
      imagePath: NEW_PATH,
      imageSource: 'url:https://example.com/p.jpg',
    });
    expect(rec.deleteCalls).toStrictEqual([{ path: OLD_PATH, rowPathAtDeleteTime: NEW_PATH }]);
    expect(rec.logCalls).toStrictEqual([
      {
        message: 'exercise image override: deleting previous exercise-images/old-a.jpg failed',
        error: deleteError,
      },
    ]);
  });

  describe('a row write that rejects after a successful download', () => {
    // No such row, so setExerciseImage's find() rejects AFTER the download
    // landed. The error must reach the caller (the screen's catch-all is the
    // only thing that tells the user the save failed), and the file just
    // downloaded must not be left orphaned on disk.
    const MISSING_ID = 'no-such-exercise';
    const MISSING_PATH = 'exercise-images/no-such-exercise-n1.jpg';

    it('propagates the error and deletes only the just-downloaded file', async () => {
      // A real previous image on another row, so a delete of any path other
      // than the downloaded one is observable.
      await seedPreviousImage();
      const rec = makeRecorder(db);

      await expect(overrideExerciseImage(rec.deps, MISSING_ID, NEW_URL)).rejects.toThrow(MISSING_ID);

      expect(rec.downloadCalls).toStrictEqual([{ url: NEW_URL, relativePath: MISSING_PATH }]);
      expect(rec.deleteCalls.map((call) => call.path)).toStrictEqual([MISSING_PATH]);
      expect(await readRow(db, EXERCISE_ID)).toStrictEqual({ imagePath: OLD_PATH, imageSource: OLD_SOURCE });
      expect(rec.logCalls).toStrictEqual([]);
    });

    it('a failing cleanup delete is logged, and the ORIGINAL row-write error still propagates', async () => {
      const deleteError = new Error('EACCES');
      const rec = makeRecorder(db, { deleteError });

      const rejection = await overrideExerciseImage(rec.deps, MISSING_ID, NEW_URL).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(rejection).toBeInstanceOf(Error);
      expect(rejection).not.toBe(deleteError);
      expect((rejection as Error).message).toContain(MISSING_ID);
      expect(rec.deleteCalls.map((call) => call.path)).toStrictEqual([MISSING_PATH]);
      expect(rec.logCalls).toStrictEqual([
        {
          message: `exercise image override: row write failed for ${MISSING_ID}; deleting downloaded ${MISSING_PATH} failed`,
          error: deleteError,
        },
      ]);
    });
  });

  describe('exerciseImageOverrideMessage', () => {
    it.each([
      [{ kind: 'saved', imagePath: NEW_PATH } as const, 'Image updated.'],
      [{ kind: 'invalid-url' } as const, 'Enter an image URL that starts with http:// or https://.'],
      [
        { kind: 'download-failed' } as const,
        "Couldn't download that image. Use a direct https:// link to the image file.",
      ],
    ])('words %j exactly', (outcome, expected) => {
      expect(exerciseImageOverrideMessage(outcome)).toBe(expected);
    });
  });
});
