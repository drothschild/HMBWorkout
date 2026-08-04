import { contrastRatio } from './contrastRatio';
import { ActionButtonColor } from './actionButtonColors';

describe('contrastRatio', () => {
  it('returns 21 for black against white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('returns 1 for a color against itself', () => {
    expect(contrastRatio('#3366CC', '#3366CC')).toBeCloseTo(1, 5);
  });

  it('is symmetric in argument order', () => {
    expect(contrastRatio('#007AFF', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#007AFF'),
      10
    );
  });

  it('matches the known failing ratio for the pre-fix primary button blue', () => {
    // Documents the WCAG AA failure (needs 4.5) this fix addresses.
    expect(contrastRatio('#007AFF', '#FFFFFF')).toBeCloseTo(4.02, 2);
  });
});

describe('ActionButtonColor', () => {
  const WHITE = '#FFFFFF';
  const AA_NORMAL_TEXT_MINIMUM = 4.5;

  it.each(Object.entries(ActionButtonColor))(
    '%s clears WCAG AA contrast (4.5:1) against white text',
    (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    }
  );
});
