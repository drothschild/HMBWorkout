import { contrastRatio } from './contrastRatio';
import { WarningColors } from './warningColors';

describe('WarningColors', () => {
  const AA_NORMAL_TEXT_MINIMUM = 4.5;
  const WHITE = '#FFFFFF';
  const BLACK = '#000000';

  describe('light mode text color contrast', () => {
    it('passes WCAG AA contrast (4.5:1) against white (light mode background)', () => {
      const ratio = contrastRatio(WarningColors.textLight, WHITE);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    });
  });

  describe('dark mode text color contrast', () => {
    it('passes WCAG AA contrast (4.5:1) against black (dark mode background)', () => {
      const ratio = contrastRatio(WarningColors.textDark, BLACK);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MINIMUM);
    });
  });
});
