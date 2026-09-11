// pattern: Functional Core
/**
 * The bundled free-exercise-db catalog (#335). The data itself is generated —
 * see scripts/build-exercise-catalog.mjs — and pinned to one upstream commit so
 * image URLs never move under an already-resolved exercise.
 */
import { EXERCISE_CATALOG_DATA } from './exerciseCatalogData';

export type CatalogEntry = {
  /** Upstream id, e.g. 'Barbell_Squat'. Unique across the catalog. */
  readonly id: string;
  /** Display name, e.g. 'Barbell Squat'. What title matching runs against. */
  readonly name: string;
  /** 'strength' | 'stretching' | 'cardio' | 'plyometrics' | ... (upstream vocabulary). */
  readonly category: string;
  readonly equipment: string | null;
  readonly primaryMuscles: readonly string[];
  /** First image path relative to the upstream `exercises/` dir, e.g. 'Barbell_Squat/0.jpg'. */
  readonly image: string;
};

/** Must equal COMMIT in scripts/build-exercise-catalog.mjs. */
export const FREE_EXERCISE_DB_COMMIT = 'a859101d633a01c4a1a920d6a8ce41dabba0705f';

export const EXERCISE_CATALOG: readonly CatalogEntry[] = EXERCISE_CATALOG_DATA;

/** The raw.githubusercontent.com URL of an entry's first image, at the pinned commit. */
export function catalogImageUrl(entry: Pick<CatalogEntry, 'image'>): string {
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_COMMIT}/exercises/${entry.image}`;
}
