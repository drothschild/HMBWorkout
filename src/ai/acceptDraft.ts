import { Database, Q } from '@nozbe/watermelondb';
import { upsertExercise, upsertRoutine, RoutineExerciseEntry } from '@/db/repository';
import { RoutineDraft, slugifyTitle, validateRoutineDraft } from './draftSchema';

function normalizeWhitespace(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ');
}

export async function acceptDraft(db: Database, draft: RoutineDraft): Promise<string> {
  const validated = validateRoutineDraft(draft);

  const trimmed = validated.routineId?.trim();
  const routineId = trimmed ? trimmed : `routine-${Date.now()}`;

  const exercisesTable = db.get('exercises');

  const upserted = new Set<string>();
  for (const ex of validated.exercises) {
    const slug = slugifyTitle(ex.title);
    if (!upserted.has(slug)) {
      upserted.add(slug);

      const existing = await exercisesTable.query(Q.where('id', slug)).fetchCount();
      if (existing === 0) {
        const normalizedTitle = normalizeWhitespace(ex.title);
        await upsertExercise(db, slug, normalizedTitle, ex.kind);
      }
    }
  }

  const entries: RoutineExerciseEntry[] = validated.exercises.map((ex, index) => ({
    exerciseId: slugifyTitle(ex.title),
    order: index,
    supersetGroup: ex.supersetGroup,
    warmupSets: ex.warmupSets,
    targetSets: ex.targetSets,
    targetReps: ex.targetReps,
    targetDurationSeconds: ex.targetDurationSeconds,
    restSeconds: ex.restSeconds,
    notes: ex.notes,
  }));

  await upsertRoutine(db, routineId, validated.name, entries, validated.notes !== undefined ? { notes: validated.notes } : undefined);

  return routineId;
}
