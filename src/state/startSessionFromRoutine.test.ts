import { createTestDatabase } from '@/db/test-helpers';
import { startSessionFromRoutine } from './startSessionFromRoutine';
import { SessionState } from '@/engine/types';

describe('startSessionFromRoutine', () => {
  it('builds StartSession event from a routine', async () => {
    const db = await createTestDatabase();

    // Create routine with exercises
    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Push Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'bench-press';
        e.title = 'Bench Press';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'bench-press';
        re._raw.order = 0;
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 4;
        re._raw.target_reps = 6;
        re._raw.rest_seconds = 120;
      });
    });

    const sessionId = `session-${Date.now()}`;
    const event = await startSessionFromRoutine(
      db,
      'routine-1',
      sessionId
    );

    expect(event.tag).toBe('StartSession');
    expect(event.sessionId).toBe(sessionId);
    expect(event.nowMs).toBeGreaterThan(0);
    expect(event.routine).toBeDefined();
    expect((event.routine as any).id).toBe('routine-1');
    expect((event.routine as any).name).toBe('Push Day');
    expect((event.routine as any).entries).toHaveLength(1);
    expect((event.routine as any).entries[0]).toMatchObject({
      idx: 0,
      exerciseId: 'bench-press',
      kind: 'strength',
      warmupSets: 1,
      targetSets: 4,
      targetReps: 6,
      targetDurationSeconds: 0,
      restSeconds: 120,
      supersetGroup: '',
    });
  });

  it('handles superset groups with idx field', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-2';
        r.name = 'Superset Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      for (let i = 1; i <= 2; i++) {
        await db.get('exercises').create((e: any) => {
          e._raw.id = `ex-${i}`;
          e.title = `Exercise ${i}`;
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      }

      // Superset pair
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-2';
        re._raw.exercise_id = 'ex-1';
        re._raw.order = 0;
        re._raw.superset_group = 'ss1';
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
        re._raw.rest_seconds = 90;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-2';
        re._raw.exercise_id = 'ex-2';
        re._raw.order = 1;
        re._raw.superset_group = 'ss1';
        re._raw.warmup_sets = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 10;
        re._raw.rest_seconds = 90;
      });
    });

    const sessionId2 = `session-${Date.now()}`;
    const event = await startSessionFromRoutine(
      db,
      'routine-2',
      sessionId2
    );

    const entries = (event.routine as any).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].idx).toBe(0);
    expect(entries[0].supersetGroup).toBe('ss1');
    expect(entries[1].idx).toBe(1);
    expect(entries[1].supersetGroup).toBe('ss1');
  });

  it('handles cardio and stretch exercises with duration', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-3';
        r.name = 'Cardio';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      for (const [id, kind] of [['rowing', 'cardio'], ['stretching', 'stretch']]) {
        await db.get('exercises').create((e: any) => {
          e._raw.id = id;
          e.title = id;
          e._raw.kind = kind;
          e._raw.created_at = Date.now();
        });
      }

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-3';
        re._raw.exercise_id = 'rowing';
        re._raw.order = 0;
        re._raw.target_duration_seconds = 300;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-3';
        re._raw.exercise_id = 'stretching';
        re._raw.order = 1;
        re._raw.target_duration_seconds = 120;
      });
    });

    const sessionId3 = `session-${Date.now()}`;
    const event = await startSessionFromRoutine(
      db,
      'routine-3',
      sessionId3
    );

    const entries = (event.routine as any).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      idx: 0,
      exerciseId: 'rowing',
      kind: 'cardio',
      targetDurationSeconds: 300,
    });
    expect(entries[1]).toMatchObject({
      idx: 1,
      exerciseId: 'stretching',
      kind: 'stretch',
      targetDurationSeconds: 120,
    });
  });

  it('throws if routine does not exist', async () => {
    const db = await createTestDatabase();

    await expect(
      startSessionFromRoutine(db, 'nonexistent', 'session-123')
    ).rejects.toThrow();
  });

  it('refuses to start a session from a routine with no exercises', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-empty';
        r.name = 'Empty Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
    });

    await expect(
      startSessionFromRoutine(db, 'routine-empty', 'session-123')
    ).rejects.toThrow(/no exercises/);
  });
});
