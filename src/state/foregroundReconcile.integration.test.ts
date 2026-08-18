import type { Event, SessionState } from '@/engine/types';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createActiveSessionStore } from './activeSession';
import {
  reconcileForegroundedSession,
  ForegroundSessionStore,
} from './foregroundReconcile';
import { Database } from '@nozbe/watermelondb';

/**
 * Foreground reconciliation: an app that is BACKGROUNDED (not killed) past the
 * rest deadline and then foregrounded has no session screen guaranteed to be
 * mounted — the countdown's RestElapsed only fires if the user stayed on it.
 * The AppState listener dispatches AppForegrounded blind and the engine decides
 * what it means; these tests pin the shell module's contract.
 */
describe('reconcileForegroundedSession (foreground recovery)', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

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
    id: 'routine-foreground',
    name: 'Foreground Routine',
    entries: [
      {
        exerciseId: 'ex-fg1',
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

  // Drive the live store into the between-sets rest: StartSession → LogSet
  // enters the 90s rest with deadline (now + 2000) + 90_000. Unlike the boot
  // rehydrate tests there is no fresh store — foregrounding happens in the
  // same process that scheduled the rest.
  async function driveToResting(
    store: ReturnType<typeof createActiveSessionStore>,
    sessionId: string,
    now: number
  ): Promise<number> {
    await store.getState().dispatch({
      tag: 'StartSession',
      sessionId,
      nowMs: now,
      routine,
    });
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

  it('recovers the phase when foregrounded past the rest deadline — no error banner', async () => {
    const executors = fakeExecutors();
    const store = createActiveSessionStore(database, executors);
    const now = Date.now();
    await driveToResting(store, 'foreground-expired', now);

    // Backgrounded through the whole 90s rest, foregrounded long after.
    await reconcileForegroundedSession(store, now + 200_000);

    const s = store.getState().sessionState!;
    expect(store.getState().lastError).toBeNull();
    expect(s.phase).toBe('working');
    expect(s.setIndex).toBe(1);
    expect(s.restDeadlineMs).toBe(0);
    expect(s.loggedSets).toHaveLength(1);
    expect(executors.onCancelRest).toHaveBeenCalled();
  });

  it('keeps a live rest running and re-arms its alert when foregrounded mid-rest', async () => {
    const executors = fakeExecutors();
    const store = createActiveSessionStore(database, executors);
    const now = Date.now();
    const deadline = await driveToResting(store, 'foreground-live', now);

    // Foregrounded 30s into the 90s rest.
    await reconcileForegroundedSession(store, now + 32_000);

    const s = store.getState().sessionState!;
    expect(store.getState().lastError).toBeNull();
    expect(s.phase).toBe('resting');
    expect(s.restDeadlineMs).toBe(deadline);
    // Once when the rest started, once re-armed on foreground — same deadline,
    // and the fixed notification identifier makes the re-emit a replace.
    expect(executors.onScheduleRest).toHaveBeenLastCalledWith(deadline);
    expect(executors.onCancelRest).not.toHaveBeenCalled();
  });

  it('never un-pauses a session the user deliberately paused mid-rest', async () => {
    const executors = fakeExecutors();
    const store = createActiveSessionStore(database, executors);
    const now = Date.now();
    await driveToResting(store, 'foreground-paused', now);
    await store.getState().dispatch({ tag: 'PauseSession', nowMs: now + 10_000 });

    const paused = store.getState().sessionState!;
    expect(paused.phase).toBe('paused');
    const frozen = paused.restRemainingMs;

    await reconcileForegroundedSession(store, now + 500_000);

    const s = store.getState().sessionState!;
    expect(store.getState().lastError).toBeNull();
    expect(s.phase).toBe('paused');
    expect(s.restRemainingMs).toBe(frozen);
  });

  it('does not dispatch at all when no workout is in progress', async () => {
    const dispatch = jest.fn<Promise<SessionState | null>, [Event]>();
    const store: ForegroundSessionStore = {
      getState: () => ({ sessionState: null, dispatch }),
    };

    await reconcileForegroundedSession(store, Date.now());

    expect(dispatch).not.toHaveBeenCalled();
  });
});
