/**
 * Per-set rest (#281): both `advance_after_set` ScheduleRest sites read the
 * JUST-COMPLETED set's own `restSeconds`, falling back to the entry's
 * `restSeconds` when the set does not override.
 *
 * The two sites are NOT symmetric in what `currentEntry`'s set index means:
 *  - round-repeat (transition.lv:63-70) leaves you on the same entry;
 *  - group-exhausted (transition.lv:103-107) has already advanced position.
 * The completed set is `entries[exerciseIndex].sets[setIndex]` — the INPUT
 * position — at BOTH sites, never the advanced landing. These tests pin that by
 * making the completed set's rest distinct from the entry default AND from any
 * neighbouring set, so a reader that reached for the wrong index or the entry
 * default fails on a specific number.
 *
 * The discriminating fixture is a DROP SET: three descending loads at
 * rest 0 / 0 / full. No exercise-level rest can express it — a single value is
 * either 0 (no rest ever) or full (rest between the drops too).
 */

import { createEngine } from './index';
import type { SessionState, RoutineEntry } from './types';

function makeState(entries: RoutineEntry[], overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'session-per-set-rest',
    routineId: 'routine-per-set-rest',
    phase: 'working',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: 0,
    loggedSets: [],
    lastLoggedSet: undefined,
    startedAtMs: 1000,
    prePausePhase: '',
    entries,
    ...overrides,
  };
}

function makeExecutors() {
  return {
    onCreateSession: jest.fn(),
    onScheduleRest: jest.fn(),
    onCancelRest: jest.fn(),
    onNotify: jest.fn(),
    onPersistSet: jest.fn(),
    onCompleteSession: jest.fn(),
    onDiscardSession: jest.fn(),
  };
}

describe('#281: a drop set gets 0 / 0 / full rest', () => {
  // A standalone drop set (idx 0) followed by a second exercise (idx 1) so the
  // last drop's rest is observable at the GROUP-EXHAUSTED site. Exercise-level
  // rest is 90 on both — every scheduled rest that reads 90 is the bug.
  function dropRoutine(): RoutineEntry[] {
    return [
      {
        idx: 0,
        exerciseId: 'lat-pulldown',
        kind: 'strength',
        restSeconds: 90,
        supersetGroup: '',
        sets: [
          { setType: 'normal', reps: 10, weightKg: 40, restSeconds: 0 },
          { setType: 'normal', reps: 10, weightKg: 30, restSeconds: 0 },
          { setType: 'normal', reps: 10, weightKg: 20, restSeconds: 120 },
        ],
      },
      {
        idx: 1,
        exerciseId: 'cable-row',
        kind: 'strength',
        restSeconds: 90,
        supersetGroup: '',
        sets: [{ setType: 'normal', reps: 8, weightKg: 50 }],
      },
    ];
  }

  it('schedules NO rest between the drops (round-repeat site reads the completed set: 0)', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState(dropRoutine(), { exerciseIndex: 0, setIndex: 0 }));

    // Drop 1 → drop 2. Completed set 0 has restSeconds 0, so no rest, despite
    // the exercise default being 90. A per-exercise reading would fire 90s here.
    const afterFirst = await engine.dispatch({ tag: 'SetDone', nowMs: 1000 });
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
    expect(afterFirst.phase).toBe('working');
    expect(afterFirst.setIndex).toBe(1);
    expect(afterFirst.exerciseIndex).toBe(0);

    // Drop 2 → drop 3. Completed set 1 has restSeconds 0. Still no rest.
    const afterSecond = await engine.dispatch({ tag: 'SetDone', nowMs: 2000 });
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
    expect(afterSecond.phase).toBe('working');
    expect(afterSecond.setIndex).toBe(2);
  });

  it('schedules FULL rest after the last drop (group-exhausted site reads the completed set: 120)', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    // Sitting on the final drop (set 2), about to finish the group.
    engine.setState(makeState(dropRoutine(), { exerciseIndex: 0, setIndex: 2 }));

    const afterLast = await engine.dispatch({ tag: 'SetDone', nowMs: 3000 });

    // The completed set (set 2) prescribes 120s — not the exercise default 90,
    // and not the landing entry's own rest. Deadline = 3000 + 120*1000.
    expect(executors.onScheduleRest).toHaveBeenCalledTimes(1);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(123000);
    expect(afterLast.phase).toBe('resting');
    expect(afterLast.exerciseIndex).toBe(1); // landed on cable-row
    expect(afterLast.setIndex).toBe(0);
  });
});

