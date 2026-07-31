/**
 * The accept path for a chosen alternate — the AI-authored half of a swap.
 *
 * It inherits `acceptDraft`'s two invariants unchanged:
 *
 *  - **Exercise identity is `slugifyTitle(title)`.** Reusing a title maps to
 *    the existing record, which is what makes history accumulate across
 *    routines instead of fragmenting.
 *  - **Create-only.** Exercises are global and shared by every routine, so a
 *    swap made in one workout must never rename, re-kind, or re-describe a
 *    movement out from under another. A missing exercise is created; an
 *    existing one is left exactly as it is.
 *
 * The kind comes from the entry being replaced rather than from the model: a
 * substitute changes identity only, and a `stretch` entry that came back as
 * `cardio` would desynchronize the engine's entry from its exercise record.
 */

import { Database, Q } from '@nozbe/watermelondb';
import type { ExerciseKind } from '@/engine/types';
import {
  findRoutineExerciseIdByOrder,
  updateRoutineExerciseExerciseId,
  upsertExercise,
} from '@/db/repository';
import { ExerciseAlternate, validateExerciseAlternate } from './alternatesSchema';
import { slugifyTitle } from './draftSchema';

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Resolve the chosen alternate to an exercise id, creating the exercise when
 * it does not exist yet.
 *
 * Validates the alternate a second time first (the client already validated
 * the whole payload on receipt) — this is the last checkpoint before a write.
 *
 * @returns the exercise id: `slugifyTitle(alternate.title)`
 */
export async function ensureAlternateExercise(
  database: Database,
  alternate: ExerciseAlternate,
  kind: ExerciseKind
): Promise<string> {
  const validated = validateExerciseAlternate(alternate);
  const exerciseId = slugifyTitle(validated.title);

  const existing = await database
    .get('exercises')
    .query(Q.where('id', exerciseId))
    .fetchCount();

  if (existing === 0) {
    await upsertExercise(
      database,
      exerciseId,
      normalizeWhitespace(validated.title),
      kind,
      validated.description
    );
  }

  return exerciseId;
}

/**
 * Point the routine's entry at the chosen exercise.
 *
 * The row is located the same way `onPersistSet` locates it — by
 * (routine_id, order) — because `order` is the engine entry's canonical
 * 0-based `idx`. It is then updated in place, so the row id survives and with
 * it every `session_sets.routine_exercise_id` reference and every
 * working-set-history join.
 */
export async function applyAlternateToRoutine(
  database: Database,
  routineId: string,
  order: number,
  exerciseId: string
): Promise<void> {
  const rowId = await findRoutineExerciseIdByOrder(database, routineId, order);

  if (!rowId) {
    throw new Error(`Routine exercise not found for routine=${routineId}, order ${order}`);
  }

  await updateRoutineExerciseExerciseId(database, rowId, exerciseId);
}
