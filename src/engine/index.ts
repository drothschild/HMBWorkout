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
    entries: [],
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

    // Ok result: extract new state + uniform effects from Rill
    const { state: newState, effects: uniformEffects } = value.value as {
      state: SessionState;
      effects: Array<{ kind: string; deadline_ms: number; message: string }>
    };

    // Swap state first, then run executors
    state = newState;

    // Process persist_set effects: append the new set to loggedSets
    // (Rill can't concatenate lists, so set data is encoded in the effect message)
    for (const ue of uniformEffects) {
      if (ue.kind === 'persist_set' && ue.message) {
        // Parse set data: exerciseId|setType|reps|weightKg|durationSeconds|rpe
        const parts = ue.message.split('|');
        if (parts.length === 6) {
          const newSet: LoggedSet = {
            exerciseId: parts[0],
            setType: parts[1] as any,
            reps: parseInt(parts[2], 10),
            weightKg: parseFloat(parts[3]),
            durationSeconds: parseInt(parts[4], 10),
            rpe: parseFloat(parts[5]),
          };
          state.loggedSets = [...state.loggedSets, newSet];
        }
      }
    }

    // Map uniform effects from Rill to typed Effects, then run executors
    const typedEffects: Effect[] = uniformEffects.map((ue) => mapUniformEffect(ue, state));

    for (const effect of typedEffects) {
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
 * Map uniform effect from Rill to typed Effect discriminated union.
 * Rill returns { kind: string, deadline_ms: number, message: string } (uniform schema).
 * Host converts to the full typed Effect with payloads extracted from state or effect fields.
 */
function mapUniformEffect(uniformEffect: { kind: string; deadline_ms: number; message: string }, state: SessionState): Effect {
  switch (uniformEffect.kind) {
    case 'create_session':
      return { tag: 'CreateSession', sessionId: state.sessionId, routineId: state.routineId, startedAtMs: state.startedAtMs };
    case 'schedule_rest':
      return { tag: 'ScheduleRest', deadlineMs: uniformEffect.deadline_ms };
    case 'cancel_rest':
      return { tag: 'CancelRest' };
    case 'notify':
      return { tag: 'Notify', message: uniformEffect.message };
    case 'persist_set':
      // Extract the last logged set (the one just added)
      const lastSet = state.loggedSets[state.loggedSets.length - 1];
      return { tag: 'PersistSet', set: lastSet };
    case 'complete_session':
      // Summary: basic summary of the session
      return { tag: 'CompleteSession', summary: { exercisesCompleted: state.exerciseIndex, setsLogged: state.loggedSets.length } };
    default:
      // Fallback for unknown kinds
      return { tag: 'Notify', message: 'unknown effect' };
  }
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
