import { Database, Q } from '@nozbe/watermelondb';
import { upsertExercise, upsertRoutine, RoutineExerciseEntry } from '@/db/repository';
import { RoutineDraft, slugifyTitle, validateRoutineDraft } from './draftSchema';
import { type AiCoachMode } from './contextBuilder';

function normalizeWhitespace(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ');
}

export async function acceptDraft(db: Database, draft: RoutineDraft, mode: AiCoachMode): Promise<string> {
  const validated = validateRoutineDraft(draft);

  // Mode is authoritative for the routine id. In create mode, mint a fresh id
  // regardless of any draft-supplied id (which may be echoing an existing routine's id).
  // In edit mode, force the id to match the mode's routine, ignoring the draft.
  // Onboarding carries no routine id — the first routine it offers is a brand-new
  // one — so it takes the create branch. This is not optional bookkeeping: without
  // it `mode.routineId` does not typecheck, since onboarding has no such field.
  const routineId =
    mode.kind === 'create' || mode.kind === 'onboarding' ? `routine-${Date.now()}` : mode.routineId;

  const exercisesTable = db.get('exercises');

  const upserted = new Set<string>();
  for (const ex of validated.exercises) {
    const slug = slugifyTitle(ex.title);
    if (!upserted.has(slug)) {
      upserted.add(slug);

      // Create-only: an AI draft must never mutate an existing exercise's kind, title, or description, since exercises are global and shared across every routine.
      const existing = await exercisesTable.query(Q.where('id', slug)).fetchCount();
      if (existing === 0) {
        const normalizedTitle = normalizeWhitespace(ex.title);
        await upsertExercise(db, slug, normalizedTitle, ex.kind, ex.description);
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
