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

// WCAG 2.x sRGB-to-linear channel conversion (relative luminance formula).
function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * srgbChannelToLinear(color.r) +
    0.7152 * srgbChannelToLinear(color.g) +
    0.0722 * srgbChannelToLinear(color.b)
  );
}

/**
 * WCAG contrast ratio between two colors, from 1 (identical) to 21 (black on
 * white). Symmetric — argument order doesn't matter.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexToRgb(hexA));
  const luminanceB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}
