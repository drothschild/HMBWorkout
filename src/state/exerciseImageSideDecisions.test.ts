import type { Database } from '@nozbe/watermelondb';
import type Exercise from '@/db/models/Exercise';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise, setExerciseImage } from '@/db/repository';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import { createCatalogMatcher } from './exerciseImageMatch';
import { runImageResolutionPass, type ExerciseImageResolverDeps } from './exerciseImageResolver';

let database: Database;
const matcher = createCatalogMatcher(EXERCISE_CATALOG);
beforeEach(() => { database = createTestDatabase(); });
afterEach(async () => { await closeTestDatabase(database); });
function deps(overrides: Partial<ExerciseImageResolverDeps> = {}): ExerciseImageResolverDeps {
  let suffix = 0;
  return { database, catalog: EXERCISE_CATALOG, getAiKeyConfigured: () => true,
    ask: jest.fn().mockResolvedValue('NONE'), download: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined), makeImageSuffix: () => String(++suffix), log: jest.fn(), ...overrides };
}
async function add(id: string, title: string, imageSource: string | null = null) {
  await upsertExercise(database, id, title, 'strength');
  if (imageSource) await setExerciseImage(database, id, { imageSource, imagePath: imageSource.startsWith('catalog:') || imageSource.startsWith('url:') ? `exercise-images/${id}-old.jpg` : null });
}
async function row(id: string) { return database.get<Exercise>('exercises').find(id); }

it.each([
  ['Calf Stretch - Left', 'Calf Stretch - Right', 'Standing_Gastrocnemius_Calf_Stretch'],
  ['Doorway Biceps Stretch Right', 'Doorway Biceps Stretch Left', 'Standing_Biceps_Stretch'],
  ['Cross-Body Shoulder Stretch Left', 'Cross-Body Shoulder Stretch Right', 'Shoulder_Stretch'],
  ['Wall Calf Stretch (L)', 'Wall Calf Stretch (R)', 'Calf_Stretch_Hands_Against_Wall'],
])('shares one normalized pick for %s and %s', async (left, right, id) => {
  await add('left', left); await add('right', right);
  const d = deps({ ask: jest.fn().mockResolvedValueOnce(id).mockResolvedValue('NONE') });
  await runImageResolutionPass(d, matcher);
  expect((await row('left')).imageSource).toBe(`catalog:${id}`);
  expect((await row('right')).imageSource).toBe(`catalog:${id}`);
  expect(d.ask).toHaveBeenCalledTimes(1);
  expect((d.ask as jest.Mock).mock.calls[0][0].message.split('## Candidates')[0]).not.toMatch(/\b(left|right)\b|\([lr]\)/i);
  expect(d.download).toHaveBeenCalledTimes(2);
  expect((await row('left')).imagePath).not.toBe((await row('right')).imagePath);
});

it('caches NONE too and remains terminal on the next pass', async () => {
  await add('left', 'Calf Stretch Left'); await add('right', 'Calf Stretch Right');
  const d = deps();
  await runImageResolutionPass(d, matcher);
  expect(d.ask).toHaveBeenCalledTimes(1);
  expect((await row('left')).imageSource).toBe('none');
  expect((await row('right')).imageSource).toBe('none');
  await runImageResolutionPass(d, matcher);
  expect(d.ask).toHaveBeenCalledTimes(1);
});

it.each([true, false])('repairs terminal none from its existing sibling even with hasKey=%s', async hasKey => {
  await add('right', 'Calf Stretch Right', 'none');
  await add('left', 'Calf Stretch Left', 'catalog:Standing_Gastrocnemius_Calf_Stretch');
  const d = deps({ getAiKeyConfigured: () => hasKey });
  await runImageResolutionPass(d, matcher);
  expect((await row('right')).imageSource).toBe('catalog:Standing_Gastrocnemius_Calf_Stretch');
  expect(d.ask).not.toHaveBeenCalled();
  expect(d.download).toHaveBeenCalledTimes(1);
  await runImageResolutionPass(d, matcher);
  expect(d.download).toHaveBeenCalledTimes(1);
});

it('uses a persisted sibling when the other side is added on a later pass', async () => {
  await add('left', 'Calf Stretch Left');
  const d = deps({ ask: jest.fn().mockResolvedValueOnce('Standing_Gastrocnemius_Calf_Stretch').mockResolvedValue('NONE') });
  await runImageResolutionPass(d, matcher);
  await add('right', 'Calf Stretch Right');
  await runImageResolutionPass(d, matcher);
  expect((await row('right')).imageSource).toBe((await row('left')).imageSource);
  expect(d.ask).toHaveBeenCalledTimes(1);
});

