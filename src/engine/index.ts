/**
 * Engine host: wraps rill-lang createEngine with HMBWorkout-specific executors.
 * Runs the transition rule, swaps state on Ok, preserves state on Err,
 * handles executor failures in isolation.
 */

import { createEngine as rillCreateEngine, TransitionError as RillTransitionError } from 'rill-lang';
import { SessionState, Event, Effect, LoggedSet } from './types';

// Import rule sources via Jest .lv transformer
import typesSource from './rules/types.lv';
import helpersSource from './rules/helpers.lv';
import transitionSource from './rules/transition.lv';

/**
 * TransitionError: re-export from rill-lang for compatibility
 */
export { TransitionError } from 'rill-lang';

/**
 * Effect executors: one handler per Effect tag.
 * Host provides implementations; tests pass fakes.
 */
export interface EffectExecutors {
  onCreateSession(payload: { sessionId: string; routineId: string; startedAtMs: number }): void | Promise<void>;
  onScheduleRest(deadlineMs: number): void | Promise<void>;
  onCancelRest(): void | Promise<void>;
  onNotify(message: string): void | Promise<void>;
  onPersistSet(set: LoggedSet): void | Promise<void>;
  onCompleteSession(summary: unknown): void | Promise<void>;
}

/**
 * Convert TypeScript RoutineEntry to Rill format (removing idx, handling supersetGroup as Option).
 */
function toRillRoutineEntry(entry: any): any {
  return {
    exerciseId: entry.exerciseId,
    kind: entry.kind,
    warmupSets: entry.warmupSets,
    targetSets: entry.targetSets,
    targetReps: entry.targetReps,
    targetDurationSeconds: entry.targetDurationSeconds,
    restSeconds: entry.restSeconds,
    supersetGroup: entry.supersetGroup === '' || !entry.supersetGroup ? undefined : entry.supersetGroup,
  };
}

/**
 * Convert TypeScript SessionState (with string phase) to Rill format (with tag-based phase).
 */
function toRillState(tsState: SessionState): any {
  return {
    sessionId: tsState.sessionId,
    routineId: tsState.routineId,
    phase: { tag: tsState.phase.charAt(0).toUpperCase() + tsState.phase.slice(1) },
    exerciseIndex: tsState.exerciseIndex,
    setIndex: tsState.setIndex,
    supersetPosition: tsState.supersetPosition || 0,
    prePausePhase:
      tsState.prePausePhase === undefined || tsState.prePausePhase === ''
        ? undefined
        : { tag: tsState.prePausePhase.charAt(0).toUpperCase() + tsState.prePausePhase.slice(1) },
    restDeadlineMs: (tsState.restDeadlineMs === undefined || tsState.restDeadlineMs === 0) ? undefined : tsState.restDeadlineMs,
    loggedSets: tsState.loggedSets.map(set => ({
      ...set,
      rpe: set.rpe === -1.0 || set.rpe === undefined ? undefined : set.rpe,
    })),
    lastLoggedSet: tsState.lastLoggedSet ? {
      ...tsState.lastLoggedSet,
      rpe: tsState.lastLoggedSet.rpe === -1.0 || tsState.lastLoggedSet.rpe === undefined ? undefined : tsState.lastLoggedSet.rpe,
    } : undefined,
    startedAtMs: tsState.startedAtMs,
    entries: tsState.entries.map(toRillRoutineEntry),
  };
}

/**
 * Convert Rill SessionState back to TypeScript format.
 */
function fromRillState(rillState: any): SessionState {
  return {
    sessionId: rillState.sessionId,
    routineId: rillState.routineId,
    phase: rillState.phase.tag.toLowerCase(),
    exerciseIndex: rillState.exerciseIndex,
    setIndex: rillState.setIndex,
    supersetPosition: rillState.supersetPosition,
    prePausePhase:
      rillState.prePausePhase === undefined
        ? ''
        : rillState.prePausePhase.tag.toLowerCase(),
    restDeadlineMs: rillState.restDeadlineMs === undefined ? 0 : rillState.restDeadlineMs,
    loggedSets: rillState.loggedSets.map((set: any) => ({
      ...set,
      rpe: set.rpe === undefined ? -1.0 : set.rpe,
    })),
    lastLoggedSet: rillState.lastLoggedSet ? {
      ...rillState.lastLoggedSet,
      rpe: rillState.lastLoggedSet.rpe === undefined ? -1.0 : rillState.lastLoggedSet.rpe,
    } : undefined,
    startedAtMs: rillState.startedAtMs,
    entries: rillState.entries.map((entry: any, idx: number) => ({
      idx,
      exerciseId: entry.exerciseId,
      kind: entry.kind,
      warmupSets: entry.warmupSets,
      targetSets: entry.targetSets,
      targetReps: entry.targetReps,
      targetDurationSeconds: entry.targetDurationSeconds,
      restSeconds: entry.restSeconds,
      supersetGroup: entry.supersetGroup === undefined ? '' : entry.supersetGroup,
    })),
  };
}

/**
 * Engine: dispatch-driven state machine.
 * createEngine(executors) -> { dispatch, getState, setState }
 */
