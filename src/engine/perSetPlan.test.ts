/**
 * Per-set routine plan (#276 Phase 2, aggregates removed in Phase 6) — the
 * engine advances by set list.
 *
 * A routine entry no longer says "3 warmup sets then 4 working sets of 8". It
 * carries an ordered `sets` list and each set declares its own type, reps and
 * weight — `RoutineEntry.sets` is required, and the four aggregate count
 * fields (`warmupSets`/`targetSets`/`targetReps`/`targetDurationSeconds`) no
 * longer exist on the type at all: there is no derivation seam left to
 * regress on. The "derivation seam, both directions" describe block that
 * exercised the counts-to-list expansion and the re-derivation back to counts
 * was deleted in #276 Phase 6 along with `src/engine/entrySets.ts`
 * (`setsFromCounts`/`entrySets`) — see the top of that describe block's
 * former location for a fuller note.
 *
 * ON `toEqual` VS `toStrictEqual`. `rillToJs` omits a `None` field entirely
 * rather than emitting `undefined`, and `fromRillState` re-spells the absent
 * keys as explicit `undefined`. Either way an expectation written without those
 * keys only matches under `toEqual`. Use `toEqual` throughout (AC2.12).
 */

import { createEngine, SENTINEL_TO_OPTION_MAP } from './index';
import { loadRules } from './loadRules';
import type { RoutineEntry, RoutineSet, SessionState } from './types';
import * as fs from 'fs';
import * as path from 'path';

const rulesDir = path.join(__dirname, 'rules');
const typesSource = fs.readFileSync(path.join(rulesDir, 'types.lv'), 'utf-8');
const helpersSource = fs.readFileSync(path.join(rulesDir, 'helpers.lv'), 'utf-8');
const transitionSource = fs.readFileSync(path.join(rulesDir, 'transition.lv'), 'utf-8');

/** Rule source with `--` comment lines stripped, for assertions about code rather than prose. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const helpersCode = codeOnly(helpersSource);

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

/** A per-set entry. */
function perSetEntry(
  idx: number,
  exerciseId: string,
  sets: RoutineSet[],
  overrides: Partial<RoutineEntry> = {},
): RoutineEntry {
  return {
    idx,
    exerciseId,
    kind: 'strength',
    restSeconds: 0,
    supersetGroup: '',
    sets,
    ...overrides,
  };
}

/**
 * RAMP — the real Hevy Bench Press (Dumbbell) prescription. Three ascending
 * warmups then four working sets. The aggregate model cannot represent this at
 * all: it can only record the number 3.
 */
