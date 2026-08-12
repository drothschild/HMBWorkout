/**
 * The Replace flow: ask the coach for substitutes for the exercise in progress,
 * let the athlete pick one, and swap it in.
 *
 * Shell-only, like the rest of the AI slice. It decides nothing about session
 * flow — it shapes a payload, runs side effects, and asks the engine to make
 * the change. Whether a swap is legal is a `transition.lv` question, and the
 * store obeys the answer rather than second-guessing it.
 *
 * Four rules, and they are the whole design:
 *
 *  1. The button is offered only when the athlete could actually act on it: a
 *     key is configured, an exercise is in progress, and nothing has been
 *     recorded against it. `replaceExerciseTarget` mirrors the rule's guards so
 *     the affordance and the engine agree; the rule remains the authority.
 *  2. The engine goes first. `choose` creates the exercise, dispatches, and
 *     only writes the routine row once the dispatch came back accepted — a
 *     rejected swap must not leave the routine pointing somewhere the running
 *     session isn't.
 *  3. A stale answer is discarded, never applied. `generation` advances on
 *     every `open` and `cancel`, the `aiChatStore` pattern.
 *  4. The workout never depends on the AI. No key means no call; every failure
 *     is logged and surfaced as an error string, and nothing here ever throws
 *     at the screen.
 *
 * Nothing is persisted. Deps are injected (`ExerciseReplaceDeps`) so the whole
 * path tests without network or DB.
 */

import { create } from 'zustand';
import { buildAlternatesPrompt } from '@/ai/alternatesPrompt';
import {
  ExerciseAlternate,
  ExerciseAlternates,
  validateExerciseAlternate,
} from '@/ai/alternatesSchema';
import { applyAlternateToRoutine, ensureAlternateExercise } from '@/ai/acceptAlternate';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import { getSettings } from '@/state/settings';
import { createAiClient } from '@/ai/provider/factory';
import type { Event, ExerciseKind, SessionState } from '@/engine/types';
import type { AiClient, ProviderConfig } from '@/ai/provider/types';

/**
 * The entry being replaced, plus the ids the swap needs. Built by
 * `replaceExerciseTarget` from engine state; the title is resolved shell-side,
 * since engine entries carry ids only.
 */
export interface ReplaceTarget {
  sessionId: string;
  routineId: string;
  /** 0-based entry position — the engine's `idx` and the DB row's `order`. */
  idx: number;
  exerciseId: string;
  exerciseTitle: string;
  kind: ExerciseKind;
  warmupSets: number;
  targetSets: number;
  targetReps: number;
  targetDurationSeconds: number;
  restSeconds: number;
}

export interface ExerciseReplaceDeps {
  getSettings: typeof getSettings;
  createClient: (config: ProviderConfig) => AiClient;
  /** The active session store's dispatch; returns null when the engine rejected. */
  dispatch: (event: Event) => Promise<SessionState | null>;
  /** Create-only exercise resolution; returns the exercise id. */
  ensureExercise: (alternate: ExerciseAlternate, kind: ExerciseKind) => Promise<string>;
  /** In-place routine_exercises row swap, keyed by (routineId, order). */
  applyToRoutine: (routineId: string, order: number, exerciseId: string) => Promise<void>;
  logError?: (message: string, error: unknown) => void;
}

export type ExerciseReplaceStatus = 'idle' | 'loading' | 'choosing' | 'swapping' | 'error';

interface ExerciseReplaceState {
  status: ExerciseReplaceStatus;
  /** The substitutes on offer; empty unless status is 'choosing'. */
  alternates: ExerciseAlternate[];
  /** User-facing copy for a failure. Never a stack trace. */
  error: string | null;
  /**
   * Bumped once each time a swap finishes re-pointing the routine row. The
   * session screen's prefill effect depends on this so it re-reads the routine's
   * prescribed loads *after* the write commits.
   *
   * This exists because the two halves of a swap race. `choose()` dispatches to
   * the engine before it re-points the row (deliberately — a rejected swap must
   * not move the routine), but that same dispatch updates activeSessionStore,
   * which re-runs the prefill effect. The effect's read and
   * applyAlternateToRoutine's write are then independent async paths with no
   * ordering between them: if the read wins, the substitute's weight field is
   * pre-typed with the *replaced* exercise's prescribed load — the exact hazard
   * the swap-clear rule exists to prevent.
   *
   * Rather than trying to win that race, this guarantees one more effect run
   * strictly after the write. The extra run is idempotent.
   *
   * SCOPE: exercise swaps only. `upsertRoutine` is the other writer of
   * target_weight_kg — a coach revising a routine through acceptDraft can change
   * or clear a prescription and bumps nothing here, so a session screen that
   * stays mounted across such an edit keeps the stale value until it remounts.
   * That is not a live defect (nothing reads a prescription outside the session
   * screen's own prefill, and editing a routine mid-session is not a supported
   * flow), and the name is deliberately about the *routine* rather than the swap
   * so that an acceptDraft bump can be added to this same counter later without
   * a rename. Do not assume routine edits are covered today.
   */
  routineRevision: number;
  /** Ask for alternates for this entry and open the picker. */
  open(target: ReplaceTarget): Promise<void>;
  /** Apply one. @returns true when the swap landed in both engine and routine. */
  choose(alternate: ExerciseAlternate): Promise<boolean>;
  /** Close the picker and invalidate any in-flight request. */
  cancel(): void;
}

