import { RoutineEntry } from '@/engine/types';
import {
  LEAD_IN_SECONDS,
  MILESTONE_INTERVAL_SECONDS,
  advanceStopwatch,
  formatStopwatchDisplay,
  isDurationBasedEntry,
  makeStopwatchKey,
  StopwatchCommand,
  StopwatchRun,
} from './exerciseStopwatch';

const T0 = 1_700_000_000_000;

function entry(overrides: Partial<RoutineEntry> = {}): RoutineEntry {
  return {
    idx: 0,
    exerciseId: 'plank',
    kind: 'stretch',
    warmupSets: 0,
    targetSets: 3,
    targetReps: 0,
    targetDurationSeconds: 60,
    restSeconds: 30,
    supersetGroup: '',
    ...overrides,
  };
}

/**
 * Drive the stopwatch from scratch to an absolute time, one advance. The
 * trailing `command` is the one-shot button press for that advance; omitting it
 * is an ordinary tick.
 */
function at(offsetMs: number, run?: StopwatchRun, running = true, command?: StopwatchCommand) {
  return advanceStopwatch(run, { key: 'k', running, nowMs: T0 + offsetMs, command });
}

/** Arm a run at T0 so tests can jump straight to the phase they care about. */
function armed(): StopwatchRun {
  return at(0).run!;
}

describe('isDurationBasedEntry', () => {
  test('stretch and cardio entries are duration-based', () => {
    expect(isDurationBasedEntry(entry({ kind: 'stretch' }))).toBe(true);
    expect(isDurationBasedEntry(entry({ kind: 'cardio' }))).toBe(true);
  });

  test('strength entries and a missing entry are not', () => {
    expect(isDurationBasedEntry(entry({ kind: 'strength' }))).toBe(false);
    expect(isDurationBasedEntry(undefined)).toBe(false);
  });
});

/**
 * The key is the stopwatch's identity: it changes when the current entry
 * changes or a set is logged (setIndex advances), and that change is the only
 * thing that resets the run.
 */
