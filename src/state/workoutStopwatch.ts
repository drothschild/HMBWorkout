// pattern: Functional Core
/**
 * Workout stopwatch — pure logic for the session header's total-elapsed-time
 * display.
 *
 * Unlike `ExerciseStopwatch`/`exerciseStopwatch.ts` (a single duration-based
 * exercise's own timer, which freezes while the session is paused and resets
 * every set), these functions count up for the whole workout and never freeze
 * on their own — they always report `now - startedAtMs` for whatever `nowMs`
 * they're given, matching how `ExerciseProgress` already treats rest as part
 * of the workout rather than excluding it. (The header display *does* freeze,
 * once the session reaches `done` — that's the component choosing to stop
 * calling these functions, not a mode of the functions themselves.)
 * `SessionState` (`@/engine/types`) has no accumulated-pause-duration field —
 * only `startedAtMs` and `prePausePhase` (a sentinel for which phase to
 * resume into, not a timestamp) — so there is nothing to freeze against
 * without an engine change, which is out of scope here (see AGENTS.md's FCIS
 * boundary).
 *
 * Like `RestCountdown` and `exerciseStopwatch.ts`, time is always derived from
 * a `nowMs` delta against a stored start timestamp, never accumulated ticks:
 * a backgrounded app resyncs to true elapsed time on the next tick instead of
 * drifting. None of these functions read the clock themselves, so no mocking
 * is needed to test them.
 */

/**
 * Milliseconds elapsed since the workout started. Clamped to zero so a stray
 * `nowMs` before `startedAtMs` (device clock changes) never renders a
 * negative stopwatch.
 */
export function computeElapsedMs(startedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - startedAtMs);
}

/**
 * Whole seconds elapsed since the workout started. Floors the millisecond
 * result so only complete seconds are counted, matching the component's
 * tick-to-second-precision rounding (not rounded up). Clamped to zero.
 */
export function computeElapsedSeconds(
  startedAtMs: number,
  nowMs: number
): number {
  return Math.floor(computeElapsedMs(startedAtMs, nowMs) / 1000);
}

/**
 * Render elapsed milliseconds as `m:ss` (minutes unpadded, seconds
 * zero-padded), matching `RestCountdown` and `exerciseStopwatch.ts` so every
 * timer on the session screen reads alike — with one difference: total
 * workout time is not bounded to under an hour the way a rest period or a
 * single exercise's set is, so once elapsed time reaches an hour this rolls
 * over to `h:mm:ss` (minutes then also zero-padded) rather than printing
 * unbroken double- or triple-digit minutes.
 */
export function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;

  if (hours > 0) {
    const paddedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
