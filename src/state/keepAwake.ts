// pattern: Functional Core
import type { StopwatchControl } from './exerciseStopwatch';

/**
 * Screen keep-awake decisions for the workout timers (#312).
 *
 * The rule is deliberately narrow: the screen stays lit only while a timer is
 * *actually counting*, never merely because a session is open. Each predicate
 * here reproduces exactly the condition under which its component arms its tick
 * interval, and each component then uses the one boolean it returns for both
 * the interval and the keep-awake mount. Two consequences worth stating,
 * because they are the whole point of the design:
 *
 * - The lock can never outlive the clock. A leaked keep-awake — one that is
 *   never released — means the phone will not sleep again until the app is
 *   killed, and it is invisible in every test this repo can run. Deriving both
 *   from one value makes the leak structurally impossible rather than merely
 *   unlikely.
 * - Pausing releases the screen. A paused rest or a paused stopwatch is not
 *   counting, so there is nothing for the user to watch.
 *
 * These are pure so they can live in the node jest project; the components in
 * `src/components` have no test coverage of their own (AGENTS.md, "Testing
 * gotchas"), so putting the decision anywhere else would leave it unverified.
 */

/**
 * One tag per timing surface.
 *
 * expo-keep-awake matches activate/deactivate by tag string, so two surfaces
 * sharing a tag would let whichever released first drop the other's lock — a
 * stopwatch being stopped mid-rest would let the screen sleep on a running
 * countdown. Distinct tags keep the two independent.
 */
export const KeepAwakeTag = {
  restCountdown: 'hmb-rest-countdown',
  exerciseStopwatch: 'hmb-exercise-stopwatch',
} as const;

export type KeepAwakeTagValue = (typeof KeepAwakeTag)[keyof typeof KeepAwakeTag];

export interface RestTimerRunningInput {
  /** Active rest deadline. Absent while paused, unset, or between rests. */
  deadlineMs: number | undefined;
  /** True while the engine has frozen the remainder. */
  isPaused: boolean;
}

/**
 * True while a rest countdown is genuinely ticking down.
 *
 * The `0` case is not defensive padding: `fromRillState` re-sentinelizes an
 * absent `restDeadlineMs` to `0` on the way out of the engine (AGENTS.md,
 * engine convention 8), so a plain `!= null` check would read "no rest" as a
 * deadline at the Unix epoch, report the timer as running, and hold the screen
 * awake for the rest of the app's life.
 */
export function isRestTimerRunning({ deadlineMs, isPaused }: RestTimerRunningInput): boolean {
  if (isPaused) return false;
  return deadlineMs !== undefined && deadlineMs !== 0;
}

export interface ExerciseStopwatchRunningInput {
  /** Identity of the current run; undefined switches the card off entirely. */
  stopwatchKey: string | undefined;
  /** False while the *session* pause freezes the clock. */
  running: boolean;
  /** The card's own latched control position, which composes with the above. */
  control: StopwatchControl;
}

/**
 * True while an exercise stopwatch is genuinely advancing.
 *
 * Both pauses have to be clear: the session-level pause (`running`) and the
 * card's own pause/stop (`control`). Either one freezes the display, and a
 * frozen display has no claim on the screen.
 */
export function isExerciseStopwatchRunning({
  stopwatchKey,
  running,
  control,
}: ExerciseStopwatchRunningInput): boolean {
  return stopwatchKey !== undefined && running && control === 'running';
}
