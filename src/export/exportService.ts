import { Database, Q } from '@nozbe/watermelondb';
import { serializeRoutine, serializeSession } from '@/interop/serialize';
import { getSessionSets } from '@/db/repository';

/**
 * Export a single routine to markdown string.
 *
 * Returns empty string if routine not found. Uses existing `serializeRoutine`
 * to produce vault-contract-compliant markdown.
 *
 * @param db Database instance
 * @param routineId Routine ID to export
 * @returns Markdown string (or empty string if not found)
 */
export async function exportRoutine(db: Database, routineId: string): Promise<string> {
  try {
    const routine = await db.get('routines').find(routineId);
    if (!routine) {
      return '';
    }

    // Get routine exercises ordered by their order field
    const routineExercises = (await db
      .get('routine_exercises')
      .query(Q.where('routine_id', routineId), Q.sortBy('order', 'asc'))
      .fetch()) as any[];

    // Get all exercise IDs from routine exercises
    const exerciseIds = routineExercises.map((re) => re._raw.exercise_id);
    const exercises =
      exerciseIds.length > 0
        ? ((await db
            .get('exercises')
            .query(Q.where('id', Q.oneOf(exerciseIds)))
            .fetch()) as any[])
        : [];

    // Serialize routine
    return serializeRoutine(
      {
        id: (routine as any).id,
        name: (routine as any).name,
        notes: (routine as any).notes,
        createdAt: (routine as any).createdAt,
        updatedAt: (routine as any).updatedAt,
      },
      routineExercises.map((re) => ({
        id: re.id,
        exerciseId: re._raw.exercise_id,
        order: re._raw.order,
        supersetGroup: re._raw.superset_group,
        warmupSets: re._raw.warmup_sets,
        targetSets: re._raw.target_sets ?? undefined,
        targetReps: re._raw.target_reps ?? undefined,
        targetDurationSeconds: re._raw.target_duration_seconds ?? undefined,
        restSeconds: re._raw.rest_seconds ?? undefined,
        notes: re._raw.notes,
      })),
      exercises.map((e) => ({
        id: e.id,
        title: e.title,
        kind: e._raw.kind,
      }))
    );
  } catch {
    return '';
  }
}

/**
 * Export all completed sessions (exercise history) to markdown.
 *
 * Returns one session per block. Each session is serialized via the existing
 * `serializeSession`, which handles the orphaned-set case (sets whose
 * routine_exercise row was deleted but whose exercise_id stamp survives).
 *
 * @param db Database instance
 * @returns Markdown string (possibly empty if no completed sessions)
 */
export async function exportSessionHistory(db: Database): Promise<string> {
  // Get all completed sessions
  const sessions = (await db
    .get('sessions')
    .query(Q.where('phase', 'Done'), Q.sortBy('ended_at', 'desc'))
    .fetch()) as any[];

  if (sessions.length === 0) {
    return '';
  }

  const sessionMarkdowns: string[] = [];

  for (const session of sessions) {
    try {
      // Get sets for this session
      const sets = await getSessionSets(db, session.id);

      // Get routine exercises for context
      const routineExercises = (await db
        .get('routine_exercises')
        .query(Q.where('routine_id', session.routineId))
        .fetch()) as any[];

      // Get all exercise IDs from routine exercises
      const exerciseIds = [
        ...new Set(routineExercises.map((re) => re._raw.exercise_id)),
      ];

      // Also fetch stamped exercises (for orphaned sets)
      const stampedExerciseIds = [
        ...new Set(
          (sets as any[])
            .map((s) => (s as any)._raw.exercise_id as string | null)
            .filter((id): id is string => !!id && !exerciseIds.includes(id))
        ),
      ];

      let exercises: any[] = [];
      if (exerciseIds.length > 0) {
        exercises.push(
          ...(await db
            .get('exercises')
            .query(Q.where('id', Q.oneOf(exerciseIds)))
            .fetch())
        );
      }

      if (stampedExerciseIds.length > 0) {
        exercises.push(
          ...(await db
            .get('exercises')
            .query(Q.where('id', Q.oneOf(stampedExerciseIds)))
            .fetch())
        );
      }

      // Serialize this session
      const markdown = serializeSession(
        {
          id: session.id,
          routineId: session.routineId,
          startedAt: (session as any).startedAt,
          endedAt: (session as any).endedAt,
          createdAt: (session as any).createdAt,
          customSyncStatus: (session as any).customSyncStatus,
        },
        (sets as any[]).map((s) => ({
          routineExerciseId: (s as any).routineExerciseId,
          exerciseId: (s as any)._raw.exercise_id ?? undefined,
          setType: (s as any).setType,
          reps: (s as any).reps ?? undefined,
          weightKg: (s as any).weightKg ?? undefined,
          distanceM: (s as any).distanceM ?? undefined,
          durationSeconds: (s as any).durationSeconds ?? undefined,
          rpe: (s as any).rpe ?? undefined,
          position: (s as any)._raw.position,
        })),
        routineExercises.map((re) => ({
          id: re.id,
          exerciseId: re._raw.exercise_id,
          order: re._raw.order,
          supersetGroup: re._raw.superset_group,
          warmupSets: re._raw.warmup_sets,
          targetSets: re._raw.target_sets ?? undefined,
          targetReps: re._raw.target_reps ?? undefined,
          targetDurationSeconds: re._raw.target_duration_seconds ?? undefined,
          restSeconds: re._raw.rest_seconds ?? undefined,
          notes: re._raw.notes,
        })),
        exercises.map((e) => ({
          id: e.id,
          title: e.title,
          kind: e._raw.kind,
        }))
      );

      sessionMarkdowns.push(markdown);
    } catch {
      // Skip any sessions that fail to serialize (malformed data, missing exercises, etc.)
      continue;
    }
  }

  return sessionMarkdowns.join('\n');
}

// Re-export presenter functions for convenience
export { getRoutineExportName, getSessionHistoryExportName } from './exportPresenter';
