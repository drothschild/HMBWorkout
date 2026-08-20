import { RoutineEntry, RoutineSet } from '@/engine/types';

/**
 * Exercise stopwatch — pure logic for the timed-exercise clock.
 *
 * Shell-only display and feedback: this decides what the stopwatch *shows* and
 * when the phone should buzz, never what the session does next. It dispatches
 * nothing and reads no engine state directly — the caller passes it an identity
 * key, whether the session is running, and the current wall-clock time.
 *
 * Time is always derived from `nowMs` deltas against a stored start timestamp,
 * never by accumulating ticks: JS timers drift and suspend outright while the
 * app is backgrounded, so a tick count is not elapsed time. The interval in the
 * component exists only to trigger a re-render; truth is computed here.
 *
 * Two display modes share this one state machine. An entry with a positive
 * `targetDurationSeconds` runs as a countdown: after the same lead-in, the
 * running phase counts DOWN from the target, halts at 0:00 exactly once
 * (recording the target as the elapsed exercise time and firing one buzz),
 * and drops the per-minute milestones. An entry with no target (0 or absent)
 * keeps the original count-up stopwatch, milestones included. The mode is
 * decided per advance from the caller's input, not latched onto the run —
 * `targetDurationSeconds` is a property of the routine entry the key already
 * identifies, so it stays constant for the run's lifetime in practice.
 */

/** Lead-in before the clock starts, so the user can get into position. */
export const LEAD_IN_SECONDS = 5;

/**
 * Alert cadence for the count-up stopwatch: buzz once at every full minute of
 * exercise time. Countdown mode never uses this — it fires exactly one buzz,
 * at 0:00, in place of the whole cadence.
 */
export const MILESTONE_INTERVAL_SECONDS = 60;

export type StopwatchPhase = 'leadIn' | 'running' | 'stopped';

/**
 * Position of the card's own controls, latched onto the run.
 *
 * Deliberately separate from the session pause the caller passes as `running`:
 * that one belongs to the engine and can flip underneath the stopwatch, while
 * this one is the user pressing the buttons on the card. Either being away from
 * `'running'` freezes the clock, so the two compose — a session resume leaves a
 * locally paused stopwatch frozen, and vice versa.
 */
export type StopwatchControl = 'running' | 'paused' | 'stopped';

/** A single button press, applied to exactly one advance. */
export type StopwatchCommand = 'pause' | 'resume' | 'stop';

/**
 * The stopwatch's persistent state. Held by the component across renders and
 * fed back into `advanceStopwatch`; JSON-serializable, like engine state.
 */
export interface StopwatchRun {
  /** Identity of the run — see makeStopwatchKey. A change resets everything. */
  key: string;
  /**
   * Epoch ms at which the lead-in began. Shifted forward on resume so that
   * paused wall-clock time never counts as exercise time.
   */
  startedAtMs: number;
  /** Epoch ms at which the clock froze; undefined while running. */
  frozenAtMs?: number;
  /**
   * Highest minute milestone already announced (0 = none yet). This is the
   * idempotency latch: a late tick at 61.8s still owes minute 1, but a second
   * tick at 66s owes nothing.
   */
  lastMilestone: number;
  /** Where the card's own pause/stop buttons stand. Reset with the run. */
  control: StopwatchControl;
}

export interface StopwatchView {
  phase: StopwatchPhase;
  /** Whole seconds left in the lead-in (5..1); 0 once the clock is running. */
  remainingLeadInSeconds: number;
  /**
   * Whole seconds of exercise time, excluding the lead-in; 0 during it.
   * Always the true elapsed time (never the countdown remainder), and in
   * countdown mode never reports past the target — a late tick caps here
   * rather than showing overtime. This is what a manual or auto stop records.
   */
  elapsedSeconds: number;
  /**
   * Seconds left in a countdown: target minus elapsed, clamped to zero.
   * Always 0 outside countdown mode (no target, or a target of 0) — callers
   * driving the plain count-up stopwatch have no reason to read it.
   */
  remainingSeconds: number;
  /**
   * Lead-in renders as a bare count ("5"); the running clock as "m:ss" —
   * elapsed time counting up, or remaining time counting down in countdown
   * mode; a stop that recorded nothing renders "—" so the card never
   * asserts a duration it did not record.
   */
  display: string;
  /** Heading above the clock — 'Starting in', 'Elapsed', 'Remaining', 'Paused', 'Stopped'. */
  label: string;
  /** Frozen by anything at all: the session pause, the local pause, or a stop. */
  isFrozen: boolean;
  /** The card's own pause is engaged (a session pause alone does not set this). */
  isLocallyPaused: boolean;
  /** The run has been stopped; only a new set revives it. */
  isStopped: boolean;
  /** Whether to offer the pause/resume control at all. */
  canPause: boolean;
  /** Whether to offer the stop control at all. */
  canStop: boolean;
}

