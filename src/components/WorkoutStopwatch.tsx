// pattern: Imperative Shell
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { computeElapsedSeconds, formatElapsedTime } from '@/state/workoutStopwatch';

interface WorkoutStopwatchProps {
  /** Wall-clock ms the session started (SessionState.startedAtMs, via the presenter). */
  startedAtMs: number;
  /** True when the session phase is 'done' — freezes the display. */
  isDone?: boolean;
}

/**
 * Total elapsed workout time, ticking in the session header. Counts up from
 * `startedAtMs` and — unlike the header's Pause/Resume control or the
 * per-exercise `ExerciseStopwatch` — is never paused for a pause; it keeps
 * running through pause/resume cycles. However, it does freeze once the
 * session phase reaches `done` to display the final elapsed time.
 *
 * Mirrors `RestCountdown`'s ticking pattern: tick synchronously on mount (and
 * again whenever `startedAtMs` changes, i.e. a new session) plus every 250ms
 * while mounted and not done, with the interval torn down on unmount so nothing
 * ticks off-screen. All the arithmetic lives in `@/state/workoutStopwatch`
 * (jest-covered); this component only owns the interval and the markup.
 */
export function WorkoutStopwatch({ startedAtMs, isDone }: WorkoutStopwatchProps) {
  // Store whole seconds to avoid re-renders on every 250ms tick (~4x/sec).
  // Only 1 of every 4 ticks produces a visible change, so 3 bail out per interval.
  // Note: nothing currently remounts this component after a workout is done —
  // no screen navigates back into /session for a done session, the done-screen's
  // only action (router.back()) pops the modal rather than remounting, and the
  // debrief flow uses router.push so the session modal stays mounted underneath.
  // If a future navigation change violates this invariant, a remount long after
  // completion would show the wrong (now-stale) elapsed time here until the next
  // tick; watch this spot if navigation patterns change.
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() =>
    computeElapsedSeconds(startedAtMs, Date.now())
  );

  useEffect(() => {
    // Don't tick if the session is done. Freezing here is safe because
    // activeSession.ts:352 skips saveEngineState when phase === 'done', and
    // onCompleteSession clears the stored engine_state on the completion record.
    if (isDone) return;

    const tick = () => {
      setElapsedSeconds(computeElapsedSeconds(startedAtMs, Date.now()));
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [startedAtMs, isDone]);

  const elapsedMs = elapsedSeconds * 1000;
  return (
    <ThemedText
      type="small"
      style={styles.text}
      accessibilityLabel={`Elapsed workout time ${formatElapsedTime(elapsedMs)}`}
    >
      {formatElapsedTime(elapsedMs)}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  text: {
    // Matches session.tsx's styles.phaseText: secondary, at-a-glance chrome.
    opacity: 0.7,
    // Fixed-width digits stop the header jittering as seconds tick over.
    fontVariant: ['tabular-nums'],
  },
});
