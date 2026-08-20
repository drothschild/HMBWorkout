/**
 * Write an imported routine document to the database (#267 Phase 2).
 *
 * **This is `acceptDraft` with a different entry source, and deliberately so.**
 * The coach and the file picker are two ways of authoring the same thing, and a
 * routine that came from a `.md` file must be indistinguishable from one the
 * coach wrote by the time the engine sees it. Every rule that path follows is
 * repeated here on purpose rather than shared, because the two have different
 * validators upstream (`validateRoutineDraft` vs `importRoutine`) and the only
 * thing genuinely common is the three-line write:
 *
 * - **Exercise writes are CREATE-ONLY.** Exercises are global and shared by
 *   every routine (AGENTS.md Boundaries), so an import must never rename or
 *   re-kind one out from under another routine. `upsertExercise` *does* update
 *   an existing row, so the existence query in front of it is the guard, not
 *   decoration.
 * - **The id is always minted.** `routine-${Date.now()}`, never the id in the
 *   document's frontmatter: importing a file exported from this same install
 *   must produce a SECOND routine rather than silently overwriting the original
 *   (AC2.4). The app has no undo.
 * - **One `upsertRoutine`.** It reconciles `routine_exercises` in place, so the
 *   pre-existing routine's row ids — the ones `session_sets.routine_exercise_id`
 *   references — are never touched by a new routine's write.
 *
 * It lives in `src/state` rather than next to `importRoutine` so the node jest
 * project covers it; `src/app` is invisible to every suite (AGENTS.md).
 */

import { Database, Q } from '@nozbe/watermelondb';
import { upsertExercise, upsertRoutine } from '@/db/repository';
import type { ImportedRoutine } from '@/interop/importRoutine';

/**
 * Create the routine the document describes, and return its new id.
 *
 * The caller must have a validated `ImportedRoutine` — this function does not
 * re-decide whether the document was importable, because `importRoutine` owns
 * every such refusal and returning `ok: false` there is what keeps this path
 * from being reached at all (AC2.5).
 */
export async function applyRoutineImport(
  database: Database,
  routine: ImportedRoutine
): Promise<string> {
  const exercisesTable = database.get('exercises');

  for (const exercise of routine.exercises) {
    // Create-only. Querying first rather than letting `upsertExercise` decide:
    // it updates title and kind on an existing row, which is exactly the
    // mutation an import must never make.
    const existing = await exercisesTable.query(Q.where('id', exercise.id)).fetchCount();
    if (existing === 0) {
      await upsertExercise(database, exercise.id, exercise.title, exercise.kind);
    }
  }

  const routineId = `routine-${Date.now()}`;

  await upsertRoutine(
    database,
    routineId,
    routine.name,
    routine.entries,
    routine.notes !== undefined ? { notes: routine.notes } : undefined
  );

  return routineId;
}
