/**
 * #397: the App Store build disables every Bing caller unless
 * EXPO_PUBLIC_WEB_IMAGE_FALLBACK=1. `exerciseImageFiles.ts` cannot be imported
 * by jest (expo-file-system), so the wiring seam is `resolveWebImageSearch`,
 * and a source read pins that `createExerciseImageResolverDeps` uses it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { closeTestDatabase, createTestDatabase } from '@/db/test-helpers';
import { upsertExercise } from '@/db/repository';
import type Exercise from '@/db/models/Exercise';
import type { Database } from '@nozbe/watermelondb';
import { runImageResolutionPass, type ExerciseImageResolverDeps } from './exerciseImageResolver';
import { createCatalogMatcher } from './exerciseImageMatch';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import {
  resolveWebImageSearch,
  searchExerciseImageChoices,
  searchExerciseWebImages,
} from './exerciseWebImages';

const ON = { EXPO_PUBLIC_WEB_IMAGE_FALLBACK: '1' };
const OFF = {};

describe('resolveWebImageSearch', () => {
  it('is undefined with the flag off (unset, empty, "0", "true")', () => {
    for (const value of [undefined, '', '0', 'true']) {
      expect(resolveWebImageSearch({ EXPO_PUBLIC_WEB_IMAGE_FALLBACK: value })).toBeUndefined();
    }
  });

  it('is searchExerciseWebImages with the flag on', () => {
    expect(resolveWebImageSearch(ON)).toBe(searchExerciseWebImages);
  });
});

describe('createExerciseImageResolverDeps wiring', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'exerciseImageFiles.ts'), 'utf-8');

  it('takes searchWebImages from resolveWebImageSearch, not the Bing search directly', () => {
    expect(source).toContain('searchWebImages: resolveWebImageSearch(');
    expect(source).not.toContain('searchWebImages: searchExerciseWebImages');
  });
});

describe('resolution pass with the flag off', () => {
  let db: Database;
  beforeEach(() => { db = createTestDatabase(); });
  afterEach(async () => {
    jest.restoreAllMocks();
    await closeTestDatabase(db);
  });

  it.each([false, true])('makes no fetch call and writes none / none:nokey (key configured: %p)', async hasKey => {
    const fetchSpy = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    await upsertExercise(db, 'missing', 'Uncatalogued Movement Zzz', 'strength');
    const deps: ExerciseImageResolverDeps = {
      database: db,
      catalog: EXERCISE_CATALOG,
      getAiKeyConfigured: () => hasKey,
      ask: jest.fn().mockResolvedValue('NONE'),
      searchWebImages: resolveWebImageSearch(OFF),
      download: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      makeImageSuffix: () => 's1',
      log: jest.fn(),
    };
    await runImageResolutionPass(deps, createCatalogMatcher(EXERCISE_CATALOG));
    const row = await db.get<Exercise>('exercises').find('missing');
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(['none', 'none:nokey']).toContain(row.imageSource);
    expect(row.imageSource).not.toBe('web:none');
  });
});

describe('searchExerciseImageChoices', () => {
  it('resolves to an empty list and never calls its fetcher with the flag off', async () => {
    const fetcher = jest.fn();
    const result = await searchExerciseImageChoices('squat exercise', undefined, fetcher as unknown as typeof fetch, OFF);
    expect(result).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(0);
  });
});

describe('createExerciseImageResolverDeps wiring uses the build-time default env', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'exerciseImageFiles.ts'), 'utf-8');

  it('calls resolveWebImageSearch() with no argument so a forced-on env cannot be injected', () => {
    expect(source).toContain('searchWebImages: resolveWebImageSearch(),');
    expect(source).not.toMatch(/resolveWebImageSearch\(\s*\{/);
  });
});
