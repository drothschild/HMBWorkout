import { Database } from '@nozbe/watermelondb';
import { getSettings } from '@/state/settings';
import { routineListPresenter, type RoutineListItem } from '@/state/routineListPresenter';
import { routineDetailPresenter, type RoutineDetail, ExerciseDetail } from '@/state/routineDetailPresenter';
import SessionSet from '@/db/models/SessionSet';
import { getExerciseWorkingSetHistory } from '@/db/repository';

export type AiCoachMode = { kind: 'create' } | { kind: 'edit'; routineId: string };

type RoutineWithDetail = { routine: RoutineListItem; detail: RoutineDetail | null };

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

  sections.push(personaSection());
  sections.push(goalsSection());
  sections.push(equipmentSection());

  // Build routine details once, reuse for both routines and history sections
  const routines = await routineListPresenter(db);
  const routineDetails: RoutineWithDetail[] = [];

  for (const routine of routines) {
    const detail = await routineDetailPresenter(db, routine.id);
    routineDetails.push({ routine, detail });
  }

  sections.push(routinesSection(routineDetails));
  sections.push(await historySection(db, routineDetails));

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

Draft constraints:
- A draft must contain at least one exercise (exercises array must not be empty)
- routineId must be omitted unless you are in Edit Mode (only present when revising an existing routine per the Edit Mode addendum below)

Exercise schema (inside draft.exercises):
- title: must contain at least one letter or digit
- kind: must be one of "strength", "cardio", or "stretch"
- supersetGroup: use the same string on grouped exercises for supersets
- targetSets, targetReps: when present, must be integers >= 1
- warmupSets, targetDurationSeconds, restSeconds: when present, must be integers >= 0

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

function routinesSection(routineDetails: RoutineWithDetail[]): string {
  const routineLines: string[] = [];

  for (const { routine, detail } of routineDetails) {
    if (!detail) {
      continue;
    }

    routineLines.push(`### ${routine.name} (id: ${routine.id})`);

    // Merge and sort all exercises by their order
    const allExercises: Array<{ exercise: ExerciseDetail; supersetLabel: string | null }> = [];

    for (const group of detail.supersetGroups) {
      for (const exercise of group.exercises) {
        allExercises.push({ exercise, supersetLabel: group.label });
      }
    }

    for (const exercise of detail.standaloneExercises) {
      allExercises.push({ exercise, supersetLabel: null });
    }

    // Sort by order to preserve sequence
    allExercises.sort((a, b) => a.exercise.order - b.exercise.order);

    for (const { exercise, supersetLabel } of allExercises) {
      routineLines.push(formatExerciseLine(exercise, supersetLabel));
    }
  }

  if (routineLines.length === 0) {
    return `## Existing Routines

No routines yet.`;
  }

  return `## Existing Routines\n\n${routineLines.join('\n')}`;
}

function formatExerciseLine(
  exercise: ExerciseDetail,
  supersetLabel: string | null
): string {
  const parts: string[] = [];

  parts.push(`${exercise.title} (${exercise.kind})`);

  if (exercise.warmupSets) {
    parts.push(`warmup: ${exercise.warmupSets}`);
  }

  if (exercise.targetSets && exercise.targetReps) {
    parts.push(`${exercise.targetSets}x${exercise.targetReps}`);
  } else if (exercise.targetDurationSeconds) {
    parts.push(`${exercise.targetDurationSeconds}s`);
  }

  if (exercise.restSeconds) {
    parts.push(`rest ${exercise.restSeconds}s`);
  }

  if (supersetLabel) {
    parts.push(`[${supersetLabel}]`);
  }

  return `  - ${parts.join(' | ')}`;
}

async function historySection(db: Database, routineDetails: RoutineWithDetail[]): Promise<string> {
  // Collect all distinct exerciseIds and titles from pre-built routine details
  const exerciseTitleMap = new Map<string, string>();

  for (const { detail } of routineDetails) {
    if (!detail) {
      continue;
    }

    for (const group of detail.supersetGroups) {
      for (const exercise of group.exercises) {
        exerciseTitleMap.set(exercise.exerciseId, exercise.title);
      }
    }

    for (const exercise of detail.standaloneExercises) {
      exerciseTitleMap.set(exercise.exerciseId, exercise.title);
    }
  }

  const historyLines: string[] = [];

  for (const [exerciseId, exerciseTitle] of exerciseTitleMap) {
    const sets = await getExerciseWorkingSetHistory(db, exerciseId);

    if (sets.length === 0) {
      continue;
    }

    // Take the 5 most recent sets (they're already sorted most-recent-first)
    const recentSets = sets.slice(0, HISTORY_SETS_PER_EXERCISE);

    // Format set details
    const setDescriptions = recentSets.map((set: SessionSet) => {
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

      if (set.distanceM !== undefined && set.distanceM !== null) {
        parts.push(`${set.distanceM}m`);
      }

      if (set.rpe !== undefined && set.rpe !== null) {
        parts.push(`RPE ${set.rpe}`);
      }

      return parts.join(' ');
    });

    // A set can be logged with every metric left blank; drop the empty
    // descriptions so the line doesn't render dangling commas
    const nonEmptyDescriptions = setDescriptions.filter(
      (description) => description.length > 0
    );

    if (nonEmptyDescriptions.length === 0) {
      continue;
    }

    historyLines.push(`  ${exerciseTitle}: ${nonEmptyDescriptions.join(', ')}`);
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
