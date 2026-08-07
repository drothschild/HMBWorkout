/**
 * Rest-screen coach commentary: the ephemeral cache + generation store.
 *
 * Shell-only, like the rest of the AI slice — it never touches the engine and
 * never influences session flow. The rest screen reads `text`/`pending` and the
 * screen's effect drives `show`/`hide` off the engine's phase; nothing here
 * decides what happens next in the workout.
 *
 * Three rules, and they are the whole design:
 *
 *  1. ONE call per upcoming routine entry per session. The cache is keyed by
 *     `sessionId#entryIdx`, so every rest between sets of the same exercise
 *     reuses the first answer. `pendingRequests` dedupes the in-flight case, so
 *     a rest that restarts before the first response lands does not double-bill.
 *  2. A stale answer is discarded, never shown. `generation` advances on every
 *     `show` for a new entry and on every `hide`, the `aiChatStore` pattern; a
 *     response resolving under an old generation is dropped from the UI. It is
 *     still written to the cache — it cost a call either way, and rule 1 says we
 *     do not pay for it twice.
 *  3. Rest never depends on the AI. No key means no call and no placeholder; any
 *     failure is logged and swallowed, exactly as `src/health` treats HealthKit.
 *
 * Nothing here is persisted. The cache is gone on app restart, by design.
 */

import { create } from 'zustand';
import { createRestCommentaryClient } from '@/ai/anthropicClient';
import {
  buildRestCommentaryPrompt,
  normalizeCommentaryText,
  type RestCommentaryHistorySet,
} from '@/ai/restCommentaryPrompt';
import { loadRestCommentaryHistory } from '@/ai/restCommentaryHistory';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import { getSettings } from '@/state/settings';
import { isRestingPhase, deriveSetPosition } from '@/state/sessionPresenter';
import type { ExerciseKind, SessionState } from '@/engine/types';

/**
 * The exercise the athlete is about to perform, plus the ids that scope the
 * cache. Built by `restCommentaryTarget` from engine state; display data
 * (`exerciseTitle`) is resolved shell-side, since engine entries carry ids only.
 */
export interface RestCommentaryTarget {
  sessionId: string;
  /** 0-based routine entry index — the cache key within a session. */
  entryIdx: number;
  exerciseId: string;
  exerciseTitle: string;
  kind: ExerciseKind;
  warmupSets: number;
  targetSets: number;
  targetReps: number;
  targetDurationSeconds: number;
  restSeconds: number;
  isWarmupSet: boolean;
  setNumber: number;
}

export interface RestCommentaryDeps {
  getSettings: typeof getSettings;
  loadHistory: (exerciseId: string) => Promise<RestCommentaryHistorySet[]>;
  createClient: typeof createRestCommentaryClient;
  logError?: (message: string, error: unknown) => void;
}

interface RestCommentaryState {
  /** The comment to render, or null when there is none (yet, or at all). */
  text: string | null;
  /**
   * True while a request for the current target is in flight. The rest screen
   * reserves the commentary slot on this, so the text lands in space that was
   * already there instead of shoving the countdown when it arrives.
   */
  pending: boolean;
  /**
   * True once a request has been attempted for the current target, even if it
   * failed. The rest screen uses this to keep the commentary slot reserved for
   * the life of the rest, avoiding a one-frame layout shift when a request fails.
   */
  attempted: boolean;
  /** Rest started, or moved to a new upcoming entry. Idempotent per entry. */
  show(target: RestCommentaryTarget): Promise<void>;
  /** Rest ended. Clears the comment and invalidates any in-flight request. */
  hide(): void;
}

/**
 * Derive the upcoming exercise from engine state, or null when there is none to
 * comment on.
 *
 * What "upcoming" means during rest, verified against `transition.lv`'s
 * `advance_after_set`: resting between sets of one exercise advances `setIndex`
 * and leaves `exerciseIndex` alone, and resting between exercises advances
 * `exerciseIndex` to the next entry before entering Resting. Either way the
 * entry at `exerciseIndex` IS the upcoming one — the same entry the presenter
 * exposes as `currentEntry`. A finished workout goes straight to Done with no
 * rest, so "rest before done" does not occur; the missing-entry guard below
 * covers a stranded index anyway, by showing nothing and making no call.
 *
 * The resting / paused-mid-rest test mirrors `createSessionPresenter`'s
 * `isResting` / `isRestPaused`, including the 0 sentinel on `restRemainingMs`.
 */
export function restCommentaryTarget(
  sessionState: SessionState | null | undefined,
  exerciseTitles?: Record<string, string>
): RestCommentaryTarget | null {
  if (!sessionState) return null;

  // Use shared predicate: true during resting or paused-mid-rest
  if (!isRestingPhase(sessionState)) return null;

  const entry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!entry) return null;

  // Use shared derivation for set position (same calculation as presenter)
  const setPos = deriveSetPosition(sessionState, entry);
  if (!setPos) return null;

  return {
    sessionId: sessionState.sessionId,
    entryIdx: entry.idx,
    exerciseId: entry.exerciseId,
    exerciseTitle: exerciseTitles?.[entry.exerciseId] || entry.exerciseId,
    kind: entry.kind,
    warmupSets: entry.warmupSets,
    targetSets: entry.targetSets,
    targetReps: entry.targetReps,
    targetDurationSeconds: entry.targetDurationSeconds,
    restSeconds: entry.restSeconds,
    isWarmupSet: setPos.isWarmupSet,
    setNumber: setPos.setNumber,
  };
}

