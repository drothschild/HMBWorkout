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
 *
 * @param database The database instance
 * @param options Session creation options
 */
export async function createSession(
  database: Database,
  options: CreateSessionOptions
): Promise<Session> {
  const { sessionId, routineId, startedAtMs } = options;

  return await database.write(async () => {
    const sessionsTable = database.get('sessions');
    const session = await sessionsTable.create((session: any) => {
      session._raw.id = sessionId;
      session.routineId = routineId;
      session._raw.started_at = startedAtMs;
      session.customSyncStatus = 'local';
      session._raw.created_at = Date.now();
    });

    return session as Session;
  });
}

/**
 * Append a set to a session.
 * Defaults setType to 'working' if not provided.
 * Validates input before writing to database.
 * Assigns a monotonic position for deterministic ordering.
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

  await database.write(async () => {
    const sessionSetsTable = database.get('session_sets');

    // Get current max position for this session
    const existingSets = (await sessionSetsTable
      .query(Q.where('session_id', sessionId))
      .fetch()) as SessionSet[];

    const maxPosition = existingSets.length > 0
      ? Math.max(...existingSets.map((s) => (s as any)._raw.position || 0))
      : -1;
    const nextPosition = maxPosition + 1;

    await sessionSetsTable.create((set: any) => {
      set.sessionId = sessionId;
      set.routineExerciseId = routineExerciseId;
      set.setType = setType;
      if (reps !== undefined) set.reps = reps;
      if (weightKg !== undefined) set.weightKg = weightKg;
      if (durationSeconds !== undefined) set.durationSeconds = durationSeconds;
      if (distanceM !== undefined) set.distanceM = distanceM;
      if (rpe !== undefined) set.rpe = rpe;
      set.position = nextPosition;
      set._raw.created_at = Date.now();
    });
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
 * Get all sets for a session, ordered by position (deterministic).
 *
 * @param database The database instance
 * @param sessionId The session ID
 * @returns Array of session sets sorted by position
 */
export async function getSessionSets(
  database: Database,
  sessionId: string
): Promise<SessionSet[]> {
  const sessionSetsTable = database.get('session_sets');
  const sets = (await sessionSetsTable
    .query(Q.where('session_id', sessionId))
    .fetch()) as SessionSet[];

  // Sort by position to maintain deterministic order
  sets.sort((a, b) => {
    const aPos = (a as any)._raw.position;
    const bPos = (b as any)._raw.position;
    return aPos - bPos;
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

  return await database.write(async () => {
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
        re.routineId = routineId;
        re.exerciseId = exerciseId;
        re.order = order;
        if (supersetGroup !== undefined) re.supersetGroup = supersetGroup;
        re.warmupSets = warmupSets;
        if (targetSets !== undefined) re.targetSets = targetSets;
        if (targetReps !== undefined) re.targetReps = targetReps;
        if (targetDurationSeconds !== undefined)
          re.targetDurationSeconds = targetDurationSeconds;
        if (restSeconds !== undefined) re.restSeconds = restSeconds;
      });
      return created as RoutineExercise;
    }
  });
}

/**
 * Get all routine exercises for a routine, grouped by superset_group.
 * Non-grouped exercises (with null superset_group) are returned as individual singleton groups.
 * Same superset_group labels that are non-contiguous are split into separate groups.
 * Preserves the order of exercises overall.
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

  // Group exercises respecting overall order: break groups when superset_group changes
  // Each standalone exercise (superset_group=null) is its own singleton group
  const result: RoutineExercise[][] = [];
  let currentGroup: RoutineExercise[] = [];
  let currentGroupKey: string | null | undefined = undefined;

  for (const exercise of allExercises) {
    const supersetGroup = (exercise as any)._raw.superset_group;
    const isStandalone = supersetGroup === null || supersetGroup === undefined;

    if (isStandalone) {
      // Standalone exercises: each is its own singleton group
      if (currentGroup.length > 0) {
        result.push(currentGroup);
        currentGroup = [];
        currentGroupKey = undefined;
      }
      result.push([exercise]);
    } else if (supersetGroup !== currentGroupKey) {
      // Non-standalone group key changed, start a new group
      if (currentGroup.length > 0) {
        result.push(currentGroup);
      }
      currentGroup = [exercise];
      currentGroupKey = supersetGroup;
    } else {
      // Same group key, add to current group
      currentGroup.push(exercise);
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    result.push(currentGroup);
  }

  return result;
}
