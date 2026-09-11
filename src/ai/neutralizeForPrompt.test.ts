/**
 * neutralizeForPrompt — shared utility for stripping prompt-injection attempts
 * (#335, hoisted from three private duplicates).
 */

import { neutralizeForPrompt } from './neutralizeForPrompt';

describe('neutralizeForPrompt', () => {
  it('strips leading hashes from a single-line heading', () => {
    expect(neutralizeForPrompt('# Heading')).toBe('Heading');
  });

  it('strips leading hashes with arbitrary whitespace', () => {
    expect(neutralizeForPrompt('  ### x')).toBe('x');
  });

  it('handles multi-line text, stripping hashes line by line', () => {
    expect(neutralizeForPrompt('a\n# b\n c')).toBe('a\nb\n c');
  });

  it('ignores hash marks mid-line', () => {
    expect(neutralizeForPrompt('bench #2')).toBe('bench #2');
  });

  it('returns empty string unchanged', () => {
    expect(neutralizeForPrompt('')).toBe('');
  });
});
