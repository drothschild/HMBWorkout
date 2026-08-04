// pattern: Imperative Shell
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { computeElapsedMs, formatElapsedTime } from '@/state/workoutStopwatch';

interface WorkoutStopwatchProps {
  /** Wall-clock ms the session started (SessionState.startedAtMs, via the presenter). */
  startedAtMs: number;
  /** True when the session phase is 'done' — freezes the display. */
  isDone?: boolean;
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
export function WorkoutStopwatch({ startedAtMs, isDone }: WorkoutStopwatchProps) {
  // M1: Store whole seconds to avoid re-renders on every 250ms tick (~4x/sec).
  // Only 1 of every 4 ticks produces a visible change, so 3 bail out per interval.
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() =>
    Math.floor(computeElapsedMs(startedAtMs, Date.now()) / 1000)
  );

  useEffect(() => {
    // I1: Don't tick if the session is done. The phase is never persisted, so
    // freezing here is safe — a rehydrate will never land on 'done' and leave
    // an obsolete stopwatch value behind.
    if (isDone) return;

    const tick = () => {
      setElapsedSeconds(Math.floor(computeElapsedMs(startedAtMs, Date.now()) / 1000));
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
