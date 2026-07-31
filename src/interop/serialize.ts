/**
 * Serializer: DB rows → markdown (Task 2).
 * AC3.2: valid frontmatter, required keys, ✅ token.
 */

import SessionSet, { SetType } from '@/db/models/SessionSet';
import Exercise, { ExerciseKind } from '@/db/models/Exercise';
import { formatFlags, formatDuration } from './format';

/**
 * Serialize a session to markdown.
 * Includes frontmatter (type, id, date, tags, created), Tasks-plugin ✅ token, and fenced workout block.
 */
export function serializeSession(
  sessionRow: {
    id: string;
    routineId: string;
    startedAt: Date;
    endedAt?: Date;
    createdAt: Date;
    customSyncStatus: string;
  },
  sets: Array<{
    routineExerciseId: string;
    /**
     * The exercise this set was performed as (session_sets.exercise_id). Fills
     * the line's existing identity slot in preference to the routine row's
     * exerciseId: ReplaceExercise re-points that row, so a session still queued
     * for sync would otherwise serialize under whatever the routine names by
     * the time the bridge comes back. Absent on sets written before the column
     * existed — those fall back to the row, as everywhere else.
     */
    exerciseId?: string;
    setType: SetType;
    reps?: number;
    weightKg?: number;
    distanceM?: number;
    durationSeconds?: number;
    rpe?: number;
    position: number;
  }>,
  routineExercises: Array<{
    id: string;
    exerciseId: string;
    order: number;
    supersetGroup?: string;
    warmupSets: number;
    targetSets?: number;
    targetReps?: number;
    targetDurationSeconds?: number;
    restSeconds?: number;
    notes?: string;
  }>,
  exercises: Array<{
    id: string;
    title: string;
    kind: ExerciseKind;
  }>
): string {
  // Extract date from endedAt (or startedAt if no endedAt)
  const dateObj = sessionRow.endedAt || sessionRow.startedAt;
  const dateStr = dateObj.toISOString().split('T')[0];

  // Build frontmatter
  const createdStr = sessionRow.createdAt.toISOString().split('T')[0];
  const frontmatter = [
    '---',
    'type: workout-session',
    `id: ${sessionRow.id}`,
    `date: ${dateStr}`,
    `tags: []`,
    `created: ${createdStr}`,
    '---',
  ].join('\n');

  // Build workout block
  const workoutLines: string[] = [];

  // Group sets by routine_exercise_id
  const setsByExercise = new Map<string, typeof sets>();
  for (const set of sets) {
    if (!setsByExercise.has(set.routineExerciseId)) {
      setsByExercise.set(set.routineExerciseId, []);
    }
    setsByExercise.get(set.routineExerciseId)!.push(set);
  }

  // Build lines in order of routine_exercises
  for (const re of routineExercises) {
    const exerciseSets = setsByExercise.get(re.id) || [];

    // Get all sets for this exercise
    const exerciseSetsInOrder = exerciseSets.sort((a, b) => a.position - b.position);

    // If superset, need to group; handle adjacent superset exercises
    // For now, emit each set as a line with superset flag
    for (const set of exerciseSetsInOrder) {
      // What the set was performed as, not what its routine row names today.
      // The row supplies everything else on the line — the prescription belongs
      // to the plan and survives a swap untouched — so only the identity (and
      // the kind read off it) comes from the set.
      const performedExerciseId = set.exerciseId || re.exerciseId;
      const exerciseData = exercises.find(e => e.id === performedExerciseId);

      if (!exerciseData) continue;

      // Build flags manually for sessions to always include set_type
      const flagParts: string[] = [];

      // Always add set_type for session sets
      flagParts.push(`set_type=${set.setType}`);

      // Add kind if not strength (C2)
      if (exerciseData.kind !== 'strength') {
        flagParts.push(`kind=${exerciseData.kind}`);
      }

      // Add rpe if present. `!= null` (not `!== undefined`): WatermelonDB
      // returns null, not undefined, for an unset optional column, and a
      // loose null check is the only guard that treats both as "absent"
      // without also rejecting legitimate falsy values like 0.
      if (set.rpe != null) {
        flagParts.push(`rpe=${set.rpe}`);
      }

      // Add weight if present (C1)
      if (set.weightKg != null) {
        flagParts.push(`weight=${set.weightKg}`);
      }

      // Add distance if present (C1)
      if (set.distanceM != null) {
        flagParts.push(`distance=${set.distanceM}`);
      }

      // Add superset if applicable
      if (re.supersetGroup) {
        flagParts.push(`superset=${re.supersetGroup}`);
      }

      // Add rest (from routine_exercise level)
      if (re.restSeconds != null) {
        if (re.restSeconds >= 60) {
          flagParts.push(`rest=${formatDuration(re.restSeconds)}`);
        } else {
          flagParts.push(`rest=${re.restSeconds}`);
        }
      }

      // Build set description
      // For sessions: logged sets are emitted as 1x<reps> (not target sets)
      let setDesc = '';
      if (set.reps != null) {
        // Strength: 1x<logged-reps>
        setDesc = `1x${set.reps}`;
      } else if (set.durationSeconds != null) {
        // Cardio/stretch: emit duration as flag (C2)
        flagParts.push(`duration=${formatDuration(set.durationSeconds)}`);
      }

      const flagStr = flagParts.join(' ');
      // Build line: `- <exercise-id>: <setDesc> <flagStr>`, avoiding double space
      const parts = [setDesc, flagStr].filter(p => p);
      const line = `- ${performedExerciseId}: ${parts.join(' ')}`;
      workoutLines.push(line);
    }
  }

  // Build body with ✅ token and workout block
  const body = [
    `✅ ${dateStr}`,
    '',
    '```workout',
    ...workoutLines,
    '```',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Serialize a routine to markdown.
 * Includes frontmatter (type, id, updated, created, tags) and fenced workout block.
 */
export function serializeRoutine(
  routineRow: {
    id: string;
    name: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
  },
  routineExercises: Array<{
    id: string;
    exerciseId: string;
    order: number;
    supersetGroup?: string;
    warmupSets: number;
    targetSets?: number;
    targetReps?: number;
    targetDurationSeconds?: number;
    restSeconds?: number;
    notes?: string;
  }>,
  exercises: Array<{
    id: string;
    title: string;
    kind: ExerciseKind;
  }>
): string {
  const createdStr = routineRow.createdAt.toISOString().split('T')[0];
  const updatedStr = routineRow.updatedAt.toISOString().split('T')[0];

  const frontmatter = [
    '---',
    'type: workout-routine',
    `id: ${routineRow.id}`,
    `updated: ${updatedStr}`,
    `tags: []`,
    `created: ${createdStr}`,
    '---',
  ].join('\n');

  // Build workout block
  const workoutLines: string[] = [];

  for (const re of routineExercises) {
    const exerciseData = exercises.find(e => e.id === re.exerciseId);
    if (!exerciseData) continue;

    const flags: Record<string, any> = {};

    // Add kind if not strength
    if (exerciseData.kind !== 'strength') {
      flags.kind = exerciseData.kind;
    }

    // Add duration for cardio/stretch. `!= null`, not `!== undefined`: see
    // the matching comment in serializeSession — WatermelonDB's unset
    // optional columns surface as null here too.
    if (re.targetDurationSeconds != null) {
      flags.durationSeconds = re.targetDurationSeconds;
    }

    // Add superset if applicable
    if (re.supersetGroup) {
      flags.supersetLabel = re.supersetGroup;
    }

    // Add warmup count if > 0
    if (re.warmupSets > 0) {
      flags.warmupSets = re.warmupSets;
    }

    // Add rest
    if (re.restSeconds != null) {
      flags.restSeconds = re.restSeconds;
    }

    // Add notes as hint if present
    if (re.notes) {
      flags.hint = re.notes;
    }

    let setDesc = '';
    if (re.targetSets != null && re.targetReps != null) {
      setDesc = `${re.targetSets}x${re.targetReps}`;
    }

    const flagStr = formatFlags(flags);
    // Build line: `- <exercise-id>: <setDesc> <flagStr>`, avoiding double space
    const parts = [setDesc, flagStr].filter(p => p);
    const line = `- ${re.exerciseId}: ${parts.join(' ')}`;
    workoutLines.push(line);
  }

  const body = [
    '```workout',
    ...workoutLines,
    '```',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}
