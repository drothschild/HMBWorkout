/**
 * #335 AC5.1: exercise images never reach the markdown export.
 *
 * `image_path` / `image_source` are device-local display state — a path under
 * the app's documents directory and a provenance tag. Neither belongs in the
 * vault document, which is a portable backup. The export path reads `title`
 * and `kind` off each exercise row and nothing else; this pins that from the
 * outside, by exporting the same data before and after images are set and
 * requiring the two documents to be byte-identical.
 *
 * The fixture carries a superset, rest values, and a finished session with
 * stamped logged sets, so both serializers run their real row-driven paths
 * rather than the empty-document early returns.
 */
import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import {
  upsertExercise,
  upsertRoutine,
  createSession,
  appendSet,
  setExerciseImage,
} from '@/db/repository';
import { exportRoutine, exportSessionHistory } from './exportService';

const ROUTINE_ID = 'routine-images';
const SESSION_ID = 'session-images';

const IMAGE_MARKERS = ['exercise-images/', 'catalog:', 'url:'];

async function seed(db: Database): Promise<void> {
  await upsertExercise(db, 'ex-squat', 'Barbell Squat', 'strength');
  await upsertExercise(db, 'ex-row', 'Barbell Row', 'strength');
  await upsertRoutine(db, ROUTINE_ID, 'Legs and Back', [
    {
      exerciseId: 'ex-squat',
      order: 0,
      supersetGroup: 'A',
      restSeconds: 90,
      sets: [
        { setType: 'warmup', targetReps: 5, targetWeightKg: 40 },
        { setType: 'normal', targetReps: 5, targetWeightKg: 100 },
      ],
    },
    {
      exerciseId: 'ex-row',
      order: 1,
      supersetGroup: 'A',
      restSeconds: 90,
      sets: [{ setType: 'normal', targetReps: 8, targetWeightKg: 60 }],
    },
  ]);

  const rows = (await db.get('routine_exercises').query().fetch()) as any[];
  const rowFor = (exerciseId: string) => rows.find((r) => r._raw.exercise_id === exerciseId).id;

  await createSession(db, { sessionId: SESSION_ID, routineId: ROUTINE_ID, startedAtMs: 1_000 });
  await appendSet(db, SESSION_ID, rowFor('ex-squat'), {
    setType: 'warmup',
    reps: 5,
    weightKg: 40,
    exerciseId: 'ex-squat',
  });
  await appendSet(db, SESSION_ID, rowFor('ex-squat'), {
    setType: 'working',
    reps: 5,
    weightKg: 100,
    exerciseId: 'ex-squat',
  });
  await appendSet(db, SESSION_ID, rowFor('ex-row'), {
    setType: 'working',
    reps: 8,
    weightKg: 60,
    exerciseId: 'ex-row',
  });
  await db.write(async () => {
    const session = await db.get('sessions').find(SESSION_ID);
    await session.update((s: any) => {
      s._raw.ended_at = 5_000;
    });
  });
  await flush();
}

async function exportBoth(db: Database) {
  const routineMarkdown = await exportRoutine(db, ROUTINE_ID);
  const history = await exportSessionHistory(db);
  return { routineMarkdown, history };
}

describe('exercise images do not reach the markdown export (#335 AC5.1)', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  it('exportRoutine and exportSessionHistory are byte-identical before and after images are set', async () => {
    await seed(db);

    const before = await exportBoth(db);

    await setExerciseImage(db, 'ex-squat', {
      imagePath: 'exercise-images/ex-squat-a.jpg',
      imageSource: 'catalog:Barbell_Squat',
    });
    await setExerciseImage(db, 'ex-row', {
      imagePath: 'exercise-images/ex-row-b.jpg',
      imageSource: 'url:https://example.com/row.jpg',
    });
    await flush();

    // Precondition: the images really are on the rows. Without this, a
    // setExerciseImage that silently wrote nothing would make the byte-identity
    // below vacuous.
    const exercises = (await db.get('exercises').query().fetch()) as any[];
    const sourceOf = (id: string) => exercises.find((e) => e.id === id)._raw.image_source;
    const pathOf = (id: string) => exercises.find((e) => e.id === id)._raw.image_path;
    expect(sourceOf('ex-squat')).toBe('catalog:Barbell_Squat');
    expect(sourceOf('ex-row')).toBe('url:https://example.com/row.jpg');
    expect(pathOf('ex-squat')).toBe('exercise-images/ex-squat-a.jpg');
    expect(pathOf('ex-row')).toBe('exercise-images/ex-row-b.jpg');

    const after = await exportBoth(db);

    // Both serializers produced real documents, not the empty early returns.
    expect(before.routineMarkdown).toContain('- ex-squat:');
    expect(before.history.markdown).toContain('type: workout-session');
    expect(before.history.markdown).toContain('ex-row');

    expect(before.history.failures).toStrictEqual([]);
    expect(after.history.failures).toStrictEqual([]);

    expect(after.routineMarkdown === before.routineMarkdown).toBe(true);
    expect(after.history.markdown === before.history.markdown).toBe(true);

    for (const markdown of [
      before.routineMarkdown,
      before.history.markdown,
      after.routineMarkdown,
      after.history.markdown,
    ]) {
      for (const marker of IMAGE_MARKERS) {
        expect(markdown).not.toContain(marker);
      }
    }
  });
});
