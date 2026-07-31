/**
 * The commentary prompt's history half, read straight off
 * `getExerciseWorkingSetHistory` — same convention as the AI coach's history
 * section: working sets only, warmups excluded, most recent first.
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { upsertExercise, upsertRoutineExercise } from '@/db/repository';
import { REST_COMMENTARY_HISTORY_SETS } from './restCommentaryPrompt';
import { loadRestCommentaryHistory } from './restCommentaryHistory';

const ROUTINE_ID = 'routine-1';
const EXERCISE_ID = 'bench-press';

describe('loadRestCommentaryHistory', () => {
  let database: Database;
  let routineExerciseId: string;

  beforeEach(async () => {
    database = createTestDatabase();

    await database.write(async () => {
      await database.get('routines').create((r: any) => {
        r._raw.id = ROUTINE_ID;
        r.name = 'Push';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
    });

    await upsertExercise(database, EXERCISE_ID, 'Bench Press', 'strength');
    const routineExercise = await upsertRoutineExercise(database, ROUTINE_ID, {
      exerciseId: EXERCISE_ID,
      order: 0,
    });
    routineExerciseId = (routineExercise as any).id;
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  /** Writes one set directly so the test owns created_at (the history clock). */
  async function seedSet(options: {
    setType?: string;
    reps?: number;
    weightKg?: number;
    rpe?: number;
    createdAtMs: number;
    position: number;
  }) {
    await database.write(async () => {
      await database.get('session_sets').create((set: any) => {
        set.sessionId = 'session-1';
        set.routineExerciseId = routineExerciseId;
        set.setType = options.setType ?? 'working';
        set.reps = options.reps;
        set.weightKg = options.weightKg;
        set.rpe = options.rpe;
        set._raw.position = options.position;
        set._raw.created_at = options.createdAtMs;
      });
    });
  }

  it('returns nothing when the exercise has never been logged', async () => {
    await expect(loadRestCommentaryHistory(database, EXERCISE_ID)).resolves.toEqual([]);
  });

  it('returns the logged metrics of a working set', async () => {
    await seedSet({ reps: 8, weightKg: 61.23, rpe: 8, createdAtMs: 1_769_558_400_000, position: 0 });

    const history = await loadRestCommentaryHistory(database, EXERCISE_ID);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ reps: 8, weightKg: 61.23, rpe: 8 });
  });

  it('dates each set to the UTC day it was logged', async () => {
    // 2026-01-28T00:00:00Z
    await seedSet({ reps: 5, createdAtMs: Date.UTC(2026, 0, 28), position: 0 });

    const history = await loadRestCommentaryHistory(database, EXERCISE_ID);

    expect(history[0].loggedDate).toBe('2026-01-28');
  });

  it('excludes warmup sets, matching the working-set history convention', async () => {
    await seedSet({ setType: 'warmup', reps: 12, createdAtMs: 1_000, position: 0 });
    await seedSet({ setType: 'working', reps: 8, createdAtMs: 2_000, position: 1 });

    const history = await loadRestCommentaryHistory(database, EXERCISE_ID);

    expect(history).toHaveLength(1);
    expect(history[0].reps).toBe(8);
  });

  it('returns the most recent sets first', async () => {
    await seedSet({ reps: 5, createdAtMs: 1_000, position: 0 });
    await seedSet({ reps: 6, createdAtMs: 2_000, position: 1 });
    await seedSet({ reps: 7, createdAtMs: 3_000, position: 2 });

    const history = await loadRestCommentaryHistory(database, EXERCISE_ID);

    expect(history.map((set) => set.reps)).toEqual([7, 6, 5]);
  });

  it('caps the result at REST_COMMENTARY_HISTORY_SETS so the prompt stays small', async () => {
    for (let i = 0; i < REST_COMMENTARY_HISTORY_SETS + 4; i++) {
      await seedSet({ reps: 1 + i, createdAtMs: 1_000 + i * 1_000, position: i });
    }

    const history = await loadRestCommentaryHistory(database, EXERCISE_ID);

    expect(history).toHaveLength(REST_COMMENTARY_HISTORY_SETS);
  });

  it('ignores sets belonging to a different exercise', async () => {
    await upsertExercise(database, 'squat', 'Squat', 'strength');
    const other = await upsertRoutineExercise(database, ROUTINE_ID, {
      exerciseId: 'squat',
      order: 1,
    });

    await database.write(async () => {
      await database.get('session_sets').create((set: any) => {
        set.sessionId = 'session-1';
        set.routineExerciseId = (other as any).id;
        set.setType = 'working';
        set.reps = 3;
        set._raw.position = 0;
        set._raw.created_at = 5_000;
      });
    });

    await expect(loadRestCommentaryHistory(database, EXERCISE_ID)).resolves.toEqual([]);
  });
});