/**
 * Derive the replaceable entry from engine state, or null when there is none.
 *
 * The two conditions mirror `transition.lv`'s ReplaceExercise guards:
 *
 *  - phase is warmup or working — an exercise is in progress. Resting and
 *    stretching sit between exercises, paused is a held position, and
 *    idle/done have no entry to swap.
 *  - `setIndex === 0` — nothing has been recorded against this entry. Both
 *    LogSet and SetDone advance setIndex and it resets on every entry change,
 *    so it is exactly entry-scoped. Scanning `loggedSets` by exerciseId would
 *    not be: a routine may list the same movement twice, and the second entry
 *    would inherit the first's veto.
 */
export function replaceExerciseTarget(
  sessionState: SessionState | null | undefined,
  exerciseTitles?: Record<string, string>
): ReplaceTarget | null {
  if (!sessionState) return null;
  if (sessionState.phase !== 'warmup' && sessionState.phase !== 'working') return null;
  if (sessionState.setIndex !== 0) return null;

  const entry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!entry) return null;

  return {
    sessionId: sessionState.sessionId,
    routineId: sessionState.routineId,
    idx: entry.idx,
    exerciseId: entry.exerciseId,
    exerciseTitle: exerciseTitles?.[entry.exerciseId] || entry.exerciseId,
    kind: entry.kind,
    warmupSets: entry.warmupSets,
    targetSets: entry.targetSets,
    targetReps: entry.targetReps,
    targetDurationSeconds: entry.targetDurationSeconds,
    restSeconds: entry.restSeconds,
  };
}

/**
 * Whether the screen should render the Replace button at all.
 *
 * Hidden rather than disabled without a key: a disabled button advertises a
 * feature the athlete cannot reach and cannot fix from here.
 */
export function canOfferReplace(
  sessionState: SessionState | null | undefined,
  settings: { anthropicKey?: string; openaiKey?: string }
): boolean {
  const hasAnthropicKey = settings.anthropicKey?.trim();
  const hasOpenaiKey = settings.openaiKey?.trim();
  if (!hasAnthropicKey && !hasOpenaiKey) return false;
  return replaceExerciseTarget(sessionState) !== null;
}

