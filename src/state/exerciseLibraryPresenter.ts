import type { Database } from '@nozbe/watermelondb';
import type Exercise from '@/db/models/Exercise';
import type { ExerciseKind } from '@/db/models/Exercise';

export interface ExerciseLibraryItem {
  id: string;
  title: string;
  kind: ExerciseKind;
  imagePath: string | null;
}

/** Narrows a presenter-shaped library without changing its established order. */
export function filterExerciseLibraryItems(
  items: ExerciseLibraryItem[],
  query: string
): ExerciseLibraryItem[] {
  const foldedQuery = query.trim().toLocaleLowerCase();
  if (!foldedQuery) return items;

  return items.filter((item) => item.title.toLocaleLowerCase().includes(foldedQuery));
}

/** Every exercise stored locally, formatted and sorted for the Exercises tab. */
export async function exerciseLibraryPresenter(db: Database): Promise<ExerciseLibraryItem[]> {
  const exercises = (await db.get('exercises').query().fetch()) as Exercise[];

  return exercises
    .map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      kind: exercise.kind,
      imagePath: exercise.imagePath ?? null,
    }))
    .sort((a, b) => {
      const folded = a.title.toLocaleLowerCase().localeCompare(b.title.toLocaleLowerCase());
      return folded || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}
