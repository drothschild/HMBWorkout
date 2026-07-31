import { RoutineEntry } from '@/engine/types';
import {
  LEAD_IN_SECONDS,
  MILESTONE_INTERVAL_SECONDS,
  advanceStopwatch,
  formatStopwatchDisplay,
  isDurationBasedEntry,
  makeStopwatchKey,
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

/** Drive the stopwatch from scratch to an absolute time, one advance. */
function at(offsetMs: number, run?: StopwatchRun, running = true) {
  return advanceStopwatch(run, { key: 'k', running, nowMs: T0 + offsetMs });
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
