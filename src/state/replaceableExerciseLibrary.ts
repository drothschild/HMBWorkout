import type { ExerciseKind } from '@/db/models/Exercise';
import {
  filterExerciseLibraryItems,
  type ExerciseLibraryItem,
} from '@/state/exerciseLibraryPresenter';

/**
 * Excludes a no-op selection, then applies the athlete's real query.
 * Cross-kind replacements are deliberately deferred to #380 until it defines
 * how an existing prescription maps to the chosen kind.
 */
export function filterReplaceableExerciseLibraryItems(
  items: ExerciseLibraryItem[],
  currentExerciseId: string,
  query: string,
  kind: ExerciseKind
): ExerciseLibraryItem[] {
  return filterExerciseLibraryItems(
    items.filter((item) => item.id !== currentExerciseId && item.kind === kind),
    query
  );
}
