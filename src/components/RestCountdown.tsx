import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { playRestCompleteSound } from './timerSoundPlayer';
import { vibrateAtRestComplete } from './minuteVibration';

interface RestCountdownProps {
  /** Active deadline while the timer is running (undefined when paused) */
  deadlineMs: number | undefined;
  /** Remaining time frozen by the engine while the timer is paused */
  frozenRemainingMs: number | undefined;
  isPaused: boolean;
  /**
   * Coach comment about this rest: the set just completed when the rest sits
   * inside an exercise or superset group, the upcoming exercise when it sits
   * between two (#270). Absent when there is none.
   */
  commentary?: string | null;
  /**
   * True while the comment is still being fetched. Reserving the slot on this
   * (rather than on the text arriving) is what keeps the countdown and controls
   * from being shoved when it lands mid-rest.
   */
  commentaryPending?: boolean;
  /**
   * True once a request for the comment has been attempted, even if it failed.
   * Keeps the commentary slot reserved for the life of the rest, avoiding a
   * layout shift if the request fails. When no comment is coming at all — no
   * API key configured — neither pending nor attempted is set and the space is
   * given back.
   */
  commentaryAttempted?: boolean;
  onRestElapsed: () => void;
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

/**
 * Full-screen rest countdown. Renders max(0, deadline - now) while running and
 * the engine-frozen remainder while paused. The only controls are Skip and
 * Pause/Resume; at 0 it dispatches RestElapsed once. Skipping is benign — the
 * engine's SkipRest lands in the same state RestElapsed would.
 *
 * The wall-clock arithmetic is load-bearing beyond display: a deadline that
 * expires while the app is backgrounded (or the session modal is dismissed) is
 * reconciled by the first tick after resume/remount. AppForegrounded
 * (src/state/foregroundReconcile.ts) covers the same case when this screen is
 * NOT mounted; a straggler tick racing that reconcile is benign — RestElapsed
 * is Ok-no-effects in the phases recovery lands in (see AGENTS.md, engine
 * convention 5). A decrementing counter would silently break this.
 */
export function RestCountdown({
  deadlineMs,
  frozenRemainingMs,
  isPaused,
  commentary,
  commentaryPending,
  commentaryAttempted,
  onRestElapsed,
  onSkip,
  onPause,
  onResume,
}: RestCountdownProps) {
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    deadlineMs ? Math.max(0, deadlineMs - Date.now()) : 0
  );

  // I5 Fix: Keep the elapsed callback in a ref so the tick interval
  // (which has deps [deadlineMs, isPaused]) doesn't re-arm when onRestElapsed changes.
  // The ref is updated via an effect [onRestElapsed] so tick always calls the latest callback.
  //
  // Seeded with the prop rather than null, and called without `?.`, on purpose: the tick
  // latches `elapsedDispatched` *before* calling, so a null ref would swallow the dispatch
  // with the latch already set — the interval would never retry and the rest would strand
  // at 0:00. That is round 3's stranding bug reached by a different route. It cannot happen
  // today, because passive effects run in declaration order and this one is declared first,
  // but that guarantee is invisible at the call site and one plausible edit inverts it:
  // converting the tick below to useLayoutEffect — which ExerciseStopwatch already does, to
  // avoid a one-frame layout jump — would run it before this passive write, with .current
  // still null. Seeding removes the ordering dependency structurally instead of documenting
  // it, and matches ExerciseStopwatch's onMinuteRef/onZeroRef pattern exactly.
  const onRestElapsedRef = useRef(onRestElapsed);
  useEffect(() => {
    onRestElapsedRef.current = onRestElapsed;
  }, [onRestElapsed]);

  useEffect(() => {
    if (isPaused || !deadlineMs) return;

    let elapsedDispatched = false;
    const tick = () => {
      const remaining = Math.max(0, deadlineMs - Date.now());
      setRemainingMs(remaining);
      if (remaining <= 0 && !elapsedDispatched) {
        elapsedDispatched = true;
        // C1 Fix: fire-and-forget, never awaited. The engine dispatch must not wait on
        // audio — if the sound promise hangs, onRestElapsed never fires and the workout
        // is stranded at 0:00 with the latch already set. Match ExerciseStopwatch.
        // Buzz first, synchronously: it is the signal that survives a
        // silenced phone, a failed audio session, or audio routed to a
        // disconnected device. Same order as ExerciseStopwatch's
        // defaultOnMinute/defaultOnZero.
        vibrateAtRestComplete();
        playRestCompleteSound().catch(() => {
          // Sound failures are logged by the sound module; ignore here
        });
        onRestElapsedRef.current();
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadlineMs, isPaused]);

  const displayMs = isPaused ? frozenRemainingMs ?? 0 : remainingMs;

  return (
    <View style={styles.container}>
      <View style={styles.timerArea}>
        <ThemedText type="subtitle" style={styles.label}>
          {isPaused ? 'Rest Paused' : 'Rest'}
        </ThemedText>
        <ThemedText style={styles.countdown}>{formatMs(displayMs)}</ThemedText>
      </View>

      {(commentary || commentaryPending || commentaryAttempted) && (
        <View style={styles.commentary}>
          {commentary ? (
            <ThemedText type="small" style={styles.commentaryText}>
              {commentary}
            </ThemedText>
          ) : null}
        </View>
      )}

      <View style={styles.buttonGroup}>
        {isPaused ? (
          <Pressable style={[styles.button, styles.resumeButton]} onPress={onResume}>
            <ThemedText style={styles.buttonText}>Resume</ThemedText>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, styles.pauseButton]} onPress={onPause}>
            <ThemedText style={styles.buttonText}>Pause</ThemedText>
          </Pressable>
        )}
        <Pressable style={[styles.button, styles.skipButton]} onPress={onSkip}>
          <ThemedText style={styles.buttonText}>Skip</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: Spacing.three,
  },
  timerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    opacity: 0.7,
  },
  countdown: {
    fontSize: 96,
    // 108 is 5.06pt under LINE_HEIGHT_FLOOR × 96 (113.06), and that is
    // deliberate rather than an oversight. This renders `tabular-nums` digits
    // and a colon only — no descenders — so the shortfall lands in the unused
    // descent band, making it a sound element-specific exemption. Same reasoning
    // that exempts a no-descender glyph elsewhere; recorded here because a
    // ratio sweep will otherwise flag it every time. If this ever renders
    // arbitrary text, raise it to 114.
    lineHeight: 108,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
    marginTop: Spacing.two,
  },
  // Fixed height, not intrinsic: the slot is reserved the moment a comment is
  // expected, so arriving text fills space that already existed.
  commentary: {
    minHeight: 60,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.three,
  },
  commentaryText: {
    textAlign: 'center',
    opacity: 0.75,
  },
  buttonGroup: {
    gap: Spacing.two,
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: 8,
    alignItems: 'center',
  },
  pauseButton: {
    backgroundColor: ActionButtonColor.warning,
  },
  resumeButton: {
    backgroundColor: ActionButtonColor.finish,
  },
  skipButton: {
    backgroundColor: ActionButtonColor.primary,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
  },
});
