import { SessionState } from '@/engine/types';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createActiveSessionStore } from './activeSession';
import { saveEngineState, loadActiveEngineState } from '@/db/engineState';
import { createSession } from '@/db/repository';
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

  it('rehydrates a mid-session state and Resume advances past the expired rest (AC2.3/AC10.4)', async () => {
    // 1. Build a valid engine state by driving through transitions:
    // StartSession → LogSet → SetDone → (engine advances to resting) → Pause → serialize
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
          warmupSets: 1,
          targetSets: 1,
          targetReps: 8,
          targetDurationSeconds: 0,
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

    // LogSet to complete warmup
    await store.getState().dispatch({
      tag: 'LogSet',
      reps: 10,
      weightKg: 20,
      durationSeconds: 0,
    });

    // SetDone to complete warmup set
    await store.getState().dispatch({
      tag: 'SetDone',
      nowMs: now + 5000,
    });

    // LogSet for working set
    await store.getState().dispatch({
      tag: 'LogSet',
      reps: 8,
      weightKg: 25,
      durationSeconds: 0,
    });

    // SetDone to complete working set and enter resting
    await store.getState().dispatch({
      tag: 'SetDone',
      nowMs: now + 10000,
    });

    // Pause while in resting (now phase should be paused)
    await store.getState().dispatch({
      tag: 'PauseSession',
    });

    // Get the paused state and manually set a past deadline for testing
    let pausedState = store.getState().sessionState;
    if (pausedState) {
      pausedState.restDeadlineMs = now + 30000; // deadline will be in the past when we Resume
    }

    // Save the paused state to DB
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

    // 3. Resume with nowMs PAST the deadline
    await store2.getState().dispatch({ tag: 'Resume', nowMs: now + 100_000 });

    // 4. assertions
    const s = store2.getState().sessionState!;
    expect(s.loggedSets.length).toBeGreaterThan(0); // sets intact after hydration
    expect(s.phase).not.toBe('paused'); // no longer paused after Resume
    expect(s.phase).not.toBe('resting'); // advanced past resting (engine reconciled deadline)
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
        },
      ],
      restDeadlineMs: pastDeadline,
      entries: [
        {
          idx: 0,
          exerciseId: 'ex-1',
          kind: 'strength',
          warmupSets: 1,
          targetSets: 3,
          targetReps: 6,
          targetDurationSeconds: 0,
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
    });

    // Verify entries are intact for phase advancement
    expect(loadedState!.entries).toHaveLength(1);
    expect(loadedState!.entries[0].idx).toBe(0);
    expect(loadedState!.entries[0].exerciseId).toBe('ex-1');
  });
});
