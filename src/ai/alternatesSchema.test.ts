import {
  ALTERNATES_SCHEMA,
  ALTERNATE_DESCRIPTION_MAX_LENGTH,
  ALTERNATE_TITLE_MAX_LENGTH,
  EXERCISE_ALTERNATES_MAX,
  parseExerciseAlternates,
  validateExerciseAlternate,
  validateExerciseAlternates,
} from './alternatesSchema';
import { DraftValidationError, slugifyTitle } from './draftSchema';

const ALTERNATE = {
  title: 'Dumbbell Floor Press',
  description:
    'Lie on the floor with a dumbbell in each hand, elbows at 45 degrees. Press to lockout, then lower until the triceps touch the floor.',
};

function payload(overrides?: Record<string, unknown>) {
  return { alternates: [ALTERNATE, ALTERNATE, ALTERNATE], ...overrides };
}

describe('validateExerciseAlternate', () => {
  it('accepts a well-formed alternate', () => {
    expect(validateExerciseAlternate(ALTERNATE)).toEqual(ALTERNATE);
  });

  it('rejects a non-object', () => {
    expect(() => validateExerciseAlternate('Dumbbell Floor Press')).toThrow(DraftValidationError);
    expect(() => validateExerciseAlternate(null)).toThrow(DraftValidationError);
  });

  it('rejects a missing or empty title', () => {
    expect(() => validateExerciseAlternate({ description: 'x' })).toThrow(/title/);
    expect(() => validateExerciseAlternate({ ...ALTERNATE, title: '   ' })).toThrow(/title/);
  });

  it('rejects a title that slugifies to nothing — the id is slugifyTitle(title)', () => {
    expect(slugifyTitle('???')).toBe('');
    expect(() => validateExerciseAlternate({ ...ALTERNATE, title: '???' })).toThrow(
      /valid characters/
    );
  });

  it('rejects an over-long title', () => {
    const title = 'a'.repeat(ALTERNATE_TITLE_MAX_LENGTH + 1);
    expect(() => validateExerciseAlternate({ ...ALTERNATE, title })).toThrow(
      new RegExp(`at most ${ALTERNATE_TITLE_MAX_LENGTH}`)
    );
  });

  it('rejects a missing or empty description — the picker is a choice between descriptions', () => {
    expect(() => validateExerciseAlternate({ title: 'Push Up' })).toThrow(/description/);
    expect(() => validateExerciseAlternate({ ...ALTERNATE, description: '  ' })).toThrow(
      /description/
    );
  });

  it('rejects an over-long description', () => {
    const description = 'a'.repeat(ALTERNATE_DESCRIPTION_MAX_LENGTH + 1);
    expect(() => validateExerciseAlternate({ ...ALTERNATE, description })).toThrow(
      new RegExp(`at most ${ALTERNATE_DESCRIPTION_MAX_LENGTH}`)
    );
  });
});

describe('validateExerciseAlternates', () => {
  it('accepts a list of alternates', () => {
    expect(validateExerciseAlternates(payload()).alternates).toHaveLength(3);
  });

  it('rejects a missing or empty list', () => {
    expect(() => validateExerciseAlternates({})).toThrow(/at least one/);
    expect(() => validateExerciseAlternates({ alternates: [] })).toThrow(/at least one/);
    expect(() => validateExerciseAlternates({ alternates: 'nope' })).toThrow(/at least one/);
  });

  it(`rejects more than ${EXERCISE_ALTERNATES_MAX} alternates — the picker is a short list`, () => {
    const alternates = new Array(EXERCISE_ALTERNATES_MAX + 1).fill(ALTERNATE);
    expect(() => validateExerciseAlternates({ alternates })).toThrow(
      new RegExp(`at most ${EXERCISE_ALTERNATES_MAX}`)
    );
  });

  it('rejects when any one alternate is malformed', () => {
    expect(() =>
      validateExerciseAlternates({ alternates: [ALTERNATE, { title: 'No Description' }] })
    ).toThrow(/description/);
  });
});

describe('parseExerciseAlternates', () => {
  it('parses and validates the model’s JSON text', () => {
    const parsed = parseExerciseAlternates(JSON.stringify(payload()));
    expect(parsed.alternates[0]).toEqual(ALTERNATE);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseExerciseAlternates('here are three ideas:')).toThrow(/failed to parse JSON/);
  });

  it('rejects JSON that is not an object', () => {
    expect(() => parseExerciseAlternates('[1, 2, 3]')).toThrow(DraftValidationError);
  });

  it('rejects a payload that fails the same bounds validateExerciseAlternates enforces', () => {
    expect(() => parseExerciseAlternates(JSON.stringify({ alternates: [] }))).toThrow(
      /at least one/
    );
  });
});

describe('ALTERNATES_SCHEMA', () => {
  it('declares the same shape the validator enforces', () => {
    expect(ALTERNATES_SCHEMA.required).toEqual(['alternates']);
    expect(ALTERNATES_SCHEMA.additionalProperties).toBe(false);

    const item = ALTERNATES_SCHEMA.properties.alternates.items;
    expect(item.required).toEqual(['title', 'description']);
    expect(item.additionalProperties).toBe(false);
    expect(Object.keys(item.properties).sort()).toEqual(['description', 'title']);
  });

  it('bounds the array in the schema as well as in the validator', () => {
    expect(ALTERNATES_SCHEMA.properties.alternates.maxItems).toBe(EXERCISE_ALTERNATES_MAX);
    expect(ALTERNATES_SCHEMA.properties.alternates.minItems).toBe(1);
  });
});
