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

/**
 * Short reps-in-reserve description for each 0.5-step RPE value,
 * shown under the slider while the user picks a value.
 */
export function rpeHint(value: number): string {
  const v = snapRpe(value);
  if (v === 10) return 'Max effort — no reps left';
  if (v === 9.5) return 'Near max — maybe a partial rep left';
  if (v === 9) return '1 rep left in the tank';
  if (v === 8.5) return '1–2 reps left';
  if (v === 8) return '2 reps left';
  if (v === 7.5) return '2–3 reps left';
  if (v === 7) return '3 reps left';
  if (v >= 6) return '4+ reps left — moderate effort';
  if (v >= 4.5) return 'Light — could do many more reps';
  return 'Very light — warm-up effort';
}
