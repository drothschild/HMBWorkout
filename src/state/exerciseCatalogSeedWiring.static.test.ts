import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('exercise catalog seed boot wiring', () => {
  it('loads the pinned catalog into the database before image resolution starts', () => {
    const layout = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/\s+/g, '');

    expect(layout).toContain("import{EXERCISE_LIBRARY_CATALOG}from'@/state/exerciseCatalog';");
    expect(layout).toContain("import{seedExerciseCatalog}from'@/state/exerciseCatalogSeed';");

    const seed = layout.indexOf('awaitseedExerciseCatalog(database,EXERCISE_LIBRARY_CATALOG);');
    const resolver = layout.indexOf('ensureExerciseImageResolver(');
    expect(seed).toBeGreaterThan(-1);
    expect(resolver).toBeGreaterThan(seed);
  });

  it('passes one mixed update/create operation array to WatermelonDB batch', () => {
    const seedSource = readFileSync(join(__dirname, 'exerciseCatalogSeed.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/\s+/g, '');

    expect(seedSource).toContain('awaitdatabase.batch([');
    expect(seedSource).toContain('...backfill.map(');
    expect(seedSource).toContain('prepareUpdate(');
    expect(seedSource).toContain('...missing.map(');
    expect(seedSource).toContain('prepareCreate(');
    expect(seedSource).not.toContain('database.batch(...missing.map(');
  });
});
