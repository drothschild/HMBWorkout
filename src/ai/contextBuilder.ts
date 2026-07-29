import { Database } from '@nozbe/watermelondb';
import { getSettings } from '@/state/settings';
import { routineListPresenter } from '@/state/routineListPresenter';
import { routineDetailPresenter } from '@/state/routineDetailPresenter';
import { getExerciseWorkingSetHistory } from '@/db/repository';

export type AiCoachMode = { kind: 'create' } | { kind: 'edit'; routineId: string };

export const HISTORY_SETS_PER_EXERCISE = 5;

/**
 * Build the system prompt for Claude by composing user context:
 * - Coach persona and JSON response schema
 * - User goals and available equipment
 * - All existing routines and exercises
 * - Recent working set history (capped at 5 per exercise)
 * - Edit-mode instructions (if editing a specific routine)
 *
 * @param db WatermelonDB database instance
 * @param mode 'create' or 'edit' mode with optional routineId
 * @returns System prompt string for Claude API
 */
export async function buildSystem(db: Database, mode: AiCoachMode): Promise<string> {
  const sections: string[] = [];

  // Section 1: Persona and rules
  sections.push(personaSection());

  // Section 2: User goals
  sections.push(goalsSection());

  // Section 3: Available equipment
  sections.push(equipmentSection());

  // Section 4: Existing routines
  sections.push(await routinesSection(db));

  // Section 5: Recent training history
  sections.push(await historySection(db));

  // Section 6: Edit-mode addendum (if applicable)
  if (mode.kind === 'edit') {
    const editAddendum = await editModeSection(db, mode.routineId);
    if (editAddendum) {
      sections.push(editAddendum);
    }
  }

  return sections.join('\n\n');
}

function personaSection(): string {
  return `You are a strength-training coach inside a workout-logging app.

Every response must be valid JSON with this structure:
{
  "reply": "Your conversational message to the user",
  "draft": { /* only when proposing a new routine or revision */ }
}

The "draft" field is included ONLY when proposing a complete new routine or a complete revision of an existing routine. A draft always contains the full exercise list (not a diff).

Exercise schema (inside draft.exercises):
- kind: must be one of "strength", "cardio", or "stretch"
- supersetGroup: use the same string on grouped exercises for supersets
- targetSets, targetReps, targetDurationSeconds: integers, in seconds

Guidance:
- Prefer reusing exercise titles that already exist in the user's data — they will map to the same records
- All numeric values must be integers`;
}

function goalsSection(): string {
  const settings = getSettings();
  const goals = settings.aiGoals?.trim();

  if (!goals) {
    return `## User Goals

Not specified.`;
  }

  return `## User Goals

${goals}`;
}

function equipmentSection(): string {
  const settings = getSettings();
  const equipment = settings.aiEquipment?.trim();

  if (!equipment) {
    return `## Available Equipment

Not specified.`;
  }

  return `## Available Equipment

${equipment}`;
}

async function routinesSection(db: Database): Promise<string> {
  const routines = await routineListPresenter(db);

  if (routines.length === 0) {
    return `## Existing Routines

No routines yet.`;
  }

  const routineLines: string[] = [];

  for (const routine of routines) {
    // Add routine heading with name and id
    routineLines.push(`### ${routine.name} (id: ${routine.id})`);

    // Get detailed routine info
    const detail = await routineDetailPresenter(db, routine.id);

    if (!detail) {
      continue;
    }

    // Add superset groups
    for (const group of detail.supersetGroups) {
      for (const exercise of group.exercises) {
        routineLines.push(formatExerciseLine(exercise, group.label));
      }
    }

    // Add standalone exercises
    for (const exercise of detail.standaloneExercises) {
      routineLines.push(formatExerciseLine(exercise, null));
    }
  }

  return `## Existing Routines\n\n${routineLines.join('\n')}`;
}

function formatExerciseLine(
  exercise: any,
  supersetLabel: string | null
): string {
  const parts: string[] = [];

  // Title and kind
  parts.push(`${exercise.title} (${exercise.kind})`);

  // Warmup sets if present
  if (exercise.warmupSets) {
    parts.push(`warmup: ${exercise.warmupSets}`);
  }

  // Target sets and reps OR duration
  if (exercise.targetSets && exercise.targetReps) {
    parts.push(`${exercise.targetSets}x${exercise.targetReps}`);
  } else if (exercise.targetDurationSeconds) {
    parts.push(`${exercise.targetDurationSeconds}s`);
  }

  // Rest seconds if present
  if (exercise.restSeconds) {
    parts.push(`rest ${exercise.restSeconds}s`);
  }

  // Superset label if present
  if (supersetLabel) {
    parts.push(`[${supersetLabel}]`);
  }

  return `  - ${parts.join(' | ')}`;
}

async function historySection(db: Database): Promise<string> {
  // Collect all distinct exerciseIds from routines
  const routines = await routineListPresenter(db);
  const exerciseIdSet = new Set<string>();
  const exerciseTitleMap = new Map<string, string>();

  for (const routine of routines) {
    const detail = await routineDetailPresenter(db, routine.id);
    if (!detail) {
      continue;
    }

    // Collect from superset groups
    for (const group of detail.supersetGroups) {
      for (const exercise of group.exercises) {
        exerciseIdSet.add(exercise.exerciseId);
        exerciseTitleMap.set(exercise.exerciseId, exercise.title);
      }
    }

    // Collect from standalone exercises
    for (const exercise of detail.standaloneExercises) {
      exerciseIdSet.add(exercise.exerciseId);
      exerciseTitleMap.set(exercise.exerciseId, exercise.title);
    }
  }

  if (exerciseIdSet.size === 0) {
    return `## Recent Training History

No workout history yet.`;
  }

  const historyLines: string[] = [];

  for (const exerciseId of exerciseIdSet) {
    const sets = await getExerciseWorkingSetHistory(db, exerciseId);

    if (sets.length === 0) {
      continue;
    }

    // Take the 5 most recent sets (they're already sorted most-recent-first)
    const recentSets = sets.slice(0, HISTORY_SETS_PER_EXERCISE);

    // Format set details
    const setDescriptions = recentSets.map((set: any) => {
      const parts: string[] = [];

      if (set.reps !== undefined && set.reps !== null) {
        parts.push(`${set.reps} reps`);
      }

      if (set.weightKg !== undefined && set.weightKg !== null) {
        parts.push(`@ ${set.weightKg}kg`);
      }

      if (set.durationSeconds !== undefined && set.durationSeconds !== null) {
        parts.push(`${set.durationSeconds}s`);
      }

      if (set.rpe !== undefined && set.rpe !== null) {
        parts.push(`RPE ${set.rpe}`);
      }

      return parts.join(' ');
    });

    const exerciseTitle = exerciseTitleMap.get(exerciseId) || exerciseId;
    historyLines.push(`  ${exerciseTitle}: ${setDescriptions.join(', ')}`);
  }

  if (historyLines.length === 0) {
    return `## Recent Training History

No workout history yet.`;
  }

  return `## Recent Training History\n\n${historyLines.join('\n')}`;
}

async function editModeSection(db: Database, routineId: string): Promise<string | null> {
  const detail = await routineDetailPresenter(db, routineId);

  if (!detail) {
    // Routine not found; don't add edit-mode section
    return null;
  }

  return `## Edit Mode

The user is editing the routine "${detail.name}" (routineId: ${detail.id}). Return any draft as a complete revision of this routine, and set the draft's routineId field to exactly "${detail.id}".`;
}
