import { contrastRatio } from './contrastRatio';
import { ActionButtonColor, StatusColor } from './actionButtonColors';

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

  it('confirms the pre-fix primary button blue fails WCAG AA (needs 4.5)', () => {
    expect(contrastRatio('#007AFF', '#FFFFFF')).toBeLessThan(4.5);
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

describe('StatusColor', () => {
  const WHITE = '#FFFFFF';
  const AA_NORMAL_TEXT_MINIMUM = 4.5;

  it.each(Object.entries(StatusColor))(
    '%s clears WCAG AA contrast (4.5:1) against white text',
    (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    }
  );
});

describe('Progress fill graphical component colors', () => {
  const WCAG_GRAPHICAL_MINIMUM = 3.0;
  const LIGHT_TRACK_BACKGROUND = '#E0E1E6';
  const DARK_TRACK_BACKGROUND = '#2E3135';
  const LIGHT_PROGRESS_FILL = '#0D6E13';
  const DARK_PROGRESS_FILL = '#34C759';

  it('light mode progress fill clears WCAG 1.4.11 contrast (3:1) against light track', () => {
    expect(contrastRatio(LIGHT_PROGRESS_FILL, LIGHT_TRACK_BACKGROUND)).toBeGreaterThanOrEqual(
      WCAG_GRAPHICAL_MINIMUM
    );
  });

  it('dark mode progress fill clears WCAG 1.4.11 contrast (3:1) against dark track', () => {
    expect(contrastRatio(DARK_PROGRESS_FILL, DARK_TRACK_BACKGROUND)).toBeGreaterThanOrEqual(
      WCAG_GRAPHICAL_MINIMUM
    );
  });
});
