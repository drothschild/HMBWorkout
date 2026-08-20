import { SymbolView } from 'expo-symbols';
import { useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  advanceStopwatch,
  StopwatchCommand,
  StopwatchControl,
  StopwatchRun,
  StopwatchView,
} from '@/state/exerciseStopwatch';
import { KeepAwakeTag, isExerciseStopwatchRunning } from '@/state/keepAwake';
import { KeepScreenAwake } from './KeepScreenAwake';
import { vibrateAtZero, vibrateForMinute } from './minuteVibration';
import {
  playMinuteMilestoneSound,
  playStopwatchZeroSound,
} from './timerSoundPlayer';

/** Comfortably over the 44pt minimum touch target, icon included. */
const CONTROL_SIZE = 48;
const CONTROL_ICON_SIZE = 36;

interface ExerciseStopwatchProps {
  /**
   * Identity of this run (see makeStopwatchKey). A change resets the stopwatch;
   * undefined switches it off entirely.
   */
  stopwatchKey: string | undefined;
  /** False while the session is paused: the clock freezes and stays silent. */
  running: boolean;
  /**
   * The entry's target duration, seconds. A positive value switches the card
   * into a countdown (see `@/state/exerciseStopwatch`); 0 or undefined keeps
   * the plain count-up stopwatch, minute vibrations included.
   */
  targetDurationSeconds?: number;
  /** Injected so the one side effect stays swappable and isolated. */
  onMinute?: () => void;
  /**
   * Fires once, in countdown mode only, on the advance where the run reaches
   * 0:00 on its own — never on a manual Stop. Injected for the same reason as
   * `onMinute`.
   */
  onZero?: () => void;
  /**
   * The stop button's recorded exercise time, in whole seconds — or, in
   * countdown mode, the target once the run reaches 0:00 on its own, which
   * behaves exactly like pressing Stop. Fires at most once per run — the
   * caller writes it into the Duration field, which Log Set then records
   * through the ordinary path. A stop before the first whole second of
   * exercise time has elapsed (anywhere in the lead-in or the first running
   * second) reports nothing at all rather than a 0 that would clobber the
   * prefilled target.
   */
  onStop?: (elapsedSeconds: number) => void;
}

/**
 * Stopwatch card for duration-based exercises: a 5-second lead-in, then
 * either elapsed exercise time counting up (no target) or a countdown from
 * the target (positive `targetDurationSeconds`), with its own pause and stop
 * controls. Count-up mode vibrates at each full minute; countdown mode
 * vibrates once, at 0:00, and then halts there.
 *
 * Display and feedback only — it dispatches no engine events and makes no
 * session-flow decisions. Its pause is the card's own and is *not* the session
 * pause in the header; the two compose, and the pure module owns that. All of
 * the logic lives in `@/state/exerciseStopwatch` (jest covers src/state, not
 * src/components); this component only owns the interval, the run reference,
 * and the markup.
 *
 * The interval exists purely to re-render: every value comes from
 * `advanceStopwatch` recomputing against `Date.now()`, so a suspended timer or
 * a backgrounded app resyncs to true elapsed time on the next tick instead of
 * drifting.
 */
/**
 * Combined default for minute milestone: buzz + sound.
 */
function defaultOnMinute() {
  vibrateForMinute();
  playMinuteMilestoneSound().catch(() => {
    // Sound failures are logged by the sound module; ignore here
  });
}

/**
 * Combined default for countdown zero: buzz + sound.
 */
function defaultOnZero() {
  vibrateAtZero();
  playStopwatchZeroSound().catch(() => {
    // Sound failures are logged by the sound module; ignore here
  });
}

