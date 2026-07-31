/**
 * Weight unit conversion: lbs for display and entry ONLY.
 *
 * kg stays canonical everywhere else — engine state and events, the DB
 * weight_kg column, the vault markdown weight= flag, sync, and HealthKit.
 * Entry converts lbs → kg at the presenter boundary; display converts
 * kg → lbs at the formatter. Nothing outside this module may append a
 * weight unit suffix, so no read site can regress to kg.
 */

export const LBS_PER_KG = 2.20462;

/**
 * Entry-side conversion: the input field carries lbs; storage stays kg,
 * rounded to 2 decimals so vault markdown keeps readable values. The 0.005 kg
 * worst-case error is under a quarter of the 0.5 lb display step, so every
 * 0.5 lb entry round-trips exactly through kgToLbs. 0 stays 0, keeping the
 * engine's 0-to-undefined sentinel unchanged.
 */
export function lbsToKg(lbs: number): number {
  return Math.round((lbs / LBS_PER_KG) * 100) / 100;
}

/**
 * Display-side conversion, rounded to the nearest 0.5 lb so entered values
 * echo back exactly (61.24 kg renders as 135, not 134.99).
 */
export function kgToLbs(kg: number): number {
  return Math.round(kg * LBS_PER_KG * 2) / 2;
}

/** Formats a canonical kg value for display. Owns the lbs suffix. */
export function formatWeightLbs(kg: number): string {
  return `${kgToLbs(kg)}lbs`;
}
