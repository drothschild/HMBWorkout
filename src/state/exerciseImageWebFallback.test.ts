import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import { upsertExercise, setExerciseImage } from '@/db/repository';
import type Exercise from '@/db/models/Exercise';
import { runImageResolutionPass, type ExerciseImageResolverDeps } from './exerciseImageResolver';
import { createCatalogMatcher } from './exerciseImageMatch';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import type { Database } from '@nozbe/watermelondb';

// Intersection lets the first red run exercise today's resolver before the new dep exists.
type WebDeps = { -readonly [K in keyof ExerciseImageResolverDeps]: ExerciseImageResolverDeps[K] } & { searchWebImages: (title: string) => Promise<readonly string[]> };
describe('web fallback after a catalog miss', () => {
  let db: Database;
  let deps: WebDeps;
  const matcher = createCatalogMatcher(EXERCISE_CATALOG);
  const url = 'https://example.org/exercise.jpg';
  beforeEach(() => {
    db = createTestDatabase();
    let suffix = 0;
    deps = { database: db, catalog: EXERCISE_CATALOG, getAiKeyConfigured: () => false,
      ask: jest.fn().mockResolvedValue('NONE'), searchWebImages: jest.fn().mockResolvedValue([url]),
      download: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined),
      makeImageSuffix: () => `s${++suffix}`, log: jest.fn() };
  });
  afterEach(async () => closeTestDatabase(db));
  const row = () => db.get<Exercise>('exercises').find('missing');
  async function seed(source: string | null = null) {
    await upsertExercise(db, 'missing', 'Uncatalogued Movement Zzz', 'strength');
    if (source) await setExerciseImage(db, 'missing', {imagePath: null, imageSource: source});
  }
  it.each([null, 'none', 'none:nokey'])('backfills %s with a downloaded web image and becomes terminal', async source => {
    await seed(source);
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).toHaveBeenCalledTimes(1);
    expect((await row()).imageSource).toBe(`web:${url}`);
    expect((await row()).imagePath).toBe('exercise-images/missing-s1.jpg');
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).toHaveBeenCalledTimes(1);
  });
  it('uses the first available validated download, with a fresh file for each attempt', async () => {
    await seed();
    deps.searchWebImages = jest.fn().mockResolvedValue(['https://example.org/bad', url]);
    deps.download = jest.fn().mockRejectedValueOnce(new Error('Not an image')).mockResolvedValue(undefined);
    await runImageResolutionPass(deps, matcher);
    expect((await row()).imageSource).toBe(`web:${url}`);
    expect((await row()).imagePath).toBe('exercise-images/missing-s2.jpg');
    expect(deps.download).toHaveBeenCalledTimes(2);
  });
  it('stops after the first successful image', async () => {
    await seed();
    deps.searchWebImages = jest.fn().mockResolvedValue([url, 'https://example.org/second.jpg']);
    await runImageResolutionPass(deps, matcher);
    expect(deps.download).toHaveBeenCalledTimes(1);
  });
  it.each(['none', 'none:nokey'])('records an empty search once for %s and terminates', async source => {
    await seed(source);
    deps.searchWebImages = jest.fn().mockResolvedValue([]);
    await runImageResolutionPass(deps, matcher);
    expect((await row()).imageSource).toBe('web:none:nokey');
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).toHaveBeenCalledTimes(1);
  });
  it('retries a no-key web miss once a key exists, then becomes terminal with a key', async () => {
    await seed('web:none:nokey');
    deps.getAiKeyConfigured = () => true;
    deps.searchWebImages = jest.fn().mockResolvedValue([]);
    await runImageResolutionPass(deps, matcher);
    expect((await row()).imageSource).toBe('web:none');
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).toHaveBeenCalledTimes(1);
  });
  it.each(['search', 'download'])('preserves the row and retries after %s failure', async failure => {
    await seed('none');
    if (failure === 'search') deps.searchWebImages = jest.fn().mockRejectedValue(new Error('offline'));
    else deps.download = jest.fn().mockRejectedValue(new Error('offline'));
    await runImageResolutionPass(deps, matcher);
    expect((await row()).imageSource).toBe('none');
    expect((await row()).imagePath).toBeNull();
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).toHaveBeenCalledTimes(2);
  });
  it('preserves an override racing the download and removes the orphan', async () => {
    await seed();
    deps.download = jest.fn(async () => { await setExerciseImage(db, 'missing', {imagePath: 'manual.jpg', imageSource: 'url:https://example.org/manual.jpg'}); });
    await runImageResolutionPass(deps, matcher);
    expect((await row()).imagePath).toBe('manual.jpg');
    expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/missing-s1.jpg');
  });
  it.each(['url:https://example.org/manual.jpg', 'catalog:Romanian_Deadlift', 'web:https://example.org/old.jpg', 'unknown'])('protects existing %s', async source => {
    await seed(source);
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).not.toHaveBeenCalled();
    expect((await row()).imageSource).toBe(source);
  });
  it('keeps a catalog match first', async () => {
    await upsertExercise(db, 'missing', 'Dumbbell Chest Press', 'strength');
    await runImageResolutionPass(deps, matcher);
    expect((await row()).imageSource).toBe('catalog:Dumbbell_Bench_Press');
    expect(deps.searchWebImages).not.toHaveBeenCalled();
  });
  it('shares a search across sides but stores separate files', async () => {
    await upsertExercise(db, 'left', 'Uncatalogued Movement Zzz Left', 'strength');
    await upsertExercise(db, 'right', 'Uncatalogued Movement Zzz Right', 'strength');
    await runImageResolutionPass(deps, matcher);
    expect(deps.searchWebImages).toHaveBeenCalledTimes(1);
    expect(deps.download).toHaveBeenCalledTimes(2);
    const left = await db.get<Exercise>('exercises').find('left');
    const right = await db.get<Exercise>('exercises').find('right');
    expect(left.imageSource).toBe(right.imageSource);
    expect(left.imagePath).not.toBe(right.imagePath);
  });
});