export function createExerciseReplaceStore(deps: ExerciseReplaceDeps) {
  const log = deps.logError ?? ((message: string, error: unknown) => console.warn(message, error));

  let generation = 0;
  let target: ReplaceTarget | null = null;
  // A swap in flight. The screen's own busy state is cosmetic, so this latch
  // is what actually stops a second tap from dispatching a second swap.
  let swapping = false;

  return create<ExerciseReplaceState>((set) => ({
    status: 'idle',
    alternates: [],
    error: null,
    routineRevision: 0,

    async open(nextTarget: ReplaceTarget) {
      const gen = ++generation;
      target = nextTarget;
      swapping = false;

      const settings = deps.getSettings();
      const hasAnthropicKey = settings.anthropicKey?.trim();
      const hasOpenaiKey = settings.openaiKey?.trim();
      // No key, no call, and no placeholder — the button should not have been
      // rendered, but the guard is re-stated here so no caller can reach the
      // API without one.
      if (!hasAnthropicKey && !hasOpenaiKey) {
        target = null;
        set({ status: 'idle', alternates: [], error: null });
        return;
      }

      set({ status: 'loading', alternates: [], error: null });

      try {
        const prompt = buildAlternatesPrompt({
          exercise: {
            title: nextTarget.exerciseTitle,
            kind: nextTarget.kind,
            warmupSets: nextTarget.warmupSets,
            targetSets: nextTarget.targetSets,
            targetReps: nextTarget.targetReps,
            targetDurationSeconds: nextTarget.targetDurationSeconds,
            restSeconds: nextTarget.restSeconds,
          },
          goals: settings.aiGoals,
          equipment: settings.aiEquipment,
          personality: settings.aiPersonality,
          // The non-negotiable tier only. Suggesting a substitute is coaching,
          // so the safety rules bind here exactly as they do in the chat —
          // `buildAlternatesPrompt` renders them last, after every
          // user-controlled section, to keep that precedence. The overridable
          // tier is deliberately left out: it is about how to *compose a
          // routine* (warmups, cooldowns, stretch splitting) and says nothing
          // about substituting one movement for another.
          directives: IMMUTABLE_DIRECTIVES,
          profileAge: settings.profileAge,
          profileExperience: settings.profileExperience,
        });

        const providerConfig: ProviderConfig = {
          anthropicKey: settings.anthropicKey,
          openaiKey: settings.openaiKey,
          aiProvider: settings.aiProvider,
        };
        const client = deps.createClient(providerConfig);
        const result = (await client.suggest(prompt)) as ExerciseAlternates;

        // Cancelled, or a newer request superseded this one, while it was in
        // flight: the answer is about an exercise the athlete is no longer
        // looking at.
        if (generation !== gen) return;

        set({ status: 'choosing', alternates: result.alternates, error: null });
      } catch (error) {
        log('Exercise alternates request failed:', error);
        if (generation !== gen) return;
        set({
          status: 'error',
          alternates: [],
          error: 'Couldn’t load alternatives. Try again, or keep going with this exercise.',
        });
      }
    },

    async choose(alternate: ExerciseAlternate) {
      const current = target;
      if (!current || swapping) return false;

      const gen = generation;
      swapping = true;
      set({ status: 'swapping', error: null });

      try {
        // Validate twice: the client validated the whole payload on receipt,
        // and this is the last checkpoint before anything is written.
        const validated = validateExerciseAlternate(alternate);

        // Create-only, and the kind comes from the entry — a substitute
        // changes identity, never the prescription or the exercise record.
        const exerciseId = await deps.ensureExercise(validated, current.kind);

        // The engine is the authority on whether the swap is legal. A null
        // here is a rejection (the store surfaces the reason in lastError).
        const newState = await deps.dispatch({
          tag: 'ReplaceExercise',
          idx: current.idx,
          exerciseId,
        });

        if (!newState) {
          throw new Error('the engine rejected the replacement');
        }

        // Only now the routine row, so a rejected swap can never leave the
        // routine pointing somewhere the running session isn't.
        await deps.applyToRoutine(current.routineId, current.idx, exerciseId);

        // Strictly after the row is re-pointed and its prescription cleared.
        // Placement is the whole contract: bumped before the await, this would
        // race the write it exists to sequence after; bumped in the catch, it
        // would announce a clear that never happened.
        set((state) => ({ routineRevision: state.routineRevision + 1 }));

        target = null;
        swapping = false;
        if (generation !== gen) return true;
        set({ status: 'idle', alternates: [], error: null });
        return true;
      } catch (error) {
        log('Exercise replacement failed:', error);
        swapping = false;
        if (generation !== gen) return false;
        set({
          status: 'error',
          error: 'Couldn’t swap that exercise. Keep going with this one.',
        });
        return false;
      }
    },

    cancel() {
      generation++;
      target = null;
      swapping = false;
      set({ status: 'idle', alternates: [], error: null });
    },
  }));
}

/**
 * The app-wide store. The database is required lazily so importing this module
 * does not pull in the database singleton at module-init time, and dispatch is
 * read off the active session store at call time rather than captured.
 */
export const exerciseReplaceStore = createExerciseReplaceStore({
  getSettings,
  createClient: createAiClient,
  dispatch: (event) => {
    const { activeSessionStore } = require('@/state/activeSession');
    return activeSessionStore.getState().dispatch(event);
  },
  ensureExercise: (alternate, kind) => {
    const { database } = require('@/db');
    return ensureAlternateExercise(database, alternate, kind);
  },
  applyToRoutine: (routineId, order, exerciseId) => {
    const { database } = require('@/db');
    return applyAlternateToRoutine(database, routineId, order, exerciseId);
  },
});