it.each([null, 'none', 'none:nokey'])('resolves the established chest-press alias from %s without consulting the model', async source => {
  await add('press', 'Dumbbell Chest Press', source);
  const d = deps();
  await runImageResolutionPass(d, matcher);
  expect((await row('press')).imageSource).toBe('catalog:Dumbbell_Bench_Press');
  expect(d.ask).not.toHaveBeenCalled();
});

it('does not confuse variants, overwrite URLs, or retry unrelated terminal NONE', async () => {
  await add('left', 'Calf Stretch Left', 'catalog:Standing_Gastrocnemius_Calf_Stretch');
  await add('url', 'Calf Stretch Right', 'url:https://example.com/custom.jpg');
  await add('variant', 'Seated Calf Stretch Right', 'none');
  await add('unrelated', 'Dumbbell Incline Chest Press', 'none');
  await add('bare', 'Right', 'none');
  const d = deps(); await runImageResolutionPass(d, matcher);
  expect((await row('url')).imageSource).toBe('url:https://example.com/custom.jpg');
  for (const id of ['variant', 'unrelated', 'bare']) expect((await row(id)).imageSource).toBe('none');
  expect(d.download).not.toHaveBeenCalled(); expect(d.ask).not.toHaveBeenCalled();
});

it('does not arbitrate conflicting existing sibling catalog picks', async () => {
  await add('left', 'Calf Stretch Left', 'catalog:Standing_Gastrocnemius_Calf_Stretch');
  await add('right', 'Calf Stretch Right', 'catalog:Calf_Stretch_Hands_Against_Wall');
  await add('miss', 'Calf Stretch (L)', 'none');
  const d = deps(); await runImageResolutionPass(d, matcher);
  expect((await row('miss')).imageSource).toBe('none');
  expect(d.download).not.toHaveBeenCalled();
});

it('keeps failed repairs eligible and preserves a racing URL override', async () => {
  await add('left', 'Calf Stretch Left', 'catalog:Standing_Gastrocnemius_Calf_Stretch');
  await add('right', 'Calf Stretch Right', 'none');
  const d = deps({ download: jest.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
    await setExerciseImage(database, 'right', { imageSource: 'url:https://example.com/custom.jpg', imagePath: 'exercise-images/custom.jpg' });
  }) });
  await runImageResolutionPass(d, matcher);
  expect((await row('right')).imageSource).toBe('none');
  await runImageResolutionPass(d, matcher);
  expect((await row('right')).imageSource).toBe('url:https://example.com/custom.jpg');
  expect(d.download).toHaveBeenCalledTimes(2);
  expect(d.deleteFile).toHaveBeenCalledWith('exercise-images/right-2.jpg');
});

it('shares a rejected ask within a pass but retries on the next pass', async () => {
  await add('left', 'Calf Stretch Left'); await add('right', 'Calf Stretch Right');
  const d = deps({ ask: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('Standing_Gastrocnemius_Calf_Stretch') });
  await runImageResolutionPass(d, matcher);
  expect(d.ask).toHaveBeenCalledTimes(1);
  expect((await row('left')).imageSource).toBeNull();
  expect((await row('right')).imageSource).toBeNull();
  await runImageResolutionPass(d, matcher);
  expect(d.ask).toHaveBeenCalledTimes(2);
  expect((await row('left')).imageSource).toBe('catalog:Standing_Gastrocnemius_Calf_Stretch');
  expect((await row('right')).imageSource).toBe('catalog:Standing_Gastrocnemius_Calf_Stretch');
});

it('seeds missing sided rows with the corrected alias, regardless of row order', async () => {
  await add('left', 'Dumbbell Row Left', 'none');
  await add('base', 'Dumbbell Row', 'catalog:Dumbbell_Incline_Row');
  const d = deps(); await runImageResolutionPass(d, matcher);
  expect((await row('left')).imageSource).toBe('catalog:One-Arm_Dumbbell_Row');
  expect((await row('base')).imageSource).toBe('catalog:One-Arm_Dumbbell_Row');
  expect(d.ask).not.toHaveBeenCalled();
  expect(d.download).toHaveBeenCalledTimes(2);
});

it('does not reopen terminal misses for a duplicate group without side labels', async () => {
  await add('miss', 'Calf Stretch', 'none');
  await add('catalog', 'Calf Stretch', 'catalog:Standing_Gastrocnemius_Calf_Stretch');
  const d = deps(); await runImageResolutionPass(d, matcher);
  expect((await row('miss')).imageSource).toBe('none');
  expect(d.ask).not.toHaveBeenCalled();
  expect(d.download).not.toHaveBeenCalled();
});
