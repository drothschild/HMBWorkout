import { Database } from '@nozbe/watermelondb';
import SessionSet from '@/db/models/SessionSet';
import {
  getSession,
  getSessionSets,
  getSessionExerciseLog,
  getRoutineDisplay,
  type RoutineSetEntry,
} from '@/db/repository';
import { formatSetLine } from './sessionPresenter';
import { getPrescribedSetsForRow } from './routineSetPlans';

/**
 * One logged set formatted for display, keyed by its own row id (stable
 * across re-renders — a session can log many sets with identical values).
 */
export interface SessionDetailSetLine {
  id: string;
  setType: string;
  line: string;
  /** Formatted label: per-type counters (e.g. "Warmup 1", "Set 3") for planned
   * exercises, plain 1..n numbering (e.g. "1", "2") for otherSets */
  label: string;
}

/**
 * One planned exercise of the routine the session performed, in routine
 * order, paired with the sets actually logged against it. routineExerciseId
 * (not exerciseId) is the row identity: a routine may list the same exercise
 * twice, so exerciseId alone cannot key a React list (AGENTS.md boundary
 * rule) — see routineDetailPresenter.ts for the same convention.
 *
 * `title`/`exerciseId` describe what the sets were *performed* as, which after
 * a ReplaceExercise swap is not what the routine entry names today. One row can
 * therefore carry more than one entry, so a React key must be the
 * `(routineExerciseId, exerciseId)` pair rather than the row id alone.
 *
 * An empty `sets` array means the exercise was planned but skipped; the
 * screen renders that state rather than omitting the exercise, matching
 * getSessionExerciseLog's own documented convention.
 */
export interface SessionDetailExercise {
  routineExerciseId: string;
  /** The exercise these sets were performed as. */
  exerciseId: string;
  title: string;
  /**
   * What the routine prescribes for this row TODAY (#276) — read from
   * `routine_sets`, which is where the plan lives. This is the routine's
   * CURRENT composition, not a snapshot of what was planned when the session
   * ran; the routine may have been edited since. `[]` when the row prescribes
   * nothing or has been destroyed.
   */
  plannedSets: RoutineSetEntry[];
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
   * Planned exercises in routine order, paired with logged sets. The *spine* of
   * this list is the routine's CURRENT composition, not the session's: an
   * exercise added to the routine after this session ended appears here with
   * zero logged sets, and one removed from the routine has its sets fall into
   * otherSets instead.
   *
   * The titles, however, are the session's own: each entry is named by what its
   * sets were performed as (session_sets.exercise_id), so a ReplaceExercise
   * swap does not retitle finished workouts. Sets written before that column
   * existed still resolve through the routine_exercises row, and for those the
   * old caveat holds — a swap after the fact would have rewritten them, which
   * is why updateRoutineExerciseExerciseId stamps them before re-pointing.
   */
  exercises: SessionDetailExercise[];
  /**
   * Sets logged against a routine_exercise row that no longer exists. This
   * only happens when the routine was edited (not deleted) after the
   * session ended: upsertRoutine destroys the row for any exercise a draft
   * omits, and getSessionExerciseLog silently drops sets pointing at a
   * gone row. These render as a flat, generically-labeled list instead of
   * being lost.
   *
   * A set written before session_sets.exercise_id existed genuinely has no
   * identity left once its row is gone. A stamped one still does — surfacing
   * that here (titling orphans by their recorded exercise) is a worthwhile
   * follow-up, not something this list does today.
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

function toSetLine(set: SessionSet, label: string): SessionDetailSetLine {
  return {
    id: set.id,
    setType: set.setType as string,
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
 * silently losing logged history, matching the invariant that routines are
 * deletable while history is preserved.
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

  // The plan now lives in `routine_sets`, so the lookup is by row id. One read
  // per distinct row — `log` can list a row twice when a swap split its sets
  // across two performed identities, and both halves share the same plan.
  //
  // Through `getPrescribedSetsForRow`, so a row with no `routine_sets` behind
  // it still resolves to its aggregate counts. Reading `routine_sets` alone
  // made `plannedSets` empty for every routine in the app — `acceptDraft`
  // writes no set rows until Phase 4 — and the screen's target label vanished.
  const plansByRow = new Map<string, RoutineSetEntry[]>();
  for (const rowId of new Set(log.map((entry) => entry.routineExerciseId))) {
    plansByRow.set(rowId, await getPrescribedSetsForRow(db, rowId));
  }

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
      const label = setType === 'warmup'
        ? `Warmup ${warmupCount++ + 1}`
        : `Set ${workingCount++ + 1}`;
      return toSetLine(set, label);
    });

    return {
      routineExerciseId: entry.routineExerciseId,
      exerciseId: entry.exerciseId,
      title: entry.title,
      plannedSets: plansByRow.get(entry.routineExerciseId) ?? [],
      sets: formattedSets,
    };
  });

  // For otherSets (from deleted exercises), just use simple numbering
  const otherSets = allSets
    .filter((set) => !accountedForSetIds.has(set.id))
    .map((set, idx) => toSetLine(set, String(idx + 1)));

  return {
    sessionId: session.id,
    routineName: routineDisplay?.name ?? routineId,
    endedAt,
    exercises,
    otherSets,
  };
}
