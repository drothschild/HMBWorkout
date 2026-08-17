/**
 * Tests for the grammar primitives in format.ts (#277).
 *
 * `roundtrip.test.ts` proves the serializer and the parser agree; these prove
 * the three primitives they agree *through* — quoting, decoding, tokenizing —
 * behave at the edges the round-trip fixtures cannot reach. Two of them are a
 * defense-in-depth pair: an unterminated quote is rejected by the tokenizer AND
 * by the decoder, so a document-level test kills neither on its own.
 */

import {
  quoteFlagValue,
  decodeFlagValue,
  tokenizeFlagString,
  ContractError,
} from '../format';

describe('format: quoted flag values (#277)', () => {
  describe('quoteFlagValue', () => {
    test('leaves a value that survives tokenization bare', () => {
      expect(quoteFlagValue('progressive')).toBe('progressive');
      expect(quoteFlagValue('3x12')).toBe('3x12');
      expect(quoteFlagValue('↑')).toBe('↑');
    });

    test('quotes the empty string rather than emitting nothing', () => {
      // A bare `@` or `superset=` is a value-shaped hole in the line; the
      // quoted form says "empty on purpose".
      expect(quoteFlagValue('')).toBe('""');
    });

    test('quotes and escapes every character that would break a line', () => {
      expect(quoteFlagValue('two words')).toBe('"two words"');
      expect(quoteFlagValue('a"b')).toBe('"a\\"b"');
      expect(quoteFlagValue('a\\b')).toBe('"a\\\\b"');
      expect(quoteFlagValue('a\nb')).toBe('"a\\nb"');
      // Carriage return too: a literal CR inside a workout line is invisible
      // and machine-hostile, even though the document splits on \n alone.
      expect(quoteFlagValue('a\rb')).toBe('"a\\rb"');
      expect(quoteFlagValue('a\r\nb')).toBe('"a\\r\\nb"');
    });
  });

  describe('decodeFlagValue', () => {
    test('passes a bare value through untouched', () => {
      expect(decodeFlagValue('progressive')).toBe('progressive');
      expect(decodeFlagValue('90')).toBe('90');
    });

    test('is the exact inverse of quoteFlagValue', () => {
      const values = [
        'progressive',
        '',
        'two words',
        '↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8',
        '3x12 = the goal',
        'He said "go heavy" \\ then rest=90 @cue',
        'line one\nline two',
        'crlf\r\nend',
        '   leading and trailing   ',
        'backslash-n literal: \\n',
      ];
      for (const value of values) {
        expect(decodeFlagValue(quoteFlagValue(value))).toBe(value);
      }
    });

    test('throws on a value whose quote is never closed', () => {
      // Reachable independently of the tokenizer's own check: this is the
      // second layer, and the layers must be tested separately or each one
      // hides the other's absence.
      expect(() => decodeFlagValue('"never closed')).toThrow(ContractError);
    });

    test('throws on trailing junk after the closing quote', () => {
      expect(() => decodeFlagValue('"abc"def')).toThrow(ContractError);
    });

    test('throws on an unrecognized escape', () => {
      expect(() => decodeFlagValue('"bad \\q escape"')).toThrow(ContractError);
    });
  });

  describe('tokenizeFlagString', () => {
    test('splits on whitespace outside quotes only', () => {
      expect(tokenizeFlagString('4x6 rest=90 @"two words" warmup=2')).toEqual([
        '4x6',
        'rest=90',
        '@"two words"',
        'warmup=2',
      ]);
    });

    test('keeps quotes on the token so the value stays distinguishable', () => {
      // A quoted `3x12` must not look like the bare sets×reps token to
      // parse.ts, which scans these tokens for the sets slot.
      expect(tokenizeFlagString('superset="3x12"')).toEqual(['superset="3x12"']);
    });

    test('an escaped quote does not close the value', () => {
      expect(tokenizeFlagString('@"say \\"hi\\" now" rest=90')).toEqual([
        '@"say \\"hi\\" now"',
        'rest=90',
      ]);
    });

    test('collapses runs of whitespace and tolerates an empty input', () => {
      expect(tokenizeFlagString('  4x6   rest=90  ')).toEqual(['4x6', 'rest=90']);
      expect(tokenizeFlagString('')).toEqual([]);
      expect(tokenizeFlagString('   ')).toEqual([]);
    });

    test('throws on an unterminated quote', () => {
      // The first layer of the pair; `decodeFlagValue` is the second.
      expect(() => tokenizeFlagString('@"never closed')).toThrow(ContractError);
    });
  });
});
