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
 * Configuration for creating a sound instance with a beep sequence.
 * Specifies the exact number of beeps to play in the sequence.
 */
export interface SoundConfig {
  beepCount: number;
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
   * Play a single beep. In the component, this wraps the cached ExpoAudioSoundInstance.
   * In tests, this is mocked to track beep invocations.
   */
  playOne(): Promise<void>;

  /**
   * Delay for a specified duration (milliseconds). In the component, this wraps setTimeout.
   * In tests, this is mocked.
   */
  delay(durationMs: number): Promise<void>;

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
 * Play a sequence of beeps with brief silence between them.
 *
 * This is the core beep-loop logic, pure relative to audio playback but depending
 * on injected `playOne()` and `delay()` for timing and sound. Lives here (not in
 * components) so it can be tested with mocked dependencies in the jest node project.
 *
 * Each beep is ~100ms (defined by the beep.wav asset), with ~150ms gap between beeps
 * to allow audio to complete and create distinct rhythm.
 *
 * Note: All sequences share a single cached player (beepSound in timerSoundPlayer),
 * so concurrent sequences would interfere (both calling seekTo/play on the same player).
 * This is not reachable today — src/state/exerciseStopwatch.ts makes vibrateAtMinute
 * and vibrateAtZero mutually exclusive by construction (countdown never emits minute,
 * count-up never emits zero) — but worth documenting as a constraint for future changes.
 *
 * @param beepCount - number of beeps to play (2, 3, or 4)
 * @param playOne - injected function to play a single beep
 * @param delay - injected function to delay for a given duration (ms)
 * @param recordWarning - optional injected function to log warnings (defaults to no-op in pure context)
 */
export async function playBeepSequence(
  beepCount: number,
  playOne: () => Promise<void>,
  delay: (durationMs: number) => Promise<void>,
  recordWarning?: (message: string, error: Error) => void
): Promise<void> {
  for (let i = 0; i < beepCount; i++) {
    try {
      await playOne();
    } catch (error) {
      if (recordWarning) {
        recordWarning(`Failed to play beep ${i + 1}/${beepCount}:`, error as Error);
      }
    }

    // Brief delay before next beep (beep duration ~100ms + gap ~50ms = 150ms total)
    // No delay after the last beep
    if (i < beepCount - 1) {
      await delay(150);
    }
  }
}

/**
 * Create a timer sound executor with injected audio APIs.
 * C3/C4 Note: Creates fresh sound instances for each pattern (not cached across patterns).
 * The underlying audio player (beepSound in timerSoundPlayer) is cached for efficiency.
 */
export function createTimerSoundExecutor(apis: TimerSoundAPIs): TimerSoundExecutor {
  /**
   * Internal helper to safely play a sound with a given configuration.
   * Uses the injected playBeepSequence to emit the beep loop.
   */
  async function playSound(config: SoundConfig, context: string): Promise<void> {
    try {
      // Play the beep sequence with the configured beep count
      await playBeepSequence(config.beepCount, apis.playOne, apis.delay, apis.recordWarning);
    } catch (error) {
      apis.recordWarning(`Failed to play ${context} sound:`, error as Error);
    }
  }

  return {
    async playMinuteMilestone() {
      await playSound(
        {
          beepCount: 2,
        },
        'minute milestone'
      );
    },

    async playStopwatchZero() {
      await playSound(
        {
          beepCount: 3,
        },
        'stopwatch zero'
      );
    },

    async playRestComplete() {
      await playSound(
        {
          beepCount: 4,
        },
        'rest complete'
      );
    },
  };
}
