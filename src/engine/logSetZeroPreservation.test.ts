/**
 * #305 — a logged zero is a measurement, not absence.
 *
 * `engine/index.ts`'s `LogSet` host→Rill conversion once folded `reps === 0`,
 * `weightKg === 0` and `durationSeconds === 0` into `undefined` via three
 * zero-sentinels that were never in `SENTINEL_TO_OPTION_MAP`. A set of zero
 * reps and a bodyweight (0 kg) set are real logged measurements — the vault
 * contract writes `1x0` and `weight=0` as-is (PR #89) — so collapsing them at
 * the boundary produced the unexportable #288 shape one layer below the guard
 * that #304 added to stop it.
 *
 * These tests drive the real engine end to end: they dispatch `LogSet`, capture
 * the value handed to `onPersistSet`, and read the same value back out of the
 * post-dispatch `SessionState` (`loggedSets` and host-maintained
 * `lastLoggedSet`) — the round trip that `setInputs.test.ts` and the
 * serializer fixtures could never see, because each exercises only one side of
 * the boundary that erased it. `rpe: -1` stays the one legitimate sentinel on
 * this event.
 */

import { createEngine } from './index';
import type { SessionState } from './types';

function idleState(): SessionState {
  return {
    sessionId: 'session-305',
    routineId: 'routine-305',
    phase: 'idle',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: 0,
    loggedSets: [],
    lastLoggedSet: undefined,
    startedAtMs: 1000,
    prePausePhase: '',
    entries: [],
  };
}

function makeEngine() {
  const persisted: Record<string, unknown>[] = [];
  const engine = createEngine({
    onCreateSession: jest.fn(),
    onScheduleRest: jest.fn(),
    onCancelRest: jest.fn(),
    onNotify: jest.fn(),
    onCompleteSession: jest.fn(),
    onDiscardSession: jest.fn(),
    onPersistSet: jest.fn((set: Record<string, unknown>) => {
      persisted.push(set);
    }),
  } as never);
  engine.setState(idleState());
  return { engine, persisted };
}

/** Start a single-exercise session that lands directly in `working`. */
async function startWorkingSession(
  engine: ReturnType<typeof createEngine>,
  entry: Record<string, unknown>
) {
  await engine.dispatch({
    tag: 'StartSession',
    sessionId: 'session-305',
    nowMs: 1000,
    routine: {
      id: 'routine-305',
      entries: [
        {
          exerciseId: 'bench-press',
          kind: 'strength',
          restSeconds: 60,
          supersetGroup: '',
          ...entry,
        },
      ],
    },
  } as never);
}

describe('LogSet preserves logged zeros through the engine (#305)', () => {
  it('reps: 0 (strength) reaches onPersistSet and the state as reps: 0, not absence', async () => {
    const { engine, persisted } = makeEngine();
    await startWorkingSession(engine, {
      sets: [{ setType: 'normal', reps: 8 }],
    });

    const state = await engine.dispatch({
      tag: 'LogSet',
      reps: 0,
      weightKg: 60.0,
      nowMs: 10000,
    } as never);

    // The effect payload the host persists.
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ reps: 0 });
    // And the same value survives back out through fromRillState.
    expect(state.loggedSets).toHaveLength(1);
    expect(state.loggedSets[0].reps).toBe(0);
    expect(state.lastLoggedSet?.reps).toBe(0);
  });

  it('weightKg: 0 (bodyweight) is preserved as 0, not erased', async () => {
    const { engine, persisted } = makeEngine();
    await startWorkingSession(engine, {
      sets: [{ setType: 'normal', reps: 12 }],
    });

    const state = await engine.dispatch({
      tag: 'LogSet',
      reps: 12,
      weightKg: 0,
      nowMs: 10000,
    } as never);

    expect(persisted[0]).toMatchObject({ reps: 12, weightKg: 0 });
    expect(state.loggedSets[0].weightKg).toBe(0);
    expect(state.lastLoggedSet?.weightKg).toBe(0);
  });

  it('durationSeconds: 0 is preserved as 0, not erased', async () => {
    const { engine, persisted } = makeEngine();
    await startWorkingSession(engine, {
      kind: 'cardio',
      sets: [{ setType: 'normal', durationSeconds: 30 }],
    });

    const state = await engine.dispatch({
      tag: 'LogSet',
      durationSeconds: 0,
      nowMs: 10000,
    } as never);

    expect(persisted[0]).toMatchObject({ durationSeconds: 0 });
    expect(state.loggedSets[0].durationSeconds).toBe(0);
    expect(state.lastLoggedSet?.durationSeconds).toBe(0);
  });

  it('the fix does not over-correct: an absent measurement stays absent (Rill None)', async () => {
    // A duration-based set logged with no reps must still carry reps as absent,
    // never coerced to 0. Only null/undefined maps to None; a genuine 0 does not.
    const { engine, persisted } = makeEngine();
    await startWorkingSession(engine, {
      kind: 'cardio',
      sets: [{ setType: 'normal', durationSeconds: 30 }],
    });

    const state = await engine.dispatch({
      tag: 'LogSet',
      durationSeconds: 45,
      nowMs: 10000,
    } as never);

    expect(persisted[0]).toMatchObject({ durationSeconds: 45 });
    expect(persisted[0].reps).toBeUndefined();
    expect(persisted[0].weightKg).toBeUndefined();
    expect(state.loggedSets[0].reps).toBeUndefined();
    expect(state.lastLoggedSet?.reps).toBeUndefined();
  });

  it('rpe keeps its -1 sentinel untouched: -1 is absence, an in-range rpe is preserved', async () => {
    // rpe is the field this fix deliberately does NOT change: 0 is off the
    // 1.0–10.0 RPE scale (the engine rejects it), which is exactly why -1 is
    // its documented sentinel and the one entry SENTINEL_TO_OPTION_MAP owns on
    // this event. A logged zero cannot be an rpe, so no measurement is lost by
    // mapping -1 → absent.
    const { engine, persisted } = makeEngine();
    await startWorkingSession(engine, {
      sets: [{ setType: 'normal', reps: 8 }, { setType: 'normal', reps: 8 }],
    });

    // rpe: -1 → absent (the documented sentinel, unchanged by this fix).
    // Logging set 0 arms a 60s rest (deadline = 10000 + 60_000).
    await engine.dispatch({ tag: 'LogSet', reps: 5, weightKg: 20, rpe: -1.0, nowMs: 10000 } as never);
    expect(persisted[0].rpe).toBeUndefined();

    // A real in-range rpe survives.
    await engine.dispatch({ tag: 'RestElapsed', nowMs: 70000 } as never);
    const state = await engine.dispatch({ tag: 'LogSet', reps: 5, weightKg: 20, rpe: 8.0, nowMs: 80000 } as never);
    expect(persisted[1]).toMatchObject({ rpe: 8.0 });
    expect(state.lastLoggedSet?.rpe).toBe(8.0);
  });
});
