/**
 * Sync service: manages session export to bridge and routine import.
 * AC5.1: offline sessions queue and flip to synced on retry
 * AC5.3: idempotent by session id
 * AC4.5: health check gates posting
 */

import { Database, Q } from '@nozbe/watermelondb';
import Session from '@/db/models/Session';
import { getSession, getSessionSets } from '@/db/repository';
import { serializeSession } from '@/interop/serialize';
import { BridgeClient } from './bridgeClient';

/**
 * Create a sync service with the given database and bridge client.
 */
export function createSyncService(database: Database, bridgeClient: BridgeClient) {
  return {
    /**
     * Run sync: check health, then export local sessions to bridge.
     * Sessions stay "local" if bridge unreachable; transition to "synced" on successful post.
     * Idempotent: already-synced sessions are skipped.
     */
    async syncNow(): Promise<void> {
      try {
        // Check health first; if unreachable, return early
        await bridgeClient.health();
      } catch {
        // Bridge unreachable; don't attempt posts
        return;
      }

      // Query all sessions with customSyncStatus = 'local' and finished (ended_at set)
      const sessions = (await database
        .get('sessions')
        .query(
          Q.and(
            Q.where('sync_status', 'local'),
            Q.where('ended_at', Q.notEq(null))
          )
        )
        .fetch()) as Session[];

      // For each local finished session, try to post
      for (const session of sessions) {
        try {
          // Get sets for this session
          const sets = await getSessionSets(database, session.id);

          // Get routine exercises and exercises needed by serializeSession
          const routine = await database.get('routines').find(session.routineId);
          const routineExercises = (await database
            .get('routine_exercises')
            .query(Q.where('routine_id', session.routineId))
            .fetch()) as any[];

          // Get all exercise IDs from routine exercises
          const exerciseIds = [...new Set(routineExercises.map((re) => re._raw.exercise_id))];
          const exercises = await Promise.all(
            exerciseIds.map((id) => database.get('exercises').find(id))
          );

          // Serialize session to markdown
          const markdown = serializeSession(
            {
              id: session.id,
              routineId: session.routineId,
              startedAt: (session as any).startedAt,
              endedAt: (session as any).endedAt,
              createdAt: (session as any).createdAt,
              customSyncStatus: (session as any).customSyncStatus,
            },
            sets.map((s) => ({
              routineExerciseId: (s as any).routineExerciseId,
              setType: (s as any).setType,
              reps: (s as any).reps,
              weightKg: (s as any).weightKg,
              distanceM: (s as any).distanceM,
              durationSeconds: (s as any).durationSeconds,
              rpe: (s as any).rpe,
              position: (s as any)._raw.position,
            })),
            routineExercises.map((re) => ({
              id: re.id,
              exerciseId: re._raw.exercise_id,
              order: re._raw.order,
              supersetGroup: re._raw.superset_group,
              warmupSets: re._raw.warmup_sets,
              targetSets: re._raw.target_sets,
              targetReps: re._raw.target_reps,
              targetDurationSeconds: re._raw.target_duration_seconds,
              restSeconds: re._raw.rest_seconds,
              notes: re._raw.notes,
            })),
            (exercises as any[]).map((e) => ({
              id: e.id,
              title: e.title,
              kind: e._raw.kind,
            }))
          );

          // Post session to bridge
          await bridgeClient.postSession({
            id: session.id,
            markdown,
          });

          // Mark session as synced
          await database.write(async () => {
            await session.update((record: any) => {
              record._raw.sync_status = 'synced';
            });
          });
        } catch (error) {
          // Skip this session and continue with others
          // (don't let one failure block the rest)
          console.error(`Failed to sync session ${session.id}:`, error);
          continue;
        }
      }
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
