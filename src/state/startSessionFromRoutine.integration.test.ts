/**
 * Integration test: AC7.1
 * Tests the REAL import path -> startSessionFromRoutine -> dispatch flow
 * Verifies that sets logged during an imported routine are actually persisted
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { startSessionFromRoutine } from './startSessionFromRoutine';
import { createActiveSessionStore } from './activeSession';
import { getSessionSets } from '@/db/repository';
import { parseRoutine } from '@/interop/parse';
import { upsertRoutine, upsertExercise } from '@/db/repository';

describe('Integration: Import routine + start session + log set (AC7.1)', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('imports a routine, starts a session, logs sets, and persists them (bug C1 regression)', async () => {
    // Seed exercises first (needed for import)
    await upsertExercise(database, 'bench-press', 'Bench Press', 'strength');
    await upsertExercise(database, 'incline-press', 'Incline Press', 'strength');

    // Upsert routine via REAL import path (0-based order)
    const routineId = 'import-test-routine';
    await upsertRoutine(
      database,
      routineId,
      'Push Day Imported',
      [
        {
          exerciseId: 'bench-press',
          order: 0, // Canonical 0-based
          warmupSets: 1,
          targetSets: 3,
          targetReps: 8,
          targetDurationSeconds: 0,
          restSeconds: 120,
        },
        {
          exerciseId: 'incline-press',
          order: 1, // Canonical 0-based (second exercise)
          warmupSets: 0,
          targetSets: 3,
          targetReps: 6,
          targetDurationSeconds: 0,
          restSeconds: 120,
        },
      ]
    );

    // Create the active session store with injected database
    const store = createActiveSessionStore(database);

    // Build StartSession event from the imported routine
    const sessionId = `session-${Date.now()}`;
    const startEvent = await startSessionFromRoutine(database, routineId, sessionId);

    // Verify the event was built correctly
    expect(startEvent.tag).toBe('StartSession');
    expect((startEvent.routine as any).entries).toHaveLength(2);
    expect((startEvent.routine as any).entries[0].idx).toBe(0); // idx from DB order
    expect((startEvent.routine as any).entries[1].idx).toBe(1); // idx from DB order

    // Dispatch StartSession
    let state = await store.getState().dispatch(startEvent);
    expect(state).toBeDefined();
    expect(state?.sessionId).toBe(sessionId);
    expect(state?.phase).toBe('warmup'); // First exercise has warmupSets > 0

    // Log a warmup set for first exercise — one-tap: records AND advances into rest
    let logState = await store.getState().dispatch({
      tag: 'LogSet',
      reps: 8,
      weightKg: 60,
      durationSeconds: 0,
      rpe: 6.5,
      nowMs: Date.now(),
    });
    expect(logState).toBeDefined();
    expect(logState?.phase).toBe('resting');
    expect(logState?.setIndex).toBe(1); // Moved to next set

    // Cut the between-sets rest short
    let restState = await store.getState().dispatch({ tag: 'SkipRest' });
    expect(restState?.phase).toBe('working');

    // Log a working set
    logState = await store.getState().dispatch({
      tag: 'LogSet',
      reps: 8,
      weightKg: 70,
      durationSeconds: 0,
      rpe: 7.5,
      nowMs: Date.now(),
    });
    expect(logState?.setIndex).toBe(2);

    restState = await store.getState().dispatch({ tag: 'SkipRest' });
    expect(restState?.phase).toBe('working');

    // Log second working set (1 warmup + 3 targets = 4 positions, so one remains)
    logState = await store.getState().dispatch({
      tag: 'LogSet',
      reps: 8,
      weightKg: 75,
      durationSeconds: 0,
      rpe: 8,
      nowMs: Date.now(),
    });
    expect(logState?.setIndex).toBe(3);

    restState = await store.getState().dispatch({ tag: 'SkipRest' });
    expect(restState?.phase).toBe('working');

    // Skip the last working set without logging it (SetDone = Skip Set)
    const skipState = await store.getState().dispatch({
      tag: 'SetDone',
      nowMs: Date.now(),
    });
    expect(skipState?.exerciseIndex).toBe(1); // Advanced to next exercise
    expect(skipState?.setIndex).toBe(0); // Reset set index

    restState = await store.getState().dispatch({ tag: 'SkipRest' });
    expect(restState?.phase).toBe('working');

    // Log a set for the second exercise
    logState = await store.getState().dispatch({
      tag: 'LogSet',
      reps: 6,
      weightKg: 65,
      durationSeconds: 0,
      rpe: 7,
      nowMs: Date.now(),
    });
    expect(logState).toBeDefined();

    // Finish session
    const finishState = await store.getState().dispatch({
      tag: 'FinishSession',
      nowMs: Date.now(),
    });
    expect(finishState?.phase).toBe('done');

    // THE CRITICAL ASSERTION: Verify sets were ACTUALLY persisted
    // Without the fix, this would return 0 because onPersistSet lookup failed
    const sessionSets = await getSessionSets(database, sessionId);

    // Should have: 1 warmup + 2 working for exercise 1, + 1 working for exercise 2 = 4 sets
    expect(sessionSets).toHaveLength(4);

    // Verify set details
    const set1 = sessionSets[0];
    expect((set1 as any).setType).toBe('warmup');
    expect((set1 as any).reps).toBe(8);
    expect((set1 as any).weightKg).toBe(60);

    const set2 = sessionSets[1];
    expect((set2 as any).setType).toBe('working');
    expect((set2 as any).reps).toBe(8);
    expect((set2 as any).weightKg).toBe(70);

    const set3 = sessionSets[2];
    expect((set3 as any).setType).toBe('working');
    expect((set3 as any).reps).toBe(8);
    expect((set3 as any).weightKg).toBe(75);

    const set4 = sessionSets[3];
    expect((set4 as any).setType).toBe('working');
    expect((set4 as any).reps).toBe(6);
    expect((set4 as any).weightKg).toBe(65);

    // Verify session row has correct data
    const session = await database.get('sessions').find(sessionId) as any;
    expect((session as any).routineId).toBe(routineId);
    expect((session as any).customSyncStatus).toBe('local');
  }, 30000);
});
