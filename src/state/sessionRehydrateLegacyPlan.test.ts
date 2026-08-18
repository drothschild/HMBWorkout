/**
 * A persisted session whose entries predate the per-set plan must not brick the
 * app (#276 Phase 6).
 *
 * Engine convention 5 is explicit that `hydrate` is not a dispatch and that no
 * rule validates what it restores — so the shell owns the question of whether a
 * restored state is one this build can actually run. Through Phase 5 the answer
 * was always yes, because a derivation seam expanded an entry's aggregate counts
 * into a set list whenever `sets` was absent. Phase 6 deleted that seam, and
 * deleting it is what makes this guard necessary rather than theoretical.
 *
 * The shape: `{ warmupSets: 2, targetSets: 3, … }` with **no `sets` key at all**,
 * which is what `fromRillState` emitted before #276 Phase 2. It survives in
 * `sessions.engine_state` for any workout left in progress across an upgrade
 * from a Phase-1-era build. Phase 1's wipe cleared everything older, so this is
 * a narrow window — but it is a window whose failure mode is severe, verified by
 * execution before this guard existed:
 *
 *   deriveSetPosition -> THREW Cannot read properties of undefined (reading '0')
 *   engine.dispatch   -> THREW TypeError: Cannot read properties of undefined (reading 'map')
 *
 * and `_layout.tsx` catches a boot throw into `RuleErrorScreen`, so the user
 * lands on an unrecoverable error screen with no way to clear the stale session.
 * Refusing to restore it leaves the app usable.
 *
 * REFUSING IS ONLY HALF OF IT, and the half that was missing cost more than the
 * one abandoned workout this note originally claimed. `loadActiveEngineState`
 * returns the first `ended_at IS NULL` row carrying a state, unordered, so a
 * refused row that keeps its state is refused again on every subsequent boot and
 * shadows every later in-progress session — restart recovery dead for the life of
 * the install. The drop therefore clears the row's `engine_state`; the second
 * describe block below is that contract, and `sessionRehydrate.integration.test.ts`
 * proves it end to end against a real database, with the un-cleared failure mode
 * as an executed control.
 */

import {
  rehydrateActiveSession,
  type RehydrateDeps,
  type RehydrateSessionStore,
} from './sessionRehydrate';
import type { Event, SessionState } from '@/engine/types';

function legacyEntry(overrides: Record<string, unknown> = {}): any {
  return {
    idx: 0,
    exerciseId: 'bench-press-dumbbell',
    kind: 'strength',
    // The pre-Phase-2 aggregate shape. NO `sets`.
    warmupSets: 2,
    targetSets: 3,
    targetReps: 8,
    targetDurationSeconds: 0,
    restSeconds: 90,
    supersetGroup: '',
    ...overrides,
  };
}

function savedState(entries: unknown[], phase = 'working'): SessionState {
  return {
    sessionId: 'session-1',
    routineId: 'routine-1',
    phase,
    exerciseIndex: 0,
    setIndex: 0,
    loggedSets: [],
    startedAtMs: 1,
    entries,
  } as unknown as SessionState;
}

function fakeStore() {
  const hydrated: SessionState[] = [];
  const dispatched: Event[] = [];
  const cleared: string[] = [];
  const store: RehydrateSessionStore = {
    getState: () => ({
      hydrate: (state: SessionState) => {
        hydrated.push(state);
      },
      dispatch: async (event: Event) => {
        dispatched.push(event);
        return null;
      },
    }),
  };
  const deps: RehydrateDeps = {
    clearEngineState: async (sessionId: string) => {
      cleared.push(sessionId);
    },
  };
  return { store, hydrated, dispatched, deps, cleared };
}

