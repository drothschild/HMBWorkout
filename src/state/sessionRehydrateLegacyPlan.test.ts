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
 * Refusing to restore it leaves the app usable and costs one abandoned workout.
 */

import { rehydrateActiveSession, type RehydrateSessionStore } from './sessionRehydrate';
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
  return { store, hydrated, dispatched };
}

describe('rehydrateActiveSession: a plan this build cannot run', () => {
  it('refuses to hydrate a session whose entries carry no set list', async () => {
    const { store, hydrated, dispatched } = fakeStore();

    await rehydrateActiveSession(store, savedState([legacyEntry()]), 1000);

    expect(hydrated).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('refuses even when the phase would otherwise dispatch Resume', async () => {
    // `paused` and `resting` are the two phases the boot path follows with a
    // Resume, and Resume is what would reach `toRillRoutineEntry` and throw.
    // The guard has to run BEFORE the phase check, not inside it.
    for (const phase of ['paused', 'resting']) {
      const { store, hydrated, dispatched } = fakeStore();
      await rehydrateActiveSession(store, savedState([legacyEntry()], phase), 1000);
      expect(hydrated).toEqual([]);
      expect(dispatched).toEqual([]);
    }
  });

  it('refuses when only ONE of several entries is unrunnable', async () => {
    // A later entry is reached by advancing, not at boot, so a guard that only
    // inspected `entries[exerciseIndex]` would let the session in and throw
    // mid-workout instead — strictly worse, because the set the athlete just
    // logged is the one that disappears.
    const { store, hydrated } = fakeStore();

    await rehydrateActiveSession(
      store,
      savedState([{ ...legacyEntry(), sets: [{ setType: 'normal', reps: 8 }] }, legacyEntry({ idx: 1 })]),
      1000
    );

    expect(hydrated).toEqual([]);
  });

  it('still hydrates a session whose entries DO carry a set list', async () => {
    // The guard must not be a blanket refusal — this is the ordinary path and
    // it is what every other rehydrate test exercises.
    const { store, hydrated, dispatched } = fakeStore();
    const state = savedState([
      { ...legacyEntry(), sets: [{ setType: 'warmup', reps: 8 }, { setType: 'normal', reps: 8 }] },
    ]);

    await rehydrateActiveSession(store, state, 1000);

    expect(hydrated).toEqual([state]);
    expect(dispatched).toEqual([]);
  });

  it('accepts an entry that legitimately prescribes nothing', async () => {
    // `sets: []` is a real, restorable state (engine convention 10) and must be
    // told apart from an ABSENT list. Conflating them would refuse to restore a
    // perfectly good session that happens to contain a zero-set entry.
    const { store, hydrated } = fakeStore();
    const state = savedState([
      { ...legacyEntry(), sets: [] },
      { ...legacyEntry(), idx: 1, sets: [{ setType: 'normal', reps: 5 }] },
    ]);

    await rehydrateActiveSession(store, state, 1000);

    expect(hydrated).toEqual([state]);
  });

  it('accepts a session with no entries at all rather than reading it as unrunnable', async () => {
    // Vacuously fine: there is no entry missing a list. The engine's own
    // empty-routine guard is a different layer and rejects at StartSession.
    const { store, hydrated } = fakeStore();
    const state = savedState([]);

    await rehydrateActiveSession(store, state, 1000);

    expect(hydrated).toEqual([state]);
  });
});
