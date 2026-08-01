/**
 * Sync service integration tests for routine import
 * AC5.2: Bridge routines with superset and stretch → import to DB with grouping/order intact
 * Re-import edited routine updates rather than duplicates
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSyncService } from './syncService';
import { startSessionFromRoutine } from '@/state/startSessionFromRoutine';
import { createEngine } from '@/engine';

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

  // The vault contract forbids sets×reps on cardio/stretch lines (parse.ts),
  // so a routine built entirely from duration-based exercises parses with
  // targetSets undefined on every entry, which reaches the engine as
  // warmupSets + targetSets === 0. h.next_active_idx (helpers.lv) never
  // treats a zero-total entry as active at any round — that check is
  // unchanged by whether a zero-total entry is the round's *first* candidate
  // or a later one, so a duration-only exercise sharing a superset group with
  // an active exercise is silently skipped forever, not just delayed: it is
  // never handed off to and never picked on loop-back. The AI persona already
  // avoids the zero-total shape entirely by always giving duration-based
  // exercises targetSets: 1 (contextBuilder.ts, "a timed hold is still one
  // planned set in the session flow"); vault import needs the same default so
  // a routine's origin doesn't change whether every exercise in it actually
  // gets performed.
  describe('duration-only routines (all cardio/stretch, no strength)', () => {
    const allDurationRoutineMarkdown = `---
type: workout-routine
id: routine-mobility-1
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- foam-rolling: kind=stretch duration=1:00 rest=15
- jump-rope: kind=cardio duration=2:00 rest=30
\`\`\`
`;

    it('defaults targetSets to 1 for every cardio/stretch entry on import', async () => {
      const mockBridgeClient = {
        health: jest.fn(),
        postSession: jest.fn(),
        getRoutines: jest.fn().mockResolvedValueOnce([
          { id: 'routine-mobility-1', updated: Date.now(), markdown: allDurationRoutineMarkdown },
        ]),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);
      await syncService.importRoutines();

      const routineExercises = (await database
        .get('routine_exercises')
        .query()
        .fetch()) as any[];

      expect(routineExercises).toHaveLength(2);
      for (const re of routineExercises) {
        expect(re._raw.target_sets).toBe(1);
      }
    });

    it('logs a duration-only exercise even when it is not the first member of its superset group', async () => {
      // goblet-squat (2 sets) is naturally landed on first; calf-stretch
      // shares its superset group but is duration-only. Without a targetSets
      // default, calf-stretch's own total is 0, so h.next_active_idx never
      // hands off to it and never loop-backs to it: the round-robin finishes
      // goblet-squat's 2 sets and ends the group having logged calf-stretch
      // zero times, not once. Play the whole routine to completion and assert
      // calf-stretch actually appears in loggedSets, regardless of the exact
      // hand-off order the engine picks (which differs pre/post fix).
      const supersetRoutineMarkdown = `---
type: workout-routine
id: routine-superset-mobility-1
updated: 2026-07-08
tags: []
created: 2026-07-08
---

\`\`\`workout
- goblet-squat: 2x8 superset=ss1 rest=0
- calf-stretch: kind=stretch duration=0:30 superset=ss1 rest=0
\`\`\`
`;
      const mockBridgeClient = {
        health: jest.fn(),
        postSession: jest.fn(),
        getRoutines: jest.fn().mockResolvedValueOnce([
          {
            id: 'routine-superset-mobility-1',
            updated: Date.now(),
            markdown: supersetRoutineMarkdown,
          },
        ]),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);
      await syncService.importRoutines();

      const startEvent = await startSessionFromRoutine(
        database,
        'routine-superset-mobility-1',
        'session-superset-mobility-1'
      );
      const engine = createEngine({
        onCreateSession: jest.fn(),
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
        onDiscardSession: jest.fn(),
      });

      let state = await engine.dispatch(startEvent);
      let guard = 0;
      while (state.phase !== 'done' && guard < 10) {
        state = await engine.dispatch({
          tag: 'LogSet',
          reps: 8,
          weightKg: 20,
          durationSeconds: 30,
          rpe: -1.0,
          nowMs: 1000 + guard,
        } as any);
        guard++;
      }

      expect(state.phase).toBe('done');
      expect(state.loggedSets.some((s: any) => s.exerciseId === 'calf-stretch')).toBe(true);
    });
  });
});
