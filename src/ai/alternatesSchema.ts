/**
 * Exercise alternates: the payload shape for "give me something else to do
 * instead of this".
 *
 * Its own schema/validator pair rather than a case of the conversational turn:
 * this call answers a single question with a fixed shape, and folding it into
 * `AI_TURN_SCHEMA` would loosen that schema for every other caller.
 *
 * Same three-declaration hazard as the turn contract, though — the shape is
 * stated here in `ALTERNATES_SCHEMA` (what the API enforces), in the validators
 * below (what the app enforces), and in `alternatesPrompt.ts` (what the model
 * reads). Changing the payload means changing all three.
 */

import { DraftValidationError, slugifyTitle } from './draftSchema';

/**
 * A substitute movement. Identity and prose only: the entry's targets, warmups
 * and rest belong to the plan, not to the exercise, and survive a swap
 * untouched — so there is deliberately nowhere here to put them.
 */
export interface ExerciseAlternate {
  title: string;
  /**
   * How to perform it. This is the whole basis for the athlete's choice — the
   * picker shows three titles they may not recognize — so it is required, not
   * optional as it is on `DraftExercise`.
   */
  description: string;
}

export interface ExerciseAlternates {
  alternates: ExerciseAlternate[];
}

/**
 * Upper bound on the list. The picker is a choice made mid-workout between
 * sets; past a handful it stops being a choice and starts being a menu.
 */
export const EXERCISE_ALTERNATES_MAX = 5;

/**
 * Cap on a title. Exercise identity is `slugifyTitle(title)`, so a runaway
 * title becomes a runaway row id that every future routine inherits.
 */
export const ALTERNATE_TITLE_MAX_LENGTH = 80;

/**
 * Cap on a description. It renders in a choice list on a phone, and it is
 * persisted on the exercise when the accept path creates one.
 */
export const ALTERNATE_DESCRIPTION_MAX_LENGTH = 600;

export const ALTERNATES_SCHEMA = {
  type: 'object',
  properties: {
    // No `minItems`/`maxItems` here, and none of the other count/length/range
    // keywords either: the structured-output endpoint compiles this schema and
    // rejects the entire request with a 400 when it carries a keyword outside
    // the supported subset. The official SDKs strip those and re-check them
    // client-side; this feature's client is a hand-rolled fetch by design, so
    // nothing strips them for us — an unsupported keyword here is a Replace
    // button that fails on every tap. `validateExerciseAlternates` enforces the
    // 1..EXERCISE_ALTERNATES_MAX bounds instead, which is where the SDKs put
    // them anyway; the description and the prompt do the steering.
    alternates: {
      type: 'array',
      description: 'Substitute exercises, best first',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The exercise name on its own, with no set or rep counts' },
          description: {
            type: 'string',
            description: 'How to perform it, and why it substitutes for the original',
          },
        },
        required: ['title', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['alternates'],
  additionalProperties: false,
} as const;

/**
 * Validate one alternate. Called on receipt as part of the whole payload, and
 * again on the single chosen alternate at swap time — structured output is not
 * a guarantee, and the second call is what stands between the model and a
 * write.
 */
export function validateExerciseAlternate(value: unknown): ExerciseAlternate {
  if (!value || typeof value !== 'object') {
    throw new DraftValidationError('each alternate must be an object');
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    throw new DraftValidationError('alternate title is required and must be non-empty');
  }

  if (obj.title.length > ALTERNATE_TITLE_MAX_LENGTH) {
    throw new DraftValidationError(
      `alternate title must be at most ${ALTERNATE_TITLE_MAX_LENGTH} characters, got ${obj.title.length}`
    );
  }

  if (!slugifyTitle(obj.title)) {
    throw new DraftValidationError(
      `alternate title "${obj.title}" does not contain valid characters`
    );
  }

  if (typeof obj.description !== 'string' || !obj.description.trim()) {
    throw new DraftValidationError('alternate description is required and must be non-empty');
  }

  if (obj.description.length > ALTERNATE_DESCRIPTION_MAX_LENGTH) {
    throw new DraftValidationError(
      `alternate description must be at most ${ALTERNATE_DESCRIPTION_MAX_LENGTH} characters, got ${obj.description.length}`
    );
  }

  return { title: obj.title, description: obj.description };
}

export function validateExerciseAlternates(value: unknown): ExerciseAlternates {
  if (!value || typeof value !== 'object') {
    throw new DraftValidationError('alternates response must be an object');
  }

  const obj = value as Record<string, unknown>;

  if (!Array.isArray(obj.alternates) || obj.alternates.length === 0) {
    throw new DraftValidationError('at least one alternate is required');
  }

  if (obj.alternates.length > EXERCISE_ALTERNATES_MAX) {
    throw new DraftValidationError(
      `at most ${EXERCISE_ALTERNATES_MAX} alternates are allowed, got ${obj.alternates.length}`
    );
  }

  const alternates = obj.alternates.map(validateExerciseAlternate);

  // Titles are the choice. The athlete picks by title and nothing else, the
  // picker keys its list by title, and exercise identity is
  // slugifyTitle(title) — so two alternates sharing one are not two options.
  // Compared case- and whitespace-insensitively, because "Push Up" and
  // "push up" read as one option and resolve to one exercise id.
  const seen = new Set<string>();
  for (const alternate of alternates) {
    const key = alternate.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) {
      throw new DraftValidationError(
        `alternates must be distinct; "${alternate.title}" appears more than once`
      );
    }
    seen.add(key);
  }

  return { alternates };
}

export function parseExerciseAlternates(text: string): ExerciseAlternates {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new DraftValidationError(
      `failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return validateExerciseAlternates(parsed);
}
