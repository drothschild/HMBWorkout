import {
  KeepAwakeTag,
  isExerciseStopwatchRunning,
  isRestTimerRunning,
} from './keepAwake';

/**
 * #312 — the screen must stay lit while a workout timer is counting.
 *
 * These predicates are the whole *decision*: each one answers "is this surface's
 * clock actually moving right now?", and each component uses the single boolean
 * it returns for BOTH its tick interval and its keep-awake mount. That shared
 * use is what makes a leak structurally impossible — the lock cannot outlive the
 * interval, because the same value gates both.
 */
describe('keep-awake tags', () => {
  it('gives each timing surface its own distinct tag', () => {
    // expo-keep-awake reference-counts by tag: releasing one tag must not
    // cancel another surface's lock. Two surfaces sharing a tag means the
    // stopwatch stopping would drop the rest countdown's lock too.
    expect(KeepAwakeTag.restCountdown).not.toBe(KeepAwakeTag.exerciseStopwatch);
  });

  it('pins the tag values so a rename cannot silently orphan a live lock', () => {
    // Activate and deactivate are matched by tag string. A value changed while
    // a lock is held leaves the old tag active forever.
    expect(KeepAwakeTag).toStrictEqual({
      restCountdown: 'hmb-rest-countdown',
      exerciseStopwatch: 'hmb-exercise-stopwatch',
    });
  });
});

describe('isRestTimerRunning', () => {
  it('is true while a rest deadline is live and unpaused', () => {
    expect(isRestTimerRunning({ deadlineMs: 1_700_000_000_000, isPaused: false })).toBe(true);
  });

  it('is false while the rest is paused, even with a deadline still set', () => {
    // The engine freezes the remainder on pause; nothing is counting, so the
    // phone is free to sleep.
    expect(isRestTimerRunning({ deadlineMs: 1_700_000_000_000, isPaused: true })).toBe(false);
  });

  it('is false when no deadline is set', () => {
    expect(isRestTimerRunning({ deadlineMs: undefined, isPaused: false })).toBe(false);
  });

  it('treats the engine 0 sentinel as no deadline, not as a deadline at the epoch', () => {
    // AGENTS.md engine convention 8: fromRillState re-sentinelizes an absent
    // restDeadlineMs to 0. A plain null check would read 0 as "a deadline" and
    // hold the lock forever with no rest running — exactly the leak to avoid.
    expect(isRestTimerRunning({ deadlineMs: 0, isPaused: false })).toBe(false);
    expect(isRestTimerRunning({ deadlineMs: 0, isPaused: true })).toBe(false);
  });
});

describe('isExerciseStopwatchRunning', () => {
  const base = { stopwatchKey: 'entry-1:0', running: true, control: 'running' } as const;

  it('is true while the card is armed, the session is unpaused, and the clock moves', () => {
    expect(isExerciseStopwatchRunning(base)).toBe(true);
  });

  it('is false when the stopwatch is switched off entirely', () => {
    expect(isExerciseStopwatchRunning({ ...base, stopwatchKey: undefined })).toBe(false);
  });

  it('is false while the session pause freezes the clock', () => {
    expect(isExerciseStopwatchRunning({ ...base, running: false })).toBe(false);
  });

  it('is false while the card is locally paused', () => {
    // The card's own pause and the session pause compose; either one stops the
    // clock, and a stopped clock must release the screen.
    expect(isExerciseStopwatchRunning({ ...base, control: 'paused' })).toBe(false);
  });

  it('is false once the run is stopped', () => {
    expect(isExerciseStopwatchRunning({ ...base, control: 'stopped' })).toBe(false);
  });
});
