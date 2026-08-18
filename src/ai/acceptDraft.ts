import { Database, Q } from '@nozbe/watermelondb';
import { upsertExercise, upsertRoutine, RoutineExerciseEntry } from '@/db/repository';
import { RoutineDraft, slugifyTitle, validateRoutineDraft } from './draftSchema';
import { type AiCoachMode } from './contextBuilder';
import { lbsToKg } from '@/state/weightUnits';

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
    restSeconds: ex.restSeconds,
    // No per-exercise counts, load or duration are passed at all (#276 Phase
    // 4). `upsertRoutine` DERIVES all five of those columns from the set list
    // below, so passing them would be offering a second, competing answer for
    // a value the list already fixes — the drift the derivation exists to make
    // impossible.
    notes: ex.notes,
    sets: ex.sets.map((set) => ({
      setType: set.type,
      targetReps: set.reps,
      targetRepsMax: set.repsMax,
      // THE single write-side unit boundary, and it is per set. The model
      // speaks lbs (it reads history in lbs — contextBuilder's formatWeightLbs);
      // storage is canonical kg. Nothing below this line sees pounds, and
      // nothing above it sees kg — a second conversion anywhere turns 50lbs
      // into 22.68kg and then into 10.29kg.
      //
      // Guard on undefined rather than falsiness: the validator has already
      // rejected 0, but `lbsToKg(0)` is 0, and a 0 written into the column is a
      // value computeSetPrefill silently ignores.
      targetWeightKg: set.weightLbs !== undefined ? lbsToKg(set.weightLbs) : undefined,
      targetDurationSeconds: set.durationSeconds,
      // Per-set rest override (#281). Seconds, no unit conversion — unlike
      // weightLbs, rest is dimensionless across the lbs/kg boundary. 0 is a
      // real override and passes through (the validator accepted it).
      restSeconds: set.restSeconds,
    })),
  }));

  await upsertRoutine(db, routineId, validated.name, entries, validated.notes !== undefined ? { notes: validated.notes } : undefined);

  return routineId;
}
