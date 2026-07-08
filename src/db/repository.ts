import { Database, Q } from '@nozbe/watermelondb';
import Session from './models/Session';
import SessionSet, { SetType } from './models/SessionSet';
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
 * Create a new session with the given id, routine id, and start time.
 * The session is created with syncStatus = 'local' by default.
 *
 * @param database The database instance
 * @param options Session creation options
 */
export async function createSession(
  database: Database,
  options: CreateSessionOptions
): Promise<void> {
  const { sessionId, routineId, startedAtMs } = options;

  const sessionsTable = database.get('sessions');
  await sessionsTable.create((session: any) => {
    session._raw.id = sessionId;
    session.routine_id = routineId;
    session.started_at = startedAtMs;
    session.sync_status = 'local';
    session.created_at = Date.now();
  });
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
    set.session_id = sessionId;
    set.routine_exercise_id = routineExerciseId;
    set.set_type = setType;
    if (reps !== undefined) set.reps = reps;
    if (weightKg !== undefined) set.weight_kg = weightKg;
    if (durationSeconds !== undefined) set.duration_seconds = durationSeconds;
    if (distanceM !== undefined) set.distance_m = distanceM;
    if (rpe !== undefined) set.rpe = rpe;
    set.created_at = Date.now();
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
 * Get all sets for a session.
 *
 * @param database The database instance
 * @param sessionId The session ID
 * @returns Array of session sets
 */
export async function getSessionSets(
  database: Database,
  sessionId: string
): Promise<SessionSet[]> {
  const sessionSetsTable = database.get('session_sets');
  const sets = await sessionSetsTable
    .query(Q.where('session_id', sessionId))
    .fetch();
  return sets as SessionSet[];
}
