// pattern: Functional Core

/**
 * Progress bar fill and track colors, constrained by WCAG 1.4.11 (3:1 minimum
 * contrast for graphical components).
 *
 * Light mode: #0D6E13 (dark green) achieves 3.32:1 against light track #E0E1E6
 * Dark mode: #34C759 (iOS green) achieves 5.89:1 against dark track #2E3135
 *
 * Note: #34C759 is reused from ActionButtonColor.finish (which was considered
 * but not selected for light mode to avoid four distinct greens in one
 * interface).
 */
export const ProgressBarColors = {
  light: {
    fill: '#0D6E13',
    track: '#E0E1E6',
  },
  dark: {
    fill: '#34C759',
    track: '#2E3135',
  },
} as const;
