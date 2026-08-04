import { createAudioPlayer, type AudioPlayer, setAudioModeAsync } from 'expo-audio';
import {
  createTimerSoundExecutor,
  TimerSoundAPIs,
  TimerSoundExecutor,
} from '@/state/timerSounds';

/**
 * Default sound player implementation for timer completion sounds using expo-audio SDK 57.
 *
 * On iOS, the mute switch (hardware silent switch) is respected by default,
 * so sounds won't play if the phone is in silent mode. This is intentional:
 * a workout app should respect the user's explicit silent mode choice.
 *
 * Audio is loaded from pre-recorded assets in assets/sounds/beep.wav.
 * M5: Asset provenance - beep.wav is a synthesized 100ms sine-wave tone with no
 * external licensing concerns.
 *
 * Each timer event plays the beep multiple times with brief pauses between
 * to create distinct auditory patterns:
 * - Minute milestone: 2 beeps
 * - Countdown zero: 3 beeps
 * - Rest complete: 4 beeps
 *
 * Uses the expo-audio SDK 57 AudioPlayer API (createAudioPlayer factory function).
 * Replay requires seekTo(0) before play() to reset the playhead after the first beep.
 */

/**
 * Wrapper around expo-audio's AudioPlayer.
 * Used internally to cache and replay a single beep sound.
 */
class ExpoAudioSoundInstance {
  private player: AudioPlayer;

  constructor() {
    // Create an AudioPlayer with the beep asset using the factory function
    // The require() call bundles the asset at build time
    this.player = createAudioPlayer(require('@/assets/sounds/beep.wav'));
  }

  async playAsync(): Promise<void> {
    // C2 Fix: Seek to start before playing. The AudioPlayer's playhead stays at
    // the end after the first play() call; subsequent play() calls on a finished
    // player are silent no-ops. Seeking resets the playhead for the next beep.
    // Reference: Expo SDK 57 AudioPlayer.seekTo(seconds: number) — note the unit is
    // SECONDS, not milliseconds (expo-audio/build/AudioModule.types.d.ts). Immaterial at
    // 0, but any future nonzero value read as ms would seek 1000x too far.
    await this.player.seekTo(0);
    this.player.play();
  }
}

/**
 * Create the default sound implementation for the app.
 *
 * This connects to the injectable TimerSoundAPIs interface,
 * allowing the pure timerSounds module to trigger sounds.
 * Uses expo-audio to load and play the beep sound with timing
 * to create distinct patterns for different timer events.
 */
export function createDefaultTimerSoundAPIs(): TimerSoundAPIs {
  // Cache a single beep sound instance; reuse for all patterns (C4 optimization)
  let beepSound: ExpoAudioSoundInstance | null = null;

  // I1 Fix: Lazy-initialize audio mode on first playback (not at module scope).
  // This avoids setting a global iOS audio session before the user opens a workout.
  //
  // The promise is memoized rather than guarded by a boolean: the mode must actually be
  // in effect *before* the first beep plays, and a bare `if (done) return` lets a second
  // caller past while the first setAudioModeAsync is still in flight. Every caller awaits
  // the same promise, so the very first sound of the process can't play under iOS's default
  // soloAmbient session and interrupt the user's music — which is the whole point of
  // interruptionMode: 'mixWithOthers'. Rejection is absorbed here, so the memoized promise
  // always resolves and a failed init degrades to "mode not set", never to a thrown beep.
  //
  // Awaiting here is safe only because the sound path is fire-and-forget from the engine's
  // side (see RestCountdown's C1 fix): it can never delay onRestElapsed, which is traceable
  // rather than conventional — playRestCompleteSound suspends at its first await before any
  // native call, so the dispatch has already run by then.
  //
  // Be precise about the cost, because memoizing changed it: a setAudioModeAsync that never
  // settles leaves this promise pending forever, so *every* beep for the rest of the process
  // is lost — not just the first sequence, which is what the boolean guard this replaced
  // would have cost. That trade is deliberate. An unsettling native promise is speculative;
  // the concurrent-caller race the boolean allowed was real and reachable. Both failure
  // modes are silent and confined to a non-essential channel, so the likelier one wins.
  let audioModePromise: Promise<void> | null = null;
  function initializeAudioMode(): Promise<void> {
    if (!audioModePromise) {
      // I1 Fix: Make the deferral structural to ensure the native call doesn't happen
      // synchronously. This ensures the invariant that suspends at the first await
      // before any native call.
      audioModePromise = Promise.resolve()
        .then(() =>
          setAudioModeAsync({
            playsInSilentMode: true,
            interruptionMode: 'mixWithOthers',
          })
        )
        .catch((error: unknown) => {
          console.warn('Failed to set audio mode:', error);
        });
    }
    return audioModePromise;
  }

  return {
    async prepare(): Promise<void> {
      // Called once per sequence, before the beep loop. The audio-mode work itself
      // happens once per *process* — initializeAudioMode memoises its promise, so
      // every later call awaits the already-settled one.
      await initializeAudioMode();

      // Load once and cache the sound instance
      if (!beepSound) {
        beepSound = new ExpoAudioSoundInstance();
      }
    },

    async playOne(): Promise<void> {
      // Play a single beep
      await beepSound!.playAsync();
    },

    async delay(durationMs: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, durationMs));
    },

    recordWarning(message: string, error: Error): void {
      console.warn(message, error);
    },
  };
}

/**
 * Create the timer sound executor with the default (expo-audio) implementation.
 *
 * File-internal: the only caller is getDefaultExecutor below. It used to claim it was
 * "used as the default for component props", which was never true — ExerciseStopwatch
 * defaults to defaultOnMinute/defaultOnZero, and RestCountdown imports
 * playRestCompleteSound directly. Kept as a named factory rather than inlined only
 * because it names the APIs-to-executor seam that createDefaultTimerSoundAPIs exists
 * to serve.
 */
function createDefaultTimerSoundExecutor() {
  return createTimerSoundExecutor(createDefaultTimerSoundAPIs());
}

// C4 Fix: Lazy-initialize executor so all three sound functions share
// the same cached beepSound instance. This eliminates the memory leak of
// creating a new executor (and new player) for each sound pattern.
// Initialization is deferred until first playback (via createDefaultTimerSoundAPIs).
let defaultExecutor: TimerSoundExecutor | null = null;
function getDefaultExecutor(): TimerSoundExecutor {
  if (!defaultExecutor) {
    defaultExecutor = createDefaultTimerSoundExecutor();
  }
  return defaultExecutor;
}

// Export the three main functions for component injection
export async function playMinuteMilestoneSound(): Promise<void> {
  return getDefaultExecutor().playMinuteMilestone();
}

export async function playStopwatchZeroSound(): Promise<void> {
  return getDefaultExecutor().playStopwatchZero();
}

export async function playRestCompleteSound(): Promise<void> {
  return getDefaultExecutor().playRestComplete();
}
