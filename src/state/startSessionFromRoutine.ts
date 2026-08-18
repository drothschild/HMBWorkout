import { Database, Q } from '@nozbe/watermelondb';
import { Event, RoutineEntry, ExerciseKind } from '@/engine/types';
import { getRoutineSets } from '@/db/repository';
import { entrySetsFromRows } from './routineSetPlans';

/**
 * Build a StartSession event from a routine in the database.
 * Loads routine_exercises with their prescribed `routine_sets`, maps them to
 * RoutineEntry format (with idx field), and returns the event payload ready to
 * dispatch.
 *
 * @param db Database instance
 * @param routineId ID of routine to start
 * @param sessionId ID for new session
 * @returns StartSession event (tag already set)
 * @throws Error if the routine is not found, has no exercises, or has
 *         exercises whose set lists are all empty
 */
export async function startSessionFromRoutine(
  db: Database,
  routineId: string,
  sessionId: string
): Promise<Event & { tag: 'StartSession' }> {
  // Load routine
  const routine = await db.get('routines').find(routineId);

  // Load routine_exercises for this routine
  const routineExercises = (await db
    .get('routine_exercises')
    .query(Q.where('routine_id', routineId))
    .fetch()) as any[];

  // Sort by order
  routineExercises.sort((a, b) => a._raw.order - b._raw.order);

  // Build entries with idx field
  // CRITICAL: idx MUST match re._raw.order from database (canonical 0-based)
  // for onPersistSet to find the routine_exercise row by (routine_id, order: entry.idx)
  const entries: RoutineEntry[] = [];

  for (const re of routineExercises) {
    // Load exercise to get kind
    const exercise = await db.get('exercises').find(re._raw.exercise_id);

    const kind = (exercise as any)._raw.kind as ExerciseKind;

    // The prescription the engine advances through, and the whole plan
    // (#276 Phase 6 — the aggregate columns that used to ride alongside it
    // are undeclared).
    const prescribedSets = await getRoutineSets(db, re.id);

    entries.push({
      idx: re._raw.order, // Use DB order directly, NOT loop counter
      exerciseId: re._raw.exercise_id,
      kind,
      restSeconds: re._raw.rest_seconds || 0,
      supersetGroup: re._raw.superset_group || '',
      sets: entrySetsFromRows(prescribedSets),
    });
  }

  // A routine with no exercises would start an empty session the user can only
  // abandon. Refuse it here so no caller can create one, however it navigated.
  if (entries.length === 0) {
    throw new Error(`Cannot start session: routine ${routineId} has no exercises`);
  }

  // A routine whose every entry has an empty set list is just as unstartable:
  // the engine itself rejects it (h.next_active_landing finds nothing active,
  // its predicate being `length(entry.sets) > 0`), so refuse it at the same
  // layer as the no-exercises guard above rather than surfacing the engine's
  // generic Err to every caller. `hasActiveExercise` in the routine presenters
  // asks the same question one layer further out, through the same
  // `entrySetsFromRows`, so a routine that cannot start never renders as
  // startable either.
  const hasActiveEntry = entries.some((entry) => entry.sets.length > 0);
  if (!hasActiveEntry) {
    throw new Error(`Cannot start session: routine ${routineId} has no entry with any sets to perform`);
  }

  return {
    tag: 'StartSession',
    sessionId,
    nowMs: Date.now(),
    routine: {
      id: routineId,
      name: (routine as any).name,
      entries,
    },
  };
}
