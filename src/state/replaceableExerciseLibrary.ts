import {
  filterExerciseLibraryItems,
  type ExerciseLibraryItem,
} from '@/state/exerciseLibraryPresenter';

/**
 * Excludes a no-op selection, then applies the athlete's real query. The
 * caller forwards each selected row's own kind to the replacement contract.
 */
export function filterReplaceableExerciseLibraryItems(
  items: ExerciseLibraryItem[],
  currentExerciseId: string,
  query: string
): ExerciseLibraryItem[] {
  return filterExerciseLibraryItems(
    items.filter((item) => item.id !== currentExerciseId),
    query
  );
}
