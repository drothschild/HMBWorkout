import { contrastRatio } from './contrastRatio';
import { ActionButtonColor, StatusColor } from './actionButtonColors';
import { ProgressBarColors } from './progressColors';
import { AiCoachErrorColors } from './aiCoachColors';

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

describe('AI Coach error bubble colors', () => {
  const AA_NORMAL_TEXT_MINIMUM = 4.5;

  it('error bubble text clears WCAG AA contrast (4.5:1) against error bubble background', () => {
    // Note: contrastRatio() parser requires 6-digit hex format (/^#([0-9a-fA-F]{6})$/),
    // so we use #CC0000 rather than 3-digit shorthand #C00.
    expect(
      contrastRatio(AiCoachErrorColors.bubbleText, AiCoachErrorColors.bubbleBackground)
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
  });
});
