// pattern: Imperative Shell
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { computeElapsedMs, formatElapsedTime } from '@/state/workoutStopwatch';

interface WorkoutStopwatchProps {
  /** Wall-clock ms the session started (SessionState.startedAtMs, via the presenter). */
  startedAtMs: number;
}

/**
 * Total elapsed workout time, ticking in the session header. Counts up from
 * `startedAtMs` and — unlike the header's Pause/Resume control or the
 * per-exercise `ExerciseStopwatch` — is never paused or frozen; see
 * `@/state/workoutStopwatch` for why.
 *
 * Mirrors `RestCountdown`'s ticking pattern: tick synchronously on mount (and
 * again whenever `startedAtMs` changes, i.e. a new session) plus every 250ms
 * while mounted, with the interval torn down on unmount so nothing ticks
 * off-screen. All the arithmetic lives in `@/state/workoutStopwatch`
 * (jest-covered); this component only owns the interval and the markup.
 */
export function WorkoutStopwatch({ startedAtMs }: WorkoutStopwatchProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(() =>
    computeElapsedMs(startedAtMs, Date.now())
  );

  useEffect(() => {
    const tick = () => setElapsedMs(computeElapsedMs(startedAtMs, Date.now()));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [startedAtMs]);

  return (
    <ThemedText type="small" style={styles.text}>
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