export function ExerciseStopwatch({
  stopwatchKey,
  running,
  targetDurationSeconds,
  onMinute = defaultOnMinute,
  onZero = defaultOnZero,
  onStop,
}: ExerciseStopwatchProps) {
  const theme = useTheme();
  const runRef = useRef<StopwatchRun | undefined>(undefined);
  const [view, setView] = useState<StopwatchView | undefined>(undefined);
  // Mirrors the run's latched control position purely so the effect below can
  // depend on it: a local pause or stop must tear the interval down, and the
  // run itself lives in a ref the effect cannot watch. Primitive, so an
  // unchanged value bails out instead of re-rendering.
  const [control, setControl] = useState<StopwatchControl>('running');

  // The parent recreates its callbacks every render (the presenter is rebuilt
  // each time), so keep the alerts in refs: the interval must not be torn down
  // and re-armed on every parent render. Written in a layout effect since the
  // tick that reads them is also layout-timed — and this effect must stay
  // declared before the tick effect below (layout effects run in hook order,
  // which is what guarantees the commit-time tick reads fresh callbacks).
  const onMinuteRef = useRef(onMinute);
  const onZeroRef = useRef(onZero);
  const onStopRef = useRef(onStop);
  useLayoutEffect(() => {
    onMinuteRef.current = onMinute;
    onZeroRef.current = onZero;
    onStopRef.current = onStop;
  });

  // A button press is a one-shot input: parked here, consumed by the very next
  // advance, and cleared. That is what makes the recorded duration fire exactly
  // once — every ordinary tick carries no command.
  const pendingCommandRef = useRef<StopwatchCommand | undefined>(undefined);
  // The tick closes over the current props, so it is rebuilt by the effect; a
  // press has to run *that* tick immediately rather than wait out the interval.
  const tickRef = useRef<() => void>(() => {});

  // #312: one boolean, two consumers — the interval below and the keep-awake
  // mount in the markup. Both pauses (the session's `running` and the card's
  // own `control`) release the screen, because a frozen clock has no claim on
  // it. Re-spelling this condition in either place is how the lock outlives the
  // clock and the phone stops sleeping until the app is killed.
  const stopwatchRunning = isExerciseStopwatchRunning({ stopwatchKey, running, control });

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
      const command = pendingCommandRef.current;
      pendingCommandRef.current = undefined;

      const result = advanceStopwatch(runRef.current, {
        key: stopwatchKey,
        running,
        nowMs: Date.now(),
        command,
        targetDurationSeconds,
      });
      runRef.current = result.run;
      setView(result.view);
      setControl(result.run?.control ?? 'running');
      // The pure module latches milestones, so this fires once per minute even
      // if ticks arrive late, bunched, or after a long background gap. Never
      // fires in countdown mode — vibrateAtZero below takes its place.
      if (result.vibrateAtMinute !== undefined) onMinuteRef.current();
      // Countdown mode's single end-of-time buzz, latched the same way: fires
      // on the one advance the run reaches 0:00 on its own, never on a manual
      // Stop and never again afterwards.
      if (result.vibrateAtZero) onZeroRef.current();
      // Latched the same way: only the advance that carried the stop reports a
      // duration, so a late tick can never rewrite the field.
      if (result.recordedSeconds !== undefined) onStopRef.current?.(result.recordedSeconds);
    };
    tickRef.current = tick;

    // Tick immediately, then set up interval if the clock is actually moving.
    tick();

    // Nothing to animate while switched off, or frozen by either pause, or
    // stopped; the state is static until one of the deps changes and re-runs
    // this effect.
    if (!stopwatchRunning) return;

    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [stopwatchKey, running, control, targetDurationSeconds, stopwatchRunning]);

  const send = (command: StopwatchCommand) => {
    pendingCommandRef.current = command;
    tickRef.current();
  };

  if (!view) return null;

  const isResumeAction = view.isLocallyPaused;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: view.isStopped ? theme.backgroundSelected : theme.backgroundElement },
      ]}
    >
      {/*
        #312: renders nothing; mounting is what holds the idle timer open, and
        unmounting — a stop, either pause, or this card going away — releases it.
      */}
      {stopwatchRunning && <KeepScreenAwake tag={KeepAwakeTag.exerciseStopwatch} />}
      <ThemedText type="smallBold" themeColor="textSecondary">
        {view.label}
      </ThemedText>
      <ThemedText
        style={[styles.clock, view.isFrozen && !view.isStopped && styles.clockFrozen]}
      >
        {view.display}
      </ThemedText>

      {(view.canPause || view.canStop) && (
        <View style={styles.controls}>
          {view.canPause && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isResumeAction ? 'Resume stopwatch' : 'Pause stopwatch'}
              hitSlop={Spacing.two}
              style={styles.control}
              onPress={() => send(isResumeAction ? 'resume' : 'pause')}
            >
              <SymbolView
                name={isResumeAction ? 'play.circle.fill' : 'pause.circle.fill'}
                size={CONTROL_ICON_SIZE}
                tintColor={theme.text}
                fallback={
                  <ThemedText style={styles.controlFallback}>
                    {isResumeAction ? '▶' : '⏸'}
                  </ThemedText>
                }
              />
            </Pressable>
          )}

          {view.canStop && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop stopwatch and record the duration"
              hitSlop={Spacing.two}
              style={styles.control}
              onPress={() => send('stop')}
            >
              <SymbolView
                name="stop.circle.fill"
                size={CONTROL_ICON_SIZE}
                tintColor={STOP_TINT}
                fallback={<ThemedText style={styles.controlFallback}>⏹</ThemedText>}
              />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** The one destructive-ish control on the card, and the same red as elsewhere. */
const STOP_TINT = '#FF3B30';

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
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  control: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlFallback: {
    fontSize: 28,
    lineHeight: CONTROL_ICON_SIZE,
  },
});
