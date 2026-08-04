/**
 * A routine edit must not quietly shorten a workout that has not synced yet.
 *
 * The bridge is a Mac reached over Tailscale, so "finished workout still
 * sync_status='local'" is the ordinary state away from home. Editing the
 * routine in that window destroys the dropped exercise's routine_exercises row
 * (upsertRoutine's drop branch) while the session's sets live on. The session
 * then posted without them and flipped to 'synced' — the vault copy was
 * permanently short, with no error anywhere.
 *
 * This drives the whole path for real: engine → DB → routine edit → syncNow
 * against a recording bridge. The surviving exercise is the control, so the
 * dropped one's presence is about the serializer rather than about the bridge
 * having posted anything at all.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import { upsertExercise, upsertRoutine } from '@/db/repository';
import { createActiveSessionStore } from '@/state/activeSession';
import type { HealthKitDeps } from '@/state/activeSession';
import { createSyncService } from './syncService';

const ROUTINE_ID = 'routine-edit-during-queue';
const SESSION_ID = 'session-before-the-edit';

const routine = {
  id: ROUTINE_ID,
  name: 'Push',
  entries: [
    {
      exerciseId: 'bench-press-db',
      kind: 'strength' as const,
      warmupSets: 0,
      // One target set: logging it ends the entry and advances to the fly.
      targetSets: 1,
      targetReps: 8,
      targetDurationSeconds: 0,
      restSeconds: 0,
      supersetGroup: '',
    },
    {
      exerciseId: 'cable-fly',
      kind: 'strength' as const,
      warmupSets: 0,
      // Two, so logging one leaves the session in progress and finishable.
      targetSets: 2,
      targetReps: 12,
      targetDurationSeconds: 0,
      restSeconds: 0,
      supersetGroup: '',
    },
  ],
};

describe('a routine edit while a finished session is still queued', () => {
  let database: Database;
  let postedMarkdown: string[];

  const bridgeClient = () => ({
    health: jest.fn(async () => ({ ok: true })),
    postSession: jest.fn(async (payload: { id: string; markdown: string }) => {
      postedMarkdown.push(payload.markdown);
    }),
    getRoutines: jest.fn(),
    getRoutine: jest.fn(),
  });

  beforeEach(async () => {
    database = createTestDatabase();
    postedMarkdown = [];

    await upsertExercise(database, 'bench-press-db', 'Bench Press', 'strength');
    await upsertExercise(database, 'cable-fly', 'Cable Fly', 'strength');
    await upsertRoutine(database, ROUTINE_ID, 'Push', [
      { exerciseId: 'bench-press-db', order: 0, warmupSets: 0, targetSets: 1, targetReps: 8, restSeconds: 0 },
      { exerciseId: 'cable-fly', order: 1, warmupSets: 0, targetSets: 2, targetReps: 12, restSeconds: 0 },
    ]);

    const store = createActiveSessionStore(
      database,
      { onScheduleRest: jest.fn(), onCancelRest: jest.fn(), onNotify: jest.fn() },
      // Injected so finishing does not kick off the real sync service; this
      // test drives syncNow() itself, after the routine edit.
      jest.fn(async () => {}),
      {
        ensureAuthorized: jest.fn(async () => 'authorized'),
        requestAuthorization: jest.fn(async () => true),
        saveWorkoutSample: jest.fn(async () => {}),
      } as unknown as HealthKitDeps
    );

    // The workout: a set on each exercise, then finish. Bridge is unreachable
    // at this point, so the session stays sync_status='local'.
    await store.getState().dispatch({ tag: 'StartSession', sessionId: SESSION_ID, nowMs: 1000, routine });
    await store.getState().dispatch({ tag: 'LogSet', reps: 8, weightKg: 60, nowMs: 2000 });
    await store.getState().dispatch({ tag: 'LogSet', reps: 12, weightKg: 15, nowMs: 3000 });
    await store.getState().dispatch({ tag: 'FinishSession', nowMs: 4000 });
    await flush();

    // The edit: the fly leaves the routine, so upsertRoutine destroys its row.
    await upsertRoutine(database, ROUTINE_ID, 'Push', [
      { exerciseId: 'bench-press-db', order: 0, warmupSets: 0, targetSets: 1, targetReps: 8, restSeconds: 0 },
    ]);
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('destroys the dropped exercise\'s routine_exercises row', async () => {
    // Guards the premise: if upsertRoutine ever stops dropping the row, the
    // test below would pass for the wrong reason.
    const rows = (await database.get('routine_exercises').query().fetch()) as any[];

    expect(rows.map((r) => r._raw.exercise_id)).toEqual(['bench-press-db']);
  });

  it('still exports the dropped exercise\'s logged set', async () => {
    await createSyncService(database, bridgeClient() as any).syncNow();

    expect(postedMarkdown).toHaveLength(1);
    expect(postedMarkdown[0]).toContain('- bench-press-db: 1x8');
    expect(postedMarkdown[0]).toContain('- cable-fly: 1x12');
  });

  it('does not mark the session synced until its full work is exported', async () => {
    await createSyncService(database, bridgeClient() as any).syncNow();

    const session = (await database.get('sessions').find(SESSION_ID)) as any;

    expect(session._raw.sync_status).toBe('synced');
    expect(postedMarkdown[0]).toContain('cable-fly');
  });
});
