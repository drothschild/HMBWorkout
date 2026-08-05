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
 * SF's natural line height was cited as ~1.165–1.19x the font size in a
 * comment in `ai-coach.tsx`, and three PRs (#104, #108, #118) each re-derived
 * a floor from that prose, landing on 1.165 each time. Issue #126 asked for
 * the number to be settled once and written down — and settling it by direct
 * measurement disproved the story behind it.
 *
 * ## The "1.165–1.19" range was never optical-size variation
 *
 * `scripts/sf-line-height.js` (run it — `node scripts/sf-line-height.js` —
 * rather than trusting this prose) reads the vertical metrics straight out of
 * the font binaries on this Mac. SF Pro (`SFNS.ttf`, the one Latin system font
 * — there is no separate SF Text / SF Display binary today) reports `hhea`
 * ascender 1980, descender -432, lineGap 0, unitsPerEm 2048: a ratio of
 * exactly `(1980 + 432) / 2048 = 1.177734375`.
 * `OS/2` typo and win metrics agree. SF Pro's `opsz` (optical size) axis is
 * real, but its `MVAR` table only carries `stro strs undo unds xhgt` — none of
 * the eight tags (`hasc hdsc hlgp tasc tdsc tlgp wasc wdsc`) that could make
 * vertical metrics vary along an axis. What `opsz` varies is x-height, not
 * leading, so the ratio above is a constant for every size and weight, not one
 * end of a size-dependent range.
 *
 * 1.19336 — the top of the old range — is exactly SF Compact's ratio, and the
 * script measures the same ratio for SF Armenian/Georgian/Hebrew/Camera —
 * run it to see. "1.165–1.19" was spreading numbers across separate
 * SF *faces*, not describing how one face's leading moves with size. 1.165
 * itself matches no SF face the script can find — it had no source, only three
 * prior PRs that copied it forward.
 *
 * ## The floor is now the measured constant, derived in-source
 *
 * `LINE_HEIGHT_FLOOR` is computed from SF Pro's own `hhea` numbers below
 * rather than written as an opaque decimal, so it cannot be transcribed wrong
 * and so the next person can diff it against a script re-run instead of
 * re-deriving it from prose a fifth time.
 *
 * The practical consequence: **`title` needed to move.** At the old 48/56 it
 * was 48 * 1.16667 = 56, which is 0.53pt *short* of the measured 56.53 —
 * `title` was the tightest ratio in the ramp and it was under the true
 * constant, not safely at the bottom of a range. It is now 48/57 = 1.1875,
 * which clears. Every other entry in the ramp already clears 1.177734375 with
 * room (see `scripts/sf-line-height.js`'s ramp-vs-measured table), so only
 * `title` changed.
 */
export const LINE_HEIGHT_FLOOR =
  // SF Pro `hhea`: (ascender 1980 + |descender| 432 + lineGap 0) / unitsPerEm 2048
  (1980 + 432) / 2048; // 1.177734375

export type TextRole = 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link';

/**
 * `small`, `smallBold`, `default`, `subtitle`, and `link` are unchanged from
 * the ones that shipped — this module moved them, it did not retune them.
 * `fontWeight` is absent on `link` exactly as before. `title.lineHeight` is
 * the one deliberate change: 56 → 57, to clear the corrected
 * `LINE_HEIGHT_FLOOR` above (48 * 1.177734375 = 56.53, so 56 no longer
 * clears; 57 does).
 */
export const TypeRamp = {
  small: { fontSize: 14, lineHeight: 20, fontWeight: 500 },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: 700 },
  default: { fontSize: 16, lineHeight: 24, fontWeight: 500 },
  title: { fontSize: 48, lineHeight: 57, fontWeight: 600 },
  subtitle: { fontSize: 32, lineHeight: 44, fontWeight: 600 },
  link: { fontSize: 14, lineHeight: 30 },
} as const satisfies Record<TextRole, { fontSize: number; lineHeight: number; fontWeight?: number }>;
