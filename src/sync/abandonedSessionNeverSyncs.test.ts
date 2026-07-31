/**
 * An abandoned workout must never reach the vault.
 *
 * This drives two real sessions through the store — one abandoned, one finished —
 * and then runs the real syncNow() against a recording bridge. The finished
 * session is the control: it proves the bridge and the queue are genuinely
 * working, so the abandoned session's absence means it was discarded rather than
 * that nothing was posted at all.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise, upsertRoutine } from '@/db/repository';
import { createActiveSessionStore } from '@/state/activeSession';
import type { HealthKitDeps } from '@/state/activeSession';
import { createSyncService } from './syncService';

const ROUTINE_ID = 'routine-sync-abandon';
const ABANDONED_ID = 'session-abandoned';
const FINISHED_ID = 'session-finished';

const routine = {
  id: ROUTINE_ID,
  name: 'Sync Abandon Routine',
  entries: [
    {
      exerciseId: 'bench-press-db',
      kind: 'strength' as const,
      warmupSets: 0,
      // Two target sets: logging one keeps the session in progress (one-tap
      // logging advances on log), so it can still be abandoned or finished.
      targetSets: 2,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 0,
      supersetGroup: '',
    },
  ],
};

/** Let rill's un-awaited effect executors settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('abandoned sessions and the sync queue', () => {
  let database: Database;
  let postedSessionIds: string[];
  let store: ReturnType<typeof createActiveSessionStore>;

  beforeEach(async () => {
    database = createTestDatabase();
    postedSessionIds = [];

    await upsertExercise(database, 'bench-press-db', 'Bench Press', 'strength');
    await upsertRoutine(database, ROUTINE_ID, 'Sync Abandon Routine', [
      {
        exerciseId: 'bench-press-db',
        order: 0,
        warmupSets: 0,
        targetSets: 2,
        targetReps: 8,
        restSeconds: 0,
      },
    ]);

    const healthKitDeps = {
      ensureAuthorized: jest.fn(async () => 'authorized'),
      requestAuthorization: jest.fn(async () => true),
      saveWorkoutSample: jest.fn(async () => {}),
    } as unknown as HealthKitDeps;

    store = createActiveSessionStore(
      database,
      { onScheduleRest: jest.fn(), onCancelRest: jest.fn(), onNotify: jest.fn() },
      // Injected so completing a session does not kick off the real sync service;
      // this test drives syncNow() itself.
      jest.fn(async () => {}),
      healthKitDeps
    );

    // Session one: logged into, then abandoned.
    await store.getState().dispatch({
      tag: 'StartSession',
      sessionId: ABANDONED_ID,
      nowMs: 1000,
      routine,
    });
    await store.getState().dispatch({ tag: 'LogSet', reps: 8, weightKg: 60, nowMs: 2000 });
    await store.getState().dispatch({ tag: 'AbandonSession' });

    // Session two: logged into, then finished normally.
    await store.getState().dispatch({
      tag: 'StartSession',
      sessionId: FINISHED_ID,
      nowMs: 3000,
      routine,
    });
    await store.getState().dispatch({ tag: 'LogSet', reps: 8, weightKg: 65, nowMs: 3500 });
    await store.getState().dispatch({ tag: 'FinishSession', nowMs: 4000 });
    await flush();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('posts the finished session but never the abandoned one', async () => {
    const bridgeClient = {
      health: jest.fn(async () => ({ ok: true })),
      postSession: jest.fn(async (payload: { id: string; markdown: string }) => {
        postedSessionIds.push(payload.id);
      }),
      getRoutines: jest.fn(),
      getRoutine: jest.fn(),
    };

    await createSyncService(database, bridgeClient as any).syncNow();

    expect(postedSessionIds).toEqual([FINISHED_ID]);
  });

  it('does not mention the abandoned session in any posted markdown', async () => {
    const postedMarkdown: string[] = [];
    const bridgeClient = {
      health: jest.fn(async () => ({ ok: true })),
      postSession: jest.fn(async (payload: { id: string; markdown: string }) => {
        postedMarkdown.push(payload.markdown);
      }),
      getRoutines: jest.fn(),
      getRoutine: jest.fn(),
    };

    await createSyncService(database, bridgeClient as any).syncNow();

    expect(postedMarkdown).toHaveLength(1);
    expect(postedMarkdown[0]).not.toContain(ABANDONED_ID);
  });

  it('leaves no queued row for the abandoned session at all', async () => {
    const sessionIds = ((await database.get('sessions').query().fetch()) as any[]).map(
      (session) => session.id
    );

    expect(sessionIds).toEqual([FINISHED_ID]);
  });
});
