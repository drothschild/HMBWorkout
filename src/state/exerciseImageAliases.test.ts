import { createCatalogMatcher, decideByScore, NO_KEY_ACCEPT_SCORE } from './exerciseImageMatch';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import { runImageResolutionPass, type ExerciseImageResolverDeps } from './exerciseImageResolver';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise, setExerciseImage } from '@/db/repository';
import type Exercise from '@/db/models/Exercise';

const cases = [
  ['Dumbbell Lateral Raise', 'Dumbbell_Lying_Rear_Lateral_Raise', 'Side_Lateral_Raise'],
  ['dumbbell-row', 'Dumbbell_Incline_Row', 'One-Arm_Dumbbell_Row'],
  ['Glute Bridge', 'Barbell_Glute_Bridge', 'Butt_Lift_Bridge'],
];
const matcher = createCatalogMatcher(EXERCISE_CATALOG);

it.each([...cases, [' DB lateral raise ', '', 'Side_Lateral_Raise'], ['DB-Row', '', 'One-Arm_Dumbbell_Row']])(
  'matches the intended variant for %s without a key', (title, _wrong, correct) => {
    const hits = matcher.shortlist(title);
    expect(decideByScore(hits, { aiConsulted: false })).toEqual({
      kind: 'catalog', entry: EXERCISE_CATALOG.find(entry => entry.id === correct),
    });
    expect(hits.length).toBeLessThanOrEqual(8);
    expect(new Set(hits.map(hit => hit.entry.id)).size).toBe(hits.length);
    expect(NO_KEY_ACCEPT_SCORE).toBe(0.15);
  }
);

it.each(['Dumbbell Lying Rear Lateral Raise', 'Dumbbell Incline Row', 'Barbell Glute Bridge'])(
  'preserves explicit variant %s', title => {
    expect(matcher.shortlist(title)[0].entry.name.toLowerCase()).toBe(title.toLowerCase());
  }
);

it.each(cases)('repairs only the known catalog mismatch for %s and remains terminal', async (title, wrong, correct) => {
  const database = createTestDatabase();
  try {
    await upsertExercise(database, 'repair', title, 'strength');
    await setExerciseImage(database, 'repair', { imageSource: `catalog:${wrong}`, imagePath: 'exercise-images/repair-old.jpg' });
    const deps: ExerciseImageResolverDeps = {
      database, catalog: EXERCISE_CATALOG, getAiKeyConfigured: () => true,
      ask: jest.fn().mockResolvedValue('NONE'), download: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined), makeImageSuffix: () => 'new', log: jest.fn(),
    };
    await runImageResolutionPass(deps, matcher);
    const row = await database.get<Exercise>('exercises').find('repair');
    expect(row.imageSource).toBe(`catalog:${correct}`);
    expect(row.imagePath).toBe('exercise-images/repair-new.jpg');
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/repair-old.jpg');
    await runImageResolutionPass(deps, matcher);
    expect(deps.download).toHaveBeenCalledTimes(1);
  } finally { await closeTestDatabase(database); }
});

it.each(['override', 'failure', 'race', 'explicit'])('preserves existing images on %s', async scenario => {
  const database = createTestDatabase();
  try {
    const source = scenario === 'override' ? 'url:https://example.com/custom.jpg' : 'catalog:Dumbbell_Incline_Row';
    await upsertExercise(database, 'repair', scenario === 'explicit' ? 'Dumbbell Incline Row' : 'dumbbell-row', 'strength');
    await setExerciseImage(database, 'repair', { imageSource: source, imagePath: 'exercise-images/repair-old.jpg' });
    const deps: ExerciseImageResolverDeps = {
      database, catalog: EXERCISE_CATALOG, getAiKeyConfigured: () => false,
      ask: jest.fn(), download: jest.fn(async () => {
        if (scenario === 'failure') throw new Error('offline');
        if (scenario === 'race') await setExerciseImage(database, 'repair', { imageSource: 'url:https://example.com/custom.jpg', imagePath: 'exercise-images/custom.jpg' });
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined), makeImageSuffix: () => 'new', log: jest.fn(),
    };
    await runImageResolutionPass(deps, matcher);
    const row = await database.get<Exercise>('exercises').find('repair');
    expect(row.imageSource).toBe(scenario === 'race' ? 'url:https://example.com/custom.jpg' : source);
    expect(row.imagePath).toBe(scenario === 'race' ? 'exercise-images/custom.jpg' : 'exercise-images/repair-old.jpg');
    expect(deps.deleteFile).not.toHaveBeenCalledWith('exercise-images/repair-old.jpg');
    if (scenario === 'race') expect(deps.deleteFile).toHaveBeenCalledWith('exercise-images/repair-new.jpg');
    if (scenario === 'override' || scenario === 'explicit') expect(deps.download).not.toHaveBeenCalled();
  } finally { await closeTestDatabase(database); }
});
