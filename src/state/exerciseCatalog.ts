// pattern: Functional Core
/**
 * The bundled free-exercise-db catalog (#335). The data itself is generated —
 * see scripts/build-exercise-catalog.mjs — and pinned to one upstream commit so
 * image URLs never move under an already-resolved exercise.
 */
import { EXERCISE_CATALOG_DATA } from './exerciseCatalogData';

export type ExerciseLibraryEntry = {
  /** Upstream id, e.g. 'Barbell_Squat'. Unique across the catalog. */
  readonly id: string;
  /** Display name, e.g. 'Barbell Squat'. What title matching runs against. */
  readonly name: string;
  /** 'strength' | 'stretching' | 'cardio' | 'plyometrics' | ... (upstream vocabulary). */
  readonly category: string;
  readonly equipment: string | null;
  readonly primaryMuscles: readonly string[];
  /** Ordered upstream coaching instructions. The first item is the summary cue. */
  readonly instructions: readonly string[];
  /** First upstream image path, or null for the three entries without images. */
  readonly image: string | null;
};

export type CatalogEntry = ExerciseLibraryEntry & { readonly image: string };

/** Must equal COMMIT in scripts/build-exercise-catalog.mjs. */
export const FREE_EXERCISE_DB_COMMIT = 'a859101d633a01c4a1a920d6a8ce41dabba0705f';

export const EXERCISE_LIBRARY_CATALOG: readonly ExerciseLibraryEntry[] = EXERCISE_CATALOG_DATA;

/** Image matching excludes the three upstream entries that have no image. */
export const EXERCISE_CATALOG: readonly CatalogEntry[] = EXERCISE_CATALOG_DATA.filter(
  (entry): entry is CatalogEntry => entry.image !== null
);

/** The raw.githubusercontent.com URL of an entry's first image, at the pinned commit. */
export function catalogImageUrl(entry: Pick<CatalogEntry, 'image'>): string {
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_COMMIT}/exercises/${entry.image}`;
}
