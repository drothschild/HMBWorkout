import { Database, Q } from '@nozbe/watermelondb';

export interface SessionHistoryItem {
  id: string;
  routineName: string;
  endedAt: number;
  setCount: number;
}

/**
 * Format a session's set count for the history card, singular or plural.
 */
export function formatSetCountLabel(setCount: number): string {
  return setCount === 1 ? '1 logged set' : `${setCount} logged sets`;
}

/**
 * Format a session's end time as a short date for the history card and the
 * delete confirmation, in the device locale.
 */
export function formatSessionDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Query all finished sessions (endedAt set) and format them for the history
 * list UI, most recently finished first.
 *
 * The in-progress session (endedAt unset) is intentionally excluded so it
 * can never be surfaced as a delete candidate from this list.
 */
export async function sessionHistoryPresenter(db: Database): Promise<SessionHistoryItem[]> {
  const sessions = (await db
    .get('sessions')
    .query(Q.where('ended_at', Q.notEq(null)))
    .fetch()) as any[];

  // Batch-fetch all sets for all sessions to avoid N+1 queries
  const sessionIds = sessions.map((s) => s.id);
  const allSets = (await db
    .get('session_sets')
    .query(Q.where('session_id', Q.oneOf(sessionIds)))
    .fetch()) as any[];

  // Group sets by session_id for O(1) lookup
  const setsBySessionId = new Map<string, any[]>();
  for (const set of allSets) {
    const sessionId = set._raw.session_id;
    if (!setsBySessionId.has(sessionId)) {
      setsBySessionId.set(sessionId, []);
    }
    setsBySessionId.get(sessionId)!.push(set);
  }

  const result: SessionHistoryItem[] = [];

  for (const session of sessions) {
    const routineId = session.routineId;
    let routineName = routineId;
    try {
      const routine = await db.get('routines').find(routineId);
      routineName = (routine as any).name;
    } catch {
      // Routine no longer exists; fall back to showing its id.
    }

    const sessionSets = setsBySessionId.get(session.id) || [];

    result.push({
      id: session.id,
      routineName,
      endedAt: session._raw.ended_at,
      setCount: sessionSets.length,
    });
  }

  result.sort((a, b) => b.endedAt - a.endedAt);

  return result;
}
