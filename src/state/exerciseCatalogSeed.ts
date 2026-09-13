// pattern: Imperative Shell
import type { Database } from '@nozbe/watermelondb';
import type Exercise from '@/db/models/Exercise';
import type { ExerciseKind } from '@/db/models/Exercise';
import type { ExerciseLibraryEntry } from './exerciseCatalog';
import { bundledCatalogImagePath, catalogImageSource } from './exerciseImageState';

function exerciseKind(category: string): ExerciseKind {
  if (category === 'cardio') return 'cardio';
  if (category === 'stretching') return 'stretch';
  return 'strength';
}

/**
 * Create the pinned catalog entries that are not already present on-device.
 * Existing rows are user data. The narrow exception upgrades only a previously
 * seeded, canonical catalog source with no path to its bundled original; URL,
 * web and valid Documents-file choices always remain untouched.
 */
export async function seedExerciseCatalog(
  database: Database,
  catalog: readonly ExerciseLibraryEntry[],
  createdAt = Date.now()
): Promise<number> {
  return database.write(async () => {
    const exercises = database.get<Exercise>('exercises');
    const existing = await exercises.query().fetch();
    const existingIds = new Set(existing.map((exercise) => exercise.id));
    const missing = catalog.filter((entry) => !existingIds.has(entry.id));
    const byId = new Map(catalog.map(entry => [entry.id, entry]));
    const backfill = existing.filter((exercise) => {
      const entry = byId.get(exercise.id);
      return entry !== undefined
        && entry.image !== null
        && exercise.imagePath === null
        && exercise.imageSource === catalogImageSource(entry.id);
    });

    if (missing.length === 0 && backfill.length === 0) return 0;

    await database.batch(
      [
        ...backfill.map((exercise) =>
          exercise.prepareUpdate((row: any) => {
            row.imagePath = bundledCatalogImagePath(exercise.id);
          })
        ),
        ...missing.map((entry) =>
        exercises.prepareCreate((exercise: any) => {
          exercise._raw.id = entry.id;
          exercise.title = entry.name;
          exercise.kind = exerciseKind(entry.category);
          exercise._raw.muscle_group = entry.primaryMuscles[0] ?? null;
          exercise._raw.equipment = entry.equipment;
          exercise._raw.description = entry.instructions.length > 0 ? entry.instructions.join('\n') : null;
          // A bundled path is not a Documents path: ExerciseImage resolves it
          // through Metro's static manifest. The three upstream imageless rows
          // intentionally remain null placeholders. A terminal catalog source
          // keeps boot from turning seed rows into model calls or network work.
          exercise._raw.image_path = entry.image === null ? null : bundledCatalogImagePath(entry.id);
          exercise._raw.image_source = catalogImageSource(entry.id);
          exercise._raw.created_at = createdAt;
        })
        ),
      ]
    );

    return missing.length;
  });
}