export function createEngine(executors: Partial<EffectExecutors>) {
  let localState: SessionState | null = null;

  // Create the resolver for the bundled .lv sources
  // Note: transition.lv inlines type definitions; helpers.lv is used for utility functions
  const resolver = (modulePath: string): string => {
    if (modulePath === 'types') {
      // types.lv is NOT imported by transition.lv anymore (types are inlined)
      // but we keep this for potential future use
      return typesSource;
    } else if (modulePath === 'helpers') {
      return helpersSource;
    } else if (modulePath === 'transition') {
      return transitionSource;
    }
    throw new Error(`Module not found: ${modulePath}`);
  };

  // Map executors from the old interface (onCreateSession, etc.) to rill-lang's
  // executor keying (CreateSession, ScheduleRest, etc.)
  const rillExecutors: Record<string, (payload: unknown) => void | Promise<void>> = {
    CreateSession: (payload: unknown) => {
      const p = payload as any;
      return executors.onCreateSession?.({
        sessionId: p.sessionId,
        routineId: p.routineId,
        startedAtMs: p.startedAtMs,
      });
    },
    ScheduleRest: (payload: unknown) => {
      const p = payload as any;
      return executors.onScheduleRest?.(p.deadlineMs);
    },
    CancelRest: () => {
      return executors.onCancelRest?.();
    },
    Notify: (payload: unknown) => {
      const p = payload as any;
      return executors.onNotify?.(p.message);
    },
    PersistSet: (payload: unknown) => {
      const p = payload as any;
      return executors.onPersistSet?.(p.set);
    },
    CompleteSession: (payload: unknown) => {
      const p = payload as any;
      return executors.onCompleteSession?.(p.summary);
    },
  };

  // Create the initial state in Rill format
  const initialTsState: SessionState = {
    sessionId: '',
    routineId: '',
    phase: 'idle',
    exerciseIndex: 0,
    setIndex: 0,
    supersetPosition: 0,
    restDeadlineMs: undefined,
    prePausePhase: undefined,
    loggedSets: [],
    lastLoggedSet: undefined,
    startedAtMs: 0,
    entries: [],
  };

  const initialRillState = toRillState(initialTsState);

  // Create the rill engine
  let rillEngine = rillCreateEngine({
    resolve: resolver,
    entry: 'transition',
    initialState: initialRillState,
    executors: rillExecutors,
    onExecutorError: (err: unknown, effectTag: string) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Effect executor failed for ${effectTag}: ${message}`);
    },
  });

  /**
   * Set state: used for initialization before dispatch.
   * Recreates the rill engine with the new state.
   */
  function setState(newState: SessionState) {
    localState = newState;
    const rillState = toRillState(newState);
    // Recreate the rill engine with the new state
    rillEngine = rillCreateEngine({
      resolve: resolver,
      entry: 'transition',
      initialState: rillState,
      executors: rillExecutors,
      onExecutorError: (err: unknown, effectTag: string) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for ${effectTag}: ${message}`);
      },
    });
  }

  /**
   * Get state: returns current state.
   */
  function getState(): SessionState {
    return localState || initialTsState;
  }

  /**
   * Dispatch: run transition, swap state on Ok, preserve on Err, run executors.
   * Converts events and state to/from Rill format transparently.
   */
  async function dispatch(event: Event): Promise<SessionState> {
    try {
      // Convert event to Rill format
      const e = event as any;
      let rillEvent: any;

      switch (e.tag) {
        case 'StartSession':
          rillEvent = {
            tag: 'StartSession',
            value: {
              sessionId: e.sessionId,
              nowMs: e.nowMs,
              routine: {
                id: e.routine.id,
                entries: e.routine.entries.map(toRillRoutineEntry),
              },
            },
          };
          break;
        case 'LogSet':
          // LogSet: convert sentinels to undefined for Rill Option types
          rillEvent = {
            tag: 'LogSet',
            value: {
              reps: e.reps === 0 ? undefined : e.reps,
              weightKg: e.weightKg === 0.0 ? undefined : e.weightKg,
              durationSeconds: e.durationSeconds === 0 ? undefined : e.durationSeconds,
              rpe: e.rpe === -1.0 ? undefined : e.rpe,
            },
          };
          break;
        case 'SetDone':
          rillEvent = { tag: 'SetDone', value: { nowMs: e.nowMs } };
          break;
        case 'RestElapsed':
          rillEvent = { tag: 'RestElapsed', value: { nowMs: e.nowMs } };
          break;
        case 'SkipExercise':
          rillEvent = { tag: 'SkipExercise' };
          break;
        case 'PauseSession':
          rillEvent = { tag: 'PauseSession' };
          break;
        case 'Resume':
          rillEvent = { tag: 'Resume', value: { nowMs: e.nowMs } };
          break;
        case 'FinishSession':
          rillEvent = { tag: 'FinishSession', value: { nowMs: e.nowMs } };
          break;
        default:
          throw new Error(`Unknown event tag: ${e.tag}`);
      }

      // Dispatch with rill engine (which manages its own state internally)
      const newRillState = rillEngine.dispatch(rillEvent);
      const newTsState = fromRillState(newRillState);
      localState = newTsState;
      return newTsState;
    } catch (err) {
      // Re-throw as is; rill-lang already throws TransitionError
      throw err;
    }
  }

  return { dispatch, getState, setState };
}
