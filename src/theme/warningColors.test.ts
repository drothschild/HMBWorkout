import { contrastRatio } from './contrastRatio';
import { WarningColors, WARNING_SURFACE_RGBA } from './warningColors';

describe('WarningColors', () => {
  const AA_NORMAL_TEXT_MINIMUM = 4.5;
  const WHITE = '#FFFFFF';
  const BLACK = '#000000';

  /**
   * The warning text never sits on the raw app background — it sits on the
   * translucent amber surface composited over it. Asserting against white/black
   * therefore does not pin the condition these colors exist for: a text color
   * could clear 4.5:1 on white and fail on the amber it is actually drawn on.
   * The dark pair has only ~0.6 of headroom, so the difference is not academic.
   */
  function composite(
    rgba: readonly [number, number, number, number],
    base: string,
  ): string {
    const b = base.replace('#', '');
    const [r, g, bl, a] = rgba;
    const baseChannels = [0, 2, 4].map((i) => parseInt(b.slice(i, i + 2), 16));
    const mixed = [r, g, bl].map((c, i) => Math.round(c * a + baseChannels[i] * (1 - a)));
    return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }

  const LIGHT_SURFACE = composite(WARNING_SURFACE_RGBA, WHITE);
  const DARK_SURFACE = composite(WARNING_SURFACE_RGBA, BLACK);

  it('composites the warning surface the same way the screen renders it', () => {
    // Pins the fixture itself. If the overlay opacity changes, the surfaces
    // below change with it and the contrast assertions keep testing reality.
    expect(LIGHT_SURFACE).toBe('#fff9e6');
    expect(DARK_SURFACE).toBe('#1a1301');
  });

  describe('light mode text color contrast', () => {
    it('passes WCAG AA (4.5:1) against the amber surface it is drawn on', () => {
      expect(contrastRatio(WarningColors.textLight, LIGHT_SURFACE)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM,
      );
    });

    it('also passes against the bare light background', () => {
      expect(contrastRatio(WarningColors.textLight, WHITE)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM,
      );
    });
  });

  describe('dark mode text color contrast', () => {
    it('passes WCAG AA (4.5:1) against the amber surface it is drawn on', () => {
      expect(contrastRatio(WarningColors.textDark, DARK_SURFACE)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM,
      );
    });

    it('also passes against the bare dark background', () => {
      expect(contrastRatio(WarningColors.textDark, BLACK)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT_MINIMUM,
      );
    });
  });
});
