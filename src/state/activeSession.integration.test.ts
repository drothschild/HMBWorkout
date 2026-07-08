import { createActiveSessionStore } from './activeSession';
import { SessionState } from '@/engine/types';

/**
 * Integration tests for session store with injected executors.
 * AC6.1: Completing a session calls onCompleteSession with correct summary args
 * AC6.2: Executor errors don't prevent session state transition to done
 */

describe('activeSession store with injected executors', () => {
  const mockDatabase = {
    write: jest.fn(async (fn: Function) => fn()),
    get: jest.fn((tableName: string) => ({
      find: jest.fn(async (id: string) => ({
        _raw: { id, ended_at: undefined },
        update: jest.fn(async (fn: Function) => {
          const record = { _raw: { id, ended_at: 0 } };
          fn(record);
        }),
      })),
    })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC6.1: FinishSession calls onCompleteSession with correct summary startMs/endMs/setsLogged', async () => {
    const testStartMs = 1000;
    const testEndMs = 10000;
    const completeSessionSpy = jest.fn(async () => {});
    const syncSpy = jest.fn(async () => {});

    const store = createActiveSessionStore(
      mockDatabase as any,
      {
        onCreateSession: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: completeSessionSpy,
      },
      syncSpy
    );

    const initialState: SessionState = {
      sessionId: 'session-1',
      routineId: 'routine-1',
      phase: 'working',
      exerciseIndex: 1,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [
        {
          exerciseId: 'ex-1',
          setType: 'working',
          reps: 8,
          weightKg: 50,
          durationSeconds: null,
          rpe: 8,
        },
      ],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    store.getState().hydrate(initialState);
    const result = await store.getState().dispatch({ tag: 'FinishSession', nowMs: testEndMs });

    // Verify state transitioned to done
    expect(result?.phase).toBe('done');

    // Verify onCompleteSession was called with correct args
    expect(completeSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        startMs: testStartMs,
        endMs: testEndMs,
        setsLogged: 1,
      })
    );
  });

  it('AC6.2: onCompleteSession throwing does not prevent state transition to done', async () => {
    const testStartMs = 1000;
    const testEndMs = 10000;
    const errorExecutor = jest.fn(async () => {
      throw new Error('Executor failed');
    });
    const syncSpy = jest.fn(async () => {});

    const store = createActiveSessionStore(
      mockDatabase as any,
      {
        onCreateSession: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: errorExecutor,
      },
      syncSpy
    );

    const initialState: SessionState = {
      sessionId: 'session-2',
      routineId: 'routine-2',
      phase: 'working',
      exerciseIndex: 0,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    store.getState().hydrate(initialState);

    // Should not throw despite executor error
    const result = await store.getState().dispatch({ tag: 'FinishSession', nowMs: testEndMs });

    // State should still transition to done
    expect(result?.phase).toBe('done');

    // Executor should have been called
    expect(errorExecutor).toHaveBeenCalled();
  });

  it('AC6.2: sync failing does not prevent state transition to done', async () => {
    const testStartMs = 1000;
    const testEndMs = 10000;
    const completeSessionSpy = jest.fn(async () => {});
    const syncSpy = jest.fn(async () => {
      throw new Error('Sync failed');
    });

    const store = createActiveSessionStore(
      mockDatabase as any,
      {
        onCreateSession: jest.fn(),
        onPersistSet: jest.fn(),
        onCompleteSession: completeSessionSpy,
      },
      syncSpy
    );

    const initialState: SessionState = {
      sessionId: 'session-3',
      routineId: 'routine-3',
      phase: 'working',
      exerciseIndex: 0,
      setIndex: 0,
      supersetPosition: 0,
      loggedSets: [],
      startedAtMs: testStartMs,
      entries: [],
      lastLoggedSet: undefined,
      prePausePhase: '',
    };

    store.getState().hydrate(initialState);

    // Should not throw despite sync error
    const result = await store.getState().dispatch({ tag: 'FinishSession', nowMs: testEndMs });

    // State should still transition to done
    expect(result?.phase).toBe('done');

    // onCompleteSession should still be called
    expect(completeSessionSpy).toHaveBeenCalled();
  });
});
