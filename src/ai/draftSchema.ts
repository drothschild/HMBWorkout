import { ExerciseKind } from '@/db/models/Exercise';
import type { RoutineSetType } from '@/engine/types';

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
  age?: string;
  experience?: string;
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

/**
 * One PRESCRIBED set inside a draft (#276 Phase 4).
 *
 * `type` is the plan's vocabulary — `'warmup' | 'normal'`, matching
 * `routine_sets.set_type` — not the session's logged one (`working`, `stretch`,
 * `cardio`). Every other field is optional, and absent means "not prescribed":
 * a set carrying nothing but its type is a complete instruction ("do one
 * working set"), and one carrying only a load is equally valid.
 *
 * `weightLbs` is in **pounds** — the unit the model reads history in
 * (contextBuilder's formatWeightLbs) and the only unit it ever sees.
 * `acceptDraft` converts to canonical kg exactly once, per set, on the way to
 * the database; nothing below that line sees pounds.
 */
export interface DraftSet {
  type: RoutineSetType;
  /** Exact prescription, or the BOTTOM of a range when `repsMax` is present. */
  reps?: number;
  /** The top of a rep range. Meaningless without `reps`, and rejected without it. */
  repsMax?: number;
  weightLbs?: number;
  durationSeconds?: number;
}

export interface DraftExercise {
  title: string; // free-form; may name a brand-new exercise
  kind: ExerciseKind;
  supersetGroup?: string;
  restSeconds?: number;
  /**
   * The exercise's whole prescription, in the order the sets are performed.
   *
   * Required and non-empty. The schema can declare the shape but NOT the
   * count — `minItems` is on `UNSUPPORTED_SCHEMA_KEYWORDS` and 400s the entire
   * request before the model runs — so `validateRoutineDraft` is the only
   * enforcing layer for the non-empty rule. An empty list would reach the
   * engine as an entry `h.next_active_landing` can never land on.
   *
   * This replaced `warmupSets`/`targetSets`/`targetReps`/
   * `targetDurationSeconds`/`targetWeightLbs`. Those cannot come back
   * alongside it: two ways to say the same thing is how the list and the
   * aggregates drift, and `upsertRoutine` now DERIVES all five columns from
   * this list.
   */
  sets: DraftSet[];
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

/**
 * The plan's set vocabulary, as a record so the schema enum and the validator
 * are derived from one source. `working` is the SESSION's word and must not
 * appear here (`session_sets.set_type` is a different, unchanged vocabulary).
 */
const SET_TYPE_SET: Record<RoutineSetType, true> = {
  warmup: true,
  normal: true,
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
              restSeconds: { type: 'integer' },
              // The exercise's whole prescription (#276 Phase 4). NOTE the
              // absence of `minItems: 1` — it is the obvious way to express
              // "at least one set" and it is exactly what must not be here:
              // `minItems` is on UNSUPPORTED_SCHEMA_KEYWORDS and 400s the
              // entire request before the model runs (PR #71). The count is
              // enforced in validateRoutineDraft, which is its only layer.
              sets: {
                type: 'array',
                description: 'One entry per set to perform, in order',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: Object.keys(SET_TYPE_SET) },
                    reps: { type: 'integer' },
                    repsMax: { type: 'integer' },
                    // `number`, not `integer`: the bound is a 0.5lb grid,
                    // matching kgToLbs's rounding. And NO bound keywords here —
                    // `minimum` and `multipleOf` are both on
                    // UNSUPPORTED_SCHEMA_KEYWORDS, and one of them 400s the
                    // entire request (see structuredOutputSubset.ts; it cost
                    // PR #71 a whole feature). The bound lives in
                    // validateRoutineDraft.
                    weightLbs: { type: 'number' },
                    durationSeconds: { type: 'integer' },
                  },
                  required: ['type'],
                  additionalProperties: false,
                },
              },
              notes: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['title', 'kind', 'sets'],
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
        'Include only when the user asked to change their training goals, available equipment, coaching style, or profile information. At least one field is required',
      properties: {
        goals: { type: 'string' },
        equipment: { type: 'string' },
        personality: { type: 'string' },
        age: { type: 'string' },
        experience: { type: 'string' },
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

    const validateHalfStepWeight = (field: string, value: unknown) => {
      if (value === undefined) return;
      // The 0.5lb grid is kgToLbs's own rounding step (weightUnits.ts), so it is
      // exactly the set of values that can round-trip to the input and back.
      // Zero is rejected rather than stored: computeSetPrefill treats a
      // non-positive weight as absent, so a stored 0 is a value nothing honours.
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (value * 2) % 1 !== 0) {
        throw new DraftValidationError(
          `${field} must be a positive number in 0.5 steps, got "${value}"`
        );
      }
    };

    validateInteger('restSeconds', exercise.restSeconds, 0);

    // The set list, and the one rule the schema cannot carry.
    //
    // `minItems` would express the non-empty half declaratively and would 400
    // the whole request (PR #71), so this is the ONLY enforcing layer for it.
    // Without it a drafted empty exercise reaches the engine as an entry
    // `h.next_active_landing` refuses to land on, and the whole of convention
    // 10 ends up doing work this line should have done.
    if (!Array.isArray(exercise.sets)) {
      throw new DraftValidationError(
        `exercise "${exercise.title}" must carry a "sets" array, one entry per set`
      );
    }

    if (exercise.sets.length === 0) {
      throw new DraftValidationError(
        `exercise "${exercise.title}" must prescribe at least one set`
      );
    }

    for (const rawSet of exercise.sets) {
      if (!rawSet || typeof rawSet !== 'object' || Array.isArray(rawSet)) {
        throw new DraftValidationError('each set must be an object');
      }

      const set = rawSet as Record<string, unknown>;

      if (!Object.keys(SET_TYPE_SET).includes(set.type as string)) {
        throw new DraftValidationError(
          `set type must be one of: ${Object.keys(SET_TYPE_SET).join(', ')}, got "${set.type}"`
        );
      }

      validateInteger('set reps', set.reps, 1);
      validateInteger('set repsMax', set.repsMax, 1);
      validateInteger('set durationSeconds', set.durationSeconds, 0);
      validateHalfStepWeight('set weightLbs', set.weightLbs);

      if (set.repsMax !== undefined) {
        // A range's top with no bottom is not a range, and no read site can
        // render it: every reps formatter consults repsMax only once reps is
        // present, so a bare repsMax would be silently discarded rather than
        // honoured.
        if (set.reps === undefined) {
          throw new DraftValidationError('set repsMax requires reps, which is the range\'s bottom');
        }

        if ((set.repsMax as number) < (set.reps as number)) {
          throw new DraftValidationError(
            `set repsMax must be >= reps, got ${set.repsMax} < ${set.reps}`
          );
        }
      }
    }
  }

  return obj as unknown as RoutineDraft;
}

