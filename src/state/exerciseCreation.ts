import { Q, type Database } from '@nozbe/watermelondb';
import type { ExerciseKind } from '@/db/models/Exercise';

export type CreateExerciseOutcome =
  | { readonly kind: 'created'; readonly exerciseId: string }
  | { readonly kind: 'invalid-title' }
  | { readonly kind: 'invalid-kind' }
  | { readonly kind: 'duplicate'; readonly exerciseId: string; readonly existingTitle: string };

export type CreateExerciseInput = {
  readonly title: string;
  readonly kind: ExerciseKind;
};

const EXERCISE_KINDS = ['strength', 'cardio', 'stretch'] as const;

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Creates one global exercise, never changing an existing record. The id is the
 * title slug, so the duplicate check and insert share one database writer.
 */
export async function createExercise(
  database: Database,
  input: CreateExerciseInput
): Promise<CreateExerciseOutcome> {
  if (!EXERCISE_KINDS.some((candidate) => candidate === input.kind)) return { kind: 'invalid-kind' };

  const title = normalizeTitle(input.title);
  const exerciseId = slugifyTitle(title);
  if (!exerciseId) return { kind: 'invalid-title' };

  return database.write(async () => {
    const exercises = database.get('exercises');
    const existing = await exercises.query(Q.where('id', exerciseId)).fetch();
    if (existing.length > 0) {
      return { kind: 'duplicate', exerciseId, existingTitle: (existing[0] as any).title as string };
    }

    await exercises.create((exercise: any) => {
      exercise._raw.id = exerciseId;
      exercise.title = title;
      exercise.kind = input.kind;
      exercise._raw.created_at = Date.now();
    });
    return { kind: 'created', exerciseId };
  });
}

/** Inline message for a non-created outcome; null when the exercise was created. */
export function exerciseCreationMessage(outcome: CreateExerciseOutcome): string | null {
  switch (outcome.kind) {
    case 'invalid-title':
      return 'Enter a letter or number in the exercise name.';
    case 'invalid-kind':
      return 'Choose a valid exercise type.';
    case 'duplicate':
      return `"${outcome.existingTitle}" already exists. Nothing was changed.`;
    case 'created':
      return null;
  }
}
