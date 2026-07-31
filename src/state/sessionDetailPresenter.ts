import { Database } from '@nozbe/watermelondb';
import SessionSet from '@/db/models/SessionSet';
import { getSession, getSessionSets, getSessionExerciseLog, getRoutineDisplay } from '@/db/repository';
import { formatWeightLbs } from './weightUnits';

/**
 * One logged set formatted for display, keyed by its own row id (stable
 * across re-renders — a session can log many sets with identical values).
 */
export interface SessionDetailSetLine {
  id: string;
  setType: string;
  line: string;
}

/**
 * One planned exercise of the routine the session performed, in routine
 * order, paired with the sets actually logged against it. routineExerciseId
 * (not exerciseId) is the row identity: a routine may list the same exercise
 * twice, so exerciseId alone cannot key a React list (AGENTS.md boundary
 * rule) — see routineDetailPresenter.ts for the same convention.
 *
 * An empty `sets` array means the exercise was planned but skipped; the
 * screen renders that state rather than omitting the exercise, matching
 * getSessionExerciseLog's own documented convention.
 */
export interface SessionDetailExercise {
  routineExerciseId: string;
  title: string;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  sets: SessionDetailSetLine[];
}

export interface SessionDetail {
  sessionId: string;
  /** The routine's current name, or its raw id if the routine has since
   *  been deleted — same fallback convention as sessionHistoryPresenter. */
  routineName: string;
  endedAt: number;
  exercises: SessionDetailExercise[];
  /**
   * Sets logged against a routine_exercise row that no longer exists. This
   * only happens when the routine was edited (not deleted) after the
   * session ended: upsertRoutine destroys the row for any exercise a draft
   * omits, and getSessionExerciseLog silently drops sets pointing at a
   * gone row. Exercise identity is unrecoverable once that row is gone —
   * session_sets carries only routine_exercise_id, never exercise_id — so
   * these render as a flat, generically-labeled list instead of being lost.
   */
  otherSets: SessionDetailSetLine[];
}

/**
 * Format one logged DB set for the read-only history detail screen.
 * Mirrors formatLoggedSetLine's (sessionPresenter.ts) rendering and sentinel
 * conventions — rpe -1 and null reps/weight/duration mean "absent" and must
 * be omitted, never rendered — applied to the DB's SessionSet shape rather
 * than the engine's LoggedSet (the two SetType unions and field sets differ
 * enough that reusing formatLoggedSetLine directly would need an unsafe
 * cast; the DB's setType really can hold 'stretch'/'cardio' at runtime even
 * though the model's TS type only declares 'warmup' | 'working' | 'drop' —
 * activeSession.ts's onPersistSet writes the engine's setType through as-is).
 */
function formatSessionSetLine(set: SessionSet): string {
  const parts: string[] = [];
  const setType = set.setType as string;
  const reps = set.reps ?? null;
  const weightKg = set.weightKg ?? null;
  const durationSeconds = set.durationSeconds ?? null;
  const rpe = set.rpe ?? null;

  if (setType === 'stretch' || setType === 'cardio') {
    if (durationSeconds != null) {
      parts.push(`${durationSeconds}s`);
    }
  } else if (reps != null && weightKg != null) {
    parts.push(`${reps} x ${formatWeightLbs(weightKg)}`);
  } else if (reps != null) {
    parts.push(`${reps} reps`);
  } else if (weightKg != null) {
    parts.push(formatWeightLbs(weightKg));
  }

  if (rpe != null && rpe !== -1) {
    parts.push(`RPE: ${rpe}`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

function toSetLine(set: SessionSet): SessionDetailSetLine {
  return {
    id: set.id,
    setType: set.setType as string,
    line: formatSessionSetLine(set),
  };
}

/**
 * Build the read model for one finished workout's detail screen: the
 * routine performed, when it ended, and every planned exercise in routine
 * order with the sets actually logged for it.
 *
 * Degrades gracefully when the routine (or one of its routine_exercises
 * rows) no longer exists — see SessionDetail's field docs — rather than
 * silently losing logged history, matching AGENTS.md's "routines are
 * deletable while history is preserved" invariant (ticket C3, PR #31).
 *
 * @param db The database instance
 * @param sessionId The finished session to show
 * @returns The session's detail view, or null if the session no longer exists
 */
export async function sessionDetailPresenter(db: Database, sessionId: string): Promise<SessionDetail | null> {
  const session = await getSession(db, sessionId);
  if (!session) {
    return null;
  }

  const routineId = session.routineId;
  const endedAt = (session as any)._raw.ended_at as number;

  const [routineDisplay, log, allSets] = await Promise.all([
    getRoutineDisplay(db, routineId),
    getSessionExerciseLog(db, sessionId, routineId),
    getSessionSets(db, sessionId),
  ]);

  const accountedForSetIds = new Set<string>();
  const exercises: SessionDetailExercise[] = log.map((entry) => {
    for (const set of entry.sets) {
      accountedForSetIds.add(set.id);
    }

    return {
      routineExerciseId: entry.routineExerciseId,
      title: entry.title,
      targetSets: entry.targetSets,
      targetReps: entry.targetReps,
      targetDurationSeconds: entry.targetDurationSeconds,
      sets: entry.sets.map(toSetLine),
    };
  });

  const otherSets = allSets.filter((set) => !accountedForSetIds.has(set.id)).map(toSetLine);

  return {
    sessionId: session.id,
    routineName: routineDisplay?.name ?? routineId,
    endedAt,
    exercises,
    otherSets,
  };
}
