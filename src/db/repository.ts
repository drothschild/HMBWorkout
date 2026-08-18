import { Database, Q } from '@nozbe/watermelondb';
import Session from './models/Session';
import SessionSet, { SetType } from './models/SessionSet';
import Routine from './models/Routine';
import RoutineExercise from './models/RoutineExercise';
import RoutineSet, { type RoutineSetType } from './models/RoutineSet';
import Exercise from './models/Exercise';
import { validateSet } from './validation';

export type { RoutineSetType };

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
  /**
   * The exercise this set was performed as. Every production write supplies it
   * (`onPersistSet` takes it from the engine entry it already validated the
   * logged set against) — the routine_exercises row is permanent and its
   * exercise_id is mutable, so the row cannot be the identity of record.
   *
   * Optional only so that a set written without one degrades to the pre-v3
   * behaviour — resolving through the routine_exercises join — rather than
   * being written with a wrong identity. A row left unstamped is still safe
   * across a swap: `updateRoutineExerciseExerciseId` freezes it first.
   */
  exerciseId?: string;
}

/**
 * Routine exercise options for upsertRoutineExercise
 */
/**
 * Options for upserting a routine exercise. Note: this function is test-only surface
 * (zero production callers). The update branch diverges from `upsertRoutine`'s
 * contract: it preserves-on-absent (if a field is undefined, the column keeps its
 * existing value), while `upsertRoutine` clears-on-absent (mapping undefined to null).
 * This divergence is intentional for the test helper's behavior, but if it is ever
 * wired into a production flow, reconcile the contracts or add tests for the update
 * path.
 *
 * #276 Phase 6: the five aggregate options are gone with their columns, and `sets`
 * replaces them. It was previously the one writer of `target_duration_seconds` and
 * `target_weight_kg` that did NOT derive them from a list — a real inconsistency
 * while both representations were live, and now simply impossible to express.
 */
interface UpsertRoutineExerciseOptions {
  exerciseId: string;
  order: number;
  supersetGroup?: string;
  restSeconds?: number;
  /**
   * The entry's prescribed sets. Absent means "do not touch this entry's set
   * rows", which is the preserve-on-absent contract the rest of these options
   * follow; `[]` means "this entry prescribes nothing" and destroys them.
   */
  sets?: RoutineSetEntry[];
}

/**
 * Create a new session with the given id, routine id, and start time.
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
 * Records `options.exerciseId` on the row when given: the set's identity is
 * what it was performed as, not whatever its routine_exercises row happens to
 * name later. See AppendSetOptions.exerciseId.
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
    exerciseId,
  } = options;

  // Whitespace is not an identity. Collapse a blank one to absent so the row
  // falls back to the join rather than being stamped with something no
  // exercise id will ever match.
  const stampedExerciseId = exerciseId?.trim() || undefined;

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
      if (stampedExerciseId !== undefined) set.exerciseId = stampedExerciseId;
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
 * Delete an in-progress session and all its logged sets.
 * Called when a user explicitly abandons a workout. Idempotent by session id.
 *
 * This is the abandon path, and deliberately not a "delete a finished workout"
 * path: it makes no ended_at check, because the whole point is to throw away a
 * session that is still running. The persisted engine state lives on the session
 * row, so removing the row is also what stops restart recovery from rehydrating
 * the discarded workout.
 *
 * If this operation fails (e.g., database write error), the session row remains
 * on disk. On next app launch, rehydrate will restore this stale row as the active
 * session, and the user can abandon again. This is the retry path: resurrection
 * at next launch, then retry abandon. No automatic cleanup on StartSession.
 *
 * @param database The database instance
 * @param sessionId The session ID to discard
 * @throws Error if sessionId is empty/blank or if the database write fails
 */
export async function discardInProgressSession(
  database: Database,
  sessionId: string
): Promise<void> {
  // Guard against empty/blank session IDs
  if (!sessionId || !sessionId.trim()) {
    throw new Error('discardInProgressSession: sessionId must not be empty or blank');
  }

  await database.write(async () => {
    // Fetch both the sets and session. Use query().fetch()[0] to distinguish not-found
    // from real read errors: not-found returns an empty array, while read errors propagate.
    const sets = (await database
      .get('session_sets')
      .query(Q.where('session_id', sessionId))
      .fetch()) as SessionSet[];

    const sessions = (await database
      .get('sessions')
      .query(Q.where('id', sessionId))
      .fetch()) as Session[];
    const session = sessions[0] || null;

    // Atomic batch: prepare all deletions, then execute in one batch.
    // This ensures atomicity: a crash between here and completion leaves nothing
    // deleted. Destroy failures propagate; not-found returns null (handled above).
    await database.batch(
      ...sets.map((s) => s.prepareDestroyPermanently()),
      ...(session ? [session.prepareDestroyPermanently()] : []),
    );
  });
}

