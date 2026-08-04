import { contrastRatio } from './contrastRatio';
import { colorDistance } from './colorDistance';
import { ActionButtonColor, BackgroundColors, StatusColor, ThemedBackgroundText } from './actionButtonColors';
import { ProgressBarColors } from './progressColors';

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
    it('backgroundElementTextLight clears WCAG AA contrast (4.5:1) on light backgroundElement', () => {
      expect(contrastRatio(ThemedBackgroundText.backgroundElementTextLight, BackgroundColors.lightElement)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM
      );
    });
  });

  describe('text on dark mode backgroundElement', () => {
    it('backgroundElementTextDark clears WCAG AA contrast (4.5:1) on dark backgroundElement', () => {
      expect(contrastRatio(ThemedBackgroundText.backgroundElementTextDark, BackgroundColors.darkElement)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM
      );
    });
  });

  describe('text on errorBubble background', () => {
    it('errorBubbleText (used for errorMessage) clears WCAG AA contrast (4.5:1) on errorBubble background', () => {
      expect(contrastRatio(ThemedBackgroundText.errorBubbleText, BackgroundColors.errorBubble)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM
      );
    });

    it('errorBubbleTextDark clears WCAG AA contrast (4.5:1) on dark mode errorBubbleDark background', () => {
      expect(contrastRatio(ThemedBackgroundText.errorBubbleTextDark, BackgroundColors.errorBubbleDark)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM
      );
    });
  });

  describe('errorBubbleDark background distinguishability', () => {
    it('errorBubbleDark is perceptually distinct from darkElement background', () => {
      // This guards against regression where errorBubbleDark and darkElement become
      // too similar (e.g., #2C1A1D must remain clearly distinct from #212225).
      // WCAG contrast ratio alone (~1.04) is insufficient to detect color-space
      // confusion since identical backgrounds also measure ~1.00:1. Euclidean RGB
      // distance is a simple, honest metric: ~15+ indicates clear visual separation.
      const distance = colorDistance(BackgroundColors.errorBubbleDark, BackgroundColors.darkElement);
      expect(distance).toBeGreaterThan(10);
    });
  });
});

describe('Progress fill graphical component colors', () => {
  const WCAG_GRAPHICAL_MINIMUM = 3.0;

  it('light mode progress fill clears WCAG 1.4.11 contrast (3:1) against light track', () => {
    expect(
      contrastRatio(ProgressBarColors.light.fill, ProgressBarColors.light.track)
    ).toBeGreaterThanOrEqual(WCAG_GRAPHICAL_MINIMUM);
  });

  it('dark mode progress fill clears WCAG 1.4.11 contrast (3:1) against dark track', () => {
    expect(
      contrastRatio(ProgressBarColors.dark.fill, ProgressBarColors.dark.track)
    ).toBeGreaterThanOrEqual(WCAG_GRAPHICAL_MINIMUM);
  });
});