/**
 * The field list the validator and `isEmptyProposal` both walk.
 *
 * `satisfies` is load-bearing, not decoration: without it this is a bare string
 * tuple with no compile-time link to `SettingsProposal`, and a field can be
 * deleted from the interface with tsc clean and the whole suite green. That is
 * the same drift hazard `isEmptyProposal` used to carry, one layer up.
 *
 * Note what this does and does not pin. It catches a name here that is not on
 * the interface, and a field renamed on the interface. It cannot catch a field
 * ADDED to the interface but not listed here, nor one added to
 * AI_TURN_SCHEMA.settingsProposal but not to either — those two directions
 * remain hand-maintained.
 */
const SETTINGS_PROPOSAL_FIELDS = [
  'goals',
  'equipment',
  'personality',
  'age',
  'experience',
] as const satisfies readonly (keyof SettingsProposal)[];

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

  for (const field of SETTINGS_PROPOSAL_FIELDS) {
    validateField(field, obj[field]);
  }

  // An all-undefined proposal is an error: every proposal must have at least one field.
  // The shell's job is to drop empty proposals before calling this validator (in parseAiTurn).
  if (isEmptyProposal(obj as SettingsProposal)) {
    throw new DraftValidationError('settings proposal must have at least one field');
  }

  return obj as unknown as SettingsProposal;
}

/**
 * Check whether a settings proposal has no defined fields.
 * An empty proposal is semantically equivalent to no proposal.
 */
function isEmptyProposal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  // Derived from the same constant the validator loops over, deliberately.
  // Enumerating the fields by hand here is a silent-data-loss hazard: a field
  // added to SETTINGS_PROPOSAL_FIELDS but missed in this function makes a
  // proposal carrying ONLY that field read as empty, so parseAiTurn drops it
  // and the model's answer is discarded with no error raised anywhere.
  return SETTINGS_PROPOSAL_FIELDS.every((field) => obj[field] === undefined);
}

/**
 * Normalize null values to undefined at the parse boundary.
 *
 * OpenAI's strict mode forces optional fields into the schema as "type: [..., "null"]"
 * to express optionality, since it cannot express truly optional properties.
 * This normaliser converts those nulls to undefined so downstream validators only
 * need to handle one representation of absence.
 *
 * INVARIANT: No field in `AI_TURN_SCHEMA` carries `null` as a distinct value
 * separate from absence. A field that ever does must not go through this
 * normaliser — it would lose the distinction.
 *
 * @returns a deep copy with all null values replaced by undefined. Arrays preserve
 * their length (nulls become undefined, not sparse slots).
 */
function normalizeNullsToUndefined(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    // Arrays preserve holes (null becomes undefined but length is unchanged)
    return value.map(normalizeNullsToUndefined);
  }
  // Plain object: recursively normalize each property.
  // Use Object.defineProperty to reproduce JSON.parse's own-data-property semantics,
  // preventing `__proto__` from hitting the prototype setter and bypassing validation.
  const normalized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    Object.defineProperty(normalized, key, {
      value: normalizeNullsToUndefined(val),
      writable: true,
      enumerable: true,
      configurable: true,
    });
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

  // Drop empty proposals (all fields undefined) before validation.
  // An empty proposal is semantically equivalent to no proposal: the reply is preserved,
  // and we avoid losing a coaching turn to a null-filled structure from the model.
  const settingsProposal =
    obj.settingsProposal === undefined
      ? undefined
      : isEmptyProposal(obj.settingsProposal)
        ? undefined
        : validateSettingsProposal(obj.settingsProposal);

  return {
    reply: obj.reply,
    draft,
    settingsProposal,
  };
}
