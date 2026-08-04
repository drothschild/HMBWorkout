import { contrastRatio } from './contrastRatio';
import { ActionButtonColor, StatusColor, ThemedBackgroundText } from './actionButtonColors';

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
  const BLACK = '#000000';
  const AA_NORMAL_TEXT_MINIMUM = 4.5;

  it.each(Object.entries(ActionButtonColor))(
    '%s clears WCAG AA contrast (4.5:1) against white',
    (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    }
  );

  it.each(Object.entries(ActionButtonColor))(
    '%s clears WCAG AA contrast (4.5:1) against black (dark mode)',
    (_name, hex) => {
      expect(contrastRatio(hex, BLACK)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    }
  );
});

describe('StatusColor', () => {
  const WHITE = '#FFFFFF';
  const BLACK = '#000000';
  const AA_NORMAL_TEXT_MINIMUM = 4.5;

  it.each(Object.entries(StatusColor))(
    '%s clears WCAG AA contrast (4.5:1) against white',
    (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    }
  );

  it.each(Object.entries(StatusColor))(
    '%s clears WCAG AA contrast (4.5:1) against black (dark mode)',
    (_name, hex) => {
      expect(contrastRatio(hex, BLACK)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    }
  );
});

describe('ThemedBackgroundText', () => {
  const AA_NORMAL_TEXT_MINIMUM = 4.5;

  describe('text on light mode backgroundElement', () => {
    const BG_LIGHT = '#F0F0F3';

    it.each(Object.entries(ThemedBackgroundText))(
      '%s on light backgroundElement (#F0F0F3)',
      (_name, hex) => {
        // All colors should be tested; only backgroundElementTextLight is designed for this background
        const result = contrastRatio(hex, BG_LIGHT);
        if (_name === 'backgroundElementTextLight') {
          expect(result).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
        }
      }
    );
  });

  describe('text on dark mode backgroundElement', () => {
    const BG_DARK = '#212225';

    it.each(Object.entries(ThemedBackgroundText))(
      '%s on dark backgroundElement (#212225)',
      (_name, hex) => {
        // All colors should be tested; only backgroundElementTextDark is designed for this background
        const result = contrastRatio(hex, BG_DARK);
        if (_name === 'backgroundElementTextDark') {
          expect(result).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
        }
      }
    );
  });

  describe('text on errorBubble background', () => {
    const BG_PINK = '#FFE5E5';

    it.each(Object.entries(ThemedBackgroundText))(
      '%s on errorBubble background (#FFE5E5)',
      (_name, hex) => {
        // All colors should be tested; only errorBubbleText is designed for this background
        const result = contrastRatio(hex, BG_PINK);
        if (_name === 'errorBubbleText') {
          expect(result).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
        }
      }
    );
  });
});