describe('#281: per-set overrides, absent falls back to the exercise', () => {
  // Standalone entry, set 0 overrides to 30, set 1 does NOT override (inherits
  // the exercise default 90). A second exercise follows so set 1's rest is
  // observable at the group-exhausted site.
  function fallbackRoutine(): RoutineEntry[] {
    return [
      {
        idx: 0,
        exerciseId: 'squat',
        kind: 'strength',
        restSeconds: 90,
        supersetGroup: '',
        sets: [
          { setType: 'normal', reps: 5, restSeconds: 30 }, // explicit override
          { setType: 'normal', reps: 5 }, // no override → inherits 90
        ],
      },
      {
        idx: 1,
        exerciseId: 'lunge',
        kind: 'strength',
        restSeconds: 90,
        supersetGroup: '',
        sets: [{ setType: 'normal', reps: 8 }],
      },
    ];
  }

  it('round-repeat site reads the completed set OVERRIDE (30), not the exercise default', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(makeState(fallbackRoutine(), { exerciseIndex: 0, setIndex: 0 }));

    // Completed set 0 overrides to 30. Deadline 5000 + 30*1000 = 35000.
    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 5000 });
    expect(executors.onScheduleRest).toHaveBeenCalledTimes(1);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(35000);
    expect(state.phase).toBe('resting');
    expect(state.setIndex).toBe(1);
    expect(state.exerciseIndex).toBe(0);
  });

  it('group-exhausted site FALLS BACK to the exercise default (90) when the completed set has no override', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    // On set 1 (no override), finishing the entry.
    engine.setState(makeState(fallbackRoutine(), { exerciseIndex: 0, setIndex: 1 }));

    // Completed set 1 has no restSeconds → fallback to exercise 90. Deadline
    // 6000 + 90*1000 = 96000. A reader that grabbed set 0's 30 by mistake, or
    // the landing entry's rest, would produce a different number.
    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 6000 });
    expect(executors.onScheduleRest).toHaveBeenCalledTimes(1);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(96000);
    expect(state.phase).toBe('resting');
    expect(state.exerciseIndex).toBe(1);
  });
});

describe('#281: the superset no-rest hop stays rest-free with per-set rest', () => {
  // Two members of superset group G, each carrying an explicit non-zero per-set
  // rest. The hand-off between partners must schedule NO rest — convention 9 —
  // and a per-set value must not reintroduce one there.
  function supersetRoutine(): RoutineEntry[] {
    return [
      {
        idx: 0,
        exerciseId: 'bench',
        kind: 'strength',
        restSeconds: 60,
        supersetGroup: 'G',
        sets: [
          { setType: 'normal', reps: 8, restSeconds: 45 },
          { setType: 'normal', reps: 8, restSeconds: 45 },
        ],
      },
      {
        idx: 1,
        exerciseId: 'row',
        kind: 'strength',
        restSeconds: 60,
        supersetGroup: 'G',
        sets: [
          { setType: 'normal', reps: 8, restSeconds: 45 },
          { setType: 'normal', reps: 8, restSeconds: 45 },
        ],
      },
    ];
  }

  it('hands off A → B within a round with NO rest, despite A carrying a per-set rest', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    engine.setState(
      makeState(supersetRoutine(), { exerciseIndex: 0, setIndex: 0, supersetPosition: 0 })
    );

    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 1000 });

    // The hop is the `Some(nextIdx)` branch — it never touches completed_set_rest.
    expect(executors.onScheduleRest).not.toHaveBeenCalled();
    expect(state.phase).toBe('working');
    expect(state.exerciseIndex).toBe(1); // hopped to the partner
    expect(state.setIndex).toBe(0); // same round
    expect(state.supersetPosition).toBe(1);
  });

  it('at the round boundary (B finishes the round) it schedules B\'s completed-set rest (45)', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    // On B (idx 1), round 0, having just been handed off to.
    engine.setState(
      makeState(supersetRoutine(), { exerciseIndex: 1, setIndex: 0, supersetPosition: 1 })
    );

    const state = await engine.dispatch({ tag: 'SetDone', nowMs: 2000 });

    // Nobody after B is active this round → round repeats from A. The rest is
    // B's completed set 0 override: 45. Deadline 2000 + 45*1000 = 47000.
    expect(executors.onScheduleRest).toHaveBeenCalledTimes(1);
    expect(executors.onScheduleRest).toHaveBeenCalledWith(47000);
    expect(state.phase).toBe('resting');
    expect(state.exerciseIndex).toBe(0); // looped back to A
    expect(state.setIndex).toBe(1); // next round
  });
});

