// pattern: Functional Core

/**
 * The four action-button hues (also used by a couple of non-button solid
 * fills that carry white text, e.g. a chat bubble and a tag) — each the
 * original brand color darkened just enough to clear WCAG AA contrast
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

/**
 * Status/danger hues that don't belong in the action-button palette above
 * (currently just the session error banner) but carry the same white-text-
 * on-solid-fill contrast requirement.
 */
export const StatusColor = {
  danger: '#EA0C00',
} as const;