export function createRestCommentaryStore(deps: RestCommentaryDeps) {
  const log = deps.logError ?? ((message: string, error: unknown) => console.warn(message, error));

  /** `sessionId#entryIdx` → comment. In-memory only; never persisted. */
  const cache = new Map<string, string>();
  /** Same key → the single in-flight request, so a restart cannot double-bill. */
  const pendingRequests = new Map<string, Promise<string | null>>();

  let cachedSessionId: string | null = null;
  let currentKey: string | null = null;
  let generation = 0;

  const keyOf = (target: RestCommentaryTarget) => `${target.sessionId}#${target.entryIdx}`;

  function apiKey(): string | null {
    const key = deps.getSettings().anthropicKey?.trim();
    return key ? key : null;
  }

  async function requestComment(key: string, target: RestCommentaryTarget): Promise<string | null> {
    const inFlight = pendingRequests.get(key);
    if (inFlight) return inFlight;

    // Deliberate deviation from rule 1 ("one call per entry per session"):
    // Failed requests are NOT cached, so a retry on the next rest of the same
    // entry is allowed. This trades a possible double-call on network transience
    // against guaranteed silence when the API fails. Since each rest entry is
    // typically ~90s apart and the commentary is best-effort, the asymmetry is
    // intentional: rest must never depend on the AI.

    const request = (async () => {
      const settings = deps.getSettings();
      const trimmedKey = settings.anthropicKey?.trim();
      // Checked in `show` too; re-checked here so no caller can reach the API
      // without a key.
      if (!trimmedKey) return null;

      const history = await deps.loadHistory(target.exerciseId);
      const prompt = buildRestCommentaryPrompt({
        exercise: {
          title: target.exerciseTitle,
          kind: target.kind,
          warmupSets: target.warmupSets,
          targetSets: target.targetSets,
          targetReps: target.targetReps,
          targetDurationSeconds: target.targetDurationSeconds,
          restSeconds: target.restSeconds,
          isWarmupSet: target.isWarmupSet,
          setNumber: target.setNumber,
        },
        history,
        personality: settings.aiPersonality,
        // The non-negotiable tier only, matching exerciseReplaceStore's
        // choice — rendered last by buildRestCommentaryPrompt so it outranks
        // the user-controlled coaching-style text above it.
        directives: IMMUTABLE_DIRECTIVES,
        profileAge: settings.profileAge,
        profileExperience: settings.profileExperience,
      });

      const rawComment = await deps.createClient({ apiKey: trimmedKey }).comment(prompt);
      // Normalize the response: collapse whitespace, strip quotes, and bound length
      // so the rest screen can render it safely. The client is pure transport and
      // returns raw text; consumption normalizes it.
      const comment = normalizeCommentaryText(rawComment);
      // Cached even if nobody is looking any more: the call is already paid
      // for, and the next rest on this entry must not fire a second one.
      // Guard the cache.set with session/generation to prevent a stale
      // response from a cleared session lingering in the cache.
      if (comment !== null && cachedSessionId === target.sessionId) {
        cache.set(key, comment);
      }
      return comment;
    })()
      .catch((error) => {
        // A failed comment is a missing comment, never a failed rest.
        log('Rest commentary failed:', error);
        return null;
      })
      .finally(() => {
        // Only remove if this exact promise is still the one we're tracking.
        // If the session was cleared or a new request for the same key was
        // started, this stale request should not wipe out the new one.
        if (pendingRequests.get(key) === request) {
          pendingRequests.delete(key);
        }
      });

    pendingRequests.set(key, request);
    return request;
  }

  return create<RestCommentaryState>((set) => ({
    text: null,
    pending: false,
    attempted: false,

    async show(target: RestCommentaryTarget) {
      // Keys are session-scoped, so a stale session's entries could never
      // collide — but holding its comments forever would be a leak, not a
      // feature.
      if (cachedSessionId !== target.sessionId) {
        cache.clear();
        pendingRequests.clear();
        cachedSessionId = target.sessionId;
      }

      const key = keyOf(target);
      // Same upcoming entry: the answer on screen is still the right one, and
      // re-entering must not re-request or disturb an in-flight response.
      if (key === currentKey) return;

      currentKey = key;
      const gen = ++generation;

      const cached = cache.get(key);
      if (cached !== undefined) {
        set({ text: cached, pending: false, attempted: true });
        return;
      }

      // No key configured: silence, and no reserved space either.
      if (!apiKey()) {
        set({ text: null, pending: false, attempted: false });
        return;
      }

      set({ text: null, pending: true, attempted: true });

      const comment = await requestComment(key, target);

      // Rest ended, or the upcoming entry changed, while this was in flight:
      // the answer is about an exercise the athlete is no longer facing.
      if (generation !== gen) return;

      set({ text: comment, pending: false });
    },

    hide() {
      if (currentKey === null) return;

      currentKey = null;
      generation++;
      set({ text: null, pending: false, attempted: false });
    },
  }));
}

/**
 * The app-wide store. The database is required lazily so importing this module
 * does not pull in the database singleton at module-init time.
 */
export const restCommentaryStore = createRestCommentaryStore({
  getSettings,
  loadHistory: (exerciseId: string) => {
    const { database } = require('@/db');
    return loadRestCommentaryHistory(database, exerciseId);
  },
  createClient: createRestCommentaryClient,
});
