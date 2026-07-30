import * as fs from 'fs';
import { parseRoutine } from './parse';
import { Q } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise, upsertRoutine } from '@/db/repository';
import { getVaultSyncDir, resolveRoutineFile } from './test-helpers';

/**
 * These suites parse the real routine files in the Obsidian vault, so they
 * only run on a machine where the vault is present; elsewhere (e.g. CI) they
 * skip with a warning. The vault renames sync files over time (date prefixes
 * like "2026-07-08 0935 Push.md"), so routines are resolved by logical name
 * via resolveRoutineFile instead of hardcoded filenames.
 */
const vaultSyncDir = getVaultSyncDir();
const vaultAvailable = fs.existsSync(vaultSyncDir);
const describeIfVault = vaultAvailable ? describe : describe.skip;

if (!vaultAvailable) {
  console.warn(
    `[migrate.test] Obsidian vault _sync directory not found at "${vaultSyncDir}"; ` +
      'skipping vault-backed migration tests. Set HMB_VAULT_SYNC_DIR to run them ' +
      'against a different vault location.'
  );
}

const routineNames = ['Push', 'Pull', 'Legs'];

const readRoutineMarkdown = (routineName: string): string =>
  fs.readFileSync(resolveRoutineFile(vaultSyncDir, routineName), 'utf-8');

/**
 * Test that migrated routine files parse correctly without ContractError.
 * This verifies AC7.2: existing routines migrate cleanly to the workout-block format.
 */
describeIfVault('Migrated routines (AC7.2)', () => {
  for (const routineName of routineNames) {
    it(`parses ${routineName} without ContractError`, () => {
      const markdown = readRoutineMarkdown(routineName);

      // Must not throw ContractError
      const parsed = parseRoutine(markdown);

      // Verify basic structure
      expect(parsed.frontmatter).toBeDefined();
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.frontmatter.id).toBeDefined();
      expect(parsed.exercises).toBeDefined();
      expect(parsed.exercises.length).toBeGreaterThan(0);
    });

    it(`${routineName} has proper frontmatter`, () => {
      const markdown = readRoutineMarkdown(routineName);
      const parsed = parseRoutine(markdown);

      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.frontmatter.id).toBeTruthy();
      expect(parsed.frontmatter.created).toBeTruthy();
      expect(parsed.frontmatter.updated).toBeTruthy();
    });

    it(`${routineName} exercises include superset and cardio/stretch`, () => {
      const markdown = readRoutineMarkdown(routineName);
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

/**
 * Extended migration test: AC7.2 (I1)
 * Tests the full import path: parse -> upsert exercises -> upsert routine -> verify DB structure
 * Ensures superset grouping, warmup_sets, cardio/stretch targetDurationSeconds, and order sequence are preserved.
 */
describeIfVault('Migrated routines full import path (AC7.2 I1)', () => {
  for (const routineName of routineNames) {
    it(`imports and upserts ${routineName} through full DB path with correct structure`, async () => {
      const database = createTestDatabase();

      try {
        const markdown = readRoutineMarkdown(routineName);
        const parsed = parseRoutine(markdown);

        // Build allExercises list from parsed exercises (mimics syncService import)
        const allExercises: Array<{
          exerciseId: string;
          kind: string;
          order: number;
          supersetGroup?: string;
          targetSets?: number;
          targetReps?: number;
          targetDurationSeconds?: number;
          restSeconds?: number;
          warmupSets?: number;
          notes?: string;
        }> = [];

        let order = 0; // Canonical 0-based
        for (const entry of parsed.exercises) {
          if ('exercises' in entry) {
            // Superset group
            const supersetLabel = entry.supersetLabel;
            for (const line of entry.exercises) {
              allExercises.push({
                exerciseId: line.exerciseId,
                kind: line.kind || 'strength',
                order,
                supersetGroup: supersetLabel,
                targetSets: line.targetSets,
                targetReps: line.targetReps,
                targetDurationSeconds: line.targetDurationSeconds,
                restSeconds: line.restSeconds,
                warmupSets: line.warmupSets,
                notes: line.hint,
              });
              order++;
            }
          } else {
            // Single line
            const line = entry;
            allExercises.push({
              exerciseId: line.exerciseId,
              kind: line.kind || 'strength',
              order,
              targetSets: line.targetSets,
              targetReps: line.targetReps,
              targetDurationSeconds: line.targetDurationSeconds,
              restSeconds: line.restSeconds,
              warmupSets: line.warmupSets,
              notes: line.hint,
            });
            order++;
          }
        }

        // Upsert exercises
        const distinctExercises = new Map<
          string,
          { title: string; kind: string }
        >();
        for (const ex of allExercises) {
          if (!distinctExercises.has(ex.exerciseId)) {
            distinctExercises.set(ex.exerciseId, {
              title: ex.exerciseId,
              kind: ex.kind,
            });
          }
        }

        for (const [exerciseId, data] of distinctExercises.entries()) {
          await upsertExercise(database, exerciseId, data.title, data.kind);
        }

        // Upsert routine
        const routineId = parsed.frontmatter.id || routineName;
        await upsertRoutine(
          database,
          routineId,
          parsed.frontmatter.id || routineName,
          allExercises.map((e) => ({
            exerciseId: e.exerciseId,
            order: e.order,
            supersetGroup: e.supersetGroup,
            warmupSets: e.warmupSets,
            targetSets: e.targetSets,
            targetReps: e.targetReps,
            targetDurationSeconds: e.targetDurationSeconds,
            restSeconds: e.restSeconds,
            notes: e.notes,
          }))
        );

        // Verify routine was created
        const routine = await database.get('routines').find(routineId) as any;
        expect(routine).toBeDefined();
        expect((routine as any).name).toBeDefined();

        // Verify routine_exercises with correct structure
        const routineExercises = (await database
          .get('routine_exercises')
          .query(Q.where('routine_id', routineId))
          .fetch()) as any[];

        expect(routineExercises.length).toBe(allExercises.length);

        // Verify order sequence is correct and contiguous
        const orders = routineExercises.map((re) => re._raw.order).sort((a, b) => a - b);
        expect(orders[0]).toBe(0); // Starts at 0
        for (let i = 0; i < orders.length; i++) {
          expect(orders[i]).toBe(i); // Contiguous 0-based sequence
        }

        // Verify superset grouping is preserved
        const supersetGrouping = new Map<string | null, number>();
        for (const re of routineExercises) {
          const group = re._raw.superset_group || null;
          supersetGrouping.set(group, (supersetGrouping.get(group) || 0) + 1);
        }
        expect(supersetGrouping.size).toBeGreaterThan(1); // At least superset + standalone

        // Verify warmup_sets are intact (at least one exercise should have warmupSets > 0)
        const hasWarmup = routineExercises.some((re) => re._raw.warmup_sets > 0);
        expect(hasWarmup).toBe(true);

        // Verify cardio/stretch targetDurationSeconds are set
        const cardioOrStretch = routineExercises.filter(
          (re) => re._raw.kind === 'cardio' || re._raw.kind === 'stretch'
        );
        if (cardioOrStretch.length > 0) {
          const hasTargetDuration = cardioOrStretch.some(
            (re) => re._raw.target_duration_seconds && re._raw.target_duration_seconds > 0
          );
          expect(hasTargetDuration).toBe(true);
        }
      } finally {
        await closeTestDatabase(database);
      }
    }, 30000);
  }
});