describe('makeStopwatchKey', () => {
  test('is undefined for entries that are not duration-based', () => {
    expect(
      makeStopwatchKey(entry({ kind: 'strength' }), { isWarmupSet: false, setNumber: 1 })
    ).toBeUndefined();
    expect(makeStopwatchKey(undefined, { isWarmupSet: false, setNumber: 1 })).toBeUndefined();
  });

  test('is stable for the same entry and set position', () => {
    const a = makeStopwatchKey(entry(), { isWarmupSet: false, setNumber: 2 });
    const b = makeStopwatchKey(entry(), { isWarmupSet: false, setNumber: 2 });
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  test('changes when the set number advances', () => {
    const first = makeStopwatchKey(entry(), { isWarmupSet: false, setNumber: 1 });
    const second = makeStopwatchKey(entry(), { isWarmupSet: false, setNumber: 2 });
    expect(first).not.toBe(second);
  });

  test('changes when the current entry changes', () => {
    const first = makeStopwatchKey(entry({ idx: 0 }), { isWarmupSet: false, setNumber: 1 });
    const second = makeStopwatchKey(entry({ idx: 1 }), { isWarmupSet: false, setNumber: 1 });
    expect(first).not.toBe(second);
  });

  test('distinguishes warmup set 1 from working set 1 of the same entry', () => {
    const warmup = makeStopwatchKey(entry(), { isWarmupSet: true, setNumber: 1 });
    const working = makeStopwatchKey(entry(), { isWarmupSet: false, setNumber: 1 });
    expect(warmup).not.toBe(working);
  });
});

describe('formatStopwatchDisplay', () => {
  test('pads seconds and leaves minutes unpadded, matching RestCountdown', () => {
    expect(formatStopwatchDisplay(0)).toBe('0:00');
    expect(formatStopwatchDisplay(5)).toBe('0:05');
    expect(formatStopwatchDisplay(59)).toBe('0:59');
    expect(formatStopwatchDisplay(60)).toBe('1:00');
    expect(formatStopwatchDisplay(65)).toBe('1:05');
    expect(formatStopwatchDisplay(600)).toBe('10:00');
    expect(formatStopwatchDisplay(3661)).toBe('61:01');
  });

  test('never renders a negative clock', () => {
    expect(formatStopwatchDisplay(-1)).toBe('0:00');
  });
});

describe('advanceStopwatch — no timed exercise', () => {
  test('an undefined key produces no run and no view', () => {
    const result = advanceStopwatch(undefined, { key: undefined, running: true, nowMs: T0 });
    expect(result.run).toBeUndefined();
    expect(result.view).toBeUndefined();
    expect(result.vibrateAtMinute).toBeUndefined();
  });

  test('an existing run is dropped when the key goes away', () => {
    const result = advanceStopwatch(armed(), { key: undefined, running: true, nowMs: T0 + 1000 });
    expect(result.run).toBeUndefined();
    expect(result.view).toBeUndefined();
  });
});

describe('advanceStopwatch — lead-in', () => {
  test('arms at the full lead-in on the first advance', () => {
    const { view, run } = at(0);
    expect(view).toEqual(
      expect.objectContaining({
        phase: 'leadIn',
        remainingLeadInSeconds: LEAD_IN_SECONDS,
        elapsedSeconds: 0,
        display: '5',
        isFrozen: false,
      })
    );
    expect(run?.startedAtMs).toBe(T0);
    expect(run?.lastMilestone).toBe(0);
  });

  test('counts the lead-in down one whole second at a time', () => {
    const run = armed();
    expect(at(999, run).view?.remainingLeadInSeconds).toBe(5);
    expect(at(1000, run).view?.remainingLeadInSeconds).toBe(4);
    expect(at(3500, run).view?.remainingLeadInSeconds).toBe(2);
    expect(at(4999, run).view?.remainingLeadInSeconds).toBe(1);
    expect(at(4999, run).view?.display).toBe('1');
  });

  test('the elapsed clock stays at zero for the whole lead-in', () => {
    const run = armed();
    expect(at(4999, run).view?.elapsedSeconds).toBe(0);
    expect(at(4999, run).view?.phase).toBe('leadIn');
  });

  test('flips to running exactly at the lead-in boundary', () => {
    const run = armed();
    const { view } = at(LEAD_IN_SECONDS * 1000, run);
    expect(view?.phase).toBe('running');
    expect(view?.remainingLeadInSeconds).toBe(0);
    expect(view?.elapsedSeconds).toBe(0);
    expect(view?.display).toBe('0:00');
  });

  test('no milestone can fire during the lead-in', () => {
    const run = armed();
    expect(at(2500, run).vibrateAtMinute).toBeUndefined();
  });
});

describe('advanceStopwatch — elapsed time from timestamps', () => {
  test('elapsed excludes the lead-in and is derived from the now delta', () => {
    const run = armed();
    expect(at(6000, run).view?.elapsedSeconds).toBe(1);
    expect(at(35_000, run).view?.elapsedSeconds).toBe(30);
    expect(at(65_000, run).view?.elapsedSeconds).toBe(60);
  });

  test('a single late advance reports true elapsed time, not accumulated ticks', () => {
    // Nothing ticked between arming and this advance (JS timers suspend when
    // backgrounded); the elapsed value must still be correct.
    const { view } = at(305_000, armed());
    expect(view?.elapsedSeconds).toBe(300);
    expect(view?.display).toBe('5:00');
  });

  test('renders the running clock as mm:ss', () => {
    const run = armed();
    expect(at(5000, run).view?.display).toBe('0:00');
    expect(at(12_000, run).view?.display).toBe('0:07');
    expect(at(96_000, run).view?.display).toBe('1:31');
  });
});

describe('advanceStopwatch — minute milestones', () => {
  test('fires at the first full minute of exercise time', () => {
    const run = armed();
    expect(at(64_999, run).vibrateAtMinute).toBeUndefined();
    expect(at(65_000, run).vibrateAtMinute).toBe(1);
  });

  test('a late tick past the boundary still fires that milestone', () => {
    // Tick lands at 61.8s of exercise time; the 60s milestone is still owed.
    const { vibrateAtMinute } = at(66_800, armed());
    expect(vibrateAtMinute).toBe(1);
  });

  test('fires exactly once — repeated ticks past the boundary stay quiet', () => {
    let run = armed();
    const fired: number[] = [];
    for (const offset of [65_000, 65_250, 66_800, 70_000, 119_000]) {
      const result = advanceStopwatch(run, { key: 'k', running: true, nowMs: T0 + offset });
      run = result.run!;
      if (result.vibrateAtMinute !== undefined) fired.push(result.vibrateAtMinute);
    }
    expect(fired).toEqual([1]);
  });

  test('fires again at each subsequent minute', () => {
    let run = armed();
    const fired: number[] = [];
    for (let s = 0; s <= 190; s++) {
      const result = advanceStopwatch(run, {
        key: 'k',
        running: true,
        nowMs: T0 + LEAD_IN_SECONDS * 1000 + s * 1000,
      });
      run = result.run!;
      if (result.vibrateAtMinute !== undefined) fired.push(result.vibrateAtMinute);
    }
    expect(fired).toEqual([1, 2, 3]);
  });

  test('a long gap collapses to a single alert for the newest milestone', () => {
    // Backgrounded across three minutes: buzz once on return, not three times.
    const { vibrateAtMinute, run } = at(185_000, armed());
    expect(vibrateAtMinute).toBe(3);
    expect(run?.lastMilestone).toBe(3);
  });

  test('latches the milestone it fired so a replayed advance is silent', () => {
    const first = at(65_000, armed());
    expect(first.vibrateAtMinute).toBe(1);
    expect(first.run?.lastMilestone).toBe(1);
    expect(at(65_000, first.run).vibrateAtMinute).toBeUndefined();
  });

  test('MILESTONE_INTERVAL_SECONDS is the documented one-minute cadence', () => {
    expect(MILESTONE_INTERVAL_SECONDS).toBe(60);
  });
});

describe('advanceStopwatch — pause freezes, it does not reset', () => {
  test('a paused advance freezes the clock where it stood', () => {
    const run = armed();
    const paused = at(35_000, run, false);
    expect(paused.view?.elapsedSeconds).toBe(30);
    expect(paused.view?.isFrozen).toBe(true);
    expect(paused.run?.frozenAtMs).toBe(T0 + 35_000);
  });

  test('the frozen clock does not advance while time passes', () => {
    const paused = at(35_000, armed(), false);
    const stillPaused = at(95_000, paused.run, false);
    expect(stillPaused.view?.elapsedSeconds).toBe(30);
    expect(stillPaused.view?.display).toBe('0:30');
  });

  test('no milestone fires while paused, even across a minute boundary', () => {
    const paused = at(35_000, armed(), false);
    const stillPaused = at(300_000, paused.run, false);
    expect(paused.vibrateAtMinute).toBeUndefined();
    expect(stillPaused.vibrateAtMinute).toBeUndefined();
    expect(stillPaused.run?.lastMilestone).toBe(0);
  });

  test('resuming continues from the frozen elapsed time, discounting the pause', () => {
    const paused = at(35_000, armed(), false);
    // 60s of wall clock passes while paused, then one more second of exercise.
    const resumed = at(95_000, paused.run, true);
    expect(resumed.view?.isFrozen).toBe(false);
    expect(resumed.view?.elapsedSeconds).toBe(30);
    expect(at(96_000, resumed.run).view?.elapsedSeconds).toBe(31);
  });

  test('a milestone deferred by a pause still fires once after resuming', () => {
    const paused = at(64_000, armed(), false); // 59s elapsed, frozen
    const resumed = at(124_000, paused.run, true); // still 59s of exercise time
    expect(resumed.vibrateAtMinute).toBeUndefined();
    const later = at(125_000, resumed.run); // 60s of exercise time
    expect(later.vibrateAtMinute).toBe(1);
  });

  test('a milestone crossed by the pausing advance itself fires once after resuming', () => {
    // At 60.5s of exercise time (wall-clock 65.5s from lead-in start), pause crosses the milestone.
    const paused = at(65_500, armed(), false);
    expect(paused.vibrateAtMinute).toBeUndefined(); // Suppressed while frozen
    expect(paused.run?.lastMilestone).toBe(0); // Not yet latched
    const resumed = at(65_500, paused.run, true);
    expect(resumed.vibrateAtMinute).toBe(1); // Fires once on resume
  });

  test('a backward wall-clock jump while running is benign and re-renders', () => {
    const forward = at(65_000, armed()); // 60s elapsed, milestone fired
    expect(forward.vibrateAtMinute).toBe(1);
    const backward = at(64_000, forward.run); // Wall-clock skips backward; 59s elapsed
    expect(backward.view?.elapsedSeconds).toBe(59);
    expect(backward.vibrateAtMinute).toBeUndefined(); // No buzz on backward jump
  });

  test('pausing during the lead-in freezes the countdown too', () => {
    const paused = at(2000, armed(), false);
    expect(paused.view?.phase).toBe('leadIn');
    expect(paused.view?.remainingLeadInSeconds).toBe(3);
    const stillPaused = at(60_000, paused.run, false);
    expect(stillPaused.view?.remainingLeadInSeconds).toBe(3);
    const resumed = at(60_000, paused.run, true);
    expect(resumed.view?.remainingLeadInSeconds).toBe(3);
  });
});

describe('advanceStopwatch — reset on key change', () => {
  test('a new key restarts the lead-in from scratch', () => {
    const run = at(65_000, armed()).run!;
    expect(run.lastMilestone).toBe(1);

    const next = advanceStopwatch(run, { key: 'k2', running: true, nowMs: T0 + 65_000 });
    expect(next.run?.key).toBe('k2');
    expect(next.run?.startedAtMs).toBe(T0 + 65_000);
    expect(next.run?.lastMilestone).toBe(0);
    expect(next.view?.phase).toBe('leadIn');
    expect(next.view?.remainingLeadInSeconds).toBe(LEAD_IN_SECONDS);
  });

  test('restarting never fires a milestone on the same advance', () => {
    const run = at(65_000, armed()).run!;
    const next = advanceStopwatch(run, { key: 'k2', running: true, nowMs: T0 + 65_000 });
    expect(next.vibrateAtMinute).toBeUndefined();
  });

  test('the same key keeps the run going across advances', () => {
    const run = armed();
    const next = advanceStopwatch(run, { key: 'k', running: true, nowMs: T0 + 30_000 });
    expect(next.run?.startedAtMs).toBe(T0);
  });

  test('a run armed while paused starts frozen at the full lead-in', () => {
    const result = advanceStopwatch(undefined, { key: 'k', running: false, nowMs: T0 });
    expect(result.view?.isFrozen).toBe(true);
    expect(result.view?.remainingLeadInSeconds).toBe(LEAD_IN_SECONDS);
    expect(result.vibrateAtMinute).toBeUndefined();
  });
});

/**
 * The card's own pause button. Distinct from the session pause in the header:
 * this one is latched onto the run, so it survives a session resume.
 */
describe('advanceStopwatch — local pause', () => {
  test('a pause command freezes the clock where it stood', () => {
    const paused = at(35_000, armed(), true, 'pause');
    expect(paused.view?.elapsedSeconds).toBe(30);
    expect(paused.view?.isFrozen).toBe(true);
    expect(paused.view?.isLocallyPaused).toBe(true);
    expect(paused.run?.control).toBe('paused');
  });

  test('the locally paused clock stands still while the session keeps running', () => {
    const paused = at(35_000, armed(), true, 'pause');
    const later = at(95_000, paused.run);
    expect(later.view?.elapsedSeconds).toBe(30);
    expect(later.view?.display).toBe('0:30');
    expect(later.view?.isFrozen).toBe(true);
  });

  test('no milestone fires while locally paused, even across a minute boundary', () => {
    const paused = at(35_000, armed(), true, 'pause');
    const later = at(300_000, paused.run);
    expect(paused.vibrateAtMinute).toBeUndefined();
    expect(later.vibrateAtMinute).toBeUndefined();
    expect(later.run?.lastMilestone).toBe(0);
  });

  test('resuming discounts the locally paused span', () => {
    const paused = at(35_000, armed(), true, 'pause');
    const resumed = at(95_000, paused.run, true, 'resume');
    expect(resumed.view?.isFrozen).toBe(false);
    expect(resumed.view?.isLocallyPaused).toBe(false);
    expect(resumed.view?.elapsedSeconds).toBe(30);
    expect(at(96_000, resumed.run).view?.elapsedSeconds).toBe(31);
  });

  test('a milestone deferred by a local pause still fires once after resuming', () => {
    const paused = at(64_000, armed(), true, 'pause'); // 59s elapsed, frozen
    const resumed = at(124_000, paused.run, true, 'resume'); // still 59s of exercise time
    expect(resumed.vibrateAtMinute).toBeUndefined();
    expect(at(125_000, resumed.run).vibrateAtMinute).toBe(1);
  });

  test('a repeated pause command never rewinds the freeze', () => {
    const paused = at(35_000, armed(), true, 'pause');
    const again = at(95_000, paused.run, true, 'pause');
    expect(again.view?.elapsedSeconds).toBe(30);
  });

  test('pausing during the lead-in freezes the countdown too', () => {
    const paused = at(2000, armed(), true, 'pause');
    expect(paused.view?.phase).toBe('leadIn');
    expect(paused.view?.remainingLeadInSeconds).toBe(3);
    expect(at(60_000, paused.run).view?.remainingLeadInSeconds).toBe(3);

    const resumed = at(60_000, paused.run, true, 'resume');
    expect(resumed.view?.remainingLeadInSeconds).toBe(3);
    expect(at(61_000, resumed.run).view?.remainingLeadInSeconds).toBe(2);
  });
});

/**
 * Session pause and local pause compose: either one freezes, and the clock only
 * moves again once both are clear.
 */
describe('advanceStopwatch — local pause composes with the session pause', () => {
  test('a session pause layered on a local pause keeps the single freeze instant', () => {
    const local = at(35_000, armed(), true, 'pause');
    const both = at(95_000, local.run, false);
    expect(both.view?.elapsedSeconds).toBe(30);
    expect(both.view?.isFrozen).toBe(true);
  });

  test('resuming the session leaves a locally paused stopwatch frozen', () => {
    const local = at(35_000, armed(), true, 'pause');
    const both = at(95_000, local.run, false);
    const sessionResumed = at(155_000, both.run, true);
    expect(sessionResumed.view?.isFrozen).toBe(true);
    expect(sessionResumed.view?.isLocallyPaused).toBe(true);
    expect(sessionResumed.view?.elapsedSeconds).toBe(30);

    const localResumed = at(215_000, sessionResumed.run, true, 'resume');
    expect(localResumed.view?.isFrozen).toBe(false);
    expect(localResumed.view?.elapsedSeconds).toBe(30);
    expect(at(216_000, localResumed.run).view?.elapsedSeconds).toBe(31);
  });

  test('a local resume while the session is paused leaves the clock frozen', () => {
    const sessionPaused = at(35_000, armed(), false);
    const local = at(40_000, sessionPaused.run, false, 'pause');
    const localResumed = at(95_000, local.run, false, 'resume');
    expect(localResumed.view?.isFrozen).toBe(true);
    expect(localResumed.view?.elapsedSeconds).toBe(30);

    const sessionResumed = at(155_000, localResumed.run, true);
    expect(sessionResumed.view?.isFrozen).toBe(false);
    expect(sessionResumed.view?.elapsedSeconds).toBe(30);
    expect(at(156_000, sessionResumed.run).view?.elapsedSeconds).toBe(31);
  });
});

describe('advanceStopwatch — stop records the elapsed time', () => {
  test('stopping finalizes the clock and reports whole seconds once', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    expect(stopped.recordedSeconds).toBe(30);
    expect(stopped.view?.phase).toBe('stopped');
    expect(stopped.view?.isStopped).toBe(true);
    expect(stopped.view?.elapsedSeconds).toBe(30);
    expect(stopped.view?.display).toBe('0:30');
    expect(stopped.run?.control).toBe('stopped');
  });

  test('an ordinary advance reports no recorded time', () => {
    expect(at(35_000, armed()).recordedSeconds).toBeUndefined();
  });

  test('late ticks after a stop neither move the clock nor report the time again', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    const later = at(300_000, stopped.run);
    expect(later.recordedSeconds).toBeUndefined();
    expect(later.view?.elapsedSeconds).toBe(30);
    expect(later.view?.display).toBe('0:30');
  });

  test('a repeated stop command reports nothing the second time', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    const again = at(40_000, stopped.run, true, 'stop');
    expect(again.recordedSeconds).toBeUndefined();
    expect(again.view?.elapsedSeconds).toBe(30);
  });

  test('no milestone fires after a stop', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    const later = at(300_000, stopped.run);
    expect(stopped.vibrateAtMinute).toBeUndefined();
    expect(later.vibrateAtMinute).toBeUndefined();
    expect(later.run?.lastMilestone).toBe(0);
  });

  test('stopping a locally paused stopwatch records the frozen time', () => {
    const paused = at(35_000, armed(), true, 'pause');
    const stopped = at(300_000, paused.run, true, 'stop');
    expect(stopped.recordedSeconds).toBe(30);
    expect(stopped.view?.elapsedSeconds).toBe(30);
  });

  test('stopping while the session is paused records the frozen time', () => {
    const paused = at(35_000, armed(), false);
    const stopped = at(300_000, paused.run, false, 'stop');
    expect(stopped.recordedSeconds).toBe(30);
    expect(stopped.view?.isStopped).toBe(true);
  });

  test('stop is terminal: pause and resume do nothing until the set changes', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    const resumed = at(40_000, stopped.run, true, 'resume');
    expect(resumed.view?.isStopped).toBe(true);
    expect(resumed.view?.elapsedSeconds).toBe(30);

    const paused = at(45_000, resumed.run, true, 'pause');
    expect(paused.run?.control).toBe('stopped');
    expect(paused.view?.isStopped).toBe(true);
    expect(paused.view?.elapsedSeconds).toBe(30);
  });

  test('stopping during the lead-in records nothing and displays a dash', () => {
    // No exercise time happened, so there is nothing to write — and writing 0
    // would clobber the routine's prefilled target duration for no gain.
    // Display '—' to signal that no duration was recorded.
    const stopped = at(2000, armed(), true, 'stop');
    expect(stopped.recordedSeconds).toBeUndefined();
    expect(stopped.view?.phase).toBe('stopped');
    expect(stopped.view?.elapsedSeconds).toBe(0);
    expect(stopped.view?.remainingLeadInSeconds).toBe(0);
    expect(stopped.view?.display).toBe('—');
  });

  test('stopping exactly at the lead-in boundary records nothing (no elapsed time)', () => {
    const stopped = at(LEAD_IN_SECONDS * 1000, armed(), true, 'stop');
    expect(stopped.recordedSeconds).toBeUndefined();
    expect(stopped.view?.display).toBe('—');
  });

  test('stopping at the first whole second of exercise time records 1', () => {
    // The 0→1 transition is where the record guard lives: one second past the
    // lead-in boundary is the earliest stop that writes anything.
    const stopped = at(LEAD_IN_SECONDS * 1000 + 1000, armed(), true, 'stop');
    expect(stopped.recordedSeconds).toBe(1);
    expect(stopped.view?.display).toBe('0:01');
  });
});

