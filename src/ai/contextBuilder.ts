import { Database } from '@nozbe/watermelondb';
import { getSettings } from '@/state/settings';
import { routineListPresenter, type RoutineListItem } from '@/state/routineListPresenter';
import { routineDetailPresenter, type RoutineDetail, ExerciseDetail } from '@/state/routineDetailPresenter';
import SessionSet from '@/db/models/SessionSet';
import {
  getExerciseWorkingSetHistory,
  getSessionExerciseLog,
  type SessionExerciseLogEntry,
} from '@/db/repository';
import { SETTINGS_FIELD_MAX_LENGTH } from './draftSchema';

/**
 * A conversation about the workout the user just finished. It carries the
 * session to summarise and, like edit mode, owns the routine any accepted
 * draft revises.
 */
export type DebriefMode = { kind: 'debrief'; routineId: string; sessionId: string };

export type AiCoachMode = { kind: 'create' } | { kind: 'edit'; routineId: string } | DebriefMode;

type RoutineWithDetail = { routine: RoutineListItem; detail: RoutineDetail | null };

export const HISTORY_SETS_PER_EXERCISE = 5;

/**
 * Build the system prompt for Claude by composing user context:
 * - Coach persona and JSON response schema
 * - User goals and available equipment
 * - All existing routines and exercises
 * - Recent working set history (capped at 5 per exercise)
 * - Edit-mode instructions (if editing a specific routine)
 * - The just-finished session (if debriefing one)
 *
 * @param db WatermelonDB database instance
 * @param mode the conversation: 'create', 'edit' or 'debrief'
 * @returns System prompt string for Claude API
 */
export async function buildSystem(db: Database, mode: AiCoachMode): Promise<string> {
  const sections: string[] = [];

  sections.push(personaSection(mode));
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

  if (mode.kind === 'debrief') {
    sections.push(await debriefSection(db, mode));
  }

  return sections.join('\n\n');
}

function personaSection(mode: AiCoachMode): string {
  const persona = `You are a strength-training coach inside a workout-logging app.

Every response must be valid JSON with this structure:
{
  "reply": "Your conversational message to the user",
  "draft": { /* only when proposing a new routine or revision */ },
  "settingsProposal": { /* only when proposing new goals or equipment */ }
}

The "draft" field is included ONLY when proposing a complete new routine or a complete revision of an existing routine. A draft always contains the full exercise list (not a diff).

Draft constraints:
- A draft must have a non-empty name
- A draft must contain at least one exercise (exercises array must not be empty)

Exercise schema (inside draft.exercises):
- title: must contain at least one ASCII letter or digit (a-z, 0-9)
- kind: must be one of "strength", "cardio", or "stretch"
- supersetGroup: use the same string on grouped exercises for supersets
- targetSets, targetReps: when present, must be integers >= 1
- warmupSets, targetDurationSeconds, restSeconds: when present, must be integers >= 0

The "settingsProposal" field proposes new values for the "User Goals" and "Available Equipment" sections below. Never include a settingsProposal unless the user asked to change their goals or equipment — a workout question is not such a request. The user must approve a settings proposal before it takes effect, so quote the wording you are proposing in your reply and ask for confirmation rather than describing the change as already made.

Settings proposal constraints:
- A settings proposal must include at least one of "goals" or "equipment"
- goals, equipment: when present, must be non-empty strings of at most ${SETTINGS_FIELD_MAX_LENGTH} characters
- Each field is a full replacement for the user's current value, not an addition to it, so carry over any part of the current wording that should survive the change
- Omit the field you are not changing rather than repeating its current value

Guidance:
- Prefer reusing exercise titles that already exist in the user's data — they will map to the same records
- All numeric values must be integers`;

  if (mode.kind !== 'debrief') {
    return persona;
  }

  return `${persona}

Debrief mode:
- The user has just finished the workout summarised under "Just-Finished Workout" below
- Open the conversation by asking how the workout went before proposing any changes
- Any draft you propose is a complete revision of the routine the user just performed, for next time`;
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

/**
 * Render whatever a logged set actually recorded. A set can be logged with
 * every metric blank, in which case this is the empty string and the caller
 * decides what to say instead of printing a dangling separator.
 */
function formatSetMetrics(set: SessionSet): string {
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
    const setDescriptions = recentSets.map(formatSetMetrics);

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

/**
 * The workout the debrief is about: what the routine asked for, and what the
 * user actually logged for it. Unlike the history section this is scoped to a
 * single session and keeps warmups, because how the whole workout went is the
 * subject of the conversation.
 */
async function debriefSection(db: Database, mode: DebriefMode): Promise<string> {
  const detail = await routineDetailPresenter(db, mode.routineId);
  const routineName = detail?.name ?? mode.routineId;
  const log = await getSessionExerciseLog(db, mode.sessionId, mode.routineId);

  const header = `## Just-Finished Workout

The user has just finished the routine "${routineName}". These are the sets they logged.`;

  if (log.length === 0) {
    return `${header}

No exercises are on this routine.`;
  }

  const lines = log.map(
    (entry) => `  ${entry.title}${formatTarget(entry)}: ${describeLoggedSets(entry.sets)}`
  );

  return `${header}\n\n${lines.join('\n')}`;
}

function formatTarget(entry: SessionExerciseLogEntry): string {
  if (entry.targetSets && entry.targetReps) {
    return ` (target ${entry.targetSets}x${entry.targetReps})`;
  }

  if (entry.targetDurationSeconds) {
    return ` (target ${entry.targetDurationSeconds}s)`;
  }

  return '';
}

function describeLoggedSets(sets: SessionSet[]): string {
  const descriptions = sets
    .map((set) => {
      const metrics = formatSetMetrics(set);
      if (metrics === '') {
        return '';
      }

      // Warmups and drop sets are worth distinguishing: three working sets and
      // three warmups are very different answers to "how did it go".
      return set.setType === 'working' ? metrics : `${metrics} (${set.setType})`;
    })
    .filter((description) => description.length > 0);

  if (descriptions.length > 0) {
    return descriptions.join(', ');
  }

  // Every metric can be left blank, so sets can exist with nothing to show.
  return sets.length > 0
    ? `${sets.length} sets logged with no numbers recorded`
    : 'no sets logged';
}

async function editModeSection(db: Database, routineId: string): Promise<string | null> {
  const detail = await routineDetailPresenter(db, routineId);

  if (!detail) {
    // Routine not found; don't add edit-mode section
    return null;
  }

  return `## Edit Mode

The user is editing the routine "${detail.name}". Return any draft as a complete revision of this routine.`;
}
