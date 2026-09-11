// pattern: Imperative Shell
import type { Database } from '@nozbe/watermelondb';
import type Exercise from '@/db/models/Exercise';
import type { ExerciseKind } from '@/db/models/Exercise';
import type { CatalogEntry } from './exerciseCatalog';

function exerciseKind(category: string): ExerciseKind {
  if (category === 'cardio') return 'cardio';
  if (category === 'stretching') return 'stretch';
  return 'strength';
}

/**
 * Create the pinned catalog entries that are not already present on-device.
 * Existing rows are user data and are never updated by catalog refreshes.
 */
export async function seedExerciseCatalog(
  database: Database,
  catalog: readonly CatalogEntry[],
  createdAt = Date.now()
): Promise<number> {
  return database.write(async () => {
    const exercises = database.get<Exercise>('exercises');
    const existing = await exercises.query().fetch();
    const existingIds = new Set(existing.map((exercise) => exercise.id));
    const missing = catalog.filter((entry) => !existingIds.has(entry.id));

    if (missing.length === 0) return 0;

    await database.batch(
      missing.map((entry) =>
        exercises.prepareCreate((exercise: any) => {
          exercise._raw.id = entry.id;
          exercise.title = entry.name;
          exercise.kind = exerciseKind(entry.category);
          exercise._raw.muscle_group = entry.primaryMuscles[0] ?? null;
          exercise._raw.equipment = entry.equipment;
          exercise._raw.description = entry.instructions.length > 0 ? entry.instructions.join('\n') : null;
          exercise._raw.image_path = null;
          exercise._raw.image_source = null;
          exercise._raw.created_at = createdAt;
        })
      )
    );

    return missing.length;
  });
}