describe('advanceStopwatch — control availability and label', () => {
  test('a running stopwatch offers both controls', () => {
    const { view } = at(10_000, armed());
    expect(view?.canPause).toBe(true);
    expect(view?.canStop).toBe(true);
    expect(view?.label).toBe('Elapsed');
  });

  test('the lead-in offers both controls too', () => {
    const { view } = at(2000, armed());
    expect(view?.canPause).toBe(true);
    expect(view?.canStop).toBe(true);
    expect(view?.label).toBe('Starting in');
  });

  test('a session pause labels the card paused and disables the local pause control', () => {
    const { view } = at(35_000, armed(), false);
    expect(view?.label).toBe('Paused');
    expect(view?.isLocallyPaused).toBe(false);
    // Local pause is not offered while the session is paused: the session pause is in control.
    expect(view?.canPause).toBe(false);
    expect(view?.canStop).toBe(true);
  });

  test('a locally paused card is labelled paused and reports its own pause', () => {
    const { view } = at(35_000, armed(), true, 'pause');
    expect(view?.label).toBe('Paused');
    expect(view?.isLocallyPaused).toBe(true);
  });

  test('a session-paused lead-in labels the countdown frozen', () => {
    const { view } = at(2000, armed(), false);
    expect(view?.phase).toBe('leadIn');
    expect(view?.label).toBe('Paused');
    expect(view?.isFrozen).toBe(true);
  });

  test('a locally-paused lead-in labels the countdown frozen', () => {
    const { view } = at(2000, armed(), true, 'pause');
    expect(view?.phase).toBe('leadIn');
    expect(view?.label).toBe('Paused');
    expect(view?.isFrozen).toBe(true);
    expect(view?.isLocallyPaused).toBe(true);
  });

  test('a stopped card is labelled stopped and offers no controls', () => {
    const { view } = at(35_000, armed(), true, 'stop');
    expect(view?.label).toBe('Stopped');
    expect(view?.canPause).toBe(false);
    expect(view?.canStop).toBe(false);
  });
});

