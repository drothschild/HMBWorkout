// pattern: Functional Core

/**
 * The translucent amber surface the cross-provider key warning is drawn on.
 *
 * Exported as data rather than a style literal so the contrast test composites
 * the *same* value the screen renders. A hardcoded `rgba(...)` in the StyleSheet
 * plus a hardcoded background in the test is how the two silently diverge.
 */
export const WARNING_SURFACE_RGBA: readonly [number, number, number, number] = [
  255, 193, 7, 0.1,
];

export const WARNING_SURFACE_CSS = `rgba(${WARNING_SURFACE_RGBA[0]}, ${WARNING_SURFACE_RGBA[1]}, ${WARNING_SURFACE_RGBA[2]}, ${WARNING_SURFACE_RGBA[3]})`;

/**
 * Warning text colors for the cross-provider key warning.
 *
 * This is the one string in the provider settings feature whose entire job is to
 * be *read*: it fires when the user has pasted an Anthropic-shaped key under an
 * OpenAI selection, on a `secureTextEntry` field they cannot inspect. The
 * previous value (`#F57F17`) measured **2.51:1** on the light surface, well under
 * the 4.5:1 AA bar.
 *
 * Measured against the surface actually rendered (the amber above composited
 * over the app background), which is what `warningColors.test.ts` asserts:
 *
 *   light  #8B4513 on #fff9e6 → 6.74:1   (7.10:1 on bare white)
 *   dark   #D2691E on #1a1301 → 5.08:1   (5.78:1 on bare black)
 *
 * The dark pair clears the bar by ~0.6, so the difference between testing
 * against black and against the real surface is not academic.
 */
export const WarningColors = {
  textLight: '#8B4513',
  textDark: '#D2691E',
} as const;
