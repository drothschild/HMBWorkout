import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { appendSet, createSession, upsertExercise, upsertRoutine } from '@/db/repository';
import { exerciseHistoryPresenter } from './exerciseHistoryPresenter';

describe('exerciseHistoryPresenter', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
    await upsertExercise(database, 'exercise-history-detail', 'Bench Press', 'strength');
    await upsertRoutine(database, 'routine-history-detail', 'Push Day', [
      {
        exerciseId: 'exercise-history-detail',
        order: 0,
        sets: [
          { setType: 'warmup', targetReps: 10 },
          { setType: 'normal', targetReps: 8 },
        ],
      },
    ]);
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  async function routineExerciseId(): Promise<string> {
    const [row] = (await database.get('routine_exercises').query().fetch()) as any[];
    return row.id;
  }

  async function finishSession(sessionId: string, endedAt: number): Promise<void> {
    await database.write(async () => {
      const session = await database.get('sessions').find(sessionId);
      await (session as any).update((record: any) => {
        record._raw.ended_at = endedAt;
      });
    });
  }

  it('groups all set types from completed workouts newest-first and formats each set', async () => {
    const rowId = await routineExerciseId();
    const olderEnd = 1700000000000;
    const newerEnd = olderEnd + 86400000;

    await createSession(database, {
      sessionId: 'older-session', routineId: 'routine-history-detail', startedAtMs: olderEnd - 60000,
    });
    await appendSet(database, 'older-session', rowId, {
      setType: 'working', reps: 5, weightKg: 40, exerciseId: 'exercise-history-detail',
    });
    await finishSession('older-session', olderEnd);

    await createSession(database, {
      sessionId: 'newer-session', routineId: 'routine-history-detail', startedAtMs: newerEnd - 60000,
    });
    await appendSet(database, 'newer-session', rowId, {
      setType: 'warmup', reps: 10, weightKg: 20, exerciseId: 'exercise-history-detail',
    });
    await appendSet(database, 'newer-session', rowId, {
      setType: 'working', reps: 8, weightKg: 30, rpe: 8, exerciseId: 'exercise-history-detail',
    });
    await appendSet(database, 'newer-session', rowId, {
      setType: 'cardio', durationSeconds: 90, exerciseId: 'exercise-history-detail',
    });
    await appendSet(database, 'newer-session', rowId, {
      setType: 'stretch', durationSeconds: 45, exerciseId: 'exercise-history-detail',
    });
    await finishSession('newer-session', newerEnd);

    // Active workout data must never appear on the read-only history view.
    await createSession(database, {
      sessionId: 'active-session', routineId: 'routine-history-detail', startedAtMs: newerEnd + 60000,
    });
    await appendSet(database, 'active-session', rowId, {
      setType: 'working', reps: 99, exerciseId: 'exercise-history-detail',
    });

    const history = await exerciseHistoryPresenter(database, 'exercise-history-detail');

    expect(history.map((workout) => workout.sessionId)).toEqual(['newer-session', 'older-session']);
    expect(history[0].endedAt).toBe(newerEnd);
    expect(history[0].dateLabel).toBeTruthy();
    expect(history[0].sets.map((set) => set.label)).toEqual([
      'Warmup 1', 'Set 1', 'Set 2', 'Set 3',
    ]);
    expect(history[0].sets.map((set) => set.line)).toEqual([
      '10 x 44lbs', '8 x 66lbs RPE: 8', '90s', '45s',
    ]);
    expect(history.flatMap((workout) => workout.sets.map((set) => set.line))).not.toContain('99 reps');
  }, 20000);

  it('returns an empty list when the exercise has no completed history', async () => {
    expect(await exerciseHistoryPresenter(database, 'exercise-history-detail')).toEqual([]);
  });
});
