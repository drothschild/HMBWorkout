import { Q, type Database } from '@nozbe/watermelondb';
import type { ExerciseKind } from '@/db/models/Exercise';

export type CreateExerciseOutcome =
  | { readonly kind: 'created'; readonly exerciseId: string }
  | { readonly kind: 'invalid-title' }
  | { readonly kind: 'invalid-kind' }
  | { readonly kind: 'duplicate'; readonly exerciseId: string };

export type CreateExerciseInput = {
  readonly title: string;
  readonly kind: ExerciseKind;
};

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EXERCISE_KINDS = ['strength', 'cardio', 'stretch'] as const;

function isExerciseKind(kind: unknown): kind is ExerciseKind {
  return EXERCISE_KINDS.some((candidate) => candidate === kind);
}

/**
 * Creates one global exercise, never changing an existing record. Exercise ids
 * are title-derived slugs, so the duplicate check and insertion share one
 * database writer and cannot overwrite a concurrent or pre-existing choice.
 */
export async function createExercise(
  database: Database,
  input: CreateExerciseInput
): Promise<CreateExerciseOutcome> {
  if (!isExerciseKind(input.kind)) return { kind: 'invalid-kind' };

  const title = normalizeTitle(input.title);
  const exerciseId = slugifyTitle(title);
  if (!exerciseId) return { kind: 'invalid-title' };

  return database.write(async () => {
    const exercises = database.get('exercises');
    const count = await exercises.query(Q.where('id', exerciseId)).fetchCount();
    if (count > 0) return { kind: 'duplicate', exerciseId };

    await exercises.create((exercise: any) => {
      exercise._raw.id = exerciseId;
      exercise.title = title;
      exercise.kind = input.kind;
      exercise._raw.created_at = Date.now();
    });
    return { kind: 'created', exerciseId };
  });
}