/**
 * Delete a session and all of its logged sets.
 *
 * Removes on-device rows only. The HealthKit export written at completion is
 * unaffected.
 *
 * Refuses to delete a session that is still in progress (no endedAt set) —
 * the active session must go through the session-flow "abandon" path
 * instead of being deleted out from under the engine.
 *
 * Atomicity: check-and-delete is one critical section — guards and deletion
 * happen in a single writer transaction via database.batch so an app kill
 * mid-loop cannot leave a truncated session.
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
 * Resolve exercise titles for a set of exercise ids.
 * Ids whose exercise no longer exists are omitted from the map, so callers
 * can fall back to showing the raw id.
 *
 * @param database The database instance
 * @param exerciseIds Exercise ids to resolve
 * @returns Map of exerciseId → title for every id that still exists
 */
export async function getExerciseTitles(
  database: Database,
  exerciseIds: string[]
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};

  for (const exerciseId of exerciseIds) {
    try {
      const exercise = await database.get('exercises').find(exerciseId);
      titles[exerciseId] = (exercise as any).title;
    } catch {
      // Exercise no longer exists; leave it out so the caller falls back to the id.
    }
  }

  return titles;
}

/**
 * Normalize a raw routine notes value for display: trim it, and collapse
 * missing or whitespace-only notes to null so read sites can treat null as
 * "absent", matching the exercise description convention.
 *
 * @param notes The raw notes value from the routines.notes column
 * @returns The trimmed notes, or null when there is nothing to show
 */
