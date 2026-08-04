// pattern: Functional Core

/**
 * The four action-button hues (also used by a couple of non-button solid
 * fills that carry white text, e.g. a chat bubble and a tag) — each the
 * original brand color darkened just enough to clear WCAG AA contrast
 * (4.5:1) against white — see contrastRatio.test.ts. Do not swap in the
 * lighter pre-fix values (#007AFF, #FF9500, #34C759, #208AEF): none of them
 * pass.
 *
 * Note: These constants are also used as text color on white (light mode)
 * and black (dark mode) backgrounds. Contrast is bidirectional, so a color
 * that clears 4.5:1 text-on-white also clears 4.5:1 white-text-on-color.
 * Do not retune these values without verifying both directions pass 4.5:1.
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
