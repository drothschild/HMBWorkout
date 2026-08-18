import type { SessionState } from '@/engine/types';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createActiveSessionStore } from './activeSession';
import { saveEngineState, loadActiveEngineState, clearEngineState } from '@/db/engineState';
import { createSession } from '@/db/repository';
import { rehydrateActiveSession } from './sessionRehydrate';
import { Database } from '@nozbe/watermelondb';

/**
 * Integration test: Restart recovery (Task 5 AC2.3/AC10.4/AC10.6)
 * Verifies session hydration: mid-session state persists with logged sets + rest deadline,
 * and can be rehydrated on app restart with Resume event reconciling expired rest.
 */
describe('Session hydration and restart recovery', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  it('rehydrates a paused mid-session state and Resume re-arms the frozen rest (AC2.3/AC10.4)', async () => {
    // 1. Build a valid engine state by driving through transitions:
    // StartSession → LogSet (records + advances into rest) → Pause → serialize
    const store = createActiveSessionStore(database, {
      onScheduleRest: jest.fn(),
      onCancelRest: jest.fn(),
      onNotify: jest.fn(),
      onPersistSet: jest.fn(),
      onCompleteSession: jest.fn(),
    });

    const routine = {
      id: 'routine-test-c1',
      name: 'Test Routine C1',
      entries: [
        {
          exerciseId: 'ex-c1',
          kind: 'strength' as const,
          sets: [
            { setType: 'warmup' as const, reps: 8 },
            { setType: 'normal' as const, reps: 8 },
          ],
          restSeconds: 90,
          supersetGroup: '',
        },
        // Second exercise so completing ex-c1 enters resting instead of done
        {
          exerciseId: 'ex-c2',
          kind: 'strength' as const,
          sets: [{ setType: 'normal' as const, reps: 8 }],
          restSeconds: 90,
          supersetGroup: '',
        },
      ],
    };

    const sessionId = 'test-hydrate-c1';
    const now = Date.now();

    // Drive the engine: StartSession
    await store.getState().dispatch({
      tag: 'StartSession',
      sessionId,
      nowMs: now,
      routine,
    });

    // LogSet the warmup — one tap records it and enters the between-sets rest
    await store.getState().dispatch({
      tag: 'LogSet',
      reps: 10,
      weightKg: 20,
      durationSeconds: 0,
      nowMs: now + 2000,
    });

    // Cut the warmup rest short to reach the working set
    await store.getState().dispatch({ tag: 'SkipRest' });

    // LogSet the working set — final set of ex-c1, advances to ex-c2 and
    // starts the 90s between-exercise rest
    await store.getState().dispatch({
      tag: 'LogSet',
      reps: 8,
      weightKg: 25,
      durationSeconds: 0,
      rpe: 7.5,
      nowMs: now + 10000,
    });

    // Pause while in resting (freezes the remaining rest time; deadline stops running)
    await store.getState().dispatch({
      tag: 'PauseSession',
      nowMs: now + 20000,
    });

    // Save the paused state to DB
    const pausedState = store.getState().sessionState;
    if (pausedState) {
      await saveEngineState(database, sessionId, pausedState);
    }

    // 2. relaunch simulation: fresh store with FAKE executors (simulating app restart)
    const store2 = createActiveSessionStore(database, {
      onScheduleRest: jest.fn(),
      onCancelRest: jest.fn(),
      onNotify: jest.fn(),
      onPersistSet: jest.fn(),
      onCompleteSession: jest.fn(),
    });

    const loaded = await loadActiveEngineState(database);
    expect(loaded).not.toBeNull();
    store2.getState().hydrate(loaded!);

    // 3. Resume long after the original deadline would have expired
    await store2.getState().dispatch({ tag: 'Resume', nowMs: now + 100_000 });

    // 4. assertions: the frozen remainder survives the restart and re-arms on Resume
    const s = store2.getState().sessionState!;
    expect(s.loggedSets.length).toBeGreaterThan(0); // sets intact after hydration
    expect(s.phase).toBe('resting'); // paused rest resumes with the frozen remainder
    // The final LogSet at now+10s started a 90s rest (deadline now+100s); paused at now+20s
    // froze 80s, so resuming at now+100s re-arms the deadline at now+180s.
    expect(s.restDeadlineMs).toBe(now + 180_000);
    expect(s.restRemainingMs).toBe(0); // nothing frozen once resumed
  });

  it('persists and loads mid-session state with deadline info intact (AC10.4/AC10.6)', async () => {
    // AC10.4: Serialized SessionState persisted mid-session rehydrates after app restart
    // AC10.6: Rest deadline is preserved for reconciliation after rehydration
    const now = Date.now();
    const pastDeadline = now - 5000; // 5 seconds past deadline

    const midSessionState: SessionState = {
      sessionId: 'test-restore-1',
      routineId: 'routine-1',
      phase: 'resting',
      exerciseIndex: 0,
      setIndex: 1,
      startedAtMs: now - 300000,
      loggedSets: [
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 6,
          weightKg: 28,
          durationSeconds: null,
          rpe: 8.5,
        },
      ],
      restDeadlineMs: pastDeadline,
      entries: [
        {
          idx: 0,
          exerciseId: 'ex-1',
          kind: 'strength',
          sets: [
            { setType: 'warmup', reps: 6 },
            { setType: 'normal', reps: 6 },
            { setType: 'normal', reps: 6 },
            { setType: 'normal', reps: 6 },
          ],
          restSeconds: 60,
          supersetGroup: '',
        },
      ],
      prePausePhase: '',
    };

    // 1. Create the session and persist the state
    await createSession(database, {
      sessionId: midSessionState.sessionId,
      routineId: midSessionState.routineId,
      startedAtMs: midSessionState.startedAtMs,
    });
    await saveEngineState(database, midSessionState.sessionId, midSessionState);

    // 2. Load from database (simulating app restart)
    const loadedState = await loadActiveEngineState(database);

    // AC10.4 & AC10.6: State persists with all fields intact
    expect(loadedState).toBeDefined();
    expect(loadedState!.sessionId).toBe('test-restore-1');
    expect(loadedState!.phase).toBe('resting');
    expect(loadedState!.restDeadlineMs).toBe(pastDeadline);
    expect(loadedState!.restDeadlineMs).toBeLessThan(now); // Deadline is in the past

    // AC2.3: All logged sets survive persistence
    expect(loadedState!.loggedSets).toHaveLength(1);
    expect(loadedState!.loggedSets[0]).toEqual({
      exerciseId: 'ex-1',
      setType: 'working',
      reps: 6,
      weightKg: 28,
      durationSeconds: null,
      rpe: 8.5,
    });

    // Verify entries are intact for phase advancement
    expect(loadedState!.entries).toHaveLength(1);
    expect(loadedState!.entries[0].idx).toBe(0);
    expect(loadedState!.entries[0].exerciseId).toBe('ex-1');
  });

  describe('rehydrateActiveSession (boot restart recovery)', () => {
    // The production wiring from `_layout.tsx`, so these cases exercise the
    // real drop-disposal path rather than a stub of it.
    function rehydrateDeps() {
      return { clearEngineState: (sessionId: string) => clearEngineState(database, sessionId) };
    }

    // Fresh fakes per store: executors are irrelevant here beyond keeping the
    // real rest timer and notifications out of the node environment.
    function fakeExecutors() {
      return {
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };
    }

    const routine = {
      id: 'routine-rehydrate',
      name: 'Rehydrate Routine',
      entries: [
        {
          exerciseId: 'ex-rehydrate',
          kind: 'strength' as const,
          sets: [
            { setType: 'warmup' as const, reps: 8 },
            { setType: 'normal' as const, reps: 8 },
          ],
          restSeconds: 90,
          supersetGroup: '',
        },
      ],
    };

    it('rehydrates a mid-warmup session without dispatching Resume — no error surfaces', async () => {
      // App killed mid-warmup: StartSession leaves the engine in warmup, and
      // dispatch() has already persisted that state.
      const store = createActiveSessionStore(database, fakeExecutors());
      const now = Date.now();
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId: 'rehydrate-warmup',
        nowMs: now,
        routine,
      });
      expect(store.getState().sessionState!.phase).toBe('warmup');

      // Relaunch: fresh store, load the persisted state
      const store2 = createActiveSessionStore(database, fakeExecutors());
      const loaded = await loadActiveEngineState(database);
      expect(loaded!.phase).toBe('warmup');

      await rehydrateActiveSession(store2, loaded!, now + 60_000, rehydrateDeps());

      // The observed bug: an unconditional Resume is rejected by the engine
      // ("invalid event Resume in phase warmup") and lands in lastError, which
      // the session screen renders as a red banner.
      expect(store2.getState().lastError).toBeNull();
      expect(store2.getState().sessionState!.phase).toBe('warmup');
    });

    it('still dispatches Resume for a paused session, restoring the pre-pause phase', async () => {
      const store = createActiveSessionStore(database, fakeExecutors());
      const now = Date.now();
      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId: 'rehydrate-paused',
        nowMs: now,
        routine,
      });
      await store.getState().dispatch({ tag: 'PauseSession', nowMs: now + 5_000 });
      expect(store.getState().sessionState!.phase).toBe('paused');

      const store2 = createActiveSessionStore(database, fakeExecutors());
      const loaded = await loadActiveEngineState(database);
      expect(loaded!.phase).toBe('paused');

      await rehydrateActiveSession(store2, loaded!, now + 60_000, rehydrateDeps());

      // No rest was in flight when paused, so Resume returns the session to
      // the phase recorded before the pause (warmup) — never leaves it paused.
      expect(store2.getState().lastError).toBeNull();
      expect(store2.getState().sessionState!.phase).toBe('warmup');
    });

    // Killed mid-rest (NOT paused): the state on disk keeps phase 'resting'
    // and its wall-clock restDeadlineMs, but the relaunched process holds no
    // cancelable alert. The boot rehydrate must reconcile both directions:
    // re-arm a rest that is still live, and recover the phase from one that
    // expired while the app was dead.
    const killedMidRestRoutine = {
      id: 'routine-killed-mid-rest',
      name: 'Killed Mid-Rest Routine',
      entries: [
        {
          exerciseId: 'ex-kmr1',
          kind: 'strength' as const,
          sets: [
            { setType: 'normal' as const, reps: 8 },
            { setType: 'normal' as const, reps: 8 },
          ],
          restSeconds: 90,
          supersetGroup: '',
        },
      ],
    };

    // Drive a real session into the between-sets rest and stop — dispatch()
    // has already persisted the resting state, simulating a kill right here.
    async function driveToResting(sessionId: string, now: number): Promise<number> {
      const store = createActiveSessionStore(database, fakeExecutors());

      await store.getState().dispatch({
        tag: 'StartSession',
        sessionId,
        nowMs: now,
        routine: killedMidRestRoutine,
      });

      // LogSet the first working set — enters the 90s between-sets rest with
      // deadline (now + 2000) + 90_000.
      await store.getState().dispatch({
        tag: 'LogSet',
        reps: 8,
        weightKg: 40,
        durationSeconds: 0,
        nowMs: now + 2000,
      });

      const restingState = store.getState().sessionState!;
      expect(restingState.phase).toBe('resting');
      expect(restingState.restDeadlineMs).toBe(now + 92_000);
      return restingState.restDeadlineMs!;
    }

    it('re-arms the rest alert when rehydrating a kill-mid-rest session with a live deadline', async () => {
      const now = Date.now();
      const deadline = await driveToResting('rehydrate-rest-live', now);

      // Relaunch: fresh store whose executors have no armed alert; the boot
      // rehydrate lands 30s into the 90s rest.
      const executors2 = fakeExecutors();
      const store2 = createActiveSessionStore(database, executors2);
      const loaded = await loadActiveEngineState(database);
      expect(loaded!.phase).toBe('resting');

      await rehydrateActiveSession(store2, loaded!, now + 32_000, rehydrateDeps());

      // The rest continues against the same wall-clock deadline; the new
      // process gets its alert re-armed for the remaining time.
      expect(store2.getState().lastError).toBeNull();
      const s = store2.getState().sessionState!;
      expect(s.phase).toBe('resting');
      expect(s.restDeadlineMs).toBe(deadline);
      expect(executors2.onScheduleRest).toHaveBeenCalledWith(deadline);
    });

    it('recovers the phase when rehydrating a kill-mid-rest session with an expired deadline', async () => {
      const now = Date.now();
      await driveToResting('rehydrate-rest-expired', now);

      const executors2 = fakeExecutors();
      const store2 = createActiveSessionStore(database, executors2);
      const loaded = await loadActiveEngineState(database);
      expect(loaded!.phase).toBe('resting');

      // The 90s rest ran out while the app was dead.
      await rehydrateActiveSession(store2, loaded!, now + 200_000, rehydrateDeps());

      // Same recovery RestElapsed would have made: phase from position (set 1
      // of a 0-warmup entry → working), deadline cleared, logged set intact —
      // and the stale pre-kill alert is cancelled.
      expect(store2.getState().lastError).toBeNull();
      const s = store2.getState().sessionState!;
      expect(s.phase).toBe('working');
      expect(s.setIndex).toBe(1);
      expect(s.restDeadlineMs).toBe(0);
      expect(s.loggedSets).toHaveLength(1);
      expect(executors2.onCancelRest).toHaveBeenCalled();
      expect(executors2.onScheduleRest).not.toHaveBeenCalled();
    });
  });

  /**
   * A dropped legacy row must not shadow the sessions that come after it.
   *
   * `loadActiveEngineState` walks `ended_at IS NULL` rows in no particular
   * order and returns the FIRST one carrying a non-null `engine_state`. A
   * legacy row that is merely *declined* keeps its state and keeps being the
   * first, so restart recovery is dead for the life of the install rather than
   * costing the one abandoned workout the docstring used to claim.
   *
   * Both halves are executed here against a real database: the failure mode
   * (control, with the clear withheld) and the fix.
   */
  describe('a dropped legacy row does not shadow a later valid session', () => {
    function fakeExecutors() {
      return {
        onScheduleRest: jest.fn(),
        onCancelRest: jest.fn(),
        onNotify: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: jest.fn(),
      };
    }

    const liveRoutine = {
      id: 'routine-live',
      name: 'Live Routine',
      entries: [
        {
          exerciseId: 'ex-live',
          kind: 'strength' as const,
          sets: [{ setType: 'normal' as const, reps: 5 }],
          restSeconds: 90,
          supersetGroup: '',
        },
      ],
    };

    /** The pre-Phase-2 aggregate shape: entries with NO `sets` key. */
    async function seedLegacyRow(startedAtMs: number): Promise<void> {
      await createSession(database, {
        sessionId: 'sess-legacy',
        routineId: 'routine-legacy',
        startedAtMs,
      });
      await saveEngineState(database, 'sess-legacy', {
        sessionId: 'sess-legacy',
        routineId: 'routine-legacy',
        phase: 'working',
        exerciseIndex: 0,
        setIndex: 0,
        loggedSets: [],
        startedAtMs,
        entries: [
          {
            idx: 0,
            exerciseId: 'ex-legacy',
            kind: 'strength',
            warmupSets: 2,
            targetSets: 3,
            targetReps: 8,
            restSeconds: 90,
            supersetGroup: '',
          },
        ],
      } as unknown as SessionState);
    }

    it('CONTROL: withholding the clear leaves the legacy row shadowing forever', async () => {
      const now = Date.now();
      await seedLegacyRow(now - 100_000);

      // Boot 1 — the guard declines the legacy state but disposes of nothing.
      const bootStore = createActiveSessionStore(database, fakeExecutors());
      const firstBoot = await loadActiveEngineState(database);
      expect(firstBoot!.sessionId).toBe('sess-legacy');
      await rehydrateActiveSession(bootStore, firstBoot!, now, {
        clearEngineState: async () => {},
      });
      expect(bootStore.getState().sessionState).toBeNull();

      // The user starts a real workout, which persists to its own row.
      const liveStore = createActiveSessionStore(database, fakeExecutors());
      await liveStore.getState().dispatch({
        tag: 'StartSession',
        sessionId: 'sess-live',
        nowMs: now,
        routine: liveRoutine,
      });

      // Boot 2 — the stale row is handed back again and the live workout is lost.
      const secondBoot = await loadActiveEngineState(database);
      expect(secondBoot!.sessionId).toBe('sess-legacy');
      const bootStore2 = createActiveSessionStore(database, fakeExecutors());
      await rehydrateActiveSession(bootStore2, secondBoot!, now + 1000, {
        clearEngineState: async () => {},
      });
      expect(bootStore2.getState().sessionState).toBeNull();
    });

    it('clearing on the drop path lets the next boot restore the live session', async () => {
      const now = Date.now();
      await seedLegacyRow(now - 100_000);

      const deps = {
        clearEngineState: (sessionId: string) => clearEngineState(database, sessionId),
      };

      // Boot 1 — dropped AND disposed of.
      const bootStore = createActiveSessionStore(database, fakeExecutors());
      const firstBoot = await loadActiveEngineState(database);
      expect(firstBoot!.sessionId).toBe('sess-legacy');
      await rehydrateActiveSession(bootStore, firstBoot!, now, deps);
      expect(bootStore.getState().sessionState).toBeNull();

      // The row survives as the audit trail — it is the STATE that is gone.
      const legacyRow: any = await database.get('sessions').find('sess-legacy');
      expect(legacyRow._raw.ended_at).toBeNull();
      expect(legacyRow._raw.engine_state).toBeFalsy();

      // With nothing else in progress the query now answers "no active state"
      // instead of handing back the corpse.
      expect(await loadActiveEngineState(database)).toBeNull();

      // The user starts a real workout.
      const liveStore = createActiveSessionStore(database, fakeExecutors());
      await liveStore.getState().dispatch({
        tag: 'StartSession',
        sessionId: 'sess-live',
        nowMs: now,
        routine: liveRoutine,
      });

      // Boot 2 — restart recovery reaches the live session and restores it.
      const secondBoot = await loadActiveEngineState(database);
      expect(secondBoot!.sessionId).toBe('sess-live');
      const bootStore2 = createActiveSessionStore(database, fakeExecutors());
      await rehydrateActiveSession(bootStore2, secondBoot!, now + 1000, deps);

      expect(bootStore2.getState().lastError).toBeNull();
      const restored = bootStore2.getState().sessionState!;
      expect(restored.sessionId).toBe('sess-live');
      expect(restored.phase).toBe('working');
      expect(restored.entries[0].exerciseId).toBe('ex-live');
    });
  });
});
