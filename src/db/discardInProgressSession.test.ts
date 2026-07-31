/**
 * discardInProgressSession: the destructive half of abandoning a workout.
 *
 * Deliberately unlike a "delete a finished workout" operation: it must work on a
 * session that is still running (no ended_at, engine_state still populated), and
 * it must take the logged sets with it so nothing is left to sync or display.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from './test-helpers';
import {
  appendSet,
  createSession,
  discardInProgressSession,
  getSession,
  getSessionSets,
  upsertExercise,
  upsertRoutine,
} from './repository';
import { saveEngineState, loadActiveEngineState } from './engineState';
import { SessionState } from '@/engine/types';

async function seedRoutine(database: Database, routineId: string): Promise<string> {
  await upsertExercise(database, 'ex-1', 'Bench Press', 'strength');
  await upsertRoutine(database, routineId, routineId, [
    { exerciseId: 'ex-1', order: 0, warmupSets: 1, targetSets: 3, targetReps: 8, restSeconds: 90 },
  ]);
  const routineExercises = (await database.get('routine_exercises').query().fetch()) as any[];
  return routineExercises.find((re) => re._raw.routine_id === routineId)!.id;
}

function makeEngineState(sessionId: string, routineId: string): SessionState {
  return {
    sessionId,
    routineId,
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 1,
    supersetPosition: 0,
    loggedSets: [],
    startedAtMs: 1000,
    prePausePhase: '',
    entries: [],
  };
}

describe('discardInProgressSession', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('removes a still-running session and every set logged into it', async () => {
    const routineExerciseId = await seedRoutine(database, 'routine-1');
    await createSession(database, {
      sessionId: 'session-live',
      routineId: 'routine-1',
      startedAtMs: 1000,
    });
    await appendSet(database, 'session-live', routineExerciseId, { setType: 'warmup', reps: 10 });
    await appendSet(database, 'session-live', routineExerciseId, { setType: 'working', reps: 8 });
    await saveEngineState(database, 'session-live', makeEngineState('session-live', 'routine-1'));

    await discardInProgressSession(database, 'session-live');

    expect(await getSession(database, 'session-live')).toBeUndefined();
    expect(await getSessionSets(database, 'session-live')).toHaveLength(0);
  });

  it('leaves nothing for restart recovery to rehydrate', async () => {
    await seedRoutine(database, 'routine-1');
    await createSession(database, {
      sessionId: 'session-live',
      routineId: 'routine-1',
      startedAtMs: 1000,
    });
    await saveEngineState(database, 'session-live', makeEngineState('session-live', 'routine-1'));
    expect(await loadActiveEngineState(database)).not.toBeNull();

    await discardInProgressSession(database, 'session-live');

    expect(await loadActiveEngineState(database)).toBeNull();
  });

  it('leaves other sessions, their sets, and the routine graph untouched', async () => {
    const routineExerciseId = await seedRoutine(database, 'routine-1');
    await createSession(database, {
      sessionId: 'session-keep',
      routineId: 'routine-1',
      startedAtMs: 500,
    });
    await appendSet(database, 'session-keep', routineExerciseId, { setType: 'working', reps: 5 });
    await createSession(database, {
      sessionId: 'session-drop',
      routineId: 'routine-1',
      startedAtMs: 1000,
    });
    await appendSet(database, 'session-drop', routineExerciseId, { setType: 'working', reps: 8 });

    await discardInProgressSession(database, 'session-drop');

    expect(await getSession(database, 'session-keep')).toBeDefined();
    expect(await getSessionSets(database, 'session-keep')).toHaveLength(1);
    expect(await database.get('routines').find('routine-1')).toBeDefined();
    expect(await database.get('exercises').find('ex-1')).toBeDefined();
    expect((await database.get('routine_exercises').query().fetch())).toHaveLength(1);
  });

  it('is a no-op for a session that is already gone', async () => {
    await expect(discardInProgressSession(database, 'never-existed')).resolves.toBeUndefined();
  });

  // M3a: Entry guard for empty/blank session IDs
  it('M3a: rejects empty sessionId with exact message, writes nothing', async () => {
    await expect(discardInProgressSession(database, '')).rejects.toThrow(
      'discardInProgressSession: sessionId must not be empty or blank'
    );

    // Verify nothing was written
    const sessions = await database.get('sessions').query().fetch();
    expect(sessions).toHaveLength(0);
  });

  it('M3a: rejects blank-only sessionId with exact message, writes nothing', async () => {
    await expect(discardInProgressSession(database, '   ')).rejects.toThrow(
      'discardInProgressSession: sessionId must not be empty or blank'
    );

    // Verify nothing was written
    const sessions = await database.get('sessions').query().fetch();
    expect(sessions).toHaveLength(0);
  });

  // M3c: Repository-level destroy-failure propagation
  it('M3c: propagates database batch errors (destroy failure)', async () => {
    const routineExerciseId = await seedRoutine(database, 'routine-1');
    await createSession(database, {
      sessionId: 'session-live',
      routineId: 'routine-1',
      startedAtMs: 1000,
    });
    await appendSet(database, 'session-live', routineExerciseId, { setType: 'working', reps: 8 });

    // Mock the batch method to reject
    const batchSpy = jest.spyOn(database, 'batch').mockRejectedValueOnce(
      new Error('Database batch failed: simulated write error')
    );

    // Discard should reject with the batch error
    await expect(discardInProgressSession(database, 'session-live')).rejects.toThrow(
      'Database batch failed: simulated write error'
    );

    // Verify the batch was attempted
    expect(batchSpy).toHaveBeenCalled();

    // Verify session is still on disk (discard failed)
    expect(await getSession(database, 'session-live')).toBeDefined();

    batchSpy.mockRestore();
  });
});
