// pattern: Functional Core

/**
 * The four action-button hues (also used by a couple of non-button solid
 * fills that carry white text, e.g. a chat bubble and a tag) — each the
 * original brand color darkened just enough to clear WCAG AA contrast
 * (4.5:1) against white — see contrastRatio.test.ts. Do not swap in the
 * lighter pre-fix values (#007AFF, #FF9500, #34C759, #208AEF) for text/
 * fill-with-text uses: none of them pass the 4.5:1 bar. (Note: the lighter
 * values remain acceptable as graphical fills without text overlays, which
 * require only the 3:1 contrast ratio for graphical objects under WCAG 1.4.11.)
 *
 * Note: These constants are used as text color on both white (light mode)
 * and black (dark mode) backgrounds. Contrast must pass two independent checks:
 * (1) color-vs-white at 4.5:1 (light mode), and (2) color-vs-black at 4.5:1
 * (dark mode). Margins are thin on the black side (~1.0-1.4%), so do not retune
 * these values without verifying both directions pass 4.5:1.
 */
export const ActionButtonColor = {
  primary: '#0071EB',
  warning: '#AB6400',
  finish: '#23863C',
  secondary: '#0F75D7',
} as const;

/**
 * Status/danger hues that don't belong in the action-button palette above
 * (currently just the session error banner) but carry the same white-text-
 * on-solid-fill contrast requirement.
 */
export const StatusColor = {
  danger: '#EA0C00',
} as const;

/**
 * Background colors for themed elements. These are imported by test files that
 * cannot import the theme.ts Colors object (which pulls in RN/CSS dependencies).
 */
export const BackgroundColors = {
  lightElement: '#F0F0F3', // Colors.light.backgroundElement
  darkElement: '#212225',  // Colors.dark.backgroundElement
  errorBubble: '#FFE5E5',
} as const;

/**
 * Text colors for use on themed backgrounds (not white/black).
 *
 * `backgroundElementTextLight`: Text on Colors.light.backgroundElement (#F0F0F3)
 * Contrast: 9.20:1 (well above WCAG AA 4.5:1 minimum)
 *
 * `backgroundElementTextDark`: Text on Colors.dark.backgroundElement (#212225)
 * Contrast: 9.42:1 (well above WCAG AA 4.5:1 minimum)
 *
 * `errorBubbleText`: Text on errorBubble hardcoded background (#FFE5E5)
 * Contrast: 4.93:1 (meets WCAG AA 4.5:1 minimum)
 */
export const ThemedBackgroundText = {
  backgroundElementTextLight: '#003D85',
  backgroundElementTextDark: '#99CCFF',
  errorBubbleText: '#CC0000',
} as const;