export interface StopwatchAdvanceInput {
  /** undefined when no timed exercise is current — the stopwatch is off. */
  key: string | undefined;
  /** false while the *session* is paused or resting: the clock freezes. */
  running: boolean;
  nowMs: number;
  /**
   * A button press to apply on this advance and this advance only. Ticks carry
   * none, which is what makes stop's recorded time fire exactly once.
   */
  command?: StopwatchCommand;
  /**
   * The routine entry's target duration, seconds. A positive value switches
   * the running phase into a countdown (see module doc); 0 or undefined keeps
   * the plain count-up stopwatch. Not part of the run's persisted state —
   * it is a property of the entry the key already identifies, so the caller
   * re-supplies it on every advance rather than it being latched at arm time.
   */
  targetDurationSeconds?: number;
}

export interface StopwatchAdvanceResult {
  run: StopwatchRun | undefined;
  view: StopwatchView | undefined;
  /**
   * The minute (1, 2, 3…) whose milestone was crossed on this advance, or
   * undefined. Fires at most once per advance and exactly once per minute.
   * Never fires in countdown mode — see `vibrateAtZero`.
   */
  vibrateAtMinute: number | undefined;
  /**
   * True on the single advance where a countdown run reaches 0:00 on its
   * own — never on a manual Stop, and never again once the run is stopped.
   * This is the one buzz a countdown run gets, replacing the per-minute
   * milestones entirely. Always false outside countdown mode.
   */
  vibrateAtZero: boolean;
  /**
   * Whole seconds of exercise time to record as the exercise's duration,
   * emitted only on the advance that processed a `stop` — a manual one, or
   * a countdown run reaching 0:00 on its own, which behaves exactly like a
   * stop and records the target. Every other advance — including a late
   * tick, a replayed one, or a second stop — reports undefined, so the
   * Duration field is written once and stays the user's.
   */
  recordedSeconds: number | undefined;
}

/**
 * Duration-based entries are the ones that get a stopwatch.
 *
 * `kind` alone is not a reliable signal (#319): a hand-authored or
 * AI-drafted exercise can carry `kind: 'strength'` while every one of its
 * planned sets has only a duration and no reps at all — "High Plank" on a
 * real device is exactly this shape. Trusting `kind` there left the set
 * logger showing empty Reps/Weight inputs with nothing to type into either.
 *
 * `stretch`/`cardio` still short-circuit to true regardless of the planned
 * set — that part of the signal was never wrong. For every other `kind`,
 * `plannedSet` — the entry's set at the CURRENT `setIndex`, the same one
 * `computeSetPrefill`'s reps/duration guards read — decides: a positive
 * `durationSeconds` with no positive `reps` means the plan itself is
 * unambiguously duration-only, so the UI follows the plan rather than the
 * exercise's own (possibly mismatched) classification. A set with both reps
 * and a duration reads as strength-with-a-hold, not duration-based — reps is
 * the more specific signal. `RoutineSet`'s optional fields are NOT in
 * SENTINEL_TO_OPTION_MAP (engine convention 8; see the type's own docstring),
 * so absence is read with `!= null`, not a bare falsy check.
 */
export function isDurationBasedEntry(
  entry: RoutineEntry | undefined,
  plannedSet: RoutineSet | undefined
): boolean {
  if (!entry) return false;
  if (entry.kind === 'stretch' || entry.kind === 'cardio') return true;
  const hasReps = plannedSet?.reps != null && plannedSet.reps > 0;
  const hasDuration = plannedSet?.durationSeconds != null && plannedSet.durationSeconds > 0;
  return hasDuration && !hasReps;
}

/**
 * Identity of one stopwatch run: the current entry plus its set position.
 * The engine advances `setIndex` on every LogSet and SkipSet, so the set
 * position changing *is* the "a set was logged" signal — the caller does not
 * have to detect it. Warmup and working sets are namespaced apart because both
 * segments count from 1.
 *
 * `plannedSet` is the entry's set at the current `setIndex` — see
 * `isDurationBasedEntry`, which this defers to. Returns undefined for
 * entries that are not duration-based, which switches the stopwatch off
 * entirely.
 */
