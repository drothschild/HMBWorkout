// pattern: Functional Core

type RgbColor = Readonly<{ r: number; g: number; b: number }>;

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): RgbColor {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (!match) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  const value = parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/**
 * Euclidean distance in RGB color space between two hex colors.
 * Used to measure perceptual color separation for regression testing.
 * A distance of ~15+ indicates clearly distinguishable colors.
 */
export function colorDistance(hexA: string, hexB: string): number {
  const colorA = hexToRgb(hexA);
  const colorB = hexToRgb(hexB);
  const dr = colorA.r - colorB.r;
  const dg = colorA.g - colorB.g;
  const db = colorA.b - colorB.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
