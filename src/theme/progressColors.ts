// pattern: Functional Core

/**
 * Progress bar fill and track colors, constrained by WCAG 1.4.11 (3:1 minimum
 * contrast for graphical components). Both `fill` and `track` are the single
 * source of truth — `constants/theme.ts` imports them as `progressFill` and
 * `progressTrack` rather than restating the hex, so this module's own tests
 * verify the actual rendered colors, not a copy that could silently drift.
 * `progressTrack` is deliberately its own theme token, not a reuse of the
 * general-purpose `backgroundSelected` (which has ~17 unrelated consumers —
 * input borders, list separators, etc. — that must not move if this track
 * color is ever retuned for the progress bar specifically), even though the
 * two currently happen to share the same value.
 *
 * Light mode: #0D6E13 (dark green) achieves 4.94:1 against light track #E0E1E6
 * Dark mode: #34C759 (iOS green) achieves 5.89:1 against dark track #2E3135
 *
 * Note: These greens are independently chosen for the progress fill role.
 * ActionButtonColor.finish is #23863C, a different hue suitable for action
 * buttons carrying white text.
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
