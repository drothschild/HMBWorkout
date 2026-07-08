import { Database, Q } from '@nozbe/watermelondb';
import Session from './models/Session';
import SessionSet, { SetType } from './models/SessionSet';
import RoutineExercise from './models/RoutineExercise';
import { validateSet } from './validation';

/**
 * Session creation options
 */
interface CreateSessionOptions {
  sessionId: string;
  routineId: string;
  startedAtMs: number;
}

/**
 * Set input options for appendSet
 */
interface AppendSetOptions {
  setType?: SetType;
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceM?: number;
  rpe?: number;
}

/**
 * Routine exercise options for upsertRoutineExercise
 */
interface UpsertRoutineExerciseOptions {
  exerciseId: string;
  order: number;
  supersetGroup?: string;
  warmupSets?: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
}

/**
 * Create a new session with the given id, routine id, and start time.
 * The session is created with syncStatus = 'local' by default.
 * Must be called within a Writer context.
 *
 * @param database The database instance
 * @param options Session creation options
 */
export async function createSession(
  database: Database,
  options: CreateSessionOptions
): Promise<Session> {
  const { sessionId, routineId, startedAtMs } = options;

  const sessionsTable = database.get('sessions');
  const session = await sessionsTable.create((session: any) => {
    session._raw.id = sessionId;
    session._raw.routine_id = routineId;
    session._raw.started_at = startedAtMs;
    session._raw.sync_status = 'local';
    session._raw.created_at = Date.now();
  });

  return session as Session;
}

/**
 * Append a set to a session.
 * Defaults setType to 'working' if not provided.
 * Validates input before writing to database.
 *
 * @param database The database instance
 * @param sessionId The session ID
 * @param routineExerciseId The routine exercise ID
 * @param options Set options
 * @throws ValidationError if set input is invalid
 */
export async function appendSet(
  database: Database,
  sessionId: string,
  routineExerciseId: string,
  options: AppendSetOptions
): Promise<void> {
  const {
    setType = 'working',
    reps,
    weightKg,
    durationSeconds,
    distanceM,
    rpe,
  } = options;

  // Validate input before writing
  validateSet({
    reps,
    weightKg,
    durationSeconds,
    distanceM,
    rpe,
  });

  const sessionSetsTable = database.get('session_sets');
  await sessionSetsTable.create((set: any) => {
    set._raw.session_id = sessionId;
    set._raw.routine_exercise_id = routineExerciseId;
    set._raw.set_type = setType;
    if (reps !== undefined) set._raw.reps = reps;
    if (weightKg !== undefined) set._raw.weight_kg = weightKg;
    if (durationSeconds !== undefined) set._raw.duration_seconds = durationSeconds;
    if (distanceM !== undefined) set._raw.distance_m = distanceM;
    if (rpe !== undefined) set._raw.rpe = rpe;
    set._raw.created_at = Date.now();
  });
}

/**
 * Get a session by ID.
 *
 * @param database The database instance
 * @param id The session ID
 * @returns The session or undefined if not found
 */
export async function getSession(
  database: Database,
  id: string
): Promise<Session | undefined> {
  try {
    const session = await database.get('sessions').find(id);
    return session as Session;
  } catch {
    return undefined;
  }
}

/**
 * Get all sets for a session, ordered by creation time.
 *
 * @param database The database instance
 * @param sessionId The session ID
 * @returns Array of session sets sorted by creation time
 */
export async function getSessionSets(
  database: Database,
  sessionId: string
): Promise<SessionSet[]> {
  const sessionSetsTable = database.get('session_sets');
  const sets = (await sessionSetsTable
    .query(Q.where('session_id', sessionId))
    .fetch()) as SessionSet[];

  // Sort by creation time to maintain order
  sets.sort((a, b) => {
    const aTime = (a as any)._raw.created_at;
    const bTime = (b as any)._raw.created_at;
    return aTime - bTime;
  });

  return sets;
}