export function normalizeNotes(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve a routine's display fields by id. Engine session state carries only
 * routineId (the Rill boundary strips display data), so the session screen
 * resolves the name and description shell-side, the way getExerciseTitles
 * does for exercise titles. Whitespace-only notes normalize to null so
 * callers can treat null as "absent".
 *
 * @param database The database instance
 * @param routineId The routine id to resolve
 * @returns Name and notes, or null when the routine no longer exists
 */
export async function getRoutineDisplay(
  database: Database,
  routineId: string
): Promise<{ name: string; notes: string | null } | null> {
  try {
    const routine = (await database.get('routines').find(routineId)) as any;

    return {
      name: routine.name,
      notes: normalizeNotes(routine.notes as string | undefined),
    };
  } catch {
    // Routine no longer exists; the caller falls back to generic chrome.
    return null;
  }
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
 * **Two identity paths, in priority order.** A set's own `exercise_id` is what
 * it was performed as and wins outright. Only a set that has none — every row
 * written before schema v3 — resolves through `routine_exercises.exercise_id`,
 * and then only because it has nothing better. The order matters because
 * ReplaceExercise re-points that permanent row: reading the join first would
 * hand the substitute every set the original ever earned. The two sets are
 * disjoint by construction (stamped vs. unstamped), so the merge cannot
 * double-count.
 *
 * This is what `restCommentaryHistory` and `contextBuilder`'s history section
 * read through, so fixing attribution here fixes it for both.
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

  // Path 1: sets that recorded this exercise themselves. Authoritative, and
  // independent of whether the routine_exercises row still exists or still
  // names this exercise.
  const stampedSets = (await sessionSetsTable
    .query(Q.and(Q.where('set_type', 'working'), Q.where('exercise_id', exerciseId)))
    .fetch()) as SessionSet[];

  // Path 2: legacy rows, via the join. Query all routine_exercises with this
  // exerciseId, then keep only the sets that recorded no identity of their own
  // — a stamped set has already been placed by path 1, and a set stamped with
  // a *different* exercise is deliberately not this exercise's history even
  // though the row now names it.
  const routineExercises = (await routineExercisesTable
    .query(Q.where('exercise_id', exerciseId))
    .fetch()) as RoutineExercise[];

  const routineExerciseIds = routineExercises.map((re) => (re as any).id);

  const legacySets =
    routineExerciseIds.length === 0
      ? []
      : ((await sessionSetsTable
          .query(
            Q.and(
              Q.where('set_type', 'working'),
              Q.where('routine_exercise_id', Q.oneOf(routineExerciseIds))
            )
          )
          .fetch()) as SessionSet[]).filter(
          (set) => ((set as any)._raw.exercise_id ?? null) === null
        );

  const allSets = [...stampedSets, ...legacySets];

  if (allSets.length === 0) {
    return [];
  }

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
 * One finished workout, reduced to what a coach needs to see a training
 * pattern: when it happened, what was performed, and how much of it there was.
 */
export interface RecentSessionSummary {
  sessionId: string;
  routineId: string;
  /** The routine's name, or the raw routine id if the routine has been deleted. */
  routineName: string;
  endedAtMs: number;
  /** Distinct exercises with at least one working set logged. */
  exerciseCount: number;
  workingSetCount: number;
}

/**
 * The user's most recent completed workouts, newest first.
 *
 * Only sessions that ended count — an abandoned or in-progress session says
 * nothing about training frequency. Volume is counted from working sets alone,
 * matching `getExerciseWorkingSetHistory`: warmups inflate a session without
 * telling you anything about the work done.
 *
 * Costs four queries whatever the limit is: sessions, their working sets, the
 * exercises behind those sets, and the routines behind the sessions. Fanning
 * out per session would make the caller's bound the query count.
 *
 * @param database The database instance
 * @param limit How many sessions to return at most
 * @returns Completed sessions, most recent first, capped at `limit`
 */
export async function getRecentSessionSummaries(
  database: Database,
  limit: number
): Promise<RecentSessionSummary[]> {
  if (limit <= 0) {
    return [];
  }

  const sessions = (await database
    .get('sessions')
    .query(
      Q.where('ended_at', Q.notEq(null)),
      Q.sortBy('ended_at', Q.desc),
      // Two sessions ending on the same millisecond still need a stable order.
      Q.sortBy('started_at', Q.desc),
      Q.take(limit)
    )
    .fetch()) as Session[];

  if (sessions.length === 0) {
    return [];
  }

  const workingSets = (await database
    .get('session_sets')
    .query(
      Q.and(
        Q.where('set_type', 'working'),
        Q.where('session_id', Q.oneOf(sessions.map((session) => session.id)))
      )
    )
    .fetch()) as SessionSet[];

  const exerciseIdByRoutineExerciseId = await mapRoutineExercisesToExercises(
    database,
    workingSets
  );

  const routineIds = [...new Set(sessions.map((session) => session.routineId))];
  const routines = (await database
    .get('routines')
    .query(Q.where('id', Q.oneOf(routineIds)))
    .fetch()) as Routine[];
  const routineNameById = new Map<string, string>(
    routines.map((routine) => [
      routine.id,
      routine.name && routine.name.trim() ? routine.name : routine.id,
    ])
  );

  const volumeBySessionId = new Map<string, { exercises: Set<string>; setCount: number }>();
  for (const set of workingSets) {
    const sessionId = (set as any).sessionId as string;
    let volume = volumeBySessionId.get(sessionId);
    if (!volume) {
      volume = { exercises: new Set<string>(), setCount: 0 };
      volumeBySessionId.set(sessionId, volume);
    }

    volume.setCount += 1;

    // A routine that lists the same exercise twice is still one exercise
    // trained — so the count is over exercise identities, not rows. Which
    // makes the identity the load-bearing part: the set's own exercise_id
    // wins, because a swap can make two rows name the same exercise and
    // collapse a workout that genuinely trained two. The join is the fallback
    // for sets written before that column, and if the routine_exercise row is
    // gone too, the row id is the only identity the set has left.
    const routineExerciseId = (set as any).routineExerciseId as string;
    const performedExerciseId = (set as any)._raw.exercise_id as string | null;
    volume.exercises.add(
      performedExerciseId ??
        exerciseIdByRoutineExerciseId.get(routineExerciseId) ??
        routineExerciseId
    );
  }

  return sessions.map((session) => {
    const volume = volumeBySessionId.get(session.id);

    return {
      sessionId: session.id,
      routineId: session.routineId,
      routineName: routineNameById.get(session.routineId) ?? session.routineId,
      endedAtMs: (session as any)._raw.ended_at as number,
      exerciseCount: volume?.exercises.size ?? 0,
      workingSetCount: volume?.setCount ?? 0,
    };
  });
}

async function mapRoutineExercisesToExercises(
  database: Database,
  sets: SessionSet[]
): Promise<Map<string, string>> {
  const routineExerciseIds = [
    ...new Set(sets.map((set) => (set as any).routineExerciseId as string)),
  ];

  if (routineExerciseIds.length === 0) {
    return new Map();
  }

  const routineExercises = (await database
    .get('routine_exercises')
    .query(Q.where('id', Q.oneOf(routineExerciseIds)))
    .fetch()) as RoutineExercise[];

  return new Map(
    routineExercises.map((re) => [re.id, (re as any)._raw.exercise_id as string])
  );
}

/**
 * One planned exercise of a routine, paired with the sets a single session
 * actually logged against it.
 *
 * routineExerciseId identifies the routine entry (the routine_exercises row
 * id), not exerciseId: a routine may list the same exercise more than once, so
 * exerciseId alone cannot serve as a unique key (AGENTS.md boundary rule).
 *
 * `exerciseId` is what the sets were *performed* as, which after a
 * ReplaceExercise swap is not what the row names today. A row therefore keys a
 * list entry together with its exerciseId, not on its own — read
 * `(routineExerciseId, exerciseId)` as the pair.
 */
export interface SessionExerciseLogEntry {
  routineExerciseId: string;
  exerciseId: string;
  title: string;
  order: number;
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
 * **Sets are titled by what they were performed as.** ReplaceExercise
 * re-points a routine entry, so the row's current exercise_id is the plan as it
 * stands *now*, not what a session weeks ago actually did. Each set therefore
 * resolves through its own `exercise_id`, falling back to the row's only when
 * it has none — the priority order `getExerciseWorkingSetHistory` establishes.
 * A row with no sets this session has no performed identity to read, so it
 * reports under the exercise it currently names.
 *
 * The prescription stays with the entry either way: targets belong to the plan,
 * not the exercise, and a swap leaves them untouched — so the sets performed
 * under the old identity were performed against these same targets.
 *
 * @param database The database instance
 * @param sessionId The finished session to read sets from
 * @param routineId The routine that session performed
 * @param sessionSets Optional pre-fetched session sets to avoid a duplicate query
 * @returns Planned exercises in order, each with its logged sets
 */
export async function getSessionExerciseLog(
  database: Database,
  sessionId: string,
  routineId: string,
  sessionSets?: SessionSet[]
): Promise<SessionExerciseLogEntry[]> {
  const routineExercises = (await database
    .get('routine_exercises')
    .query(Q.where('routine_id', routineId))
    .fetch()) as RoutineExercise[];

  routineExercises.sort((a, b) => (a as any)._raw.order - (b as any)._raw.order);

  if (routineExercises.length === 0) {
    return [];
  }

  const currentExerciseIdByRow = new Map<string, string>(
    routineExercises.map((re) => [re.id, (re as any)._raw.exercise_id as string])
  );

  const sets = sessionSets ?? (await getSessionSets(database, sessionId));
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

  /** What a set was performed as: its own stamp, else the row it hangs off. */
  const performedExerciseId = (set: SessionSet): string => {
    const stamped = (set as any)._raw.exercise_id as string | null;
    if (stamped) return stamped;
    return currentExerciseIdByRow.get((set as any).routineExerciseId as string) ?? '';
  };

  // Titles are needed for every identity that can surface: the rows' current
  // exercises, plus every identity the sets themselves recorded.
  const neededExerciseIds = new Set<string>(currentExerciseIdByRow.values());
  for (const set of sets) {
    const performed = performedExerciseId(set);
    if (performed) neededExerciseIds.add(performed);
  }

  const exercises = await database
    .get('exercises')
    .query(Q.where('id', Q.oneOf([...neededExerciseIds])))
    .fetch();

  const titleById = new Map<string, string>(
    exercises.map((exercise) => [exercise.id, (exercise as any).title as string])
  );

  const entries: SessionExerciseLogEntry[] = [];

  for (const re of routineExercises) {
    const raw = (re as any)._raw;
    // No plan fields ride along any more (#276 Phase 6). The row's aggregate
    // columns are undeclared, and the per-set plan is read separately by
    // `sessionDetailPresenter` through `getPrescribedSetsForRow` — which is the
    // honest shape anyway, since the plan it reads is the routine's CURRENT
    // composition rather than a snapshot of what was planned when this session
    // ran.
    const plan = {
      routineExerciseId: re.id,
      order: raw.order as number,
    };

    const rowSets = setsByRoutineExerciseId.get(re.id) ?? [];

    if (rowSets.length === 0) {
      const exerciseId = currentExerciseIdByRow.get(re.id) as string;
      entries.push({
        ...plan,
        exerciseId,
        title: titleById.get(exerciseId) ?? exerciseId,
        sets: [],
      });
      continue;
    }

    // Split the row's sets by performed identity, in encounter order. One
    // session can only ever produce one identity per row — the engine refuses
    // to swap an entry once a set is recorded against it, and a swap stamps
    // every unstamped set on its way past — so this is normally a single
    // group. It is written as a partition anyway so that a row carrying two
    // eras degrades into two correctly-titled entries rather than one
    // mislabelled one.
    const setsByPerformedId = new Map<string, SessionSet[]>();
    for (const set of rowSets) {
      const exerciseId = performedExerciseId(set);
      const existing = setsByPerformedId.get(exerciseId);
      if (existing) {
        existing.push(set);
      } else {
        setsByPerformedId.set(exerciseId, [set]);
      }
    }

    for (const [exerciseId, performedSets] of setsByPerformedId) {
      entries.push({
        ...plan,
        exerciseId,
        title: titleById.get(exerciseId) ?? exerciseId,
        sets: performedSets,
      });
    }
  }

  return entries;
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
  const { exerciseId, order, supersetGroup, restSeconds, sets } = options;

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

    let row: RoutineExercise;
    if (existing.length > 0) {
      // Update existing record
      row = existing[0] as RoutineExercise;
      await row.update((record: any) => {
        record.order = order;
        if (supersetGroup !== undefined) record.supersetGroup = supersetGroup;
        if (restSeconds !== undefined) record.restSeconds = restSeconds;
      });
    } else {
      // Create new record
      row = (await routineExercisesTable.create((re: any) => {
        re.routineId = routineId;
        re.exerciseId = exerciseId;
        re.order = order;
        if (supersetGroup !== undefined) re.supersetGroup = supersetGroup;
        if (restSeconds !== undefined) re.restSeconds = restSeconds;
      })) as RoutineExercise;
    }

    // Same absent-versus-empty rule `upsertRoutine` uses: `undefined` leaves
    // the entry's existing set rows alone, `[]` destroys them.
    if (sets) await replaceRoutineSets(database, row.id, sets);

    return row;
  });
}

/**
 * Resolve a routine entry's `routine_exercises` row id from its 0-based order.
 *
 * `order` is the canonical entry position — the same value the engine carries
 * as `RoutineEntry.idx` and the same lookup `onPersistSet` uses to attribute a
 * logged set. Going through order rather than exercise_id is required, not
 * incidental: a routine may list the same exercise more than once, and only
 * the position tells the two entries apart.
 *
 * @param database The database instance
 * @param routineId The routine the entry belongs to
 * @param order The entry's 0-based position within the routine
 * @returns The row id, or null when no entry sits at that order
 */
export async function findRoutineExerciseIdByOrder(
  database: Database,
  routineId: string,
  order: number
): Promise<string | null> {
  const [match] = (await database
    .get('routine_exercises')
    .query(Q.and(Q.where('routine_id', routineId), Q.where('order', order)))
    .fetch()) as RoutineExercise[];

  return match ? (match as any).id : null;
}

/**
 * Point an existing routine entry at a different exercise, in place.
 *
 * The row keeps its id, and only `exercise_id` changes. That is the whole
 * point: `session_sets.routine_exercise_id` references this row, so deleting
 * and recreating the row would orphan every set ever logged against the entry.
 * The plan's structure (order, warmup/target-set/target-rep/rest columns,
 * superset group) belongs to the entry and is left untouched — a substitute
 * inherits it.
 *
 * **Prescribed LOADS are the one exception, and they are cleared here** — every
 * one of the entry's `routine_sets` rows' `target_weight_kg` (#276; the
 * entry-level column this used to clear alongside them was undeclared at v7).
 * Sets,
 * reps and rest survive a substitution because they are near-dimensionless
 * across movements; load is not — 185lb is a working squat and an impossible
 * leg extension. And because a prescription *overrides* the history-derived
 * prefill rather than deferring to it (computeSetPrefill, sessionPresenter.ts),
 * a stale one does not quietly lose to the substitute's own correct numbers: it
 * wins over them, and pre-types a dangerous load into the athlete's input. So
 * the swap drops it, and the substitute falls back to plain history-derived
 * prefill, which is right.
 *
 * **Past sets keep the identity they were recorded under; the row is then free
 * to re-point.** The row is permanent and shared by every session that ever
 * performed this entry, so re-pointing it is not a session-scoped act — the
 * engine's `setIndex == 0` guard only says nothing was logged *this* session,
 * and says nothing at all about the months of history already hanging off the
 * row. So before the swap, every attached set that recorded no identity of its
 * own (a pre-v3 row) is stamped with this row's *outgoing* exercise id, in the
 * same write transaction: history is frozen exactly when it would otherwise
 * become ambiguous, and the two writes cannot come apart. Sets that already
 * carry an identity are left alone — they are already immune.
 *
 * @param database The database instance
 * @param routineExerciseId The routine_exercises row id (the entry's identity)
 * @param exerciseId The exercise the entry should name
 */
export async function updateRoutineExerciseExerciseId(
  database: Database,
  routineExerciseId: string,
  exerciseId: string
): Promise<RoutineExercise> {
  const trimmed = exerciseId?.trim();
  if (!trimmed) {
    throw new Error('updateRoutineExerciseExerciseId requires a non-empty exercise id');
  }

  return await database.write(async () => {
    const row = await database.get('routine_exercises').find(routineExerciseId);
    const outgoingExerciseId = (row as any)._raw.exercise_id as string | null;

    // Freeze first, re-point second. Both inside this write, so a failure
    // cannot leave the row pointing at the substitute with its history still
    // resolving through the join.
    if (outgoingExerciseId) {
      const attachedSets = (await database
        .get('session_sets')
        .query(Q.where('routine_exercise_id', routineExerciseId))
        .fetch()) as SessionSet[];

      const unstamped = attachedSets.filter(
        (set) => ((set as any)._raw.exercise_id ?? null) === null
      );

      if (unstamped.length > 0) {
        await database.batch(
          ...unstamped.map((set) =>
            set.prepareUpdate((record: any) => {
              record.exerciseId = outgoingExerciseId;
            })
          )
        );
      }
    }

    // Only the LOADS go — set_type, reps and order are the plan's structure and
    // are near-dimensionless across movements, so a substitute keeps them,
    // exactly as it keeps the entry's rest column. A substitute inheriting a
    // seven-step warmup ramp of somebody else's loads is the bug this prevents.
    //
    // Through Phase 5 this ran alongside a clear of the entry's own
    // `target_weight_kg`; that column is undeclared at v7, so the per-set clear
    // is now the whole of it. The obligation did not shrink — the loads simply
    // all live in one place.
    //
    // Still inside this one write, alongside the history stamp and the
    // re-point: WatermelonDB's writer is a serialization primitive over a FIFO
    // queue, not a rollback-capable transaction, so "one write" is what
    // guarantees no other writer sees the row half-swapped. Hoisting any of
    // these effects into a second database.write fails
    // replaceRoutineExercise.test.ts's competing-writer test (#225).
    const prescribedSets = (await database
      .get('routine_sets')
      .query(Q.where('routine_exercise_id', routineExerciseId))
      .fetch()) as RoutineSet[];

    const loaded = prescribedSets.filter(
      (set) => ((set as any)._raw.target_weight_kg ?? null) !== null
    );

    if (loaded.length > 0) {
      await database.batch(
        ...loaded.map((set) =>
          set.prepareUpdate((record: any) => {
            record.targetWeightKg = null;
          })
        )
      );
    }

    await row.update((record: any) => {
      record.exerciseId = trimmed;
    });

    return row as RoutineExercise;
  });
}

/**
 * Upsert an exercise (create if not exists, update if exists).
 * Exercises are keyed by slug (id).
 *
 * `description` only applies on create — it is user-authored, so re-upserting
 * an existing exercise (e.g. via the AI accept path, which calls this only
 * for exercises that don't exist yet) never touches a description someone
 * already wrote. Use updateExerciseDescription for the user edit path.
 *
 * Normalizes empty or whitespace-only descriptions to null on create, so the
 * database always carries clean data.
 *
 * @param database The database instance
 * @param exerciseId The exercise slug/ID
 * @param title Human-readable title
 * @param kind Exercise kind (strength, cardio, stretch)
 * @param description Optional user-authored description, set only on create
 */
export async function upsertExercise(
  database: Database,
  exerciseId: string,
  title: string,
  kind: string,
  description?: string
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
      const trimmed = description?.trim();
      const normalized = trimmed ? trimmed : null;
      const created = await exercisesTable.create((e: any) => {
        e._raw.id = exerciseId;
        e.title = title;
        e.kind = kind;
        if (normalized !== null) e.description = normalized;
        e._raw.created_at = Date.now();
      });
      return created;
    }
  });
}

