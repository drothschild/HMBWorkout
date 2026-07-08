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
    setType: SetType;
    reps?: number;
    weightKg?: number;
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
    const exerciseData = exercises.find(e => e.id === re.exerciseId);

    if (!exerciseData) continue;

    // Get all sets for this exercise
    const exerciseSetsInOrder = exerciseSets.sort((a, b) => a.position - b.position);

    // If superset, need to group; handle adjacent superset exercises
    // For now, emit each set as a line with superset flag
    for (const set of exerciseSetsInOrder) {
      // Build flags manually for sessions to always include set_type
      const flagParts: string[] = [];

      // Always add set_type for session sets
      flagParts.push(`set_type=${set.setType}`);

      // Add rpe if present
      if (set.rpe !== undefined) {
        flagParts.push(`rpe=${set.rpe}`);
      }

      // Add superset if applicable
      if (re.supersetGroup) {
        flagParts.push(`superset=${re.supersetGroup}`);
      }

      // Add rest (from routine_exercise level)
      if (re.restSeconds !== undefined) {
        if (re.restSeconds >= 60) {
          flagParts.push(`rest=${formatDuration(re.restSeconds)}`);
        } else {
          flagParts.push(`rest=${re.restSeconds}`);
        }
      }

      // Build set description
      let setDesc = '';
      if (set.reps !== undefined && set.weightKg !== undefined) {
        // Strength: reps x weight
        setDesc = `1x${set.reps}`;
      } else if (set.durationSeconds !== undefined) {
        // Cardio/stretch: already in flags as duration
      }

      const flagStr = flagParts.join(' ');
      const line = `- ${re.exerciseId}: ${setDesc} ${flagStr}`.trim();
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

    // Add duration for cardio/stretch
    if (re.targetDurationSeconds !== undefined) {
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
    if (re.restSeconds !== undefined) {
      flags.restSeconds = re.restSeconds;
    }

    // Add notes as hint if present
    if (re.notes) {
      flags.hint = re.notes;
    }

    let setDesc = '';
    if (re.targetSets !== undefined && re.targetReps !== undefined) {
      setDesc = `${re.targetSets}x${re.targetReps}`;
    }

    const flagStr = formatFlags(flags);
    const line = `- ${re.exerciseId}: ${setDesc} ${flagStr}`.trim();
    workoutLines.push(line);
  }

  const body = [
    '```workout',
    ...workoutLines,
    '```',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}
