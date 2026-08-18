import { Database, Q } from '@nozbe/watermelondb';
import { serializeRoutine, serializeSession } from '@/interop/serialize';
import { getRoutineSets, getSessionSets } from '@/db/repository';

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
  // Queried, not `find()`-and-catch. `find` REJECTS on a missing id, so the old
  // blanket catch collapsed "no such routine" and "this routine could not be
  // read" into the same empty string (#212). An explicit query separates them,
  // and lets a real failure propagate instead of posing as an empty routine.
  const routines = await db.get('routines').query(Q.where('id', routineId)).fetch();
  if (routines.length === 0) {
    return '';
  }
  const routine = routines[0] as any;

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

  // The prescribed set list of each entry (#276 Phase 5). Fetched per entry
  // rather than in one query because `getRoutineSets` is the layer that already
  // sorts by `order` and normalizes WatermelonDB's nulls away; re-implementing
  // either here to save a round trip is how the two drift. An entry with no
  // `routine_sets` rows answers `[]`, which serializes to a bare exercise line.
  const setsByEntry = await Promise.all(
    routineExercises.map((re) => getRoutineSets(db, re.id))
  );

  // Serialize routine
  return serializeRoutine(
    {
      id: (routine as any).id,
      name: (routine as any).name,
      notes: (routine as any).notes,
      createdAt: (routine as any).createdAt,
      updatedAt: (routine as any).updatedAt,
    },
    routineExercises.map((re, index) => ({
      id: re.id,
      exerciseId: re._raw.exercise_id,
      order: re._raw.order,
      supersetGroup: re._raw.superset_group,
      restSeconds: re._raw.rest_seconds ?? undefined,
      notes: re._raw.notes,
      // `?? undefined` on every optional field, the same normalization this
      // mapping has always applied — the second layer behind `serialize.ts`'s
      // own `!= null` guards, per AGENTS.md. Redundant with `getRoutineSets`'s
      // own normalization by design: keep both.
      sets: setsByEntry[index].map((set) => ({
        setType: set.setType,
        targetReps: set.targetReps ?? undefined,
        targetRepsMax: set.targetRepsMax ?? undefined,
        targetWeightKg: set.targetWeightKg ?? undefined,
        targetDurationSeconds: set.targetDurationSeconds ?? undefined,
        targetDistanceM: set.targetDistanceM ?? undefined,
      })),
    })),
    exercises.map((e) => ({
      id: e.id,
      title: e.title,
      kind: e._raw.kind,
    }))
  );
}

/** A session that could not be serialized, and why. */
export interface SessionExportFailure {
  sessionId: string;
  reason: string;
}

/**
 * The result of an aggregate session export.
 *
 * `failures` is the whole point of the type (#212). `serializeSession`
 * guarantees it never emits a *partial* session — every logged set produces a
 * line or the call throws — but this caller used to catch per session and
 * continue, so the aggregate came back silently short at session granularity:
 * the same data-loss shape the set-level rule exists to prevent, one level up.
 *
 * Skipping is still right for a backup — 47 of 48 sessions beats 0 of 48. What
 * was wrong was the silence. A caller MUST surface a non-empty `failures`;
 * writing `markdown` to a file and dropping this on the floor reinstates the bug.
 */
export interface SessionHistoryExport {
  markdown: string;
  failures: SessionExportFailure[];
}

/**
 * Export all completed sessions (exercise history) to markdown.
 *
 * Returns one session per block. Each session is serialized via the existing
 * `serializeSession`, which handles the orphaned-set case (sets whose
 * routine_exercise row was deleted but whose exercise_id stamp survives).
 *
 * @param db Database instance
 * @returns The markdown, plus every session that could not be serialized
 */
export async function exportSessionHistory(db: Database): Promise<SessionHistoryExport> {
  // Get all completed sessions (those with ended_at set)
  const sessions = (await db
    .get('sessions')
    .query(Q.where('ended_at', Q.notEq(null)), Q.sortBy('ended_at', Q.desc))
    .fetch()) as any[];

  if (sessions.length === 0) {
    return { markdown: '', failures: [] };
  }

  const sessionMarkdowns: string[] = [];
  const failures: SessionExportFailure[] = [];

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
          // serializeSession still declares this field but never reads it; the model
          // dropped it at schema v4. Supplied as a literal to satisfy the type.
          customSyncStatus: 'local',
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
    } catch (error) {
      // Named, not swallowed (#212). The session is still skipped rather than
      // failing the whole export, but the caller now learns which one, so the
      // UI can say "47 of 48" instead of handing over a short file that looks
      // complete.
      failures.push({
        sessionId: session.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { markdown: sessionMarkdowns.join('\n'), failures };
}

// Re-export presenter functions for convenience
export { getRoutineExportName, getSessionHistoryExportName } from './exportPresenter';
