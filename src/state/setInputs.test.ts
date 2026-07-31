import { parseSetInputText, formatSetInputValue, buildLogSetValues } from './setInputs';

/**
 * Pins the live-reproduced NaN bug in the session set inputs.
 *
 * The old wiring parsed every keystroke (`parseInt(text, 10)`) into numeric
 * state and rendered `state.toString()` back into the controlled TextInput.
 * A hardware keyboard bypasses decimal-pad, so a select-all-then-type
 * sequence could deliver a non-numeric string, parse to NaN, and render the
 * literal "NaN" — and because Object.is(NaN, NaN) is true, every subsequent
 * re-parse to NaN was a no-op state update that never re-rendered, trapping
 * the field. The fix keeps raw text in component state and converts to
 * numbers only at the dispatch boundary, through these helpers.
 */
describe('parseSetInputText', () => {
  test('non-numeric intermediate strings parse to undefined, never NaN', () => {
    // The select-all-then-type artifacts observed live: a leaked chord
    // letter replacing the selection, and a bare decimal point.
    for (const text of ['a', '.', '-', 'x8', 'reps']) {
      const parsed = parseSetInputText(text);
      expect(parsed).toBeUndefined();
    }
  });

  test('the literal "NaN" and append-after-NaN strings parse to undefined', () => {
    // Once the field rendered "NaN", the controlled snap-back killed the
    // selection so typing/paste appended: "NaN5", "NaN12". These must not
    // round-trip back into a NaN state.
    expect(parseSetInputText('NaN')).toBeUndefined();
    expect(parseSetInputText('NaN5')).toBeUndefined();
    expect(parseSetInputText('NaN12')).toBeUndefined();
  });

  test('empty input is absent, not 0', () => {
    // Old behavior coerced "" to 0 and rendered "0" against the user's
    // intent (the cmd+a + delete escape hatch showed "0").
    expect(parseSetInputText('')).toBeUndefined();
    expect(parseSetInputText('   ')).toBeUndefined();
  });

  test('plain numeric entry parses', () => {
    expect(parseSetInputText('12')).toBe(12);
    expect(parseSetInputText('12.5')).toBe(12.5);
    expect(parseSetInputText('0')).toBe(0);
    expect(parseSetInputText(' 8 ')).toBe(8);
  });

  test('a trailing decimal point mid-typing parses to the typed digits', () => {
    expect(parseSetInputText('5.')).toBe(5);
  });

  test('negative and non-finite entries are rejected as absent', () => {
    expect(parseSetInputText('-5')).toBeUndefined();
    expect(parseSetInputText('Infinity')).toBeUndefined();
  });

  test('any entry sequence is recoverable: a full replacement always wins', () => {
    // Raw text state means recovery is just the next string. Pin the exact
    // live sequence: invalid -> stuck append -> clean replacement.
    expect(parseSetInputText('a')).toBeUndefined();
    expect(parseSetInputText('NaN5')).toBeUndefined();
    expect(parseSetInputText('5')).toBe(5);
  });
});

describe('formatSetInputValue', () => {
  test('absent renders as the empty string', () => {
    expect(formatSetInputValue(undefined)).toBe('');
  });

  test('NaN and non-finite values can never render', () => {
    expect(formatSetInputValue(NaN)).toBe('');
    expect(formatSetInputValue(Infinity)).toBe('');
    expect(formatSetInputValue(-Infinity)).toBe('');
  });

  test('numbers render as their plain string', () => {
    expect(formatSetInputValue(8)).toBe('8');
    expect(formatSetInputValue(132.5)).toBe('132.5');
    expect(formatSetInputValue(0)).toBe('0');
  });

  test('the parse/format round-trip can never produce a rendered "NaN"', () => {
    const adversarial = ['NaN', 'NaN5', 'a', '.', '', '-', 'Infinity', '8', '12.5', '0x8'];
    for (const text of adversarial) {
      expect(formatSetInputValue(parseSetInputText(text))).not.toBe('NaN');
    }
  });
});

describe('buildLogSetValues', () => {
  test('strength set: reps truncate to integers, weight keeps decimals', () => {
    const values = buildLogSetValues({
      isDurationBased: false,
      repsText: '8.5',
      weightText: '132.5',
      durationText: '',
      rpe: undefined,
    });
    expect(values).toEqual({ reps: 8, weightLbs: 132.5 });
  });

  test('invalid or empty fields are omitted, never NaN and never 0', () => {
    const values = buildLogSetValues({
      isDurationBased: false,
      repsText: 'NaN5',
      weightText: '',
      durationText: '',
      rpe: undefined,
    });
    expect(values).toEqual({});
  });

  test('duration set: only durationSeconds is read, truncated to integer', () => {
    const values = buildLogSetValues({
      isDurationBased: true,
      repsText: '8',
      weightText: '100',
      durationText: '45.9',
      rpe: undefined,
    });
    expect(values).toEqual({ durationSeconds: 45 });
  });

  test('duration set with invalid duration text logs nothing', () => {
    const values = buildLogSetValues({
      isDurationBased: true,
      repsText: '',
      weightText: '',
      durationText: 'NaN',
      rpe: undefined,
    });
    expect(values).toEqual({});
  });

  test('rpe is included only when set and positive', () => {
    const withRpe = buildLogSetValues({
      isDurationBased: false,
      repsText: '5',
      weightText: '',
      durationText: '',
      rpe: 8.5,
    });
    expect(withRpe).toEqual({ reps: 5, rpe: 8.5 });

    const zeroRpe = buildLogSetValues({
      isDurationBased: false,
      repsText: '5',
      weightText: '',
      durationText: '',
      rpe: 0,
    });
    expect(zeroRpe).toEqual({ reps: 5 });
  });

  test('duration-based sets never carry rpe, even when a value is present (stretches/cardio have no RPE)', () => {
    const values = buildLogSetValues({
      isDurationBased: true,
      repsText: '',
      weightText: '',
      durationText: '30',
      rpe: 8.5,
    });
    expect(values).toEqual({ durationSeconds: 30 });
  });

  test('strength sets still carry rpe unchanged (regression guard alongside the duration-based strip)', () => {
    const values = buildLogSetValues({
      isDurationBased: false,
      repsText: '5',
      weightText: '100',
      durationText: '',
      rpe: 7,
    });
    expect(values).toEqual({ reps: 5, weightLbs: 100, rpe: 7 });
  });
});