/**
 * Upsert a routine exercise with structured properties (superset, warmup sets, duration target, etc).
 * Creates a new RoutineExercise or updates an existing one if already present for this routine+exercise.
 *
 * @param database The database instance
 * @param routineId The routine ID
 * @param options The routine exercise options
 */
export async function upsertRoutineExercise(
  database: Database,
  routineId: string,
  options: UpsertRoutineExerciseOptions
): Promise<RoutineExercise> {
  const {
    exerciseId,
    order,
    supersetGroup,
    warmupSets = 0,
    targetSets,
    targetReps,
    targetDurationSeconds,
    restSeconds,
  } = options;

  const routineExercisesTable = database.get('routine_exercises');

  // Check if this routine+exercise combo already exists
  const existing = await routineExercisesTable
    .query(
      Q.and(
        Q.where('routine_id', routineId),
        Q.where('exercise_id', exerciseId)
      )
    )
    .fetch();

  if (existing.length > 0) {
    // Update existing record
    const re = existing[0] as RoutineExercise;
    await re.update((record: any) => {
      record.order = order;
      if (supersetGroup !== undefined) record.superset_group = supersetGroup;
      record.warmup_sets = warmupSets;
      if (targetSets !== undefined) record.target_sets = targetSets;
      if (targetReps !== undefined) record.target_reps = targetReps;
      if (targetDurationSeconds !== undefined)
        record.target_duration_seconds = targetDurationSeconds;
      if (restSeconds !== undefined) record.rest_seconds = restSeconds;
    });
    return re;
  } else {
    // Create new record
    const created = await routineExercisesTable.create((re: any) => {
      re._raw.routine_id = routineId;
      re._raw.exercise_id = exerciseId;
      re._raw.order = order;
      if (supersetGroup !== undefined) re._raw.superset_group = supersetGroup;
      re._raw.warmup_sets = warmupSets;
      if (targetSets !== undefined) re._raw.target_sets = targetSets;
      if (targetReps !== undefined) re._raw.target_reps = targetReps;
      if (targetDurationSeconds !== undefined)
        re._raw.target_duration_seconds = targetDurationSeconds;
      if (restSeconds !== undefined) re._raw.rest_seconds = restSeconds;
    });
    return created as RoutineExercise;
  }
}

/**
 * Get all routine exercises for a routine, grouped by superset_group.
 * Non-grouped exercises (with null superset_group) are returned as individual groups.
 * Preserves the order of exercises within each group.
 *
 * @param database The database instance
 * @param routineId The routine ID
 * @returns Array of groups, where each group is an array of RoutineExercise objects
 */
export async function getSupersetGroups(
  database: Database,
  routineId: string
): Promise<RoutineExercise[][]> {
  const routineExercisesTable = database.get('routine_exercises');

  // Fetch all routine exercises for this routine, sorted by order
  const allExercises = (await routineExercisesTable
    .query(Q.where('routine_id', routineId))
    .fetch()) as RoutineExercise[];

  // Sort by order to maintain sequence
  allExercises.sort((a, b) => (a as any)._raw.order - (b as any)._raw.order);

  // Group by superset_group
  const groups: Map<string | null, RoutineExercise[]> = new Map();

  for (const exercise of allExercises) {
    const supersetGroup = (exercise as any)._raw.superset_group ?? null;
    if (!groups.has(supersetGroup)) {
      groups.set(supersetGroup, []);
    }
    groups.get(supersetGroup)!.push(exercise);
  }

  // Convert to array of groups, filtering out null-key groups that are singletons
  // (return only exercises that share a superset_group, not individual ones)
  const result: RoutineExercise[][] = [];

  for (const [key, group] of groups) {
    // Only include groups that have a superset_group (not null) or are multi-exercise groups
    if (key !== null && group.length > 0) {
      result.push(group);
    }
  }

  return result;
}
