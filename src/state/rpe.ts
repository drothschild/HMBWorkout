/**
 * RPE value helpers shared by the slider UI.
 */

export const RPE_MIN = 1;
export const RPE_MAX = 10;
export const RPE_STEP = 0.5;

/**
 * Snap a raw slider value to an exact 0.5 step within [1, 10].
 * The native slider can emit float artifacts (e.g. 8.500000000000002);
 * the engine's validate_set rule rejects anything that is not an exact
 * 0.5-step increment, so all slider output must pass through here.
 */
export function snapRpe(value: number): number {
  const snapped = Math.round(value / RPE_STEP) * RPE_STEP;
  return Math.min(RPE_MAX, Math.max(RPE_MIN, snapped));
}
