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
  parseFlags,
  parseFlagTokens,
  formatFlags,
  isValidRpe,
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

    test('throws on a lone quote rather than reading it as an empty value', () => {
      // A single `"` both starts and ends with the delimiter, so the length
      // guard is the only thing standing between it and decoding to ''. The
      // empty value's real wire form is `""` (#277 review, m2/R15).
      expect(() => decodeFlagValue('"')).toThrow(ContractError);
      expect(decodeFlagValue('""')).toBe('');
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

    test('an escape pair is only special inside quotes', () => {
      // Outside a quoted value a backslash is an ordinary character, so it must
      // not swallow the character after it — here the space that ends the token.
      expect(tokenizeFlagString('@a\\ b')).toEqual(['@a\\', 'b']);
      // Inside, the pair is kept raw for decodeFlagValue to resolve.
      expect(tokenizeFlagString('@"a\\ b"')).toEqual(['@"a\\ b"']);
    });
  });

  /**
   * A `"` is a delimiter only where a value begins (#277 review, C2). The old
   * whitespace tokenizer truncated a note at its first space; making every `"`
   * significant turned that truncation into a thrown `ContractError` for any
   * note containing an odd number of quotes — and inch marks (`2" deficit`,
   * `45" band`) put one in an entirely ordinary lifting note.
   *
   * These pin the positions at which a quote is and is not significant. The
   * document-level consequence is pinned in `parse.test.ts`.
   */
  describe('tokenizeFlagString: a quote is significant only in value-opening position', () => {
    test('an inch mark inside a word is a literal character', () => {
      expect(tokenizeFlagString('@Go 2" deep')).toEqual(['@Go', '2"', 'deep']);
      expect(tokenizeFlagString('@Use the 45" band')).toEqual([
        '@Use',
        'the',
        '45"',
        'band',
      ]);
    });

    test('a quote part-way through a flag value is a literal character', () => {
      // The pre-#277 serializer wrote `superset=` bare, so a label holding a
      // quote is sitting in legacy documents. One token, quote and all.
      expect(tokenizeFlagString('superset=A"B rest=1:30')).toEqual([
        'superset=A"B',
        'rest=1:30',
      ]);
    });

    test('a quote still opens the value straight after the first = or the @', () => {
      expect(tokenizeFlagString('superset="Group One"')).toEqual(['superset="Group One"']);
      expect(tokenizeFlagString('@"two words"')).toEqual(['@"two words"']);
    });

    test('only the first = of a token opens a value', () => {
      // A hint's own text may contain `=` followed by a quote...
      expect(tokenizeFlagString('@tempo="3010 rest=90')).toEqual([
        '@tempo="3010',
        'rest=90',
      ]);
      // ...and so may a flag value, which the leading-@ check above does not
      // cover. A second `=` is inside the value, not the start of a new one.
      expect(tokenizeFlagString('superset=a="b rest=90')).toEqual([
        'superset=a="b',
        'rest=90',
      ]);
    });

    test('only a leading @ opens a hint value', () => {
      expect(tokenizeFlagString('@see @coach "why"')).toEqual([
        '@see',
        '@coach',
        '"why"',
      ]);
    });
  });

  /**
   * `parseFlags` is the tokenize-then-parse wrapper over `parseFlagTokens`.
   * `parse.ts` calls the token form directly (it tokenizes the whole line spec
   * itself), so nothing in the codebase reaches this one — it is exported API
   * and part of the contract's symmetry, and without a test its body is
   * invisible to mutation (#277 review, m1).
   */
  describe('parseFlags', () => {
    test('tokenizes then parses, agreeing with parseFlagTokens', () => {
      const flagStr = 'rest=1:30 warmup=2 superset="Group One" @"two words"';

      expect(parseFlags(flagStr)).toEqual({
        restSeconds: 90,
        warmupSets: 2,
        supersetLabel: 'Group One',
        hint: 'two words',
      });
      expect(parseFlags(flagStr)).toEqual(parseFlagTokens(tokenizeFlagString(flagStr)));
    });

    test('propagates the tokenizer rejection of an unterminated quote', () => {
      expect(() => parseFlags('@"never closed')).toThrow(ContractError);
    });
  });
});

/**
 * #284: the RPE scale is ONE rule, applied at both ends of the grammar.
 *
 * The reader enforced 1–10 in 0.5 steps and the writer enforced nothing, so
 * `formatFlags` could emit an `rpe=` value `parseFlags` then refused. These
 * pin the shared predicate and both of its application sites; the document
 * -level consequence is in `roundtrip.test.ts`.
 */
describe('format: the RPE scale (#284)', () => {
  /**
   * Every value named in the issue's boundary list plus the ones that bracket
   * it. `emitted` is what the grammar considers a legal RPE — the writer emits
   * exactly these and the reader accepts exactly these.
   */
  const BOUNDARIES: readonly { value: number; legal: boolean }[] = [
    { value: 0, legal: false },
    { value: 0.5, legal: false },
    { value: 1, legal: true },
    { value: 1.5, legal: true },
    { value: 7.3, legal: false },
    { value: 7.5, legal: true },
    { value: 10, legal: true },
    { value: 10.5, legal: false },
    { value: 11, legal: false },
    { value: -1, legal: false },
  ];

  describe('isValidRpe', () => {
    test.each(BOUNDARIES)('$value → $legal', ({ value, legal }) => {
      expect(isValidRpe(value)).toBe(legal);
    });

    test('rejects the non-finite values parseFloat can produce', () => {
      expect(isValidRpe(NaN)).toBe(false);
      expect(isValidRpe(Infinity)).toBe(false);
      expect(isValidRpe(-Infinity)).toBe(false);
    });
  });

  describe('formatFlags', () => {
    test('emits an in-scale rpe', () => {
      expect(formatFlags({ rpe: 7.5 })).toBe('rpe=7.5');
      expect(formatFlags({ rpe: 1 })).toBe('rpe=1');
      expect(formatFlags({ rpe: 10 })).toBe('rpe=10');
    });

    test('omits an out-of-scale rpe rather than writing a line no reader accepts', () => {
      // 0 is the value the issue was raised on: nothing in the app means
      // "RPE zero" — `buildLogSetValues` already reads a 0 off the slider as
      // *cleared* — so it is dropped exactly as an absent one is.
      expect(formatFlags({ rpe: 0 })).toBe('');
      expect(formatFlags({ rpe: 0.5 })).toBe('');
      expect(formatFlags({ rpe: 10.5 })).toBe('');
      expect(formatFlags({ rpe: 11 })).toBe('');
      expect(formatFlags({ rpe: 7.3 })).toBe('');
    });

    test('dropping the rpe leaves the rest of the line intact', () => {
      // The omission is scoped to the one flag: a set's actual work must not
      // be lost because an annotation was out of scale.
      expect(formatFlags({ setType: 'working', rpe: 0, weight: 60 })).toBe(
        'set_type=working weight=60'
      );
    });
  });

  describe('the two halves agree at every boundary', () => {
    test.each(BOUNDARIES)('$value', ({ value, legal }) => {
      const wire = formatFlags({ rpe: value });

      if (legal) {
        expect(wire).toBe(`rpe=${value}`);
        expect(parseFlags(wire)).toEqual({ rpe: value });
      } else {
        // Nothing is written, so there is nothing for the reader to refuse.
        expect(wire).toBe('');
        expect(() => parseFlags(`rpe=${value}`)).toThrow(ContractError);
      }
    });
  });
});
