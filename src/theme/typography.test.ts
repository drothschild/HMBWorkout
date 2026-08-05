import { LINE_HEIGHT_FLOOR, TypeRamp, type TextRole } from './typography';

describe('LINE_HEIGHT_FLOOR', () => {
  it('is SF Pro\'s measured hhea ratio: (1980 + 432) / 2048', () => {
    // Pinned so that moving the floor is a deliberate edit with a failing test
    // to justify. The value itself is derived in-source (see typography.ts)
    // from numbers `scripts/sf-line-height.js` reads out of the font binary —
    // not re-derived by hand from a prose range, the mistake that produced the
    // unsourced 1.165 this replaced.
    expect(LINE_HEIGHT_FLOOR).toBe((1980 + 432) / 2048);
    expect(LINE_HEIGHT_FLOOR).toBeCloseTo(1.177734375, 9);
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

  it('holds the values that ship', () => {
    // The ratio checks above only pin the ratio, not the values that actually
    // render — a mutation that swaps two roles' values wholesale, moves a
    // fontSize while keeping the ratio legal, or adds a fontWeight `link`
    // never had, passes every check above while shipping the wrong UI. This
    // module is the sole testable home of these values (themed-text.tsx is
    // outside jest's RN-free project), so pin the whole ramp here.
    expect(TypeRamp).toEqual({
      small: { fontSize: 14, lineHeight: 20, fontWeight: 500 },
      smallBold: { fontSize: 14, lineHeight: 20, fontWeight: 700 },
      default: { fontSize: 16, lineHeight: 24, fontWeight: 500 },
      title: { fontSize: 48, lineHeight: 57, fontWeight: 600 },
      subtitle: { fontSize: 32, lineHeight: 44, fontWeight: 600 },
      link: { fontSize: 14, lineHeight: 30 }, // no fontWeight, deliberately
    });
  });
});
