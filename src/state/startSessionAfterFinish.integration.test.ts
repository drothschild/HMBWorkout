/**
 * Integration test: Cross-boundary StartSession from Done phase
 * Verifies that a finished session can be replaced by starting a new one (C1 fix validation).
 * This test uses the REAL store + REAL engine to catch the dispatch return value flow.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { startSessionFromRoutine } from './startSessionFromRoutine';
import { createActiveSessionStore } from './activeSession';
import { upsertRoutine, upsertExercise } from '@/db/repository';

describe('Integration: StartSession from Done phase (C1)', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('allows starting a new session after the previous one finishes (phase done)', async () => {
    // Seed exercises
    await upsertExercise(database, 'bench-press', 'Bench Press', 'strength');
    await upsertExercise(database, 'dumbbells', 'Dumbbells', 'strength');

    // Seed two routines so we can start with one, then start the other
    const routine1Id = 'routine-1';
    await upsertRoutine(
      database,
      routine1Id,
      'Routine 1',
      [
        {
          exerciseId: 'bench-press',
          order: 0,
          warmupSets: 0,
          targetSets: 1, // Only 1 set — quick to finish
          targetReps: 5,
          targetDurationSeconds: 0,
          restSeconds: 0,
        },
      ]
    );

    const routine2Id = 'routine-2';
    await upsertRoutine(
      database,
      routine2Id,
      'Routine 2',
      [
        {
          exerciseId: 'dumbbells',
          order: 0,
          warmupSets: 0,
          targetSets: 1,
          targetReps: 8,
          targetDurationSeconds: 0,
          restSeconds: 0,
        },
      ]
    );

    // Stub the HealthKit external system; the store, engine, and DB stay real.
    const store = createActiveSessionStore(
      database,
      undefined,
      {
        ensureAuthorized: jest.fn(async () => 'authorized' as const),
        requestAuthorization: jest.fn(async () => true),
        saveWorkoutSample: jest.fn(async () => {}),
      }
    );

    // === First session: Start and finish ===
    const session1Id = `session-${Date.now()}-1`;
    const event1 = await startSessionFromRoutine(database, routine1Id, session1Id);

    let state = await store.getState().dispatch(event1);
    expect(state).not.toBeNull();
    expect(state?.sessionId).toBe(session1Id);
    expect(state?.phase).toBe('working'); // No warmup, goes straight to working

    // Log the first (and only) set — one-tap logging advances straight to Done
    let finishState = await store.getState().dispatch({
      tag: 'LogSet',
      reps: 5,
      weightKg: 100,
      durationSeconds: 0,
      rpe: 8,
      nowMs: Date.now(),
    });
    expect(finishState).not.toBeNull();
    expect(finishState?.phase).toBe('done');

    // === Critical assertion: Verify the store shows done state ===
    const storeStateAfterFinish = store.getState().sessionState;
    expect(storeStateAfterFinish?.phase).toBe('done');

    // === Second session: Start from Done phase ===
    const session2Id = `session-${Date.now()}-2`;
    const event2 = await startSessionFromRoutine(database, routine2Id, session2Id);

    // THIS IS THE KEY TEST: Dispatch the StartSession event from Done phase
    // The engine guard must accept Done || Idle, not just Idle
    const newSessionState = await store.getState().dispatch(event2);

    // MUST succeed (not null) with a new sessionId and new phase
    expect(newSessionState).not.toBeNull();
    expect(newSessionState?.sessionId).toBe(session2Id);
    expect(newSessionState?.phase).toBe('working'); // Should be in working phase (no warmup)
    expect(newSessionState?.routineId).toBe(routine2Id);
    expect(newSessionState?.exerciseIndex).toBe(0);
    expect(newSessionState?.setIndex).toBe(0);

    // Verify the old session data is NOT present (fresh state, not residue)
    expect(newSessionState?.loggedSets.length).toBe(0);

    // The store must hold the new session too — screens subscribe to the
    // store, not to dispatch's return value.
    expect(store.getState().sessionState?.sessionId).toBe(session2Id);
    expect(store.getState().sessionState?.phase).toBe('working');
  }, 30000);
});
