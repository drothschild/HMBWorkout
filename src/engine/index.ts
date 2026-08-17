/**
 * Engine host: wraps rill-lang createEngine with HMBWorkout-specific executors.
 * Runs the transition rule, swaps state on Ok, preserves state on Err,
 * handles executor failures in isolation.
 */

import { createEngine as rillCreateEngine, TransitionError as RillTransitionError } from 'rill-lang';
import { SessionState, Event, Effect, LoggedSet, RoutineSet } from './types';

// Import rule sources via Jest .lv transformer
import typesSource from './rules/types.lv';
import helpersSource from './rules/helpers.lv';
import transitionSource from './rules/transition.lv';

/**
 * TransitionError: re-export from rill-lang for compatibility
 */
export { TransitionError } from 'rill-lang';

/**
 * Sentinel → Option mapping: rill-lang uses undefined for Option(None),
 * but TypeScript and UI code benefit from non-nullable sentinels. This table
 * documents the deliberate divergence from Task 5's "update read sites" directive:
 * the host maintains this boundary rather than exposing undefined throughout the codebase.
 *
 * Sentinels are applied in fromRillState() and should be assumed throughout all
 * TypeScript code reading SessionState.
 */
/*
 * NOT EXTENDED FOR RoutineSet. Its optional fields (reps, repsMax, weightKg,
 * durationSeconds, distanceM) are new surface with no legacy read sites to
 * protect, so they cross the boundary as honest `undefined` and read sites use
 * `!= null`. Five more sentinels would grow the `-1`-renders-as-`RPE: -1`
 * hazard class for no benefit. See #276 AC2.12.
 */
export const SENTINEL_TO_OPTION_MAP = {
  rpe: { sentinel: -1.0, rillNone: undefined },
  restDeadlineMs: { sentinel: 0, rillNone: undefined },
  restRemainingMs: { sentinel: 0, rillNone: undefined },
  prePausePhase: { sentinel: '', rillNone: undefined },
  supersetGroup: { sentinel: '', rillNone: undefined },
} as const;

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
  onDiscardSession(sessionId: string): void | Promise<void>;
}

/** A number for Rill's Option, or undefined for None. WatermelonDB hands back null. */
function toRillOptionalNumber(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value;
}

/** Rill's RoutineSet record: every measurement is an Option, no sentinels. */
function toRillRoutineSet(set: RoutineSet): any {
  return {
    setType: set.setType,
    reps: toRillOptionalNumber(set.reps),
    repsMax: toRillOptionalNumber(set.repsMax),
    weightKg: toRillOptionalNumber(set.weightKg),
    durationSeconds: toRillOptionalNumber(set.durationSeconds),
    distanceM: toRillOptionalNumber(set.distanceM),
  };
}

/**
 * DERIVATION SEAM (#276, deleted in Phase 6). Expand an aggregate entry's
 * counts into the flat set list the rules now require: `warmupSets` warmups
 * followed by `targetSets` normals, every one of them carrying the entry's
 * single `targetReps`/`targetDurationSeconds` because that is all an aggregate
 * knows. Lossless in this direction — a count says nothing a list cannot.
 *
 * A 0 in either target field means "unset" on the TS side (nothing plans zero
 * reps), so it crosses as absent rather than as `Some(0)`.
 */
function setsFromCounts(entry: any): RoutineSet[] {
  const reps = entry.targetReps > 0 ? entry.targetReps : undefined;
  const durationSeconds = entry.targetDurationSeconds > 0 ? entry.targetDurationSeconds : undefined;
  const make = (setType: RoutineSet['setType']): RoutineSet => ({ setType, reps, durationSeconds });
  return [
    ...Array.from({ length: Math.max(0, entry.warmupSets ?? 0) }, () => make('warmup')),
    ...Array.from({ length: Math.max(0, entry.targetSets ?? 0) }, () => make('normal')),
  ];
}

/**
 * Convert TypeScript RoutineEntry to Rill format (removing idx, handling supersetGroup as Option).
 *
 * `entry.sets` wins when present; the counts are the fallback for the shell
 * files that have not moved to per-set yet.
 */
