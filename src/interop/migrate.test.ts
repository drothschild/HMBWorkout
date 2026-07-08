import * as fs from 'fs';
import * as path from 'path';
import { parseRoutine } from './parse';
import { ContractError } from './format';

/**
 * Test that migrated routine files parse correctly without ContractError.
 * This verifies AC7.2: existing routines migrate cleanly to the workout-block format.
 */
describe('Migrated routines (AC7.2)', () => {
  const vaultSyncDir = path.resolve(
    '/Users/davidrothschild/Documents/Obsidian/Organizer/2-Areas/Exercise/_sync'
  );

  const routines = ['Push.md', 'Pull.md', 'Legs.md'];

  for (const routineFile of routines) {
    const routinePath = path.join(vaultSyncDir, routineFile);

    it(`parses ${routineFile} without ContractError`, () => {
      if (!fs.existsSync(routinePath)) {
        throw new Error(`Routine file not found: ${routinePath}`);
      }

      const markdown = fs.readFileSync(routinePath, 'utf-8');

      // Must not throw ContractError
      const parsed = parseRoutine(markdown);

      // Verify basic structure
      expect(parsed.frontmatter).toBeDefined();
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.frontmatter.id).toBeDefined();
      expect(parsed.exercises).toBeDefined();
      expect(parsed.exercises.length).toBeGreaterThan(0);
    });

    it(`${routineFile} has proper frontmatter`, () => {
      const markdown = fs.readFileSync(routinePath, 'utf-8');
      const parsed = parseRoutine(markdown);

      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.frontmatter.id).toBeTruthy();
      expect(parsed.frontmatter.created).toBeTruthy();
      expect(parsed.frontmatter.updated).toBeTruthy();
    });

    it(`${routineFile} exercises include superset and cardio/stretch`, () => {
      const markdown = fs.readFileSync(routinePath, 'utf-8');
      const parsed = parseRoutine(markdown);

      // Should have at least one superset (entries with supersetLabel)
      const hasSupersets = parsed.exercises.some((ex) => 'exercises' in ex);
      expect(hasSupersets).toBe(true);

      // Should have at least one cardio or stretch exercise
      const hasCardioOrStretch = parsed.exercises.some((ex) => {
        if ('exercises' in ex) {
          return ex.exercises.some((e) => e.kind === 'cardio' || e.kind === 'stretch');
        }
        return ex.kind === 'cardio' || ex.kind === 'stretch';
      });
      expect(hasCardioOrStretch).toBe(true);
    });
  }
});
