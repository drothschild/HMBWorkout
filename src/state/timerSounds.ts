/**
 * Timer sound effects for exercise stopwatch and rest countdown.
 *
 * This pure module generates distinct sound patterns for different timer events:
 * - Minute milestone (count-up stopwatch): two short beeps
 * - Countdown completion (0:00 on countdown stopwatch): three longer beeps
 * - Rest period complete: four beeps for emphasis
 *
 * The implementation is injected via TimerSoundAPIs so it's testable in jest
 * (which has no audio runtime). Component code injects the real expo-audio
 * implementation by default.
 *
 * Failures are logged and swallowed following the src/health convention —
 * a failed sound must never interrupt the workout or take down the app.
 */

/**
 * A tone description for sound generation.
 */
export interface Tone {
  /** Frequency in Hz (e.g., 800 for a standard notification beep) */
  frequency: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Configuration for creating a sound instance with tone sequences.
 */
export interface SoundConfig {
  tones: Tone[];
}

/**
 * A playable sound instance — typically wraps expo-audio's Sound class.
 */
export interface SoundInstance {
  loadAsync(): Promise<void>;
  playAsync(): Promise<void>;
  unloadAsync(): Promise<void>;
}

/**
 * Injected dependencies for sound playback.
 * In tests, this is mocked. In the component, it's created from expo-audio.
 */
export interface TimerSoundAPIs {
  /**
   * Create a sound instance configured to play the given tone sequence.
   * The sound should be loadable and playable immediately after creation.
   */
  createSoundInstance(config: SoundConfig): SoundInstance;

  /**
   * Record a warning-level message. In tests, this is mocked. In production,
   * this delegates to console.warn.
   */
  recordWarning(message: string, error: Error): void;
}

/**
 * Interface for the timer sound executor.
 */
export interface TimerSoundExecutor {
  /** Play sound for a one-minute milestone in a timed exercise (count-up mode). */
  playMinuteMilestone(): Promise<void>;

  /** Play sound when a countdown exercise reaches 0:00 (countdown mode). */
  playStopwatchZero(): Promise<void>;

  /** Play sound when a rest period completes. */
  playRestComplete(): Promise<void>;
}

/**
 * Create a timer sound executor with injected audio APIs.
 * The executor caches a single sound instance and reuses it for all playback.
 */
export function createTimerSoundExecutor(apis: TimerSoundAPIs): TimerSoundExecutor {
  let soundInstance: SoundInstance | null = null;

  /**
   * Internal helper to safely play a sound with a given configuration.
   * Loads the sound once and caches it; subsequent calls reuse the instance.
   */
  async function playSound(config: SoundConfig, context: string): Promise<void> {
    try {
      // Create and cache the sound instance on first use
      if (!soundInstance) {
        soundInstance = apis.createSoundInstance(config);
        await soundInstance.loadAsync();
      }

      // Play the cached sound
      await soundInstance.playAsync();
    } catch (error) {
      apis.recordWarning(`Failed to play ${context} sound:`, error as Error);
    }
  }

  return {
    async playMinuteMilestone() {
      await playSound(
        {
          tones: [
            { frequency: 800, durationMs: 100 },
            { frequency: 800, durationMs: 100 },
          ],
        },
        'minute milestone'
      );
    },

    async playStopwatchZero() {
      await playSound(
        {
          tones: [
            { frequency: 800, durationMs: 150 },
            { frequency: 800, durationMs: 150 },
            { frequency: 800, durationMs: 150 },
          ],
        },
        'stopwatch zero'
      );
    },

    async playRestComplete() {
      await playSound(
        {
          tones: [
            { frequency: 800, durationMs: 100 },
            { frequency: 800, durationMs: 100 },
            { frequency: 800, durationMs: 100 },
            { frequency: 800, durationMs: 100 },
          ],
        },
        'rest complete'
      );
    },
  };
}
