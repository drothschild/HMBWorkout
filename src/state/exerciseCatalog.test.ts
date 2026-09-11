import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXERCISE_CATALOG, FREE_EXERCISE_DB_COMMIT, catalogImageUrl } from './exerciseCatalog';

describe('exerciseCatalog', () => {
  describe('EXERCISE_CATALOG', () => {
    it('is non-empty and has exactly 873 entries', () => {
      expect(EXERCISE_CATALOG.length).toBe(873);
      expect(EXERCISE_CATALOG.length).toBeGreaterThan(0);
    });

    it('every entry has a non-empty id, name, and image', () => {
      EXERCISE_CATALOG.forEach((entry) => {
        expect(typeof entry.id).toBe('string');
        expect(entry.id.trim().length).toBeGreaterThan(0);

        expect(typeof entry.name).toBe('string');
        expect(entry.name.trim().length).toBeGreaterThan(0);

        expect(typeof entry.image).toBe('string');
        expect(entry.image.trim().length).toBeGreaterThan(0);
      });
    });

    it('ids are unique', () => {
      const ids = EXERCISE_CATALOG.map((entry) => entry.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(EXERCISE_CATALOG.length);
    });
  });

  describe('catalogImageUrl', () => {
    it('builds the correct image URL for a catalog entry', () => {
      const url = catalogImageUrl({ image: 'Barbell_Squat/0.jpg' });
      expect(url).toBe(
        'https://raw.githubusercontent.com/yuhonas/free-exercise-db/a859101d633a01c4a1a920d6a8ce41dabba0705f/exercises/Barbell_Squat/0.jpg'
      );
    });
  });

  describe('commit consistency across source files', () => {
    it('FREE_EXERCISE_DB_COMMIT is present in exerciseCatalogData.ts', () => {
      const dataModulePath = join(__dirname, 'exerciseCatalogData.ts');
      const content = readFileSync(dataModulePath, 'utf8');
      expect(content).toContain(`free-exercise-db@${FREE_EXERCISE_DB_COMMIT}`);
    });

    it('FREE_EXERCISE_DB_COMMIT matches the COMMIT in build-exercise-catalog.mjs', () => {
      const scriptPath = join(__dirname, '..', '..', 'scripts', 'build-exercise-catalog.mjs');
      const content = readFileSync(scriptPath, 'utf8');
      expect(content).toContain(`const COMMIT = '${FREE_EXERCISE_DB_COMMIT}'`);
    });
  });
});
