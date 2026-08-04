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
 * How many beeps a given timer event emits. This is the whole of a pattern's
 * identity — nothing else differs between them.
 */
export interface SoundConfig {
  beepCount: number;
}

/**
 * Injected dependencies for sound playback.
 * In tests, this is mocked. In the component, it's created from expo-audio.
 */
export interface TimerSoundAPIs {
  /**
   * Prepare for playback once per sequence. In the component, this initializes the audio mode.
   * In tests, this is mocked. Must be awaited before playOne() is called in a sequence
   * to ensure fail-fast behavior and avoid moving setup into the per-beep path.
   */
  prepare(): Promise<void>;

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
 * This is the core beep-loop logic, decoupled from audio playback by using
 * injected `playOne()` and `delay()` for timing and sound. Lives here (not in
 * components) so it can be tested with mocked dependencies in the jest node project.
 *
 * Each beep is ~100ms (defined by the beep.wav asset) and `play()` is non-blocking,
 * so the 150ms delay is the whole beep-to-beep *interval* — the audible gap is the
 * ~50ms remainder, not 150ms.
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
 *
 * Every pattern shares one prepared player (see playBeepSequence's note on the
 * cached instance) — `prepare()` runs once per *sequence*, never per beep, and
 * the beep count is the only thing that varies between patterns.
 */
export function createTimerSoundExecutor(apis: TimerSoundAPIs): TimerSoundExecutor {
  /**
   * Internal helper to safely play a sound with a given configuration.
   * Calls playBeepSequence to emit the beep loop with injected apis.
   */
  async function playSound(config: SoundConfig, context: string): Promise<void> {
    try {
      // I1 Fix: Prepare once per sequence, before the beep loop
      await apis.prepare();
      // M9 Fix: Wrap methods to preserve their `this` context (safe for future implementations that use `this`)
      // Play the beep sequence with the configured beep count
      await playBeepSequence(
        config.beepCount,
        () => apis.playOne(),
        (ms) => apis.delay(ms),
        (msg, err) => apis.recordWarning(msg, err)
      );
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
