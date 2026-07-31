import { Database } from '@nozbe/watermelondb';
import SessionSet from '@/db/models/SessionSet';
import { getSession, getSessionSets, getSessionExerciseLog, getRoutineDisplay } from '@/db/repository';
import { formatSetLine } from './sessionPresenter';

/**
 * One logged set formatted for display, keyed by its own row id (stable
 * across re-renders — a session can log many sets with identical values).
 */
export interface SessionDetailSetLine {
  id: string;
  setType: string;
  line: string;
  /** Formatted label (e.g. "Warmup 1", "Set 3") with independent counters per type */
  label: string;
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
  /** When the session ended, or null for in-progress sessions (caller should filter
   *  for ended sessions before rendering this detail, per sessionHistoryPresenter convention). */
  endedAt: number | null;
  /**
   * Planned exercises in routine order, paired with logged sets. Note that this
   * list reflects the routine's CURRENT composition, not the session's. If an
   * exercise was added to the routine after this session ended, it will appear
   * here with zero logged sets. Conversely, if an exercise was removed from the
   * routine, its logged sets will appear in otherSets instead. Full fidelity is
   * unrecoverable because session_sets carries only routine_exercise_id, not
   * exercise_id. See AGENTS.md ticket C3 (PR #31) for the design tradeoff.
   */
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
 * Delegates to the shared formatSetLine with the DB's SessionSet shape.
 */
function formatSessionSetLine(set: SessionSet): string {
  return formatSetLine(
    set.setType as string,
    set.reps ?? null,
    set.weightKg ?? null,
    set.durationSeconds ?? null,
    set.rpe ?? null
  );
}

function toSetLine(set: SessionSet, warmupIndex: number, workingIndex: number): SessionDetailSetLine {
  const setType = set.setType as string;
  const label = setType === 'warmup'
    ? `Warmup ${warmupIndex + 1}`
    : `Set ${workingIndex + 1}`;

  return {
    id: set.id,
    setType,
    line: formatSessionSetLine(set),
    label,
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
  const endedAt = session.endedAt?.getTime() ?? null;

  const allSets = await getSessionSets(db, sessionId);
  const [routineDisplay, log] = await Promise.all([
    getRoutineDisplay(db, routineId),
    getSessionExerciseLog(db, sessionId, routineId, allSets),
  ]);

  const accountedForSetIds = new Set<string>();
  const exercises: SessionDetailExercise[] = log.map((entry) => {
    for (const set of entry.sets) {
      accountedForSetIds.add(set.id);
    }

    // Build sets with independent warmup and working set counters
    let warmupCount = 0;
    let workingCount = 0;
    const formattedSets = entry.sets.map((set) => {
      const setType = set.setType as string;
      if (setType === 'warmup') {
        return toSetLine(set, warmupCount++, -1);
      } else {
        return toSetLine(set, -1, workingCount++);
      }
    });

    return {
      routineExerciseId: entry.routineExerciseId,
      title: entry.title,
      targetSets: entry.targetSets,
      targetReps: entry.targetReps,
      targetDurationSeconds: entry.targetDurationSeconds,
      sets: formattedSets,
    };
  });

  // For otherSets (from deleted exercises), just use simple numbering
  const otherSets = allSets
    .filter((set) => !accountedForSetIds.has(set.id))
    .map((set, idx) => {
      const label = String(idx + 1);
      return {
        id: set.id,
        setType: set.setType as string,
        line: formatSessionSetLine(set),
        label,
      };
    });

  return {
    sessionId: session.id,
    routineName: routineDisplay?.name ?? routineId,
    endedAt,
    exercises,
    otherSets,
  };
}