export function makeStopwatchKey(
  entry: RoutineEntry | undefined,
  plannedSet: RoutineSet | undefined,
  position: { isWarmupSet: boolean; setNumber: number }
): string | undefined {
  if (!entry || !isDurationBasedEntry(entry, plannedSet)) return undefined;
  return `${entry.idx}:${position.isWarmupSet ? 'w' : 's'}${position.setNumber}`;
}

/**
 * Render whole seconds as `m:ss`. Minutes stay unpadded and seconds are padded,
 * matching RestCountdown so both timers on the session screen read alike.
 */
export function formatStopwatchDisplay(elapsedSeconds: number): string {
  const total = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

/**
 * Apply one button press to the run's latched control position.
 *
 * Stop is terminal — pause and resume are no-ops afterwards, because reviving a
 * stopped run would silently discard the time it just recorded. Only a key
 * change (a new set or exercise) brings the stopwatch back.
 */
function applyCommand(control: StopwatchControl, command: StopwatchCommand): StopwatchControl {
  if (control === 'stopped') return 'stopped';
  switch (command) {
    case 'pause':
      return 'paused';
    case 'resume':
      return 'running';
    case 'stop':
      return 'stopped';
  }
}

/**
 * Advance the stopwatch to `nowMs` and report what to show, whether to buzz,
 * and — on a stop — the duration to record.
 *
 * Called on every tick and on every relevant prop change; it is a total
 * function of (previous run, input), so calling it more often than necessary
 * is harmless. Milestones latch onto the run, so a replayed or late advance
 * never double-fires, and a long background gap collapses to a single alert
 * for the newest minute crossed rather than a burst for each one missed. The
 * recorded duration latches the same way, via the one-shot `command`.
 */
export function advanceStopwatch(
  run: StopwatchRun | undefined,
  input: StopwatchAdvanceInput
): StopwatchAdvanceResult {
  const { key, running, nowMs, command, targetDurationSeconds } = input;

  // No timed exercise: drop any run so returning to one starts a fresh lead-in.
  if (key === undefined) {
    return {
      run: undefined,
      view: undefined,
      vibrateAtMinute: undefined,
      vibrateAtZero: false,
      recordedSeconds: undefined,
    };
  }

  // 0 or absent is the plain count-up stopwatch; only a positive target
  // switches the running phase into a countdown.
  const target =
    targetDurationSeconds !== undefined && targetDurationSeconds > 0
      ? targetDurationSeconds
      : undefined;
  const isCountdown = target !== undefined;

  // A different key means a different (entry, set) — reset rather than resume.
  // That clears the local pause and any stop along with the clock.
  const isNewRun = !run || run.key !== key;
  let next: StopwatchRun = isNewRun
    ? { key, startedAtMs: nowMs, lastMilestone: 0, control: 'running' }
    : { ...run };

  // A command that arrives on the same advance that resets the run belongs to
  // the run that just went away, so it is dropped rather than applied to a
  // stopwatch the user has not even seen start.
  let stoppingNow = false;
  if (command !== undefined && !isNewRun) {
    const control = applyCommand(next.control, command);
    stoppingNow = control === 'stopped' && next.control !== 'stopped';
    next = { ...next, control };
  }

  // Anything that halts the clock uses the same freeze: the session pause the
  // caller owns, or the card's own pause/stop. Composition falls out of this —
  // releasing one while the other still holds leaves the clock exactly put.
  const isHalted = !running || next.control !== 'running';

  if (isHalted) {
    // Freeze once and stay frozen; re-freezing would rewind the clock.
    if (next.frozenAtMs === undefined) next = { ...next, frozenAtMs: nowMs };
  } else if (next.frozenAtMs !== undefined) {
    // Resume: push the start forward by the paused span so the elapsed time
    // picks up exactly where it froze.
    next = {
      ...next,
      startedAtMs: next.startedAtMs + (nowMs - next.frozenAtMs),
      frozenAtMs: undefined,
    };
  }

  const isFrozen = next.frozenAtMs !== undefined;
  let isStopped = next.control === 'stopped';
  const effectiveNowMs = next.frozenAtMs ?? nowMs;
  const sinceStartMs = Math.max(0, effectiveNowMs - next.startedAtMs);
  const leadInRemainingMs = LEAD_IN_SECONDS * 1000 - sinceStartMs;
  const isLeadIn = leadInRemainingMs > 0;
  // max(0, …) also normalizes the -0 that Math.floor yields exactly at the
  // boundary, so the first running frame is 0 and not a negative zero.
  const rawElapsedSeconds = isLeadIn ? 0 : Math.max(0, Math.floor(-leadInRemainingMs / 1000));

  // A countdown run expires exactly like a manual Stop: once exercise time
  // reaches the target, latch `control` to 'stopped' so it halts there for
  // good — applyCommand's terminal check then keeps a later pause/resume from
  // reviving it, same as a real stop. Gated on `!isStopped` (checked against
  // the control coming into this advance) so this only fires on the one tick
  // that crosses the line; a run already stopped — by this or an earlier
  // advance — skips straight past. `vibrateAtZero` latches the same way,
  // which is what makes it a one-shot buzz instead of firing every tick after
  // expiry. A manual stop landing on this same tick has already set `isStopped`
  // above (line 265), so it wins here and suppresses the buzz. A pause landing
  // on the expiry tick does not set `isStopped` (only freezes), so the countdown
  // expiry fires normally and both buzz and record the target.
  let vibrateAtZero = false;
  if (isCountdown && !isLeadIn && !isStopped && rawElapsedSeconds >= target) {
    next = { ...next, control: 'stopped' };
    isStopped = true;
    stoppingNow = true;
    vibrateAtZero = true;
  }

  // Exercise time never reports past the target in countdown mode — a late
  // tick (background gap, slow interval) must not record or display overtime.
  const elapsedSeconds =
    target !== undefined ? Math.min(rawElapsedSeconds, target) : rawElapsedSeconds;
  const remainingSeconds = target !== undefined ? Math.max(0, target - elapsedSeconds) : 0;

  if (isStopped) {
    // A stop with no elapsed time records nothing: no exercise time happened,
    // and writing a 0 over the routine's prefilled target duration would destroy
    // a useful default. Display '—' to signal nothing was recorded; once
    // something was recorded, show the frozen clock. In countdown mode, auto-expiry
    // (remainingSeconds === 0) keeps showing remaining time (0:00), but an early
    // manual stop shows elapsed time to match what recordedSeconds reports.
    const shouldRecordSeconds = stoppingNow && elapsedSeconds > 0;
    const stoppedDisplaySeconds = isCountdown && remainingSeconds === 0 ? remainingSeconds : elapsedSeconds;
    const displayValue = elapsedSeconds > 0 ? formatStopwatchDisplay(stoppedDisplaySeconds) : '—';
    return {
      run: next,
      view: {
        phase: 'stopped',
        remainingLeadInSeconds: 0,
        elapsedSeconds,
        remainingSeconds,
        display: displayValue,
        label: 'Stopped',
        isFrozen: true,
        isLocallyPaused: false,
        isStopped: true,
        canPause: false,
        canStop: false,
      },
      vibrateAtMinute: undefined,
      vibrateAtZero,
      recordedSeconds: shouldRecordSeconds ? elapsedSeconds : undefined,
    };
  }

  const isLocallyPaused = next.control === 'paused';
  // Disable local pause while the session is paused to avoid confusing dual pause states.
  // The label 'Paused' alone suffices; the session pause is in control.
  const controls = { isLocallyPaused, isStopped: false, canPause: running, canStop: true };

  if (isLeadIn) {
    return {
      run: next,
      view: {
        phase: 'leadIn',
        remainingLeadInSeconds: Math.ceil(leadInRemainingMs / 1000),
        elapsedSeconds: 0,
        remainingSeconds,
        display: String(Math.ceil(leadInRemainingMs / 1000)),
        label: isFrozen ? 'Paused' : 'Starting in',
        isFrozen,
        ...controls,
      },
      vibrateAtMinute: undefined,
      vibrateAtZero: false,
      recordedSeconds: undefined,
    };
  }

  // Milestones are suppressed while frozen — by either pause — so a halted
  // workout stays silent and still owes the minute once the clock moves again.
  // Countdown mode drops per-minute milestones entirely: the single zero-buzz
  // above replaces them, so this block never runs for a countdown run.
  let vibrateAtMinute: number | undefined;
  if (!isCountdown) {
    const minute = Math.floor(elapsedSeconds / MILESTONE_INTERVAL_SECONDS);
    if (!isFrozen && minute > next.lastMilestone) {
      vibrateAtMinute = minute;
      next = { ...next, lastMilestone: minute };
    }
  }

  return {
    run: next,
    view: {
      phase: 'running',
      remainingLeadInSeconds: 0,
      elapsedSeconds,
      remainingSeconds,
      display: formatStopwatchDisplay(isCountdown ? remainingSeconds : elapsedSeconds),
      label: isFrozen ? 'Paused' : isCountdown ? 'Remaining' : 'Elapsed',
      isFrozen,
      ...controls,
    },
    vibrateAtMinute,
    vibrateAtZero: false,
    recordedSeconds: undefined,
  };
}
