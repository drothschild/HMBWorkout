import { ExerciseKind } from '@/db/models/Exercise';

export interface AiTurn {
  reply: string;
  draft?: RoutineDraft;
  settingsProposal?: SettingsProposal;
}

/**
 * A proposed change to the user's AI settings. Each field is a full replacement
 * for the current value, never a diff. At least one field must be present.
 * Nothing here is written until the user approves it.
 */
export interface SettingsProposal {
  goals?: string;
  equipment?: string;
  personality?: string;
}

/**
 * Cap on a proposed goals/equipment/personality string. These are free-text
 * fields the user would otherwise type by hand, and they are persisted in the
 * settings blob; the bound keeps a runaway model from dumping a conversation
 * into storage.
 */
export const SETTINGS_FIELD_MAX_LENGTH = 1000;

export interface RoutineDraft {
  name: string;
  notes?: string;
  exercises: DraftExercise[];
}

export interface DraftExercise {
  title: string; // free-form; may name a brand-new exercise
  kind: ExerciseKind;
  supersetGroup?: string;
  warmupSets?: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
  notes?: string;
  description?: string; // applied only when the accept path creates the exercise
}

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(`Invalid AI response: ${message}`);
    this.name = 'DraftValidationError';
  }
}

const KIND_SET: Record<ExerciseKind, true> = {
  strength: true,
  cardio: true,
  stretch: true,
};

export const AI_TURN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Conversational reply shown to the user' },
    draft: {
      type: 'object',
      description: 'Include only when proposing a new routine or a revision of an existing one',
      properties: {
        name: { type: 'string' },
        notes: { type: 'string' },
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              kind: { type: 'string', enum: Object.keys(KIND_SET) },
              supersetGroup: { type: 'string' },
              warmupSets: { type: 'integer' },
              targetSets: { type: 'integer' },
              targetReps: { type: 'integer' },
              targetDurationSeconds: { type: 'integer' },
              restSeconds: { type: 'integer' },
              notes: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['title', 'kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'exercises'],
      additionalProperties: false,
    },
    settingsProposal: {
      type: 'object',
      description:
        'Include only when the user asked to change their training goals, available equipment, or coaching style. At least one field is required',
      properties: {
        goals: { type: 'string' },
        equipment: { type: 'string' },
        personality: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  required: ['reply'],
  additionalProperties: false,
} as const;

export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateRoutineDraft(value: unknown): RoutineDraft {
  if (!value || typeof value !== 'object') {
    throw new DraftValidationError('draft must be an object');
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new DraftValidationError('routine name is required and must be non-empty');
  }

  if (!Array.isArray(obj.exercises) || obj.exercises.length === 0) {
    throw new DraftValidationError('at least one exercise is required');
  }

  if (obj.notes !== undefined && typeof obj.notes !== 'string') {
    throw new DraftValidationError('notes, when present, must be a string');
  }

  for (const ex of obj.exercises) {
    if (!ex || typeof ex !== 'object') {
      throw new DraftValidationError('each exercise must be an object');
    }

    const exercise = ex as Record<string, unknown>;

    if (typeof exercise.title !== 'string' || !exercise.title.trim()) {
      throw new DraftValidationError('exercise title is required and must be non-empty');
    }

    if (!slugifyTitle(exercise.title)) {
      throw new DraftValidationError(`exercise title "${exercise.title}" does not contain valid characters`);
    }

    if (!Object.keys(KIND_SET).includes(exercise.kind as string)) {
      throw new DraftValidationError(
        `exercise kind must be one of: ${Object.keys(KIND_SET).join(', ')}, got "${exercise.kind}"`
      );
    }

    if (exercise.supersetGroup !== undefined && typeof exercise.supersetGroup !== 'string') {
      throw new DraftValidationError('supersetGroup, when present, must be a string');
    }

    if (exercise.notes !== undefined && typeof exercise.notes !== 'string') {
      throw new DraftValidationError('exercise notes, when present, must be a string');
    }

    if (exercise.description !== undefined && typeof exercise.description !== 'string') {
      throw new DraftValidationError('exercise description, when present, must be a string');
    }

    const validateInteger = (field: string, value: unknown, minValue: number = 0) => {
      if (value !== undefined) {
        if (!Number.isInteger(value) || (value as number) < minValue) {
          throw new DraftValidationError(
            `${field} must be an integer >= ${minValue}, got "${value}"`
          );
        }
      }
    };

    validateInteger('warmupSets', exercise.warmupSets, 0);
    validateInteger('targetSets', exercise.targetSets, 1);
    validateInteger('targetReps', exercise.targetReps, 1);
    validateInteger('targetDurationSeconds', exercise.targetDurationSeconds, 0);
    validateInteger('restSeconds', exercise.restSeconds, 0);
  }

  return obj as unknown as RoutineDraft;
}

export function validateSettingsProposal(value: unknown): SettingsProposal {
  if (!value || typeof value !== 'object') {
    throw new DraftValidationError('settings proposal must be an object');
  }

  const obj = value as Record<string, unknown>;

  const validateField = (field: string, fieldValue: unknown) => {
    if (fieldValue === undefined) {
      return;
    }

    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      throw new DraftValidationError(`${field}, when present, must be a non-empty string`);
    }

    if (fieldValue.length > SETTINGS_FIELD_MAX_LENGTH) {
      throw new DraftValidationError(
        `${field} must be at most ${SETTINGS_FIELD_MAX_LENGTH} characters, got ${fieldValue.length}`
      );
    }
  };

  validateField('goals', obj.goals);
  validateField('equipment', obj.equipment);
  validateField('personality', obj.personality);

  if (obj.goals === undefined && obj.equipment === undefined && obj.personality === undefined) {
    throw new DraftValidationError(
      'a settings proposal must include at least one of goals, equipment, or personality'
    );
  }

  return obj as unknown as SettingsProposal;
}

/**
 * Normalize null values to undefined at the parse boundary.
 *
 * OpenAI's strict mode forces optional fields into the schema as "type: [..., "null"]"
 * to express optionality, since it cannot express truly optional properties.
 * This normaliser converts those nulls to undefined so downstream validators only
 * need to handle one representation of absence.
 *
 * Pattern borrowed from syncService.ts, which does the same for WatermelonDB columns.
 *
 * @returns a deep copy with all null values replaced by undefined
 */
function normalizeNullsToUndefined(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeNullsToUndefined);
  }
  // Plain object: recursively normalize each property
  const normalized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    normalized[key] = normalizeNullsToUndefined(val);
  }
  return normalized;
}

export function parseAiTurn(text: string): AiTurn {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new DraftValidationError(`failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new DraftValidationError('response must be a JSON object');
  }

  // Normalize null → undefined at the boundary, before validation
  const normalized = normalizeNullsToUndefined(parsed) as Record<string, unknown>;
  const obj = normalized;

  if (typeof obj.reply !== 'string') {
    throw new DraftValidationError('reply field is required and must be a string');
  }

  const draft = obj.draft === undefined ? undefined : validateRoutineDraft(obj.draft);
  const settingsProposal =
    obj.settingsProposal === undefined ? undefined : validateSettingsProposal(obj.settingsProposal);

  return {
    reply: obj.reply,
    draft,
    settingsProposal,
  };
}