describe('rehydrateActiveSession: a plan this build cannot run', () => {
  it('refuses to hydrate a session whose entries carry no set list', async () => {
    const { store, hydrated, dispatched, deps } = fakeStore();

    await rehydrateActiveSession(store, savedState([legacyEntry()]), 1000, deps);

    expect(hydrated).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('refuses even when the phase would otherwise dispatch Resume', async () => {
    // `paused` and `resting` are the two phases the boot path follows with a
    // Resume, and Resume is what would reach `toRillRoutineEntry` and throw.
    // The guard has to run BEFORE the phase check, not inside it.
    for (const phase of ['paused', 'resting']) {
      const { store, hydrated, dispatched, deps } = fakeStore();
      await rehydrateActiveSession(store, savedState([legacyEntry()], phase), 1000, deps);
      expect(hydrated).toEqual([]);
      expect(dispatched).toEqual([]);
    }
  });

  it('refuses when only ONE of several entries is unrunnable', async () => {
    // A later entry is reached by advancing, not at boot, so a guard that only
    // inspected `entries[exerciseIndex]` would let the session in and throw
    // mid-workout instead — strictly worse, because the set the athlete just
    // logged is the one that disappears.
    const { store, hydrated, deps } = fakeStore();

    await rehydrateActiveSession(
      store,
      savedState([{ ...legacyEntry(), sets: [{ setType: 'normal', reps: 8 }] }, legacyEntry({ idx: 1 })]),
      1000,
      deps
    );

    expect(hydrated).toEqual([]);
  });

  it('still hydrates a session whose entries DO carry a set list', async () => {
    // The guard must not be a blanket refusal — this is the ordinary path and
    // it is what every other rehydrate test exercises.
    const { store, hydrated, dispatched, deps } = fakeStore();
    const state = savedState([
      { ...legacyEntry(), sets: [{ setType: 'warmup', reps: 8 }, { setType: 'normal', reps: 8 }] },
    ]);

    await rehydrateActiveSession(store, state, 1000, deps);

    expect(hydrated).toEqual([state]);
    expect(dispatched).toEqual([]);
  });

  it('accepts an entry that legitimately prescribes nothing', async () => {
    // `sets: []` is a real, restorable state (engine convention 10) and must be
    // told apart from an ABSENT list. Conflating them would refuse to restore a
    // perfectly good session that happens to contain a zero-set entry.
    const { store, hydrated, deps } = fakeStore();
    const state = savedState([
      { ...legacyEntry(), sets: [] },
      { ...legacyEntry(), idx: 1, sets: [{ setType: 'normal', reps: 5 }] },
    ]);

    await rehydrateActiveSession(store, state, 1000, deps);

    expect(hydrated).toEqual([state]);
  });

  it('refuses a `sets` that is present but not an array', async () => {
    // The guard tests arrayness, not presence, and this is what holds that
    // apart: a `!== undefined` check passes `null` and then `.map` throws
    // downstream anyway, which is the failure this module exists to prevent —
    // moved one frame later and therefore harder to attribute.
    //
    // Nothing writes `sets: null` today. That is exactly why it belongs here:
    // `hydrate` restores whatever is in `sessions.engine_state`, no rule
    // validates it (engine convention 5), and a JSON blob on a device that has
    // been through six schema versions is not a shape this module gets to
    // assume. Defense in depth, with a fixture rather than a comment.
    for (const bad of [null, 3, 'warmup,normal', {}]) {
      const { store, hydrated, deps } = fakeStore();
      await rehydrateActiveSession(store, savedState([legacyEntry({ sets: bad })]), 1000, deps);
      expect(hydrated).toEqual([]);
    }
  });

  it('accepts a session with no entries at all rather than reading it as unrunnable', async () => {
    // Vacuously fine: there is no entry missing a list. The engine's own
    // empty-routine guard is a different layer and rejects at StartSession.
    const { store, hydrated, deps } = fakeStore();
    const state = savedState([]);

    await rehydrateActiveSession(store, state, 1000, deps);

    expect(hydrated).toEqual([state]);
  });

  it('refuses a state with no `entries` key at all', async () => {
    // `entries ?? []` admitted this, because `[].every(...)` is vacuously true —
    // and the state then reached `toRillRoutineEntry` through
    // `tsState.entries.map(...)` and threw the SAME TypeError the guard exists
    // to prevent, one field over. "A state written by a build that predates the
    // field" is this guard's own threat model, and `entries` is a field like any
    // other. `Array.isArray` is what tells an absent list from an empty one at
    // the top level, exactly as it does per entry.
    const { store, hydrated, dispatched, deps } = fakeStore();
    const state = savedState([]);
    delete (state as any).entries;

    await rehydrateActiveSession(store, state, 1000, deps);

    expect(hydrated).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('refuses an `entries` that is present but not an array', async () => {
    for (const bad of [null, 3, 'bench', {}]) {
      const { store, hydrated, deps } = fakeStore();
      const state = savedState([]);
      (state as any).entries = bad;

      await rehydrateActiveSession(store, state, 1000, deps);

      expect(hydrated).toEqual([]);
    }
  });
});

describe('rehydrateActiveSession: the dropped row must not shadow the next one', () => {
  it('clears the dropped session`s engine_state', async () => {
    // Retaining the row WITH its state looked conservative and is the opposite.
    // `loadActiveEngineState` returns the FIRST `ended_at IS NULL` row carrying
    // a non-null `engine_state`, with no ordering, and the dropped row is the
    // older one — so it is returned again on every subsequent boot and the
    // later, perfectly valid in-progress session behind it is never reached.
    // Clearing the state (rather than destroying the row) removes the shadow
    // and keeps the row as the audit trail.
    const { store, hydrated, deps, cleared } = fakeStore();

    await rehydrateActiveSession(store, savedState([legacyEntry()]), 1000, deps);

    expect(hydrated).toEqual([]);
    expect(cleared).toEqual(['session-1']);
  });

  it('clears on every drop reason, not just the missing-per-entry-list one', async () => {
    const drops: SessionState[] = [
      savedState([legacyEntry()]),
      savedState([legacyEntry({ sets: null })]),
      savedState([]),
    ];
    delete (drops[2] as any).entries;

    for (const state of drops) {
      const { store, hydrated, deps, cleared } = fakeStore();
      await rehydrateActiveSession(store, state, 1000, deps);
      expect(hydrated).toEqual([]);
      expect(cleared).toEqual(['session-1']);
    }
  });

  it('does NOT clear a state it restores', async () => {
    // The other half of the contract: clearing a runnable session's state would
    // destroy restart recovery outright rather than merely shadowing it.
    const { store, hydrated, deps, cleared } = fakeStore();
    const state = savedState([{ ...legacyEntry(), sets: [{ setType: 'normal', reps: 8 }] }]);

    await rehydrateActiveSession(store, state, 1000, deps);

    expect(hydrated).toEqual([state]);
    expect(cleared).toEqual([]);
  });

  it('still leaves the app usable when the clear itself fails', async () => {
    // A throw here would escape the boot effect into `RuleErrorScreen` — the
    // exact unrecoverable screen the drop exists to avoid. Swallowed and logged:
    // the shadow survives, which is no worse than not clearing at all, and the
    // app boots.
    const { store, hydrated } = fakeStore();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const deps: RehydrateDeps = {
      clearEngineState: async () => {
        throw new Error('db write failed');
      },
    };

    await expect(
      rehydrateActiveSession(store, savedState([legacyEntry()]), 1000, deps)
    ).resolves.toBeUndefined();

    expect(hydrated).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
