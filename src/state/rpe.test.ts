import { snapRpe } from './rpe';

/**
 * snapRpe guards the slider → engine boundary: the native slider can emit
 * float artifacts (e.g. 8.500000000000002), but the engine's validate_set
 * rule requires RPE to be exactly 1-10 in 0.5-step increments.
 */
describe('snapRpe', () => {
  test('passes through exact 0.5-step values', () => {
    expect(snapRpe(1)).toBe(1);
    expect(snapRpe(7.5)).toBe(7.5);
    expect(snapRpe(10)).toBe(10);
  });

  test('snaps float artifacts from the native slider to exact steps', () => {
    expect(snapRpe(8.500000000000002)).toBe(8.5);
    expect(snapRpe(7.499999999999999)).toBe(7.5);
    expect(snapRpe(6.999999999999998)).toBe(7);
  });

  test('rounds arbitrary values to the nearest 0.5', () => {
    expect(snapRpe(7.2)).toBe(7);
    expect(snapRpe(7.3)).toBe(7.5);
    expect(snapRpe(9.8)).toBe(10);
  });

  test('clamps out-of-range values into 1-10', () => {
    expect(snapRpe(0)).toBe(1);
    expect(snapRpe(0.4)).toBe(1);
    expect(snapRpe(11)).toBe(10);
  });
});
