/**
 * Sync service: manages session export to bridge and routine import.
 * AC5.1: offline sessions queue and flip to synced on retry
 * AC5.3: idempotent by session id
 * AC4.5: health check gates posting
 */

import { Database, Q } from '@nozbe/watermelondb';
import Session from '@/db/models/Session';
import { getSession, getSessionSets, upsertExercise, upsertRoutine } from '@/db/repository';
import { serializeSession } from '@/interop/serialize';
import { parseRoutine } from '@/interop/parse';
import { ContractError } from '@/interop/format';
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

          // A set records what it was performed as, which is no longer any of
          // the routine's current exercises once a ReplaceExercise swap or a
          // routine edit has moved on — and serializeSession refuses to export
          // a session whose set it cannot identify, so these records are what
          // keep such a session syncable at all. Fetch them by query rather
          // than find(): a stamped id with no surviving row must not take the
          // whole session's sync down with it.
          const stampedExerciseIds = [
            ...new Set(
              sets
                .map((s) => (s as any)._raw.exercise_id as string | null)
                .filter((id): id is string => !!id && !exerciseIds.includes(id))
            ),
          ];
          const stampedExercises =
            stampedExerciseIds.length > 0
              ? await database
                  .get('exercises')
                  .query(Q.where('id', Q.oneOf(stampedExerciseIds)))
                  .fetch()
              : [];

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
              exerciseId: (s as any)._raw.exercise_id ?? undefined,
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
            ([...exercises, ...stampedExercises] as any[]).map((e) => ({
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

    /**
     * Import routines from bridge.
     * Pulls getRoutines(), parses each, upserts the full graph.
     * Malformed routines are skipped + logged, not fatal.
     */
    async importRoutines(): Promise<void> {
      try {
        const routines = await bridgeClient.getRoutines();

        for (const routineInfo of routines) {
          try {
            // Parse routine markdown
            const parsed = parseRoutine(routineInfo.markdown);
            const routineId = parsed.frontmatter.id || routineInfo.id;

            // Extract exercises from parsed routine
            // parsed.exercises is an array of (WorkoutLine | SupersetGroup)
            const allExercises: Array<{
              exerciseId: string;
              kind: string;
              order: number;
              supersetGroup?: string;
              targetSets?: number;
              targetReps?: number;
              targetDurationSeconds?: number;
              restSeconds?: number;
              warmupSets?: number;
              notes?: string;
            }> = [];

            let order = 0; // Canonical base: 0-based (matches entry idx from startSessionFromRoutine)
            for (const entry of parsed.exercises) {
              if ('exercises' in entry) {
                // Superset group
                const supersetLabel = entry.supersetLabel;
                for (const line of entry.exercises) {
                  allExercises.push({
                    exerciseId: line.exerciseId,
                    kind: line.kind || 'strength',
                    order,
                    supersetGroup: supersetLabel,
                    targetSets: line.targetSets,
                    targetReps: line.targetReps,
                    targetDurationSeconds: line.targetDurationSeconds,
                    restSeconds: line.restSeconds,
                    warmupSets: line.warmupSets,
                    notes: line.hint,
                  });
                  order++;
                }
              } else {
                // Single line
                const line = entry;
                allExercises.push({
                  exerciseId: line.exerciseId,
                  kind: line.kind || 'strength',
                  order,
                  targetSets: line.targetSets,
                  targetReps: line.targetReps,
                  targetDurationSeconds: line.targetDurationSeconds,
                  restSeconds: line.restSeconds,
                  warmupSets: line.warmupSets,
                  notes: line.hint,
                });
                order++;
              }
            }

            // Upsert exercises first
            const distinctExercises = new Map<
              string,
              { title: string; kind: string }
            >();
            for (const ex of allExercises) {
              if (!distinctExercises.has(ex.exerciseId)) {
                distinctExercises.set(ex.exerciseId, {
                  title: ex.exerciseId, // Use slug as title (can be improved with metadata)
                  kind: ex.kind,
                });
              }
            }

            for (const [exerciseId, data] of distinctExercises.entries()) {
              await upsertExercise(database, exerciseId, data.title, data.kind);
            }

            // Upsert routine with exercises
            await upsertRoutine(
              database,
              routineId,
              parsed.frontmatter.id || routineInfo.id,
              allExercises.map((e) => ({
                exerciseId: e.exerciseId,
                order: e.order,
                supersetGroup: e.supersetGroup,
                warmupSets: e.warmupSets,
                targetSets: e.targetSets,
                targetReps: e.targetReps,
                targetDurationSeconds: e.targetDurationSeconds,
                restSeconds: e.restSeconds,
                notes: e.notes,
              }))
            );
          } catch (error) {
            // Skip malformed routines; log error
            if (error instanceof ContractError) {
              console.error(`Failed to parse routine ${routineInfo.id}: ${error.message}`);
            } else {
              console.error(`Failed to import routine ${routineInfo.id}:`, error);
            }
            continue;
          }
        }
      } catch (error) {
        // Surfaced to the caller (and the Settings UI) via the thrown error;
        // warn rather than error so a handled failure doesn't red-screen LogBox.
        console.warn('Failed to fetch routines for import:', error);
        throw error;
      }
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
