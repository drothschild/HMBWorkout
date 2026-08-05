// pattern: Functional Core

/**
 * The text ramp and its line-height floor.
 *
 * `ThemedText` imports `TypeRamp` rather than restating these numbers, so this
 * module is the single source of truth and the floor below is checked against
 * the values actually rendered — not against a copy that could drift. Same
 * arrangement as `progressColors.ts` and `constants/theme.ts`.
 *
 * ## Why this module exists
 *
 * SF's natural line height is often cited as ~1.165–1.19x the font size, and
 * that range was written into a comment in `ai-coach.tsx`. Three PRs (#104,
 * #108, #118) each re-derived a floor from that prose, and each independently
 * landed on the bottom of the range. Issue #126 asked for the number to be
 * settled once and written down. It is 1.165, and it lives here as a constant a
 * test enforces rather than as a sentence the next PR has to interpret.
 *
 * ## Why the bottom of the range and not the top
 *
 * The range is not a tolerance band around one correct value — it describes how
 * SF's own natural line height *varies with optical size*. Small text sizes
 * render through SF Text and sit toward 1.19; large display sizes render
 * through SF Display, whose natural leading is proportionally tighter and sits
 * toward 1.165. So the number that holds for *every* size is the bottom one,
 * and that is what a floor has to be.
 *
 * The practical consequence, and the second question #126 asked: **display
 * sizes need no exemption.** `title` sits at 48/56 = 1.167, the tightest ratio
 * in the ramp by a wide margin, and that is correct rather than tight — it is
 * simply where a display face's natural leading falls. Nothing looked wrong in
 * the simulator across any of the three PRs above, which is the observation
 * this reasoning explains. Had the floor been set at the top of the range
 * instead, `title` would have needed 58pt to clear 57.12 and every display size
 * would have required a carve-out to avoid being loosened past what SF itself
 * does.
 */
export const LINE_HEIGHT_FLOOR = 1.165;

export type TextRole = 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link';

/**
 * Values are unchanged from the ones that shipped — this module moved them, it
 * did not retune them. `fontWeight` is absent on `link` exactly as before.
 */
export const TypeRamp = {
  small: { fontSize: 14, lineHeight: 20, fontWeight: 500 },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: 700 },
  default: { fontSize: 16, lineHeight: 24, fontWeight: 500 },
  title: { fontSize: 48, lineHeight: 56, fontWeight: 600 },
  subtitle: { fontSize: 32, lineHeight: 44, fontWeight: 600 },
  link: { fontSize: 14, lineHeight: 30 },
} as const satisfies Record<TextRole, { fontSize: number; lineHeight: number; fontWeight?: number }>;
