import { createTimerSoundExecutor, TimerSoundAPIs, SoundConfig, SoundInstance } from '@/state/timerSounds';

/**
 * Default sound player implementation for timer completion sounds.
 *
 * On iOS, the mute switch (hardware silent switch) is respected by default,
 * so sounds won't play if the phone is in silent mode. This is intentional:
 * a workout app should respect the user's explicit silent mode choice.
 *
 * Status: The injectable architecture is in place. The default implementation
 * is a stub that logs completion. Real sound playback requires either:
 * - Pre-recorded asset files (recommended)
 * - Audio synthesis via expo-audio's Buffer API
 * See inbox for details and next steps.
 */

/**
 * Stub sound instance for testing and MVP.
 * A real implementation would load and play audio via expo-audio.
 */
class StubSoundInstance implements SoundInstance {
  async loadAsync(): Promise<void> {
    // Stub: pretend to load
  }

  async playAsync(): Promise<void> {
    // Stub: pretend to play
  }

  async unloadAsync(): Promise<void> {
    // Stub: pretend to unload
  }
}

/**
 * Create the default sound implementation for the app.
 *
 * This connects to the injectable TimerSoundAPIs interface,
 * allowing the pure timerSounds module to trigger sounds.
 * The default implementation is a stub; see inbox for production implementation.
 */
export function createDefaultTimerSoundAPIs(): TimerSoundAPIs {
  return {
    createSoundInstance(_config: SoundConfig): SoundInstance {
      return new StubSoundInstance();
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
