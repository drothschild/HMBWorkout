import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { createTimerSoundExecutor, TimerSoundAPIs, SoundConfig, SoundInstance } from '@/state/timerSounds';

/**
 * Default sound player implementation for timer completion sounds using expo-audio SDK 57.
 *
 * On iOS, the mute switch (hardware silent switch) is respected by default,
 * so sounds won't play if the phone is in silent mode. This is intentional:
 * a workout app should respect the user's explicit silent mode choice.
 *
 * Audio is loaded from pre-recorded assets in src/assets/sounds/beep.wav.
 * Each timer event plays the beep multiple times with brief pauses between
 * to create distinct auditory patterns:
 * - Minute milestone: 2 beeps
 * - Countdown zero: 3 beeps
 * - Rest complete: 4 beeps
 *
 * Uses the expo-audio SDK 57 AudioPlayer API (createAudioPlayer factory function).
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
    // Play the sound; it will respect iOS mute switch by default
    this.player.play();
  }

  async unloadAsync(): Promise<void> {
    // Release the player when done
    await this.player.release();
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
  // Cache a single beep sound instance; reuse for all patterns
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
        console.warn(`Failed to play beep ${i + 1}/${beepCount}:`, error);
      }

      // Brief delay before next beep (beep duration ~100ms + gap ~50ms)
      if (i < beepCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  return {
    createSoundInstance(config: SoundConfig): SoundInstance {
      // Extract beep count from the tone pattern
      const beepCount = config.tones.length;

      // Return a wrapper that plays the appropriate beep sequence
      return {
        async loadAsync() {
          // Pre-loading is handled on first playAsync call
        },

        async playAsync() {
          // Play the beep sequence corresponding to the pattern
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

// Export the three main functions for component injection
export async function playMinuteMilestoneSound(): Promise<void> {
  return createDefaultTimerSoundExecutor().playMinuteMilestone();
}

export async function playStopwatchZeroSound(): Promise<void> {
  return createDefaultTimerSoundExecutor().playStopwatchZero();
}

export async function playRestCompleteSound(): Promise<void> {
  return createDefaultTimerSoundExecutor().playRestComplete();
}