function toRillRoutineEntry(entry: any): any {
  const sets: RoutineSet[] = Array.isArray(entry.sets) ? entry.sets : setsFromCounts(entry);
  return {
    exerciseId: entry.exerciseId,
    kind: entry.kind,
    restSeconds: entry.restSeconds,
    supersetGroup: entry.supersetGroup === '' || !entry.supersetGroup ? undefined : entry.supersetGroup,
    sets: sets.map(toRillRoutineSet),
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
    restRemainingMs: (tsState.restRemainingMs === undefined || tsState.restRemainingMs === 0) ? undefined : tsState.restRemainingMs,
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
 * Rill's RoutineSet back to TS. `rillToJs` OMITS a `None` key rather than
 * emitting `undefined`, so the keys are re-spelled here to give the TS side a
 * stable shape. Either way, an expectation written without the absent keys
 * matches only under `toEqual`, not `toStrictEqual` (#276 AC2.12).
 */
function fromRillRoutineSet(set: any): RoutineSet {
  return {
    setType: set.setType,
    reps: set.reps,
    repsMax: set.repsMax,
    weightKg: set.weightKg,
    durationSeconds: set.durationSeconds,
    distanceM: set.distanceM,
  };
}

/**
 * DERIVATION SEAM (#276, deleted in Phase 6). The other direction: re-derive
 * the aggregate counts from the set list so the ~20 shell files still reading
 * `warmupSets`/`targetSets`/`targetReps`/`targetDurationSeconds` see exactly
 * what they saw before per-set, and a count-built entry round-trips unchanged —
 * with exactly one exception, recorded below.
 *
 * Lossy in this direction, necessarily: INTERLEAVE (warmup, normal, warmup)
 * comes back as warmupSets 2 / targetSets 1, which is the closest an aggregate
 * can get to a shape it cannot represent. That loss is confined to the derived
 * counts — the rules read `sets`.
 *
 * THE ONE ROUND-TRIP EXCEPTION: a ZERO-TOTAL entry loses its plan values.
 *
 *   in : { warmupSets: 0, targetSets: 0, targetReps: 12, targetDurationSeconds: 45 }
 *   out: { warmupSets: 0, targetSets: 0, targetReps:  0, targetDurationSeconds:  0 }
 *
 * `setsFromCounts` expands that entry to `[]`, so `plan` is undefined here and
 * both `?? 0` defaults fire; the pre-per-set engine handed back 12/45. The shape
 * is real — AGENTS.md's Boundaries note records routines imported before
 * `upsertRoutine` learned its zero-total default, left with `target_sets` null
 * or 0 and no re-import to heal them. It is NOT reachable in any decision path,
 * which is why nothing is done about it beyond saying so: such an entry is
 * unlandable (convention 10), `computeSetPrefill` and `exerciseReplaceStore`
 * read only the CURRENT entry, and `restCommentaryStore.performedEntryIndex`
 * gates on `warmupSets + targetSets > round` with `round >= 0`, so a zero-total
 * entry is never selected. Every zero-total display guard in the shell keys on
 * the counts being 0, which they still are. Phase 6 deletes this function and
 * the exception with it; until then, do not build a reader that needs
 * `targetReps` off an entry planning no sets.
 *
 * The plan values come from the first NORMAL set (what the shell means by "the
 * target"), falling back to the first set of any type so an all-warmup entry —
 * `{ warmupSets: 2, targetSets: 0, targetReps: 12 }` — still round-trips.
 */
function countsFromSets(sets: RoutineSet[]) {
  const warmupSets = sets.filter((set) => set.setType === 'warmup').length;
  const plan = sets.find((set) => set.setType !== 'warmup') ?? sets[0];
  return {
    warmupSets,
    targetSets: sets.length - warmupSets,
    targetReps: plan?.reps ?? 0,
    targetDurationSeconds: plan?.durationSeconds ?? 0,
  };
}

/**
 * Convert Rill SessionState back to TypeScript format.
 *
 * SENTINEL BOUNDARY (deliberate divergence from Task 5):
 * rill-lang uses undefined for Option(None) types. This adapter re-sentinelizes
 * certain fields for compatibility with the rest of the codebase:
 *   - rpe: undefined → -1.0
 *   - restDeadlineMs: undefined → 0 (UI interprets 0 as inactive)
 *   - prePausePhase: undefined → ""
 *   - supersetGroup: undefined → ""
 *
 * This boundary is maintained deliberately so UI and persistence logic can assume
 * non-nullable values throughout the TypeScript layer, reducing Option<> handling
 * at read sites. Tests normalize() to match pre-migration expectations.
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
    restRemainingMs: rillState.restRemainingMs === undefined ? 0 : rillState.restRemainingMs,
    loggedSets: rillState.loggedSets.map((set: any) => ({
      ...set,
      rpe: set.rpe === undefined ? -1.0 : set.rpe,
    })),
    lastLoggedSet: rillState.lastLoggedSet ? {
      ...rillState.lastLoggedSet,
      rpe: rillState.lastLoggedSet.rpe === undefined ? -1.0 : rillState.lastLoggedSet.rpe,
    } : undefined,
    startedAtMs: rillState.startedAtMs,
    entries: rillState.entries.map((entry: any, idx: number) => {
      const sets: RoutineSet[] = (entry.sets ?? []).map(fromRillRoutineSet);
      return {
        idx,
        exerciseId: entry.exerciseId,
        kind: entry.kind,
        ...countsFromSets(sets),
        restSeconds: entry.restSeconds,
        supersetGroup: entry.supersetGroup === undefined ? '' : entry.supersetGroup,
        sets,
      };
    }),
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
  // Wrap executors to catch and log errors gracefully
  const rillExecutors: Record<string, (payload: unknown) => void | Promise<void>> = {
    CreateSession: (payload: unknown) => {
      try {
        const p = payload as any;
        return executors.onCreateSession?.({
          sessionId: p.sessionId,
          routineId: p.routineId,
          startedAtMs: p.startedAtMs,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for CreateSession: ${message}`);
      }
    },
    ScheduleRest: (payload: unknown) => {
      try {
        const p = payload as any;
        return executors.onScheduleRest?.(p.deadlineMs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for ScheduleRest: ${message}`);
      }
    },
    CancelRest: () => {
      try {
        return executors.onCancelRest?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for CancelRest: ${message}`);
      }
    },
    Notify: (payload: unknown) => {
      try {
        const p = payload as any;
        return executors.onNotify?.(p.message);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for Notify: ${message}`);
      }
    },
    PersistSet: (payload: unknown) => {
      try {
        const p = payload as any;
        return executors.onPersistSet?.(p.set);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for PersistSet: ${message}`);
      }
    },
    CompleteSession: (payload: unknown) => {
      try {
        const p = payload as any;
        return executors.onCompleteSession?.(p.summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for CompleteSession: ${message}`);
      }
    },
    DiscardSession: (payload: unknown) => {
      try {
        const p = payload as any;
        return executors.onDiscardSession?.(p.sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Effect executor failed for DiscardSession: ${message}`);
      }
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
    restRemainingMs: undefined,
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
              nowMs: e.nowMs,
            },
          };
          break;
        case 'SetDone':
          rillEvent = { tag: 'SetDone', value: { nowMs: e.nowMs } };
          break;
        case 'RestElapsed':
          rillEvent = { tag: 'RestElapsed', value: { nowMs: e.nowMs } };
          break;
        case 'SkipRest':
          rillEvent = { tag: 'SkipRest' };
          break;
        case 'ReplaceExercise':
          // No sentinel translation: both fields are plain, always-present
          // values. The rule rejects an empty exerciseId rather than reading
          // it as "absent".
          rillEvent = { tag: 'ReplaceExercise', value: { idx: e.idx, exerciseId: e.exerciseId } };
          break;
        case 'PauseSession':
          rillEvent = { tag: 'PauseSession', value: { nowMs: e.nowMs } };
          break;
        case 'Resume':
          rillEvent = { tag: 'Resume', value: { nowMs: e.nowMs } };
          break;
        case 'AppForegrounded':
          rillEvent = { tag: 'AppForegrounded', value: { nowMs: e.nowMs } };
          break;
        case 'FinishSession':
          rillEvent = { tag: 'FinishSession', value: { nowMs: e.nowMs } };
          break;
        case 'AbandonSession':
          // No payload: the id of the session to discard comes from state, so
          // the host cannot abandon a session other than the running one.
          rillEvent = { tag: 'AbandonSession' };
          break;
        default:
          throw new Error(`Unknown event tag: ${e.tag}`);
      }

      // Dispatch with rill engine (which manages its own state internally)
      // Executors are wrapped to catch errors gracefully
      const newRillState = rillEngine.dispatch(rillEvent);
      const newTsState = fromRillState(newRillState);
      localState = newTsState;
      return newTsState;
    } catch (err) {
      // Re-throw as is; rill-lang throws TransitionError for rule failures
      throw err;
    }
  }

  return { dispatch, getState, setState };
}