describe('advanceStopwatch — a new set clears the local controls', () => {
  test('an armed run starts with its controls in the running position', () => {
    expect(armed().control).toBe('running');
  });

  test('a new key clears a local pause', () => {
    const paused = at(35_000, armed(), true, 'pause');
    const next = advanceStopwatch(paused.run, { key: 'k2', running: true, nowMs: T0 + 35_000 });
    expect(next.run?.control).toBe('running');
    expect(next.view?.isFrozen).toBe(false);
    expect(next.view?.phase).toBe('leadIn');
    expect(next.view?.remainingLeadInSeconds).toBe(LEAD_IN_SECONDS);
  });

  test('a new key clears a stop', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    const next = advanceStopwatch(stopped.run, { key: 'k2', running: true, nowMs: T0 + 35_000 });
    expect(next.run?.control).toBe('running');
    expect(next.view?.isStopped).toBe(false);
    expect(next.view?.phase).toBe('leadIn');
    expect(next.recordedSeconds).toBeUndefined();
  });

  test('a command landing on the same advance as a new set is dropped', () => {
    const run = at(35_000, armed()).run!;
    const next = advanceStopwatch(run, {
      key: 'k2',
      running: true,
      nowMs: T0 + 35_000,
      command: 'stop',
    });
    expect(next.run?.control).toBe('running');
    expect(next.recordedSeconds).toBeUndefined();
    expect(next.view?.phase).toBe('leadIn');
  });

  test('a command on the very first advance is dropped', () => {
    const result = advanceStopwatch(undefined, {
      key: 'k',
      running: true,
      nowMs: T0,
      command: 'stop',
    });
    expect(result.run?.control).toBe('running');
    expect(result.recordedSeconds).toBeUndefined();
    expect(result.view?.phase).toBe('leadIn');
  });

  test('losing the timed exercise drops a stopped run entirely', () => {
    const stopped = at(35_000, armed(), true, 'stop');
    const gone = advanceStopwatch(stopped.run, {
      key: undefined,
      running: true,
      nowMs: T0 + 40_000,
    });
    expect(gone.run).toBeUndefined();
    expect(gone.view).toBeUndefined();
    expect(gone.recordedSeconds).toBeUndefined();
  });
});

