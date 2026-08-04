import { createAudioPlayer, type AudioPlayer, setAudioModeAsync } from 'expo-audio';
import { createTimerSoundExecutor, TimerSoundAPIs, SoundConfig, SoundInstance } from '@/state/timerSounds';

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
 * Wrapper around expo-audio's AudioPlayer that implements SoundInstance.
 */
class ExpoAudioSoundInstance implements SoundInstance {
  private player: AudioPlayer;

  constructor() {
    // Create an AudioPlayer with the beep asset using the factory function
    // The require() call bundles the asset at build time
    this.player = createAudioPlayer(require('@/assets/sounds/beep.wav'));
  }

  async loadAsync(): Promise<void> {
    // AudioPlayer loads the source automatically on construction
    // This is a no-op in the new API
  }

  async playAsync(): Promise<void> {
    // C2 Fix: Seek to start before playing. The AudioPlayer's playhead stays at
    // the end after the first play() call; subsequent play() calls on a finished
    // player are silent no-ops. Seeking resets the playhead for the next beep.
    // Reference: Expo SDK 57 AudioPlayer.seekTo(ms) documented behavior.
    await this.player.seekTo(0);
    this.player.play();
  }

  async unloadAsync(): Promise<void> {
    // Release the player when done (not remove() which is for SharedObject escape)
    this.player.release();
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
  // I1 Fix: Configure audio session to mix with other apps' audio.
  // By default, iOS uses soloAmbient which interrupts other audio (e.g., Spotify).
  // We respect the mute switch (playsInSilentMode: false) but allow mixing so
  // beeps don't interrupt the user's music in the gym.
  // This is a fire-and-forget initialization; failures are logged and swallowed.
  setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
  }).catch((error: unknown) => {
    console.warn('Failed to set audio mode:', error);
  });

  // Cache a single beep sound instance; reuse for all patterns (C4 optimization)
  let beepSound: ExpoAudioSoundInstance | null = null;

  /**
   * Play a sequence of beeps with brief silence between them.
   * Each beep is ~100ms, with ~150ms between beeps to allow audio to complete
   * and create a distinct rhythm.
   */
  async function playBeepSequence(beepCount: number): Promise<void> {
    // Load once and cache the sound instance
    if (!beepSound) {
      beepSound = new ExpoAudioSoundInstance();
      await beepSound.loadAsync();
    }

    // Play the beep sequence with natural timing
    for (let i = 0; i < beepCount; i++) {
      try {
        // Each call to playAsync() plays the beep
        await beepSound.playAsync();
      } catch (error) {
        // Log but continue - a single beep failure shouldn't stop the sequence
        console.warn(`Failed to play beep ${i + 1}/${beepCount}:`, error as Error);
      }

      // Brief delay before next beep (beep duration ~100ms + gap ~50ms)
      if (i < beepCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  return {
    createSoundInstance(config: SoundConfig): SoundInstance {
      // C3 Fix: Capture config and read beepCount at play time, not creation time.
      // This ensures different patterns (2/3/4 beeps) all share the same cached
      // beepSound instance but each pattern produces the correct number of beeps.
      // If we read config.tones.length at creation time, only the first pattern
      // to call this method would be cached; subsequent patterns would reuse
      // the first pattern's beep count. Reading at play time fixes this.

      // Return a wrapper that plays the appropriate beep sequence
      return {
        async loadAsync() {
          // Pre-loading is handled on first playAsync call
        },

        async playAsync() {
          // Read beep count at play time from the captured config.
          // This allows different patterns to reuse the same cached beepSound
          // while each producing the correct sequence.
          const beepCount = config.tones.length;
          await playBeepSequence(beepCount);
        },

        async unloadAsync() {
          // Sound is cached for reuse; unloading is deferred until app close
        },
      };
    },

    recordWarning(message: string, error: Error): void {
      console.warn(message, error);
    },
  };
}

/**
 * Create the timer sound executor with default implementation.
 * Used as the default for component props.
 */
export function createDefaultTimerSoundExecutor() {
  return createTimerSoundExecutor(createDefaultTimerSoundAPIs());
}

// C4 Fix: Hoist executor to module scope so all three sound functions share
// the same cached beepSound instance. This eliminates the memory leak of
// creating a new executor (and new player) for each sound pattern.
// With C3 fixed (beepCount read at play time), one executor handles all patterns.
const defaultExecutor = createDefaultTimerSoundExecutor();

// Export the three main functions for component injection
export async function playMinuteMilestoneSound(): Promise<void> {
  return defaultExecutor.playMinuteMilestone();
}

export async function playStopwatchZeroSound(): Promise<void> {
  return defaultExecutor.playStopwatchZero();
}

export async function playRestCompleteSound(): Promise<void> {
  return defaultExecutor.playRestComplete();
}
