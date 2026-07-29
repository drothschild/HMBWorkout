import { Database } from '@nozbe/watermelondb';
import { upsertExercise, upsertRoutine, RoutineExerciseEntry } from '@/db/repository';
import { RoutineDraft, slugifyTitle, validateRoutineDraft } from './draftSchema';

export async function acceptDraft(db: Database, draft: RoutineDraft): Promise<string> {
  // Validate before any writes
  const validated = validateRoutineDraft(draft);

  const routineId = validated.routineId ?? `routine-${Date.now()}`;

  // Upsert exercises (dedupe by slug)
  const upserted = new Set<string>();
  for (const ex of validated.exercises) {
    const slug = slugifyTitle(ex.title);
    if (!upserted.has(slug)) {
      upserted.add(slug);
      await upsertExercise(db, slug, ex.title.trim(), ex.kind);
    }
  }

  // Map exercises to routine_exercise entries
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

  // Upsert routine (creates or updates, replaces routine_exercises)
  await upsertRoutine(db, routineId, validated.name, entries, validated.notes !== undefined ? { notes: validated.notes } : undefined);

  return routineId;
}