/**
 * Countdown mode: entries with a positive targetDurationSeconds count DOWN
 * from the target after the same 5-second lead-in, halt at 0:00 exactly once
 * (recording the target, buzzing once), and drop the per-minute milestones
 * entirely. A target of 0 or absent must fall back to the plain count-up
 * stopwatch pinned by every test above — this block only adds targetDurationSeconds.
 */
describe('advanceStopwatch — countdown mode', () => {
  const TARGET = 60;

  function atCountdown(
    offsetMs: number,
    run?: StopwatchRun,
    running = true,
    command?: StopwatchCommand,
    target = TARGET
  ) {
    return advanceStopwatch(run, {
      key: 'k',
      running,
      nowMs: T0 + offsetMs,
      command,
      targetDurationSeconds: target,
    });
  }

  function armedCountdown(target = TARGET): StopwatchRun {
    return atCountdown(0, undefined, true, undefined, target).run!;
  }

  test('the lead-in counts down 5..1 exactly like the plain stopwatch', () => {
    const run = armedCountdown();
    expect(atCountdown(999, run).view?.remainingLeadInSeconds).toBe(5);
    expect(atCountdown(4999, run).view?.remainingLeadInSeconds).toBe(1);
    expect(atCountdown(4999, run).view?.phase).toBe('leadIn');
  });

  test('running starts at the full target and counts down', () => {
    const run = armedCountdown();
    const { view } = atCountdown(LEAD_IN_SECONDS * 1000, run);
    expect(view?.phase).toBe('running');
    expect(view?.remainingSeconds).toBe(60);
    expect(view?.display).toBe('1:00');
    expect(view?.label).toBe('Remaining');
  });

  test('remaining time decreases one second at a time as exercise time passes', () => {
    const run = armedCountdown();
    expect(atCountdown(LEAD_IN_SECONDS * 1000 + 1000, run).view?.display).toBe('0:59');
    expect(atCountdown(LEAD_IN_SECONDS * 1000 + 30_000, run).view?.display).toBe('0:30');
    expect(atCountdown(LEAD_IN_SECONDS * 1000 + 59_000, run).view?.display).toBe('0:01');
  });

  test('halts at 0:00 exactly when exercise time reaches the target', () => {
    const run = armedCountdown();
    const { view } = atCountdown(LEAD_IN_SECONDS * 1000 + 60_000, run);
    expect(view?.phase).toBe('stopped');
    expect(view?.display).toBe('0:00');
    expect(view?.remainingSeconds).toBe(0);
    expect(view?.isStopped).toBe(true);
    expect(view?.canPause).toBe(false);
    expect(view?.canStop).toBe(false);
  });

  test('never shows overtime past 0:00, even on a single late tick', () => {
    const run = armedCountdown();
    // Backgrounded well past the target; a single late advance must still cap at 0:00.
    const { view } = atCountdown(LEAD_IN_SECONDS * 1000 + 300_000, run);
    expect(view?.display).toBe('0:00');
    expect(view?.elapsedSeconds).toBe(60);
    expect(view?.remainingSeconds).toBe(0);
  });

  test('writes the target as the recorded duration exactly once, on the crossing tick', () => {
    const run = armedCountdown();
    const atZero = atCountdown(LEAD_IN_SECONDS * 1000 + 60_000, run);
    expect(atZero.recordedSeconds).toBe(60);

    const later = atCountdown(LEAD_IN_SECONDS * 1000 + 90_000, atZero.run);
    expect(later.recordedSeconds).toBeUndefined();
    expect(later.view?.display).toBe('0:00');
  });

  test('vibrates exactly once, on the crossing tick, and never again', () => {
    const run = armedCountdown();
    const before = atCountdown(LEAD_IN_SECONDS * 1000 + 59_000, run);
    expect(before.vibrateAtZero).toBe(false);

    const atZero = atCountdown(LEAD_IN_SECONDS * 1000 + 60_000, before.run);
    expect(atZero.vibrateAtZero).toBe(true);

    const later = atCountdown(LEAD_IN_SECONDS * 1000 + 90_000, atZero.run);
    expect(later.vibrateAtZero).toBe(false);
  });

  test('per-minute milestones never fire in countdown mode', () => {
    let run = armedCountdown(180); // 3-minute target
    const fired: number[] = [];
    for (let s = 0; s <= 180; s += 1) {
      const result = advanceStopwatch(run, {
        key: 'k',
        running: true,
        nowMs: T0 + LEAD_IN_SECONDS * 1000 + s * 1000,
        targetDurationSeconds: 180,
      });
      run = result.run!;
      if (result.vibrateAtMinute !== undefined) fired.push(result.vibrateAtMinute);
    }
    expect(fired).toEqual([]);
    expect(run.lastMilestone).toBe(0);
  });

  test('a manual stop before the target writes the actual elapsed time, not the target', () => {
    const run = armedCountdown();
    const stopped = atCountdown(LEAD_IN_SECONDS * 1000 + 10_000, run, true, 'stop');
    expect(stopped.recordedSeconds).toBe(10);
    expect(stopped.vibrateAtZero).toBe(false);
    // An early manual stop displays the elapsed time to match what recordedSeconds reports,
    // unlike auto-expiry which stays at remaining time (0:00).
    expect(stopped.view?.display).toBe('0:10');
  });

  test('stopping during the lead-in still records nothing, matching the plain stopwatch', () => {
    const run = armedCountdown();
    const stopped = atCountdown(2000, run, true, 'stop');
    expect(stopped.recordedSeconds).toBeUndefined();
    expect(stopped.view?.display).toBe('—');
    expect(stopped.view?.phase).toBe('stopped');
  });

  test('pausing mid-countdown freezes the remaining time; resuming continues from there', () => {
    const run = armedCountdown();
    const paused = atCountdown(LEAD_IN_SECONDS * 1000 + 20_000, run, false);
    expect(paused.view?.display).toBe('0:40');
    expect(paused.view?.isFrozen).toBe(true);

    const stillPaused = atCountdown(LEAD_IN_SECONDS * 1000 + 80_000, paused.run, false);
    expect(stillPaused.view?.display).toBe('0:40');
    expect(stillPaused.vibrateAtZero).toBe(false);
    expect(stillPaused.recordedSeconds).toBeUndefined();

    const resumed = atCountdown(LEAD_IN_SECONDS * 1000 + 80_000, stillPaused.run, true);
    expect(resumed.view?.display).toBe('0:40');
    expect(atCountdown(LEAD_IN_SECONDS * 1000 + 81_000, resumed.run).view?.display).toBe('0:39');
  });

  test('the local pause composes with the session pause while counting down', () => {
    const run = armedCountdown();
    const local = atCountdown(LEAD_IN_SECONDS * 1000 + 20_000, run, true, 'pause');
    const both = atCountdown(LEAD_IN_SECONDS * 1000 + 80_000, local.run, false);
    expect(both.view?.display).toBe('0:40');
    expect(both.view?.isFrozen).toBe(true);
    expect(both.vibrateAtZero).toBe(false);
    expect(both.recordedSeconds).toBeUndefined();
  });

  test('ticking well past target while frozen freezes no buzz, no record', () => {
    // PR #46 regression: while frozen past expiry, ensure no accidental buzzes or records.
    // Test both local pause and session pause modes.
    const run = armedCountdown();

    // Local pause case: pause at 20s, then tick 200 seconds past expiry while frozen
    const localPaused = atCountdown(LEAD_IN_SECONDS * 1000 + 20_000, run, true, 'pause');
    expect(localPaused.view?.isFrozen).toBe(true);
    let buzzes = 0;
    let records = 0;
    let testRun = localPaused.run;
    for (let i = 0; i <= 200; i++) {
      const result = atCountdown(LEAD_IN_SECONDS * 1000 + 20_000 + i * 1000, testRun, true);
      testRun = result.run;
      if (result.vibrateAtZero) buzzes++;
      if (result.recordedSeconds !== undefined) records++;
    }
    expect(buzzes).toBe(0);
    expect(records).toBe(0);

    // Session pause case: session pauses, then tick 200 seconds past expiry while frozen
    const sessionPaused = atCountdown(LEAD_IN_SECONDS * 1000 + 20_000, armed(), false);
    expect(sessionPaused.view?.isFrozen).toBe(true);
    buzzes = 0;
    records = 0;
    testRun = sessionPaused.run;
    for (let i = 0; i <= 200; i++) {
      const result = atCountdown(LEAD_IN_SECONDS * 1000 + 20_000 + i * 1000, testRun, false);
      testRun = result.run;
      if (result.vibrateAtZero) buzzes++;
      if (result.recordedSeconds !== undefined) records++;
    }
    expect(buzzes).toBe(0);
    expect(records).toBe(0);
  });

  test('a target of exactly 0 falls back to the plain count-up stopwatch', () => {
    const run = armed(); // armed with no target at all
    const result = advanceStopwatch(run, {
      key: 'k',
      running: true,
      nowMs: T0 + 65_000, // 60s of exercise time
      targetDurationSeconds: 0,
    });
    expect(result.view?.label).toBe('Elapsed');
    expect(result.view?.display).toBe('1:00');
    expect(result.view?.remainingSeconds).toBe(0);
    expect(result.vibrateAtMinute).toBe(1);
  });

  test.each([undefined, 0, -30, NaN])(
    'non-positive targets (%s) fall back to count-up mode',
    (target) => {
      const run = armed();
      const result = advanceStopwatch(run, {
        key: 'k',
        running: true,
        nowMs: T0 + 65_000, // 60s of exercise time
        targetDurationSeconds: target,
      });
      // Count-up mode is confirmed by: label is 'Elapsed', minute milestone fires, remainingSeconds is 0
      expect(result.view?.label).toBe('Elapsed');
      expect(result.vibrateAtMinute).toBe(1);
      expect(result.view?.remainingSeconds).toBe(0);
    }
  );
});
