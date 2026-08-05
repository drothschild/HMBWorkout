import { Vibration } from 'react-native';

/**
 * Exercise-stopwatch vibration alerts, both count-up and countdown.
 *
 * `Vibration` is react-native core, so this adds no native module and needs no
 * dev-client rebuild. No pattern is passed: iOS ignores requested durations and
 * plays its own fixed (~400ms) buzz, so a pattern would only diverge between
 * platforms without making the alert any clearer. The two exports below fire
 * the identical buzz — they exist separately so each call site names the
 * event it means, and so a stopwatch entry's mode (see exerciseStopwatch.ts)
 * decides which one fires: `vibrateForMinute` for the count-up stopwatch's
 * per-minute milestones, `vibrateAtZero` for a countdown run's single
 * end-of-time buzz. A given run only ever triggers one of the two.
 *
 * Failures are logged and swallowed, following the src/health convention — a
 * missed buzz must never take down the stopwatch or interrupt the workout.
 * Kept out of src/state so the pure stopwatch logic stays importable by the
 * node jest project, which has no RN runtime.
 */
function buzzOnce(context: string): void {
  try {
    Vibration.vibrate();
  } catch (error) {
    console.error(`Failed to vibrate at ${context}:`, error);
  }
}

/** Buzz once to mark a full minute of a timed exercise (count-up mode only). */
export function vibrateForMinute(): void {
  buzzOnce('minute milestone');
}

/** Buzz once when a countdown run reaches 0:00 (countdown mode only). */
export function vibrateAtZero(): void {
  buzzOnce('countdown zero');
}

/**
 * Buzz once when a rest period finishes.
 *
 * Unlike the two above this is not a stopwatch event, but it lives here for
 * the same reason: `Vibration` is react-native core, so it needs no native
 * module and no dev-client rebuild, and keeping it out of src/state leaves
 * the pure logic importable by the node jest project.
 *
 * This exists because the rest path previously had *no* non-audio signal at
 * all. On a silenced phone with the app open, a finished rest produced
 * nothing: the beep was muted, and the scheduled OS notification only helps
 * when the app is backgrounded. A buzz always reaches the athlete.
 */
export function vibrateAtRestComplete(): void {
  buzzOnce('rest complete');
}
