/**
 * Engine host: dispatch loop with effect executors.
 * Runs the Rill transition rule, swaps state on Ok, preserves state on Err,
 * handles executor failures in isolation.
 */

import { SessionState, Event, Effect, LoggedSet } from './types';
import { evaluateSource } from './bridge';
import { transitionCompositeSource } from './loadRules';

/**
 * TransitionError: typed error for transition failures.
 * Raised when transition rule returns Err or Rill evaluation fails.
 */
export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

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
 * Engine: dispatch-driven state machine.
 * createEngine(executors) -> { dispatch, getState, setState }
 */
export function createEngine(executors: Partial<EffectExecutors>) {
  let state: SessionState = {
    sessionId: '',
    routineId: '',
    phase: 'idle',
    exerciseIndex: 0,
    setIndex: 0,
    loggedSets: [],
    startedAtMs: 0,
  };

  /**
   * Set state: used for initialization before dispatch.
   */
  function setState(newState: SessionState) {
    state = newState;
  }

  /**
   * Get state: returns current state.
   */
  function getState(): SessionState {
    return state;
  }

  /**
   * Dispatch: run transition, swap state on Ok, preserve on Err, run executors.
   */
  async function dispatch(event: Event): Promise<SessionState> {
    // Run transition rule with current state + event
    const result = evaluateSource(transitionCompositeSource, { state, event });

    // On evaluation failure or Err, keep prior state and throw TransitionError
    if (!result.success) {
      throw new TransitionError(`Transition evaluation failed: ${result.error}`);
    }

    const value = result.value as any;
    if (value.tag === 'Err') {
      // Err result: preserve state, throw error, zero executors
      throw new TransitionError(`Transition error: ${value.value}`);
    }

    // Ok result: extract new state + effects
    const { state: newState, effects } = value.value as { state: SessionState; effects: Effect[] };

    // Swap state first, then run executors
    state = newState;

    // Run each effect handler, isolating failures
    for (const effect of effects) {
      try {
        await runEffect(effect, executors);
      } catch (err: unknown) {
        // Log and isolate executor failure; state stays swapped
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for ${effect.tag}: ${message}`);
        // Continue to next executor
      }
    }

    return state;
  }

  return { dispatch, getState, setState };
}

/**
 * Run a single effect by dispatching to the appropriate executor.
 */
async function runEffect(effect: Effect, executors: Partial<EffectExecutors>) {
  if (effect.tag === 'CreateSession') {
    const payload = effect as any;
    await executors.onCreateSession?.({
      sessionId: payload.sessionId,
      routineId: payload.routineId,
      startedAtMs: payload.startedAtMs,
    });
  } else if (effect.tag === 'ScheduleRest') {
    const payload = effect as any;
    await executors.onScheduleRest?.(payload.deadlineMs);
  } else if (effect.tag === 'CancelRest') {
    await executors.onCancelRest?.();
  } else if (effect.tag === 'Notify') {
    const payload = effect as any;
    await executors.onNotify?.(payload.message);
  } else if (effect.tag === 'PersistSet') {
    const payload = effect as any;
    await executors.onPersistSet?.(payload.set);
  } else if (effect.tag === 'CompleteSession') {
    const payload = effect as any;
    await executors.onCompleteSession?.(payload.summary);
  }
}
