/**
 * Sync service integration tests for routine import
 * AC5.2: Bridge routines with superset and stretch → import to DB with grouping/order intact
 * Re-import edited routine updates rather than duplicates
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSyncService } from './syncService';

describe('Sync Service - Routine Import', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('AC5.2: import routines with superset and stretch', () => {
    it('imports simple routine', async () => {
      const mockBridgeClient = {
        health: jest.fn(),
        postSession: jest.fn(),
        getRoutines: jest.fn().mockResolvedValueOnce([
          {
            id: 'routine-import-1',
            updated: Date.now(),
            markdown: `---
type: workout-routine
id: routine-import-1
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- bench-press-db: 3x8 warmup=1 rest=90
- tricep-stretch: duration=0:30 kind=stretch rest=30
\`\`\`
`,
          },
        ]),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Run import
      await syncService.importRoutines();

      // Verify routine was created
      const routine = await database.get('routines').find('routine-import-1');
      expect(routine).toBeDefined();
      expect((routine as any).name).toBe('routine-import-1');

      // Verify exercises were created with correct kinds
      const benchPress = await database.get('exercises').find('bench-press-db');
      expect(benchPress).toBeDefined();
      expect((benchPress as any).kind).toBe('strength');

      const tricepStretch = await database.get('exercises').find('tricep-stretch');
      expect(tricepStretch).toBeDefined();
      expect((tricepStretch as any).kind).toBe('stretch');

      // Verify routine_exercises with correct order
      const routineExercises = (await database
        .get('routine_exercises')
        .query()
        .fetch()) as any[];

      expect(routineExercises).toHaveLength(2);

      // Verify bench press (order 0: first exercise, canonical 0-based)
      const order0 = routineExercises.find((re) => re._raw.order === 0);
      expect(order0._raw.exercise_id).toBe('bench-press-db');
      expect(order0._raw.warmup_sets).toBe(1);
      expect(order0._raw.rest_seconds).toBe(90);

      // Verify stretch (order 1: second exercise)
      const order1 = routineExercises.find((re) => re._raw.order === 1);
      expect(order1._raw.exercise_id).toBe('tricep-stretch');
      expect(order1._raw.target_duration_seconds).toBe(30);
    });

    it('updates routine on re-import without duplicating entries', async () => {
      // First import
      const mockBridgeClient = {
        health: jest.fn(),
        postSession: jest.fn(),
        getRoutines: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'routine-update-1',
              updated: Date.now(),
              markdown: `---
type: workout-routine
id: routine-update-1
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- bench-press-db: 3x8 rest=90
- squat-bb: 4x6 rest=120
\`\`\`
`,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: 'routine-update-1',
              updated: Date.now(),
              markdown: `---
type: workout-routine
id: routine-update-1
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- bench-press-db: 3x10 rest=90
- deadlift-bb: 3x5 rest=120
\`\`\`
`,
            },
          ]),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // First import: 2 exercises
      await syncService.importRoutines();

      let routineExercises = (await database
        .get('routine_exercises')
        .query()
        .fetch()) as any[];
      expect(routineExercises).toHaveLength(2);

      // Verify initial state
      expect(routineExercises[0]._raw.target_reps).toBe(8);

      // Second import: different exercises (squat → deadlift)
      await syncService.importRoutines();

      // Should still have 2 entries (not 4)
      routineExercises = (await database
        .get('routine_exercises')
        .query()
        .fetch()) as any[];
      expect(routineExercises).toHaveLength(2);

      // Verify updated values
      const benchPress = routineExercises.find((re) => re._raw.exercise_id === 'bench-press-db');
      expect(benchPress).toBeDefined();
      expect(benchPress?._raw.target_reps).toBe(10); // Updated from 8

      // Verify squat removed and deadlift added
      const squat = routineExercises.find((re) => re._raw.exercise_id === 'squat-bb');
      expect(squat).toBeUndefined();

      const deadlift = routineExercises.find((re) => re._raw.exercise_id === 'deadlift-bb');
      expect(deadlift).toBeDefined();
    });

    it('skips malformed routines and continues import', async () => {
      const mockBridgeClient = {
        health: jest.fn(),
        postSession: jest.fn(),
        getRoutines: jest.fn().mockResolvedValueOnce([
          {
            id: 'routine-good-1',
            updated: Date.now(),
            markdown: `---
type: workout-routine
id: routine-good-1
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- bench-press-db: 3x8 rest=90
\`\`\`
`,
          },
          {
            id: 'routine-bad-1',
            updated: Date.now(),
            markdown: `This is not valid markdown (no frontmatter)`,
          },
          {
            id: 'routine-good-2',
            updated: Date.now(),
            markdown: `---
type: workout-routine
id: routine-good-2
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- squat-bb: 4x6 rest=120
\`\`\`
`,
          },
        ]),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Import should not throw despite bad routine
      await expect(syncService.importRoutines()).resolves.not.toThrow();

      // Verify good routines were imported
      const routine1 = await database.get('routines').find('routine-good-1');
      expect(routine1).toBeDefined();

      const routine2 = await database.get('routines').find('routine-good-2');
      expect(routine2).toBeDefined();

      // Bad routine should not exist
      const badRoutine = await database
        .get('routines')
        .find('routine-bad-1')
        .catch(() => null);
      expect(badRoutine).toBeNull();
    });
  });
});
