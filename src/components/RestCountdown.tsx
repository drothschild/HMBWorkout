import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { playRestCompleteSound } from './timerSoundPlayer';

interface RestCountdownProps {
  /** Active deadline while the timer is running (undefined when paused) */
  deadlineMs: number | undefined;
  /** Remaining time frozen by the engine while the timer is paused */
  frozenRemainingMs: number | undefined;
  isPaused: boolean;
  /** Coach comment about the upcoming exercise; absent when there is none */
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
  // M2 Fix: Initialize with null and use optional chaining on call site.
  // C1 Fix: playRestCompleteSound is fire-and-forget (no await). The engine dispatch
  // must not wait on audio: if the sound promise hangs, onRestElapsed never fires
  // and the workout is stranded at 0:00. Match ExerciseStopwatch's pattern.
  const onRestElapsedRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onRestElapsedRef.current = () => {
      playRestCompleteSound().catch(() => {
        // Sound failures are logged by the sound module; ignore here
      });
      onRestElapsed();
    };
  }, [onRestElapsed]);

  useEffect(() => {
    if (isPaused || !deadlineMs) return;

    let elapsedDispatched = false;
    const tick = () => {
      const remaining = Math.max(0, deadlineMs - Date.now());
      setRemainingMs(remaining);
      if (remaining <= 0 && !elapsedDispatched) {
        elapsedDispatched = true;
        onRestElapsedRef.current?.();
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
