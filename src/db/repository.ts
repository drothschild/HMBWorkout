import { Database, Q } from '@nozbe/watermelondb';
import Session from './models/Session';
import SessionSet, { SetType } from './models/SessionSet';
import RoutineExercise from './models/RoutineExercise';
import Routine from './models/Routine';
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
 * Delete a session and all of its logged sets.
 *
 * Local-only: this removes the on-device rows only. A session already synced
 * to the vault keeps its markdown copy there — deleting here never touches
 * the bridge or the vault (HealthKit export also survives, written at session
 * completion). Because syncNow() (src/sync/syncService.ts) selects candidates
 * by querying the sessions table directly, removing the row here also removes
 * it from the sync queue's candidate set.
 *
 * Refuses to delete a session that is still in progress (no endedAt set) —
 * the active session must go through the session-flow "abandon" path
 * instead of being deleted out from under the engine.
 *
 * Atomicity: check-and-delete is one critical section — guards and deletion
 * happen in a single writer transaction via database.batch so an app kill
 * mid-loop cannot leave a truncated session with sync_status='local'.
 *
 * @param database The database instance
 * @param sessionId The session ID to delete
 * @throws Error if the session does not exist or is still in progress
 */
export async function deleteSession(
  database: Database,
  sessionId: string
): Promise<void> {
  await database.write(async () => {
    const session = await getSession(database, sessionId);
    if (!session) {
      throw new Error(`cannot delete session ${sessionId}: not found`);
    }

    if (session.endedAt === null || session.endedAt === undefined) {
      throw new Error(`cannot delete session ${sessionId}: still in progress`);
    }

    const sets = await getSessionSets(database, sessionId);
    await database.batch(
      ...sets.map((s) => s.prepareDestroyPermanently()),
      session.prepareDestroyPermanently()
    );
  });
}

/**
 * Get all working-type sets for an exercise across all sessions (prior history).
 * Used for progression hint evaluation: rules compute hints based on prior working sets,
 * not current-session sets.
 *
 * Phase 4 Task 3: Query prior working sets by exercise ID, excluding warmups and other set types.
 * Returns sets ordered most-recent-first by set creation time (created_at desc),
 * breaking ties by position desc so same-millisecond appends still order most-recent-first.
 *
 * @param database The database instance
 * @param exerciseId The exercise ID to query
 * @returns Array of working-type session sets for this exercise, from all prior sessions
 */
export async function getExerciseWorkingSetHistory(
  database: Database,
  exerciseId: string
): Promise<SessionSet[]> {
  const sessionSetsTable = database.get('session_sets');
  const routineExercisesTable = database.get('routine_exercises');

  // Query all routine_exercises with this exerciseId
  const routineExercises = (await routineExercisesTable
    .query(Q.where('exercise_id', exerciseId))
    .fetch()) as RoutineExercise[];

  const routineExerciseIds = routineExercises.map((re) => (re as any).id);

  if (routineExerciseIds.length === 0) {
    // No routine_exercises for this exercise = no prior sets
    return [];
  }

  // Query all sets for these routine_exercises, filtered to working type
  const allSets = (await sessionSetsTable
    .query(
      Q.and(
        Q.where('set_type', 'working'),
        Q.where('routine_exercise_id', Q.oneOf(routineExerciseIds))
      )
    )
    .fetch()) as SessionSet[];

  // Sort most-recent-first by set creation time, breaking created_at ties by
  // position DESC: same-millisecond appends must order exactly like appends a
  // millisecond apart, and the later-position set is the more recent one either
  // way. (session_id is a random UUID and carries no temporal order — created_at
  // is the real clock.)
  allSets.sort((a, b) => {
    const createdA = (a as any)._raw.created_at ?? 0;
    const createdB = (b as any)._raw.created_at ?? 0;
    if (createdB !== createdA) {
      return createdB - createdA;
    }
    const aPos = (a as any)._raw.position ?? 0;
    const bPos = (b as any)._raw.position ?? 0;
    return bPos - aPos;
  });

  return allSets;
}

/**
 * One planned exercise of a routine, paired with the sets a single session
 * actually logged against it.
 */
export interface SessionExerciseLogEntry {
  exerciseId: string;
  title: string;
  order: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  sets: SessionSet[];
}

/**
 * Lay one session's sets out against the routine that was performed: every
 * planned exercise in routine order, each carrying the sets logged for it.
 *
 * An exercise the user skipped comes back with an empty `sets` array — that it
 * was planned and never logged is part of how the workout went. Sets pointing
 * at a routine_exercise that no longer belongs to this routine are dropped;
 * they can only exist if the routine was edited after the session ended.
 *
 * @param database The database instance
 * @param sessionId The finished session to read sets from
 * @param routineId The routine that session performed
 * @returns Planned exercises in order, each with its logged sets
 */
