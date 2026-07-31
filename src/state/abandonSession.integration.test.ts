/**
 * Abandoning a workout end to end through the store, against a real database.
 *
 * The point of the feature is that the abandoned workout leaves no trace: no
 * session row, no sets, nothing for restart recovery to rehydrate, and — because
 * abandon never emits CompleteSession — no sync attempt and no HealthKit export.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { getSession, getSessionSets, upsertExercise, upsertRoutine } from '@/db/repository';
import { loadActiveEngineState } from '@/db/engineState';
import { createActiveSessionStore } from './activeSession';
import type { HealthKitDeps } from './activeSession';

const ROUTINE_ID = 'routine-abandon';
const SESSION_ID = 'session-abandon';

const routine = {
  id: ROUTINE_ID,
  name: 'Abandon Test Routine',
  entries: [
    {
      exerciseId: 'ex-1',
      kind: 'strength' as const,
      warmupSets: 1,
      targetSets: 3,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 0,
      supersetGroup: '',
    },
  ],
};

async function seedRoutine(database: Database): Promise<void> {
  await upsertExercise(database, 'ex-1', 'Bench Press', 'strength');
  await upsertRoutine(database, ROUTINE_ID, 'Abandon Test Routine', [
    { exerciseId: 'ex-1', order: 0, warmupSets: 1, targetSets: 3, targetReps: 8, restSeconds: 0 },
  ]);
}

function makeHealthKitDeps() {
  return {
    ensureAuthorized: jest.fn(async () => 'authorized'),
    requestAuthorization: jest.fn(async () => true),
    saveWorkoutSample: jest.fn(async () => {}),
  } as unknown as HealthKitDeps;
}

describe('abandoning an in-progress workout', () => {
  let database: Database;
  let syncSpy: jest.Mock;
  let healthKitDeps: HealthKitDeps;
  let store: ReturnType<typeof createActiveSessionStore>;

  beforeEach(async () => {
    database = createTestDatabase();
    await seedRoutine(database);
    syncSpy = jest.fn(async () => {});
    healthKitDeps = makeHealthKitDeps();
    store = createActiveSessionStore(
      database,
      {
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
      },
      syncSpy,
      healthKitDeps
    );

    // Drive a real workout partway: one warmup set and one working set logged.
    await store.getState().dispatch({
      tag: 'StartSession',
      sessionId: SESSION_ID,
      nowMs: 1000,
      routine,
    });
    await store.getState().dispatch({ tag: 'LogSet', reps: 10, weightKg: 20 });
    await store.getState().dispatch({ tag: 'SetDone', nowMs: 2000 });
    await store.getState().dispatch({ tag: 'LogSet', reps: 8, weightKg: 40 });
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('starts from a session that really is on disk with its sets', async () => {
    expect(await getSession(database, SESSION_ID)).toBeDefined();
    expect(await getSessionSets(database, SESSION_ID)).toHaveLength(2);
  });

  it('deletes the session row and its sets by the time dispatch resolves', async () => {
    await store.getState().dispatch({ tag: 'AbandonSession' });

    // No microtask flush here on purpose: a caller that awaits dispatch must not
    // be able to observe the abandoned workout still on disk.
    expect(await getSession(database, SESSION_ID)).toBeUndefined();
    expect(await getSessionSets(database, SESSION_ID)).toHaveLength(0);
  });

  it('leaves no engine state for restart recovery to rehydrate', async () => {
    expect(await loadActiveEngineState(database)).not.toBeNull();

    await store.getState().dispatch({ tag: 'AbandonSession' });

    expect(await loadActiveEngineState(database)).toBeNull();
  });

  it('clears the store back to no active session', async () => {
    await store.getState().dispatch({ tag: 'AbandonSession' });

    expect(store.getState().sessionState).toBeNull();
    expect(store.getState().lastError).toBeNull();
  });

  it('never syncs and never exports to HealthKit', async () => {
    await store.getState().dispatch({ tag: 'AbandonSession' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(syncSpy).not.toHaveBeenCalled();
    expect((healthKitDeps as any).saveWorkoutSample).not.toHaveBeenCalled();
    expect((healthKitDeps as any).ensureAuthorized).not.toHaveBeenCalled();
  });

  it('lets a new workout start straight afterwards', async () => {
    await store.getState().dispatch({ tag: 'AbandonSession' });

    const started = await store.getState().dispatch({
      tag: 'StartSession',
      sessionId: 'session-after-abandon',
      nowMs: 5000,
      routine,
    });

    expect(started?.sessionId).toBe('session-after-abandon');
    expect(started?.phase).toBe('warmup');
    expect(store.getState().sessionState?.sessionId).toBe('session-after-abandon');
    expect(await getSession(database, 'session-after-abandon')).toBeDefined();
  });

  it('reports a validation error rather than crashing when there is no session', async () => {
    await store.getState().dispatch({ tag: 'AbandonSession' });

    const result = await store.getState().dispatch({ tag: 'AbandonSession' });

    expect(result).toBeNull();
    expect(store.getState().lastError).toContain('AbandonSession');
    expect(store.getState().sessionState).toBeNull();
  });
});
