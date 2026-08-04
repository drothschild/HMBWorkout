// pattern: Functional Core

/**
 * Solid-fill colors for buttons that render white bold text on top. Each is
 * the original brand hue darkened just enough to clear WCAG AA contrast
 * (4.5:1) against white — see contrastRatio.test.ts. Do not swap in the
 * lighter pre-fix values (#007AFF, #FF9500, #34C759, #208AEF): none of them
 * pass.
 */
export const ActionButtonColor = {
  primary: '#0071EB',
  warning: '#AB6400',
  finish: '#23863C',
  secondary: '#0F75D7',
} as const;
