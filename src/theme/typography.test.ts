import { LINE_HEIGHT_FLOOR, TypeRamp, type TextRole } from './typography';

describe('LINE_HEIGHT_FLOOR', () => {
  it('is 1.165 — the bottom of SF\'s natural line-height range', () => {
    // Pinned so that moving the floor is a deliberate edit with a failing test
    // to justify, rather than a fourth re-derivation from a prose comment.
    expect(LINE_HEIGHT_FLOOR).toBe(1.165);
  });
});

describe('the type ramp', () => {
  const roles = Object.keys(TypeRamp) as TextRole[];

  it('is not empty', () => {
    // Guards the per-role assertions below: an empty ramp would make them
    // vacuous, and a suite that passes by having nothing to check is the
    // exact failure mode issue #124 exists to fix one module over.
    expect(roles.length).toBeGreaterThan(0);
  });

  it.each(roles)('%s clears the line-height floor', (role) => {
    const { fontSize, lineHeight } = TypeRamp[role];
    expect(lineHeight / fontSize).toBeGreaterThanOrEqual(LINE_HEIGHT_FLOOR);
  });

  it.each(roles)('%s sets an explicit lineHeight', (role) => {
    // Every entry must state its own line height. An unset lineHeight defers
    // to the font's own metrics, which is defensible in isolation but means
    // the ratio above cannot be checked at all — so the ramp does not allow it.
    expect(TypeRamp[role].lineHeight).toBeGreaterThan(0);
  });
});
