import { useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const theme = useTheme();
  const runRef = useRef<StopwatchRun | undefined>(undefined);
  const [view, setView] = useState<StopwatchView | undefined>(undefined);

  // The parent recreates its callbacks every render (the presenter is rebuilt
  // each time), so keep the alert in a ref: the interval must not be torn down
  // and re-armed on every parent render. Written in a layout effect since the
  // tick that reads it is also layout-timed — and this effect must stay
  // declared before the tick effect below (layout effects run in hook order,
  // which is what guarantees the commit-time tick reads a fresh onMinute).
  const onMinuteRef = useRef(onMinute);
  useLayoutEffect(() => {
    onMinuteRef.current = onMinute;
  });

  // Tick once before paint (useLayoutEffect) to avoid a one-frame layout jump
  // when view mounts undefined. One layout effect owns both the tick and the
  // interval so they cannot drift apart. React runs layout cleanups in the
  // mutation phase and layout creates in the layout phase of the same
  // synchronous commit, so the sequence is clearInterval(old) → tick(new
  // closure) → setInterval(new), with no window for a stale running=true tick
  // to fire after a freeze has been committed. Splitting the interval back
  // into a passive effect reintroduces that race.
  useLayoutEffect(() => {
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

    // Tick immediately, then set up interval if running.
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
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
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
