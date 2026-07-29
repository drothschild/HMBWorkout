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
              kind: { type: 'string', enum: ['strength', 'cardio', 'stretch'] },
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
  // Check if value is an object
  if (!value || typeof value !== 'object') {
    throw new DraftValidationError('draft must be an object');
  }

  const obj = value as Record<string, unknown>;

  // Check name exists and is non-empty
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new DraftValidationError('routine name is required and must be non-empty');
  }

  // Check exercises exists and is non-empty array
  if (!Array.isArray(obj.exercises) || obj.exercises.length === 0) {
    throw new DraftValidationError('at least one exercise is required');
  }

  // Validate each exercise
  for (const ex of obj.exercises) {
    if (!ex || typeof ex !== 'object') {
      throw new DraftValidationError('each exercise must be an object');
    }

    const exercise = ex as Record<string, unknown>;

    // Check title
    if (typeof exercise.title !== 'string' || !exercise.title.trim()) {
      throw new DraftValidationError('exercise title is required and must be non-empty');
    }

    // Check slug is non-empty
    if (!slugifyTitle(exercise.title)) {
      throw new DraftValidationError(`exercise title "${exercise.title}" does not contain valid characters`);
    }

    // Check kind is valid
    const validKinds = ['strength', 'cardio', 'stretch'];
    if (!validKinds.includes(exercise.kind as string)) {
      throw new DraftValidationError(
        `exercise kind must be one of: ${validKinds.join(', ')}, got "${exercise.kind}"`
      );
    }

    // Check numeric fields if present
    if (exercise.targetSets !== undefined && (typeof exercise.targetSets !== 'number' || !isFinite(exercise.targetSets))) {
      throw new DraftValidationError('targetSets must be a finite number');
    }

    if (exercise.targetReps !== undefined && (typeof exercise.targetReps !== 'number' || !isFinite(exercise.targetReps))) {
      throw new DraftValidationError('targetReps must be a finite number');
    }

    if (
      exercise.targetDurationSeconds !== undefined &&
      (typeof exercise.targetDurationSeconds !== 'number' || !isFinite(exercise.targetDurationSeconds))
    ) {
      throw new DraftValidationError('targetDurationSeconds must be a finite number');
    }

    if (exercise.restSeconds !== undefined && (typeof exercise.restSeconds !== 'number' || !isFinite(exercise.restSeconds))) {
      throw new DraftValidationError('restSeconds must be a finite number');
    }

    if (exercise.warmupSets !== undefined && (typeof exercise.warmupSets !== 'number' || !isFinite(exercise.warmupSets))) {
      throw new DraftValidationError('warmupSets must be a finite number');
    }
  }

  // If all validations pass, return typed
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

  // Check reply exists and is string
  if (typeof obj.reply !== 'string') {
    throw new DraftValidationError('reply field is required and must be a string');
  }

  // If draft is present, validate it
  if (obj.draft !== undefined) {
    validateRoutineDraft(obj.draft);
  }

  // Return typed
  return {
    reply: obj.reply,
    draft: obj.draft as RoutineDraft | undefined,
  };
}