describe('#281: per-set rest survives rehydrate (convention 5)', () => {
  it('reads the completed set override after a persist → JSON round-trip → hydrate', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);

    const persisted: SessionState = makeState(
      [
        {
          idx: 0,
          exerciseId: 'squat',
          kind: 'strength',
          restSeconds: 90,
          supersetGroup: '',
          sets: [
            { setType: 'normal', reps: 5, restSeconds: 30 },
            { setType: 'normal', reps: 5, restSeconds: 30 },
          ],
        },
        {
          idx: 1,
          exerciseId: 'lunge',
          kind: 'strength',
          restSeconds: 90,
          supersetGroup: '',
          sets: [{ setType: 'normal', reps: 8 }],
        },
      ],
      { exerciseIndex: 0, setIndex: 0 }
    );

    // The kill/relaunch boundary: state is stored as a JSON blob (engine_state)
    // and rehydrated through hydrate/setState, which no rule validates.
    const rehydrated = JSON.parse(JSON.stringify(persisted)) as SessionState;
    expect(rehydrated.entries[0].sets[0].restSeconds).toBe(30);

    engine.setState(rehydrated);
    await engine.dispatch({ tag: 'SetDone', nowMs: 1000 });

    // The per-set override (30) is read, not the entry default (90) — the
    // lookup survived the round-trip. 1000 + 30*1000 = 31000.
    expect(executors.onScheduleRest).toHaveBeenCalledWith(31000);
  });
});

describe('#281: an all-null-rest routine behaves exactly as the exercise default', () => {
  it('schedules the exercise rest at both sites when no set overrides', async () => {
    const executors = makeExecutors();
    const engine = createEngine(executors);
    // Two standalone entries, no per-set rest anywhere. Entry rest 60.
    const entries: RoutineEntry[] = [
      {
        idx: 0,
        exerciseId: 'ex-0',
        kind: 'strength',
        restSeconds: 60,
        supersetGroup: '',
        sets: [
          { setType: 'normal', reps: 8 },
          { setType: 'normal', reps: 8 },
        ],
      },
      {
        idx: 1,
        exerciseId: 'ex-1',
        kind: 'strength',
        restSeconds: 60,
        supersetGroup: '',
        sets: [{ setType: 'normal', reps: 8 }],
      },
    ];

    // Round-repeat within ex-0: fallback to entry 60. 1000 + 60000 = 61000.
    const engine1 = engine;
    engine1.setState(makeState(entries, { exerciseIndex: 0, setIndex: 0 }));
    await engine1.dispatch({ tag: 'SetDone', nowMs: 1000 });
    expect(executors.onScheduleRest).toHaveBeenLastCalledWith(61000);

    // Group-exhausted after ex-0's last set: fallback to entry 60. 5000+60000.
    engine1.setState(makeState(entries, { exerciseIndex: 0, setIndex: 1 }));
    await engine1.dispatch({ tag: 'SetDone', nowMs: 5000 });
    expect(executors.onScheduleRest).toHaveBeenLastCalledWith(65000);
  });
});