export async function getSessionExerciseLog(
  database: Database,
  sessionId: string,
  routineId: string
): Promise<SessionExerciseLogEntry[]> {
  const routineExercises = (await database
    .get('routine_exercises')
    .query(Q.where('routine_id', routineId))
    .fetch()) as RoutineExercise[];

  routineExercises.sort((a, b) => (a as any)._raw.order - (b as any)._raw.order);

  if (routineExercises.length === 0) {
    return [];
  }

  const exerciseIds = [...new Set(routineExercises.map((re) => (re as any)._raw.exercise_id))];
  const exercises = await database
    .get('exercises')
    .query(Q.where('id', Q.oneOf(exerciseIds)))
    .fetch();

  const titleById = new Map<string, string>(
    exercises.map((exercise) => [exercise.id, (exercise as any).title as string])
  );

  const sets = await getSessionSets(database, sessionId);
  const setsByRoutineExerciseId = new Map<string, SessionSet[]>();
  for (const set of sets) {
    const key = (set as any).routineExerciseId as string;
    const existing = setsByRoutineExerciseId.get(key);
    if (existing) {
      existing.push(set);
    } else {
      setsByRoutineExerciseId.set(key, [set]);
    }
  }

  return routineExercises.map((re) => {
    const raw = (re as any)._raw;
    const exerciseId = raw.exercise_id as string;

    return {
      exerciseId,
      title: titleById.get(exerciseId) ?? exerciseId,
      order: raw.order as number,
      targetSets: raw.target_sets ?? undefined,
      targetReps: raw.target_reps ?? undefined,
      targetDurationSeconds: raw.target_duration_seconds ?? undefined,
      sets: setsByRoutineExerciseId.get((re as any).id) ?? [],
    };
  });
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
        if (supersetGroup !== undefined) record.supersetGroup = supersetGroup;
        record.warmupSets = warmupSets;
        if (targetSets !== undefined) record.targetSets = targetSets;
        if (targetReps !== undefined) record.targetReps = targetReps;
        if (targetDurationSeconds !== undefined)
          record.targetDurationSeconds = targetDurationSeconds;
        if (restSeconds !== undefined) record.restSeconds = restSeconds;
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

/**
 * Upsert an exercise (create if not exists, update if exists).
 * Exercises are keyed by slug (id).
 *
 * @param database The database instance
 * @param exerciseId The exercise slug/ID
 * @param title Human-readable title
 * @param kind Exercise kind (strength, cardio, stretch)
 */
export async function upsertExercise(
  database: Database,
  exerciseId: string,
  title: string,
  kind: string
): Promise<any> {
  return await database.write(async () => {
    const exercisesTable = database.get('exercises');

    try {
      // Try to find existing
      const exercise = await exercisesTable.find(exerciseId);
      await exercise.update((record: any) => {
        record.title = title;
        record.kind = kind;
      });
      return exercise;
    } catch {
      // Not found, create new
      const created = await exercisesTable.create((e: any) => {
        e._raw.id = exerciseId;
        e.title = title;
        e.kind = kind;
        e._raw.created_at = Date.now();
      });
      return created;
    }
  });
}

/**
 * Upsert a routine (create if not exists, update if exists).
 * When upserting, reconciles the routine's routine_exercises in place:
 * entries whose exercise survives the edit update the existing row — keeping
 * its id, so session_sets.routine_exercise_id references (and working-set
 * history) stay attached — while removed exercises are deleted and new ones
 * created. Optional fields absent from an entry are cleared, so an edit still
 * fully replaces each row's contents.
 *
 * @param database The database instance
 * @param routineId The routine ID
 * @param name Routine name
 * @param exercises Array of exercise entries (with exerciseId, order, etc)
 * @param additionalFields Optional: notes, etc
 */
export interface RoutineExerciseEntry {
  exerciseId: string;
  order: number;
  supersetGroup?: string;
  warmupSets?: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
  notes?: string;
}

export async function upsertRoutine(
  database: Database,
  routineId: string,
  name: string,
  exercises: RoutineExerciseEntry[],
  additionalFields?: { notes?: string }
): Promise<any> {
  return await database.write(async () => {
    const routinesTable = database.get('routines');
    const routineExercisesTable = database.get('routine_exercises');

    // Upsert routine record
    let routine: any;
    try {
      routine = await routinesTable.find(routineId);
      await routine.update((record: any) => {
        record.name = name;
        if (additionalFields?.notes !== undefined) record.notes = additionalFields.notes;
        record._raw.updated_at = Date.now();
      });
    } catch {
      // Not found, create new
      routine = await routinesTable.create((r: any) => {
        r._raw.id = routineId;
        r.name = name;
        if (additionalFields?.notes !== undefined) r.notes = additionalFields.notes;
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
    }

    // Reconcile routine_exercises in place. session_sets.routine_exercise_id
    // references these rows, so surviving exercises must keep their row ids —
    // delete-and-recreate would orphan all previously logged sets.
    const oldExercises = (await routineExercisesTable
      .query(Q.where('routine_id', routineId))
      .fetch()) as RoutineExercise[];

    // Queue existing rows per exercise, oldest order first, so a duplicated
    // exercise matches deterministically.
    const unclaimed = new Map<string, RoutineExercise[]>();
    for (const old of [...oldExercises].sort(
      (a, b) => (a as any)._raw.order - (b as any)._raw.order
    )) {
      const key = (old as any).exerciseId;
      if (!unclaimed.has(key)) unclaimed.set(key, []);
      unclaimed.get(key)!.push(old);
    }

    for (const exerciseEntry of exercises) {
      const existing = unclaimed.get(exerciseEntry.exerciseId)?.shift();
      if (existing) {
        await existing.update((re: any) => {
          re.order = exerciseEntry.order;
          re.supersetGroup = exerciseEntry.supersetGroup ?? null;
          re.warmupSets = exerciseEntry.warmupSets ?? 0;
          re.targetSets = exerciseEntry.targetSets ?? null;
          re.targetReps = exerciseEntry.targetReps ?? null;
          re.targetDurationSeconds = exerciseEntry.targetDurationSeconds ?? null;
          re.restSeconds = exerciseEntry.restSeconds ?? null;
          re.notes = exerciseEntry.notes ?? null;
        });
      } else {
        await routineExercisesTable.create((re: any) => {
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseEntry.exerciseId;
          re._raw.order = exerciseEntry.order;
          if (exerciseEntry.supersetGroup !== undefined) re.supersetGroup = exerciseEntry.supersetGroup;
          re.warmupSets = exerciseEntry.warmupSets ?? 0;
          if (exerciseEntry.targetSets !== undefined) re.targetSets = exerciseEntry.targetSets;
          if (exerciseEntry.targetReps !== undefined) re.targetReps = exerciseEntry.targetReps;
          if (exerciseEntry.targetDurationSeconds !== undefined)
            re.targetDurationSeconds = exerciseEntry.targetDurationSeconds;
          if (exerciseEntry.restSeconds !== undefined) re.restSeconds = exerciseEntry.restSeconds;
          if (exerciseEntry.notes !== undefined) re.notes = exerciseEntry.notes;
        });
      }
    }

    // Delete only rows whose exercise is no longer in the routine.
    for (const leftovers of unclaimed.values()) {
      for (const removed of leftovers) {
        await removed.destroyPermanently();
      }
    }

    return routine;
  });
}

/**
 * Delete a routine (PRESERVE its routine_exercise rows as history carriers).
 *
 * DELETED: routine row only.
 * RETAINED: routine_exercise rows, sessions, session_sets, exercises.
 *
 * Routine_exercise rows are retained because session_sets.routine_exercise_id
 * points through them to logged history. Deleting them would orphan all
 * previously logged sets, making working-set history inaccessible via
 * getExerciseWorkingSetHistory. The UI stays clean: presenters filter
 * routine_exercises by routine_id, so orphan rows (whose routine is gone)
 * never appear in UI lists.
 *
 * Exercises are never touched: they are global and shared across routines
 * and logged history (AGENTS.md).
 *
 * Sync safety guard: refuses to delete a routine while any session that
 * references it (including one still in progress) has sync_status='local'.
 * syncNow() (src/sync/syncService.ts) resolves each session's routine at
 * post time via database.get('routines').find(session.routineId); if the
 * routine is gone, that lookup throws and the per-session catch swallows
 * the failure and continues, so the session would never sync again. A
 * session that is already 'synced' does not block deletion — its vault
 * copy was already posted and stays untouched, and the history screen's
 * presenter falls back to the raw routine id when the routine is missing.
 *
 * Atomicity: check-and-delete is one critical section — guards and the
 * single-row destroy happen inside one writer transaction via database.batch.
 *
 * The routine's vault markdown also survives (local-first, matching
 * deleteSession): tapping "Import Routines" later will re-create the routine
 * from the vault and re-adopt the retained routine_exercise rows.
 *
 * @param database The database instance
 * @param routineId The routine ID to delete
 * @throws RoutineHasUnsyncedSessionsError if an unsynced session references it
 * @throws Error if the routine does not exist
 */
export async function deleteRoutine(
  database: Database,
  routineId: string
): Promise<void> {
  await database.write(async () => {
    const routinesTable = database.get('routines');
    // Query rather than find: a missing row yields [], while a genuine read
    // failure propagates as itself instead of masquerading as not-found.
    const [routine] = (await routinesTable
      .query(Q.where('id', routineId))
      .fetch()) as Routine[];
    if (!routine) {
      throw new Error(`cannot delete routine ${routineId}: not found`);
    }

    const referencingSessions = (await database
      .get('sessions')
      .query(Q.where('routine_id', routineId))
      .fetch()) as Session[];

    const hasUnsyncedSession = referencingSessions.some(
      (session) => session.customSyncStatus === 'local'
    );
    if (hasUnsyncedSession) {
      throw new RoutineHasUnsyncedSessionsError(
        `cannot delete routine ${routineId}: unsynced sessions reference it`
      );
    }

    // Delete ONLY the routine row. Retain routine_exercises as history carriers
    // so that session_sets remain queryable via getExerciseWorkingSetHistory.
    await database.batch(routine.prepareDestroyPermanently());
  });
}

/**
 * Thrown when attempting to delete a routine that has unsynced sessions.
 * Discriminable from other errors for user-friendly messaging.
 */
export class RoutineHasUnsyncedSessionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutineHasUnsyncedSessionsError';
  }
}
