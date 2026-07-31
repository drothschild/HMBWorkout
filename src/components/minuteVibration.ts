import { Vibration } from 'react-native';

/**
 * Buzz once to mark a full minute of a timed exercise.
 *
 * `Vibration` is react-native core, so this adds no native module and needs no
 * dev-client rebuild. No pattern is passed: iOS ignores requested durations and
 * plays its own fixed (~400ms) buzz, so a pattern would only diverge between
 * platforms without making the alert any clearer.
 *
 * Failures are logged and swallowed, following the src/health convention — a
 * missed buzz must never take down the stopwatch or interrupt the workout.
 * Kept out of src/state so the pure stopwatch logic stays importable by the
 * node jest project, which has no RN runtime.
 */
export function vibrateForMinute(): void {
  try {
    Vibration.vibrate();
  } catch (error) {
    console.error('Failed to vibrate at minute milestone:', error);
  }
}
