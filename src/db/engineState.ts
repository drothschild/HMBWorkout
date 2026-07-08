import { Database, Q } from '@nozbe/watermelondb';
import { SessionState } from '@/engine/types';
import Session from './models/Session';

/**
 * Save a SessionState to a session row as JSON.
 * Follows repository.ts conventions: database param, wraps database.write internally.
 *
 * @param database The database instance
 * @param sessionId The session ID
 * @param state The SessionState to persist
 */
export async function saveEngineState(
  database: Database,
  sessionId: string,
  state: SessionState
): Promise<void> {
  await database.write(async () => {
    const session = await database.get('sessions').find(sessionId);
    await session.update((record: any) => {
      // M2: Use decorated setter for engine_state (not readonly)
      record.engineState = JSON.stringify(state);
    });
  });
}

/**
 * Load the active SessionState from the database.
 * Returns the single session with ended_at null and non-null engine_state, parsed.
 * Returns null if no such session exists.
 *
 * @param database The database instance
 * @returns The parsed SessionState or null if no active session with state exists
 */
export async function loadActiveEngineState(database: Database): Promise<SessionState | null> {
  const sessionsTable = database.get('sessions');

  // Query for sessions with ended_at null and non-null engine_state
  const activeSessions = (await sessionsTable
    .query(Q.where('ended_at', null))
    .fetch()) as Session[];

  // Find the first session with non-null engine_state
  for (const session of activeSessions) {
    const engineState = (session as any)._raw.engine_state;
    if (engineState) {
      try {
        return JSON.parse(engineState);
      } catch (err) {
        console.error(`Failed to parse engine_state for session ${session.id}:`, err);
        return null;
      }
    }
  }

  return null;
}

/**
 * Clear the engine_state from a session.
 * Sets the engine_state column to null.
 *
 * @param database The database instance
 * @param sessionId The session ID
 */
export async function clearEngineState(database: Database, sessionId: string): Promise<void> {
  await database.write(async () => {
    const session = await database.get('sessions').find(sessionId);
    await session.update((record: any) => {
      // M2: Use decorated setter for engine_state (not readonly)
      record.engineState = null;
    });
  });
}