/**
 * Update an exercise's user-authored description. This is the targeted edit
 * path: it touches only the description field and never the title or kind,
 * so it's safe for the user-facing edit screen without risking the
 * create-only invariant the AI accept path depends on (exercises are global
 * and shared across every routine).
 *
 * Normalizes empty or whitespace-only strings to null, so the database always
 * carries clean data: either a meaningful description or null, never ''.
 *
 * @param database The database instance
 * @param exerciseId The exercise ID
 * @param description The new description, or null to clear it
 */
export async function updateExerciseDescription(
  database: Database,
  exerciseId: string,
  description: string | null
): Promise<Exercise> {
  return await database.write(async () => {
    const exercisesTable = database.get('exercises');
    const exercise = await exercisesTable.find(exerciseId);

    const trimmed = description?.trim();
    const normalized = trimmed ? trimmed : null;

    await exercise.update((record: any) => {
      record.description = normalized;
    });

    return exercise as Exercise;
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
/**
 * One PRESCRIBED set within a routine entry (#276, schema v6).
 *
 * `setType` is the plan's vocabulary ('warmup' | 'normal'), not the engine's
 * logged one. Every other field is optional and absent means "not prescribed":
 * `targetRepsMax` present makes `targetReps` the low end of a range, absent
 * makes it exact.
 */
export interface RoutineSetEntry {
  setType: RoutineSetType;
  targetReps?: number;
  targetRepsMax?: number;
  /** Canonical kg. The lbs → kg conversion stays at the AI accept boundary. */
  targetWeightKg?: number;
  targetDurationSeconds?: number;
  targetDistanceM?: number;
  /**
   * Per-set rest override in seconds (#281). Absent means the set inherits the
   * entry-level `RoutineExerciseEntry.restSeconds`; present overrides it. A
   * drop set is 0 / 0 / full — the pattern the entry-level value cannot hold.
   */
  restSeconds?: number;
}

export interface RoutineExerciseEntry {
  exerciseId: string;
  order: number;
  supersetGroup?: string;
  restSeconds?: number;
  notes?: string;
  /**
   * The entry's ordered prescribed sets — REQUIRED as of #276 Phase 6, and the
   * entry's whole plan.
   *
   * It was optional through Phases 1–5, where `undefined` meant "this caller
   * does not speak per-set, leave the set rows alone and honour my aggregate
   * counts instead". There are no aggregate counts to honour and no such
   * caller: `acceptDraft` is the only production one and it has passed a list
   * since Phase 4. Making it required is what stops a future caller silently
   * writing a routine entry with no plan at all — the unstartable shape
   * `startSessionFromRoutine` and `hasActiveExercise` both exist to refuse.
   *
   * `[]` is still legal and still means "this entry prescribes nothing"; it
   * replaces the rows wholesale, i.e. destroys them.
   *
   * The per-exercise `targetWeightKg` went with the rest. Load is per set now,
   * on `RoutineSetEntry`, and the lbs → kg conversion stays where it was — at
   * the AI accept boundary, once per set.
   */
  sets: RoutineSetEntry[];
}

/**
 * Replace an entry's prescribed set rows with `sets`, inside an open write.
 *
 * Wholesale, not reconciled: nothing references a `routine_sets` row, unlike
 * the `routine_exercises` row above it whose id `session_sets` depends on. The
 * caller must already be inside `database.write`.
 */
async function replaceRoutineSets(
  database: Database,
  routineExerciseId: string,
  sets: readonly RoutineSetEntry[]
): Promise<void> {
  const existing = (await database
    .get('routine_sets')
    .query(Q.where('routine_exercise_id', routineExerciseId))
    .fetch()) as RoutineSet[];

  for (const row of existing) {
    await row.destroyPermanently();
  }

  for (const [order, set] of sets.entries()) {
    await database.get('routine_sets').create((row: any) => {
      row._raw.routine_exercise_id = routineExerciseId;
      row._raw.order = order;
      row._raw.set_type = set.setType;
      if (set.targetReps !== undefined) row.targetReps = set.targetReps;
      if (set.targetRepsMax !== undefined) row.targetRepsMax = set.targetRepsMax;
      if (set.targetWeightKg !== undefined) row.targetWeightKg = set.targetWeightKg;
      if (set.targetDurationSeconds !== undefined)
        row.targetDurationSeconds = set.targetDurationSeconds;
      if (set.targetDistanceM !== undefined) row.targetDistanceM = set.targetDistanceM;
      // Per-set rest override (#281). Guard on undefined, not falsiness: 0 is a
      // meaningful override (no rest between drops) and must reach the column,
      // where the engine reads it as `Some(0)` and schedules no rest.
      if (set.restSeconds !== undefined) row.restSeconds = set.restSeconds;
    });
  }
}

/**
 * A routine entry's prescribed sets, in `order`.
 *
 * Sorted here rather than trusted from the query: `order` is the canonical
 * position and insertion order only happens to match it today.
 *
 * WatermelonDB's `null` for an unset optional column is normalised to
 * `undefined` at this boundary (`!= null`, not `!== undefined` — AGENTS.md), so
 * no consumer has to re-check. An entry with no prescribed sets returns `[]`.
 *
 * @param database The database instance
 * @param routineExerciseId The routine_exercises row id (the entry's identity)
 */
export async function getRoutineSets(
  database: Database,
  routineExerciseId: string
): Promise<RoutineSetEntry[]> {
  const rows = (await database
    .get('routine_sets')
    .query(Q.where('routine_exercise_id', routineExerciseId))
    .fetch()) as RoutineSet[];

  return rows
    .map((row) => (row as any)._raw)
    .sort((a, b) => (a.order as number) - (b.order as number))
    .map((raw) => {
      const entry: RoutineSetEntry = { setType: raw.set_type as RoutineSetType };
      if (raw.target_reps != null) entry.targetReps = raw.target_reps as number;
      if (raw.target_reps_max != null) entry.targetRepsMax = raw.target_reps_max as number;
      if (raw.target_weight_kg != null) entry.targetWeightKg = raw.target_weight_kg as number;
      if (raw.target_duration_seconds != null)
        entry.targetDurationSeconds = raw.target_duration_seconds as number;
      if (raw.target_distance_m != null) entry.targetDistanceM = raw.target_distance_m as number;
      // `!= null` (not `!== undefined`): 0 is a real override and must pass, but
      // WatermelonDB's null for an unset column must normalise to absent. #281.
      if (raw.rest_seconds != null) entry.restSeconds = raw.rest_seconds as number;
      return entry;
    });
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
      // THE ZERO-TOTAL DEFAULT IS GONE, and nothing replaced it here (#276
      // Phase 6). It defaulted the entry's set count to 1 so an entry carrying no
      // counts still had a set for the engine to visit; `sets` is required
      // now, so the shape it caught cannot be expressed without writing an
      // explicit `[]`, and an explicit `[]` is a caller saying "nothing" rather
      // than a caller forgetting. The rule it enforced survives one layer up,
      // in `validateRoutineDraft`, which requires at least one set.
      //
      // The five derived aggregate columns are gone with it. `routine_sets` is
      // the plan; there is no second representation left to keep consistent,
      // which is the entire point of the phase.
      const existing = unclaimed.get(exerciseEntry.exerciseId)?.shift();
      let routineExerciseId: string;
      if (existing) {
        await existing.update((re: any) => {
          re.order = exerciseEntry.order;
          re.supersetGroup = exerciseEntry.supersetGroup ?? null;
          re.restSeconds = exerciseEntry.restSeconds ?? null;
          re.notes = exerciseEntry.notes ?? null;
        });
        routineExerciseId = (existing as any).id;
      } else {
        const created = await routineExercisesTable.create((re: any) => {
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseEntry.exerciseId;
          re._raw.order = exerciseEntry.order;
          if (exerciseEntry.supersetGroup !== undefined) re.supersetGroup = exerciseEntry.supersetGroup;
          if (exerciseEntry.restSeconds !== undefined) re.restSeconds = exerciseEntry.restSeconds;
          if (exerciseEntry.notes !== undefined) re.notes = exerciseEntry.notes;
        });
        routineExerciseId = (created as any).id;
      }

      // Wholesale, never reconciled: nothing references a `routine_sets` row.
      await replaceRoutineSets(database, routineExerciseId, exerciseEntry.sets);
    }

    // Delete only rows whose exercise is no longer in the routine — but freeze
    // each one's history before it goes. A set written before schema v3 records
    // no identity of its own, so the row being destroyed is the only thing that
    // says what it was performed as; `getExerciseWorkingSetHistory` resolves
    // those through the routine_exercises join. Stamping them with the row's
    // outgoing exercise id first is the same layer-2 defense
    // `updateRoutineExerciseExerciseId` applies before it re-points a row, and
    // for the same reason: the row is shared by every past session, so dropping
    // it from the *plan* must not erase what was already *done*. Sets that
    // already carry an identity are untouched — they were never at risk.
    // Both writes are inside this transaction, so they cannot come apart.
    for (const leftovers of unclaimed.values()) {
      for (const removed of leftovers) {
        const outgoingExerciseId = (removed as any)._raw.exercise_id as string | null;
        if (outgoingExerciseId) {
          const unstamped = ((await database
            .get('session_sets')
            .query(Q.where('routine_exercise_id', (removed as any).id))
            .fetch()) as SessionSet[]).filter(
            (set) => ((set as any)._raw.exercise_id ?? null) === null
          );

          if (unstamped.length > 0) {
            await database.batch(
              ...unstamped.map((set) =>
                set.prepareUpdate((record: any) => {
                  record.exerciseId = outgoingExerciseId;
                })
              )
            );
          }
        }

        // The entry's prescribed sets go with it — nothing references them, and
        // leaving them behind orphans rows no reader can reach. Inside this
        // same write, and AFTER the history stamp above: the stamp is the thing
        // that must not be displaced, since it is the only record of what those
        // pre-v3 sets were performed as.
        await replaceRoutineSets(database, (removed as any).id, []);

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
 * Atomicity: check-and-delete is one critical section — the single-row
 * destroy happens inside one writer transaction via database.batch.
 *
 * @param database The database instance
 * @param routineId The routine ID to delete
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

    // Delete ONLY the routine row. Retain routine_exercises as history carriers
    // so that session_sets remain queryable via getExerciseWorkingSetHistory.
    await database.batch(routine.prepareDestroyPermanently());
  });
}
