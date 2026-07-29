import { ExerciseKind } from '@/db/models/Exercise';

export interface AiTurn {
  reply: string;
  draft?: RoutineDraft;
}

export interface RoutineDraft {
  routineId?: string; // present only when editing an existing routine
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
        routineId: { type: 'string', description: 'Only when revising an existing routine: its exact id' },
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
            },
            required: ['title', 'kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'exercises'],
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

  if (obj.routineId !== undefined && (typeof obj.routineId !== 'string' || !obj.routineId.trim())) {
    throw new DraftValidationError('routineId, when present, must be a non-empty string');
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

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.reply !== 'string') {
    throw new DraftValidationError('reply field is required and must be a string');
  }

  const draft = obj.draft === undefined ? undefined : validateRoutineDraft(obj.draft);

  return {
    reply: obj.reply,
    draft,
  };
}
