// pattern: Functional Core

/**
 * Warning text colors for the cross-provider key warning display.
 *
 * The warning appears on a light amber background in light mode and a dark amber
 * background in dark mode. Each text color must pass WCAG AA contrast (4.5:1)
 * against white (light mode) and black (dark mode) — the main app backgrounds.
 *
 * Light mode text: #8B4513 (saddle brown) on white → 7.10:1
 * Dark mode text: #D2691E (chocolate) on black → 5.78:1
 *
 * Both exceed the 4.5:1 minimum.
 *
 * See contrastRatio.test.ts for verification.
 */
export const WarningColors = {
  textLight: '#8B4513',
  textDark: '#D2691E',
} as const;
