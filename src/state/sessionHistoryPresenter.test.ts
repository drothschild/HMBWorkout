import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, appendSet } from '@/db/repository';
import { sessionHistoryPresenter } from './sessionHistoryPresenter';

describe('sessionHistoryPresenter', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('returns empty array when no sessions exist', async () => {
    const history = await sessionHistoryPresenter(database);
    expect(history).toEqual([]);
  });

  it('lists finished sessions with routine name and set count, excluding the in-progress session', async () => {
    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Push Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-1';
        e.title = 'Bench Press';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      await database.get('routine_exercises').create((re: any) => {
        re._raw.id = 're-1';
        re.routine_id = 'routine-1';
        re.exercise_id = 'ex-1';
        re.order = 0;
        re.warmup_sets = 0;
      });
    });

    // A finished session with two logged sets.
    await createSession(database, {
      sessionId: 'session-finished',
      routineId: 'routine-1',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-finished', 're-1', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });
    await appendSet(database, 'session-finished', 're-1', {
      setType: 'working',
      reps: 8,
      weightKg: 62.5,
    });
    await database.write(async () => {
      const session = await database.get('sessions').find('session-finished');
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    // An in-progress session (no ended_at) that must not be surfaced.
    await createSession(database, {
      sessionId: 'session-active',
      routineId: 'routine-1',
      startedAtMs: Date.now(),
    });

    const history = await sessionHistoryPresenter(database);

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('session-finished');
    expect(history[0].routineName).toBe('Push Day');
    expect(history[0].setCount).toBe(2);
  });
});
