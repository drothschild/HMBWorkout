import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { advanceStopwatch, StopwatchRun, StopwatchView } from '@/state/exerciseStopwatch';
import { vibrateForMinute } from './minuteVibration';

interface ExerciseStopwatchProps {
  /**
   * Identity of this run (see makeStopwatchKey). A change resets the stopwatch;
   * undefined switches it off entirely.
   */
  stopwatchKey: string | undefined;
  /** False while the session is paused: the clock freezes and stays silent. */
  running: boolean;
  /** Injected so the one side effect stays swappable and isolated. */
  onMinute?: () => void;
}

/**
 * Count-up stopwatch for duration-based exercises: a 5-second lead-in, then
 * elapsed exercise time, with a vibration at each full minute.
 *
 * Display and feedback only — it dispatches no engine events and makes no
 * session-flow decisions. All of the logic lives in the pure
 * `@/state/exerciseStopwatch` (jest covers src/state, not src/components); this
 * component only owns the interval, the run reference, and the markup.
 *
 * The interval exists purely to re-render: every value comes from
 * `advanceStopwatch` recomputing against `Date.now()`, so a suspended timer or
 * a backgrounded app resyncs to true elapsed time on the next tick instead of
 * drifting.
 */
export function ExerciseStopwatch({
  stopwatchKey,
  running,
  onMinute = vibrateForMinute,
}: ExerciseStopwatchProps) {
  const runRef = useRef<StopwatchRun | undefined>(undefined);
  const [view, setView] = useState<StopwatchView | undefined>(undefined);

  // The parent recreates its callbacks every render (the presenter is rebuilt
  // each time), so keep the alert in a ref: the interval must not be torn down
  // and re-armed on every parent render. Written in an effect, not during
  // render (react-hooks/refs) — same pattern as RestCountdown.
  const onMinuteRef = useRef(onMinute);
  useEffect(() => {
    onMinuteRef.current = onMinute;
  });

  useEffect(() => {
    const tick = () => {
      const result = advanceStopwatch(runRef.current, {
        key: stopwatchKey,
        running,
        nowMs: Date.now(),
      });
      runRef.current = result.run;
      setView(result.view);
      // The pure module latches milestones, so this fires once per minute even
      // if ticks arrive late, bunched, or after a long background gap.
      if (result.vibrateAtMinute !== undefined) onMinuteRef.current();
    };

    // Tick once immediately so a reset or a pause lands on screen at once.
    tick();

    // Nothing to animate while switched off or frozen; the state is static
    // until one of the deps changes and re-runs this effect.
    if (stopwatchKey === undefined || !running) return;

    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [stopwatchKey, running]);

  if (!view) return null;

  const label = view.phase === 'leadIn' ? 'Starting in' : view.isFrozen ? 'Paused' : 'Elapsed';

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" style={styles.label}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.clock, view.isFrozen && styles.clockFrozen]}>
        {view.display}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    marginVertical: Spacing.one,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
  },
  label: {
    opacity: 0.6,
  },
  clock: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: 'bold',
    // Fixed-width digits stop the clock jittering as the numbers change.
    fontVariant: ['tabular-nums'],
  },
  clockFrozen: {
    opacity: 0.5,
  },
});
