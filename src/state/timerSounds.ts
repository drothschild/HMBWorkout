/**
 * Timer sound effects for exercise stopwatch and rest countdown.
 *
 * M3 Fix: This is an effect executor module (like src/health), not pure.
 * It orchestrates distinct sound patterns for different timer events:
 * - Minute milestone (count-up stopwatch): two beeps
 * - Countdown completion (0:00 on countdown stopwatch): three beeps
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
 * Currently a marker type for extensibility; see SoundConfig below.
 */
export type Tone = Record<string, never>;

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
 * C3/C4 Note: Creates fresh sound instances for each pattern (not cached across patterns).
 * The underlying audio player (beepSound in timerSoundPlayer) is cached for efficiency.
 */
export function createTimerSoundExecutor(apis: TimerSoundAPIs): TimerSoundExecutor {
  /**
   * Internal helper to safely play a sound with a given configuration.
   * Creates a fresh wrapper for each pattern so each pattern's config is captured correctly.
   */
  async function playSound(config: SoundConfig, context: string): Promise<void> {
    try {
      // C3 Fix: Create fresh sound instance per pattern (not cached at this level)
      // The config is captured at wrapper creation time and used to determine beepCount
      const soundInstance = apis.createSoundInstance(config);
      await soundInstance.loadAsync();

      // Play the sound with this pattern's configuration
      await soundInstance.playAsync();
    } catch (error) {
      apis.recordWarning(`Failed to play ${context} sound:`, error as Error);
    }
  }

  return {
    async playMinuteMilestone() {
      await playSound(
        {
          tones: [{}, {}],
        },
        'minute milestone'
      );
    },

    async playStopwatchZero() {
      await playSound(
        {
          tones: [{}, {}, {}],
        },
        'stopwatch zero'
      );
    },

    async playRestComplete() {
      await playSound(
        {
          tones: [{}, {}, {}, {}],
        },
        'rest complete'
      );
    },
  };
}
