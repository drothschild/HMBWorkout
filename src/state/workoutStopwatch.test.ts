import { computeElapsedMs, formatElapsedTime } from './workoutStopwatch';

/**
 * Test: workout stopwatch pure logic (header total-elapsed-time display).
 *
 * Both functions are plain math over caller-supplied timestamps — no
 * Date.now() inside the module — so tests drive them with fixed numbers
 * rather than mocking the clock.
 */

describe('computeElapsedMs', () => {
  test('is zero when now equals the start time', () => {
    expect(computeElapsedMs(1_000, 1_000)).toBe(0);
  });

  test('is the positive difference once time has passed', () => {
    expect(computeElapsedMs(1_000, 5_500)).toBe(4_500);
  });

  test('clamps to zero if now is somehow before the start time', () => {
    // Defensive: device clock changes should never render a negative stopwatch.
    expect(computeElapsedMs(5_000, 1_000)).toBe(0);
  });
});

describe('formatElapsedTime', () => {
  test('formats zero as 0:00', () => {
    expect(formatElapsedTime(0)).toBe('0:00');
  });

  test('formats sub-minute durations with zero-padded seconds', () => {
    expect(formatElapsedTime(5_000)).toBe('0:05');
  });

  test('formats exactly one minute as 1:00', () => {
    expect(formatElapsedTime(60_000)).toBe('1:00');
  });

  test('formats multi-minute durations under an hour with unpadded minutes', () => {
    expect(formatElapsedTime(125_000)).toBe('2:05');
  });

  test('rolls over to h:mm:ss at exactly one hour', () => {
    expect(formatElapsedTime(3_600_000)).toBe('1:00:00');
  });

  test('formats durations over an hour with zero-padded minutes and seconds', () => {
    // 1h 1m 1s
    expect(formatElapsedTime(3_661_000)).toBe('1:01:01');
  });

  test('truncates partial seconds rather than rounding', () => {
    expect(formatElapsedTime(1_999)).toBe('0:01');
  });

  test('clamps negative input to 0:00', () => {
    expect(formatElapsedTime(-500)).toBe('0:00');
  });
});
