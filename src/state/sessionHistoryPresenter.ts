import { Database, Q } from '@nozbe/watermelondb';

export interface SessionHistoryItem {
  id: string;
  routineId: string;
  routineName: string;
  startedAt: number;
  endedAt: number;
  setCount: number;
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

    const sets = await db
      .get('session_sets')
      .query(Q.where('session_id', session.id))
      .fetch();

    result.push({
      id: session.id,
      routineId,
      routineName,
      startedAt: session._raw.started_at,
      endedAt: session._raw.ended_at,
      setCount: sets.length,
    });
  }

  result.sort((a, b) => b.endedAt - a.endedAt);

  return result;
}
