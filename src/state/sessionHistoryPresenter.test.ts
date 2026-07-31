import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, appendSet } from '@/db/repository';
import { formatSetCountLabel, sessionHistoryPresenter } from './sessionHistoryPresenter';

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
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-1';
        re._raw.order = 0;
        re._raw.warmup_sets = 0;
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

  it('returns sessions sorted most-recent-first by endedAt', async () => {
    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Test Routine';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-1';
        e.title = 'Exercise';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      await database.get('routine_exercises').create((re: any) => {
        re._raw.id = 're-1';
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'ex-1';
        re._raw.order = 0;
        re._raw.warmup_sets = 0;
      });
    });

    const now = Date.now();
    // Create sessions in non-chronological order
    const sessionIds = ['session-1', 'session-2', 'session-3'];
    const endedAts = [now - 3000, now - 1000, now - 2000]; // Deliberately out of order

    for (let i = 0; i < sessionIds.length; i++) {
      await createSession(database, {
        sessionId: sessionIds[i],
        routineId: 'routine-1',
        startedAtMs: now - 4000 - i * 1000,
      });
      const session = await database.get('sessions').find(sessionIds[i]);
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = endedAts[i];
        });
      });
    }

    const history = await sessionHistoryPresenter(database);

    expect(history).toHaveLength(3);
    // Should be sorted most-recent-first: session-2 (now-1000), session-3 (now-2000), session-1 (now-3000)
    expect(history[0].id).toBe('session-2');
    expect(history[1].id).toBe('session-3');
    expect(history[2].id).toBe('session-1');
  });

  it('falls back to routine id when routine no longer exists', async () => {
    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = 'routine-deleted';
        r.name = 'Deleted Routine';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
      await database.get('exercises').create((e: any) => {
        e._raw.id = 'ex-1';
        e.title = 'Exercise';
        e.kind = 'strength';
        e._raw.created_at = Date.now();
      });
      await database.get('routine_exercises').create((re: any) => {
        re._raw.id = 're-1';
        re._raw.routine_id = 'routine-deleted';
        re._raw.exercise_id = 'ex-1';
        re._raw.order = 0;
        re._raw.warmup_sets = 0;
      });
    });

    // Create a finished session with a routine that exists
    await createSession(database, {
      sessionId: 'session-with-routine',
      routineId: 'routine-deleted',
      startedAtMs: Date.now() - 60000,
    });
    await appendSet(database, 'session-with-routine', 're-1', {
      setType: 'working',
      reps: 8,
      weightKg: 60,
    });
    const session = await database.get('sessions').find('session-with-routine');
    await database.write(async () => {
      await (session as any).update((record: any) => {
        record._raw.ended_at = Date.now();
      });
    });

    // Now delete the routine but keep the session
    await database.write(async () => {
      const routine = await database.get('routines').find('routine-deleted');
      await routine.destroyPermanently();
    });

    const history = await sessionHistoryPresenter(database);

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('session-with-routine');
    // Should fall back to routine ID when name lookup fails
    expect(history[0].routineName).toBe('routine-deleted');
    expect(history[0].setCount).toBe(1);
  });
});

describe('formatSetCountLabel', () => {
  it('uses the singular for exactly one set', () => {
    expect(formatSetCountLabel(1)).toBe('1 logged set');
  });

  it('uses the plural for zero sets', () => {
    expect(formatSetCountLabel(0)).toBe('0 logged sets');
  });

  it('uses the plural for several sets', () => {
    expect(formatSetCountLabel(2)).toBe('2 logged sets');
  });
});