const RAMP: RoutineSet[] = [
  { setType: 'warmup', reps: 5, weightKg: 9.07 },
  { setType: 'warmup', reps: 5, weightKg: 11.34 },
  { setType: 'warmup', reps: 3, weightKg: 18.14 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
  { setType: 'normal', reps: 8, repsMax: 10, weightKg: 22.68 },
];

/**
 * INTERLEAVE — a warmup after a working set. No warmup *count* reproduces this
 * at any value: `setIndex < warmupSets` gives warmup,working,working at 1 and
 * warmup,warmup,working at 2. Only reading each set's own declared type works.
 */
const INTERLEAVE: RoutineSet[] = [
  { setType: 'warmup', reps: 5, weightKg: 20 },
  { setType: 'normal', reps: 8, weightKg: 40 },
  { setType: 'warmup', reps: 5, weightKg: 20 },
];

function startedEngine(entries: RoutineEntry[], nowMs = 1000) {
  const engine = createEngine(makeExecutors());
  return {
    engine,
    start: () =>
      engine.dispatch({
        tag: 'StartSession',
        sessionId: 'session-per-set',
        nowMs,
        routine: { id: 'routine-per-set', entries },
      }),
  };
}

/** Log sets until the workout is Done (or `max` sets, whichever comes first). */
async function logUntilDone(
  engine: ReturnType<typeof createEngine>,
  state: SessionState,
  max = 20,
): Promise<{ trace: { phase: string; exerciseIndex: number; setIndex: number; supersetPosition: number }[]; final: SessionState }> {
  const trace: { phase: string; exerciseIndex: number; setIndex: number; supersetPosition: number }[] = [];
  let current = state;
  for (let i = 0; i < max && current.phase !== 'done'; i++) {
    trace.push({
      phase: current.phase,
      exerciseIndex: current.exerciseIndex,
      setIndex: current.setIndex,
      supersetPosition: current.supersetPosition ?? 0,
    });
    current = await engine.dispatch({ tag: 'LogSet', reps: 5, nowMs: 2000 + i * 1000 });
  }
  return { trace, final: current };
}

describe('per-set routine plan: the rules declare a set list (AC2.1–AC2.3)', () => {
  it('AC2.1: types.lv declares RoutineSet and RoutineEntry carries sets, not counts', () => {
    expect(typesSource).toContain('alias RoutineSet =');
    for (const field of ['setType: String', 'reps: Option(Int)', 'repsMax: Option(Int)', 'weightKg: Option(Float)', 'durationSeconds: Option(Int)', 'distanceM: Option(Float)']) {
      expect(typesSource).toContain(field);
    }

    const entryAlias = typesSource.split('\n').find((line) => line.startsWith('alias RoutineEntry ='));
    expect(entryAlias).toBeDefined();
    expect(entryAlias).toContain('sets: List(RoutineSet)');
    for (const gone of ['warmupSets', 'targetSets', 'targetReps', 'targetDurationSeconds']) {
      expect(entryAlias).not.toContain(gone);
    }
  });

  it('AC2.1: no rule file reads an aggregate count any more', () => {
    for (const source of [typesSource, helpersSource, transitionSource]) {
      expect(source).not.toMatch(/warmupSets|targetSets|targetReps|targetDurationSeconds/);
    }
  });

  it('AC2.2: loadRules() type-checks the per-set rules', () => {
    expect(() => loadRules()).not.toThrow();
  });

  it('AC2.3: phase_for discharges at() with match Ok/Err, not the pipe-catch form', () => {
    // `at(i, entry.sets) |> fn(s) -> … |> catch e -> …` does not compile:
    // rill-lang's `|>` does not auto-unwrap a Result ("Cannot unify TRecord
    // with TUnion"). The match form keeps phase_for total so all of its call
    // sites can use it in value position inside a record literal.
    expect(helpersSource).toMatch(/let phase_for = fn\(entry\) -> fn\(setIndex\) -> \(\s*\n\s*match at\(setIndex, entry\.sets\) \{/);
    expect(helpersSource).toContain('Err(e) -> Working');
    // Comment lines are excluded: the docstring quotes the broken form on purpose.
    expect(helpersCode).not.toMatch(/entry\.sets\)\s*\|>/);
  });

  it('AC2.3: both activity predicates key on the set list length', () => {
    expect(helpersSource).toContain('round < length(entry.sets)');
    expect(helpersSource).toContain('let isActive = length(entry.sets) > 0');
  });
});

describe('per-set routine plan: set types come from the list (AC2.4, AC2.5)', () => {
  it('AC2.4: RAMP stamps three warmups then four working sets', async () => {
    const { engine, start } = startedEngine([perSetEntry(0, 'bench-press-dumbbell', RAMP)]);
    const started = await start();
    const { trace, final } = await logUntilDone(engine, started);

    expect(final.loggedSets.map((s) => s.setType)).toEqual([
      'warmup', 'warmup', 'warmup', 'working', 'working', 'working', 'working',
    ]);
    expect(trace.map((t) => t.phase)).toEqual([
      'warmup', 'warmup', 'warmup', 'working', 'working', 'working', 'working',
    ]);
    expect(final.phase).toBe('done');
  });

  it('AC2.5: INTERLEAVE stamps warmup, working, warmup — no count can do this', async () => {
    const { engine, start } = startedEngine([perSetEntry(0, 'interleaved', INTERLEAVE)]);
    const started = await start();
    const { trace, final } = await logUntilDone(engine, started);

    expect(final.loggedSets.map((s) => s.setType)).toEqual(['warmup', 'working', 'warmup']);
    expect(trace.map((t) => t.phase)).toEqual(['warmup', 'working', 'warmup']);
  });

  it('AC2.5: INTERLEAVE recovers the same interleaved phase after a rest', async () => {
    // phase_for is also the recovery path (RestElapsed / SkipRest). Landing back
    // on set 2 must recover Warmup, which a count-based derivation cannot do
    // once a working set precedes it.
    const { engine, start } = startedEngine([perSetEntry(0, 'interleaved', INTERLEAVE, { restSeconds: 60 })]);
    let state = await start();
    expect(state.phase).toBe('warmup');

    state = await engine.dispatch({ tag: 'LogSet', reps: 5, nowMs: 2000 });
    expect(state.phase).toBe('resting');
    state = await engine.dispatch({ tag: 'SkipRest' });
    expect(state.phase).toBe('working');

    state = await engine.dispatch({ tag: 'LogSet', reps: 8, nowMs: 3000 });
    expect(state.phase).toBe('resting');
    state = await engine.dispatch({ tag: 'SkipRest' });
    expect(state.phase).toBe('warmup');
  });

  it('AC2.5: an expired rest reconciles to the phase of the set actually landed on', async () => {
    // reconcile_resting_deadline is the boot-Resume / AppForegrounded recovery.
    // The phase_for RECOVERY sites are FOUR, not three, and each needs its own
    // fixture — a guard on one is not a guard on the others:
    //
    //   transition.lv:133  reconcile_resting_deadline  (this test)
    //   transition.lv:220  RestElapsed / Resting       (restControls.test.ts)
    //   transition.lv:238  SkipRest / Resting          (the INTERLEAVE test above)
    //   transition.lv:246  SkipRest / Paused, frozen   (the next test)
    //
    // Reconciling at RAMP's index 3 must give Working; reading set 0 instead —
    // which every count-shaped fixture cannot tell apart, because a ramp's set 0
    // and set 3 differ only per-set — gives Warmup.
    const engine = createEngine(makeExecutors());
    engine.setState({
      sessionId: 'session-reconcile',
      routineId: 'routine-reconcile',
      phase: 'resting',
      exerciseIndex: 0,
      setIndex: 3,
      supersetPosition: 0,
      restDeadlineMs: 5000,
      restRemainingMs: 0,
      loggedSets: [],
      lastLoggedSet: undefined,
      startedAtMs: 1000,
      prePausePhase: '',
      entries: [perSetEntry(0, 'bench-press-dumbbell', RAMP, { restSeconds: 120 })],
    });

    const state = await engine.dispatch({ tag: 'AppForegrounded', nowMs: 9000 });
    expect(state.phase).toBe('working');
    expect(state.restDeadlineMs).toBe(0);
  });

  it('AC2.5: Skip Rest from a PAUSED frozen rest recovers the set actually landed on', async () => {
    // The fourth recovery site (transition.lv:246), and the last one to get a
    // fixture. Reachable by hand: pause during a rest, then tap Skip Rest on the
    // paused screen — PauseSession moved the live deadline into restRemainingMs,
    // so this arm, not the Resting one, is what runs. Reading set 0 instead of
    // setIndex gives Warmup on a ramp; only a per-set plan can tell the two
    // apart, which is why the aggregate-era suite never covered it.
    const engine = createEngine(makeExecutors());
    engine.setState({
      sessionId: 'session-paused-skip',
      routineId: 'routine-paused-skip',
      phase: 'paused',
      prePausePhase: 'resting',
      exerciseIndex: 0,
      setIndex: 3,
      supersetPosition: 0,
      restDeadlineMs: 0,
      restRemainingMs: 30000,
      loggedSets: [],
      lastLoggedSet: undefined,
      startedAtMs: 1000,
      entries: [perSetEntry(0, 'bench-press-dumbbell', RAMP, { restSeconds: 120 })],
    });

    const state = await engine.dispatch({ tag: 'SkipRest' });

    expect(state.phase).toBe('working');
    expect(state.restRemainingMs).toBe(0);
    expect(state.prePausePhase).toBe('');
  });

  it('AC2.5: Skip Rest from a paused frozen rest recovers a WARMUP set as warmup', async () => {
    // The other half of the discrimination: same arm, same fixture shape, an
    // index whose set is a warmup. Without this, a mutant hard-coding Working
    // at :246 would pass the test above. INTERLEAVE's set 2 is a warmup that
    // follows a working set, so no warmup COUNT reproduces it either.
    const engine = createEngine(makeExecutors());
    engine.setState({
      sessionId: 'session-paused-skip-warmup',
      routineId: 'routine-paused-skip-warmup',
      phase: 'paused',
      prePausePhase: 'resting',
      exerciseIndex: 0,
      setIndex: 2,
      supersetPosition: 0,
      restDeadlineMs: 0,
      restRemainingMs: 30000,
      loggedSets: [],
      lastLoggedSet: undefined,
      startedAtMs: 1000,
      entries: [perSetEntry(0, 'interleaved', INTERLEAVE, { restSeconds: 60 })],
    });

    const state = await engine.dispatch({ tag: 'SkipRest' });

    expect(state.phase).toBe('warmup');
  });

  it('AC2.5: a rehydrated setIndex past the end of the list does not stamp a warmup', async () => {
    // set_type_at must stay total (phase_for's Ok/Err form), and its Err
    // default is reachable: `hydrate` is not validated by any rule (convention
    // 5), so a session persisted by an older build can come back sitting on an
    // index its set list no longer covers. The inert answer is "not a warmup".
    const engine = createEngine(makeExecutors());
    engine.setState({
      sessionId: 'session-stale',
      routineId: 'routine-stale',
      phase: 'working',
      exerciseIndex: 0,
      setIndex: 9,
      supersetPosition: 0,
      restDeadlineMs: 0,
      restRemainingMs: 0,
      loggedSets: [],
      lastLoggedSet: undefined,
      startedAtMs: 1000,
      prePausePhase: '',
      entries: [perSetEntry(0, 'bench-press-dumbbell', RAMP)],
    });

    const state = await engine.dispatch({ tag: 'LogSet', reps: 8, nowMs: 2000 });
    expect(state.loggedSets.map((s) => s.setType)).toEqual(['working']);
  });

  it('AC2.4: a non-strength entry still stamps its kind for a non-warmup set', async () => {
    const { engine, start } = startedEngine([
      perSetEntry(0, 'hamstring-stretch', [{ setType: 'warmup', durationSeconds: 20 }, { setType: 'normal', durationSeconds: 30 }], { kind: 'stretch' }),
    ]);
    const started = await start();
    const { final } = await logUntilDone(engine, started);
    expect(final.loggedSets.map((s) => s.setType)).toEqual(['warmup', 'stretch']);
  });
});

describe('per-set routine plan: convention 9 survives (AC2.6)', () => {
  it('AC2.6: MISMATCH alternates and the round does not end when the shorter partner is exhausted', async () => {
    const entries = [
      perSetEntry(0, 'incline-press', [{ setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }], { supersetGroup: 'G5' }),
      perSetEntry(1, 'cable-row', [{ setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }], { supersetGroup: 'G5' }),
    ];
    const { engine, start } = startedEngine(entries);
    const started = await start();
    const { trace, final } = await logUntilDone(engine, started);

    expect(final.loggedSets.map((s) => s.exerciseId)).toEqual([
      'incline-press', 'cable-row', 'incline-press', 'cable-row', 'incline-press',
    ]);
    expect(trace.map((t) => [t.exerciseIndex, t.setIndex, t.supersetPosition])).toEqual([
      [0, 0, 0], [1, 0, 1], [0, 1, 0], [1, 1, 1], [0, 2, 0],
    ]);
    expect(final.phase).toBe('done');
  });
});

describe('per-set routine plan: convention 10 survives (AC2.7–AC2.9)', () => {
  it('AC2.7: StartSession never lands on an entry with an empty set list', async () => {
    const entries = [
      perSetEntry(0, 'ghost', []),
      perSetEntry(1, 'real', [{ setType: 'warmup', reps: 5 }, { setType: 'normal', reps: 8 }]),
    ];
    const { start } = startedEngine(entries);
    const state = await start();

    expect(state.exerciseIndex).toBe(1);
    expect(state.phase).toBe('warmup');
  });

  it('AC2.7: advance_after_set skips past an empty set list', async () => {
    // WHY `opener` CARRIES TWO SETS. The landing at transition.lv:109 reads
    // `phase_for(nextEntry)(0)` — the set the athlete is about to face on the
    // NEW entry, never the round they were on when they left the old one. With
    // a one-set `opener` this test walked that line and still could not see it:
    // s.setIndex is 0 at the landing, so the bug's `phase_for(nextEntry)(s.setIndex)`
    // is literally the same call, and the mutation survived a passing assertion.
    // Two sets make the two calls disagree — index 1 is off the end of `closer`'s
    // one-set list, so the mutant recovers Working where the truth is Warmup.
    const entries = [
      perSetEntry(0, 'opener', [{ setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }]),
      perSetEntry(1, 'ghost', []),
      perSetEntry(2, 'closer', [{ setType: 'warmup', reps: 5 }]),
    ];
    const { engine, start } = startedEngine(entries);
    let state = await start();
    expect(state.exerciseIndex).toBe(0);

    state = await engine.dispatch({ tag: 'LogSet', reps: 8, nowMs: 2000 });
    expect(state.exerciseIndex).toBe(0);
    expect(state.setIndex).toBe(1);

    state = await engine.dispatch({ tag: 'LogSet', reps: 8, nowMs: 3000 });
    expect(state.exerciseIndex).toBe(2);
    expect(state.phase).toBe('warmup');
    expect(state.setIndex).toBe(0);
  });

  it('AC2.8: a routine where every entry has an empty set list is rejected', async () => {
    const { start } = startedEngine([perSetEntry(0, 'ghost-a', []), perSetEntry(1, 'ghost-b', [])]);
    await expect(start()).rejects.toThrow('routine has no entry with any sets to perform');
  });

  it('AC2.9: a landing that skips a whole empty group keeps the later group’s true start', async () => {
    const entries = [
      perSetEntry(0, 'opener', [{ setType: 'normal', reps: 8 }]),
      perSetEntry(1, 'dead-a', [], { supersetGroup: 'G1' }),
      perSetEntry(2, 'dead-b', [], { supersetGroup: 'G1' }),
      perSetEntry(3, 'lead-ghost', [], { supersetGroup: 'G2' }),
      perSetEntry(4, 'real-a', [{ setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }], { supersetGroup: 'G2' }),
      perSetEntry(5, 'real-b', [{ setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }], { supersetGroup: 'G2' }),
    ];
    const { engine, start } = startedEngine(entries);
    let state = await start();
    expect(state.exerciseIndex).toBe(0);

    state = await engine.dispatch({ tag: 'LogSet', reps: 8, nowMs: 2000 });
    // Group G2 starts at index 3 even though index 3 is itself unlandable, so
    // real-a sits at position 1 — not 0 (as a groupStart of 4 would give) and
    // not 4 (as a groupStart of 0 would give).
    expect(state.exerciseIndex).toBe(4);
    expect(state.supersetPosition).toBe(1);

    const rest = await logUntilDone(engine, state);
    expect(rest.trace.map((t) => [t.exerciseIndex, t.setIndex, t.supersetPosition])).toEqual([
      [4, 0, 1], [5, 0, 2], [4, 1, 1], [5, 1, 2],
    ]);
    expect(rest.final.phase).toBe('done');
  });
});

// The "derivation seam, both directions" describe block that used to follow
// this one — expanding `countEntry` (`warmupSets`/`targetSets`/`targetReps`/
// `targetDurationSeconds`) into a set list on the way in, and re-deriving
// those same counts from `entry.sets` on the way out — was deleted in #276
// Phase 6. `RoutineEntry.sets` is now required and the four aggregate fields
// no longer exist on the type, so there is no seam left to cover:
// `src/engine/entrySets.ts` (`setsFromCounts`/`entrySets`/`EntryCounts`) was
// deleted in the same phase.
describe('per-set routine plan: the boundary (AC2.11, AC2.12)', () => {
  it('AC2.11: ReplaceExercise swaps the id and carries the whole set list through', async () => {
    const engine = createEngine(makeExecutors());
    engine.setState({
      sessionId: 'session-replace',
      routineId: 'routine-replace',
      phase: 'warmup',
      exerciseIndex: 0,
      setIndex: 0,
      supersetPosition: 0,
      restDeadlineMs: 0,
      restRemainingMs: 0,
      loggedSets: [],
      lastLoggedSet: undefined,
      startedAtMs: 1000,
      prePausePhase: '',
      entries: [perSetEntry(0, 'bench-press-dumbbell', RAMP, { restSeconds: 120, supersetGroup: 'A' })],
    });

    const state = await engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'floor-press-dumbbell' });

    expect(state.entries[0].exerciseId).toBe('floor-press-dumbbell');
    expect(state.entries[0].sets).toEqual(RAMP);
    expect(state.entries[0].restSeconds).toBe(120);
    expect(state.entries[0].supersetGroup).toBe('A');
  });

  it('AC2.11: a swap is still rejected once a set has been recorded for the entry', async () => {
    const { engine, start } = startedEngine([perSetEntry(0, 'bench-press-dumbbell', RAMP)]);
    await start();
    await engine.dispatch({ tag: 'LogSet', reps: 5, nowMs: 2000 });

    await expect(
      engine.dispatch({ tag: 'ReplaceExercise', idx: 0, exerciseId: 'floor-press-dumbbell' }),
    ).rejects.toThrow('cannot replace an exercise once a set has already been recorded for it');
  });

  it('AC2.12: SENTINEL_TO_OPTION_MAP is not extended for the per-set fields', () => {
    expect(Object.keys(SENTINEL_TO_OPTION_MAP).sort()).toEqual([
      'prePausePhase', 'restDeadlineMs', 'restRemainingMs', 'rpe', 'supersetGroup',
    ]);
  });

  it('AC2.12: an absent per-set field crosses back as undefined, not as a sentinel', async () => {
    const { start } = startedEngine([
      perSetEntry(0, 'plain', [{ setType: 'normal', reps: 8 }]),
    ]);
    const state = await start();
    const [set] = state.entries[0].sets ?? [];

    expect(set).toEqual({ setType: 'normal', reps: 8 });
    expect(set.weightKg ?? undefined).toBeUndefined();
    expect(set.repsMax ?? undefined).toBeUndefined();
    expect(set.durationSeconds ?? undefined).toBeUndefined();
    expect(set.distanceM ?? undefined).toBeUndefined();
    // A sentinel would have made these 0 / -1 (convention 8). They are honest.
    expect(set.weightKg).not.toBe(0);
    expect(set.repsMax).not.toBe(0);
  });

  it('AC2.12: a distance-carrying set survives both crossings', async () => {
    // `distanceM` was the one measurement no fixture exercised, so BOTH bridge
    // directions were unpinned — `toRillRoutineSet` and `fromRillRoutineSet`
    // could each hard-code `undefined` for it and the whole suite stayed green.
    // (`repsMax` is already covered: RAMP carries it and AC2.11's toEqual(RAMP)
    // catches its loss.) Inert in Phase 2, read from Phase 3 on.
    const rowing: RoutineSet[] = [{ setType: 'normal', distanceM: 2000, durationSeconds: 480 }];
    const { start } = startedEngine([perSetEntry(0, 'rowing-machine', rowing, { kind: 'cardio' })]);
    const state = await start();

    expect(state.entries[0].sets).toEqual(rowing);
    expect(state.entries[0].sets?.[0].distanceM).toBe(2000);
  });
});
