/**
 * Exercise-question store: the session screen's "?" button.
 *
 * Shell-only, like the rest of the AI slice — it never touches the engine
 * and never influences session flow. The screen reads `expandedKey`/`text`/
 * `pending` and calls `toggle`; nothing here decides what happens next in
 * the workout.
 *
 * Three rules, mirroring `restCommentaryStore.ts`:
 *
 *  1. ONE call per exercise entry per session. The cache is keyed by
 *     `sessionId#entryIdx`, so collapsing and re-expanding (or tapping the
 *     button again after the exercise comes back around) reuses the first
 *     answer. `pendingRequests` dedupes the in-flight case, so a rapid
 *     collapse-then-re-expand before the first response lands does not
 *     double-bill.
 *  2. A stale answer is discarded, never shown. `generation` advances on
 *     every expand of a new entry and on every explicit `collapse`; a
 *     response resolving under an old generation is dropped from the UI. It
 *     is still written to the cache — it cost a call either way, and rule 1
 *     says we do not pay for it twice.
 *  3. Logging a set never depends on the AI. No key means no call and the
 *     block never expands; any failure is logged and swallowed, and the
 *     block quietly reverts to collapsed — since nothing was cached, the
 *     very next tap retries.
 *
 * Nothing here is persisted. The cache is gone on app restart, by design.
 */

import { create } from 'zustand';
import { createExerciseQuestionClient } from '@/ai/exerciseQuestionClient';
import { buildExerciseQuestionPrompt, normalizeExerciseAnswerText } from '@/ai/exerciseQuestionPrompt';
import { loadExerciseDescription } from '@/ai/exerciseQuestionContext';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import { getSettings } from '@/state/settings';
import { isRestingPhase } from '@/state/sessionPresenter';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import type { ExerciseKind, SessionState } from '@/engine/types';

/** The exercise the athlete tapped the question button on, plus the ids that scope the cache. */
export interface ExerciseQuestionTarget {
  sessionId: string;
  /** 0-based routine entry index — the cache key within a session. */
  entryIdx: number;
  exerciseId: string;
  exerciseTitle: string;
  kind: ExerciseKind;
}

export interface ExerciseQuestionDeps {
  getSettings: typeof getSettings;
  loadDescription: (exerciseId: string) => Promise<string | null>;
  createClient: typeof createExerciseQuestionClient;
  logError?: (message: string, error: unknown) => void;
}

interface ExerciseQuestionState {
  /** `sessionId#entryIdx` of the entry currently expanded, or null when collapsed. */
  expandedKey: string | null;
  /** The answer to render, or null when there is none (yet, or at all). */
  text: string | null;
  /** True while a request for the expanded entry is in flight. */
  pending: boolean;
  /** Tap: expands the given exercise (fetching or reusing the cache), or collapses if it's already expanded. */
  toggle(target: ExerciseQuestionTarget): Promise<void>;
  /** Explicit collapse — used when the current exercise changes or the screen unmounts. */
  collapse(): void;
}

/** True when a usable Anthropic key is configured — the "hidden without a key" gate. */
export function hasAnthropicKey(settings: { anthropicKey: string }): boolean {
  return Boolean(settings.anthropicKey?.trim());
}

/**
 * Build the cache key for an exercise question target.
 *
 * Keyed per entry (not per exercise), so a duplicate exercise pays twice:
 * `sessionId#entryIdx` scopes uniquely within a session. The prompt carries
 * nothing entry-specific, so the duplicate-entry double-call buys no better
 * answer — it is the accepted cost of mirroring restCommentaryStore and the
 * AGENTS.md entry-identity boundary (an entry is its row, never its
 * exercise). `sessionId#exerciseId` would be cheaper with identical output.
 */
export function exerciseQuestionKey(target: ExerciseQuestionTarget): string {
  return `${target.sessionId}#${target.entryIdx}`;
}

/**
 * Derive the current in-progress exercise from engine state, or null when
 * there is no exercise to ask about — no session, the session is done, or
 * the full-screen rest takeover (`isRestingPhase`, the same predicate
 * `restCommentaryTarget` uses).
 */
export function exerciseQuestionTarget(
  sessionState: SessionState | null | undefined,
  exerciseTitles?: Record<string, string>
): ExerciseQuestionTarget | null {
  if (!sessionState) return null;
  if (sessionState.phase === 'done' || sessionState.phase === 'idle') return null;
  if (isRestingPhase(sessionState)) return null;

  const entry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!entry) return null;

  return {
    sessionId: sessionState.sessionId,
    entryIdx: entry.idx,
    exerciseId: entry.exerciseId,
    exerciseTitle: exerciseTitles?.[entry.exerciseId] || entry.exerciseId,
    kind: entry.kind,
  };
}

export function createExerciseQuestionStore(deps: ExerciseQuestionDeps) {
  const log = deps.logError ?? ((message: string, error: unknown) => console.warn(message, error));

  /** `sessionId#entryIdx` → answer. In-memory only; never persisted. */
  const cache = new Map<string, string>();
  /** Same key → the single in-flight request, so a collapse/re-expand cannot double-bill. */
  const pendingRequests = new Map<string, Promise<string | null>>();

  let cachedSessionId: string | null = null;
  let currentKey: string | null = null;
  let generation = 0;

  function apiKey(): string | null {
    const key = deps.getSettings().anthropicKey?.trim();
    return key ? key : null;
  }

  async function requestAnswer(key: string, target: ExerciseQuestionTarget): Promise<string | null> {
    const inFlight = pendingRequests.get(key);
    if (inFlight) return inFlight;

    // Deliberate deviation from rule 1 ("one call per entry per session"):
    // failed requests are NOT cached, so a retry on the next tap of the same
    // entry is allowed. Best-effort, like rest commentary: logging a set
    // must never depend on the AI, so a transient failure should not be
    // permanently silent for the rest of the session.

    const request = (async () => {
      const settings = deps.getSettings();
      const trimmedKey = settings.anthropicKey?.trim();
      // Checked in `toggle` too; re-checked here so no caller can reach the
      // API without a key.
      if (!trimmedKey) return null;

      const description = await deps.loadDescription(target.exerciseId);
      const prompt = buildExerciseQuestionPrompt({
        exercise: { title: target.exerciseTitle, kind: target.kind, description },
        personality: settings.aiPersonality,
        // The non-negotiable tier only, matching exerciseReplaceStore's and
        // restCommentaryStore's choice — rendered last by
        // buildExerciseQuestionPrompt so it outranks the user-controlled
        // coaching-style text above it.
        directives: IMMUTABLE_DIRECTIVES,
      });

      const rawAnswer = await deps.createClient({ apiKey: trimmedKey }).ask(prompt);
      const answer = normalizeExerciseAnswerText(rawAnswer);

      // Cached even if nobody is looking any more: the call is already paid
      // for, and revisiting this entry must not fire a second one. Guarded
      // by session so a stale session's answer can't pollute a new one.
      if (answer !== null && cachedSessionId === target.sessionId) {
        cache.set(key, answer);
      }
      return answer;
    })()
      .catch((error) => {
        // A failed answer is a missing answer, never a failed workout.
        log('Exercise question failed:', error);
        return null;
      })
      .finally(() => {
        // Only remove if this exact promise is still the one being tracked.
        if (pendingRequests.get(key) === request) {
          pendingRequests.delete(key);
        }
      });

    pendingRequests.set(key, request);
    return request;
  }

  return create<ExerciseQuestionState>((set) => ({
    expandedKey: null,
    text: null,
    pending: false,

    async toggle(target: ExerciseQuestionTarget) {
      // Keys are session-scoped, so a stale session's entries could never
      // collide — but holding its cache forever would be a leak, not a
      // feature.
      if (cachedSessionId !== target.sessionId) {
        cache.clear();
        pendingRequests.clear();
        cachedSessionId = target.sessionId;
      }

      const key = exerciseQuestionKey(target);

      // Tapping the currently-expanded entry collapses it. Any in-flight
      // request is left running so its result still lands in the cache for
      // the next tap (rule 1: a call already paid for is never wasted).
      if (currentKey === key) {
        currentKey = null;
        generation++;
        set({ expandedKey: null, text: null, pending: false });
        return;
      }

      currentKey = key;
      const gen = ++generation;

      const cached = cache.get(key);
      if (cached !== undefined) {
        set({ expandedKey: key, text: cached, pending: false });
        return;
      }

      // No key configured: never expand, never call. Defense-in-depth — the
      // screen already hides the button in this case.
      if (!apiKey()) {
        currentKey = null;
        set({ expandedKey: null, text: null, pending: false });
        return;
      }

      set({ expandedKey: key, text: null, pending: true });

      const answer = await requestAnswer(key, target);

      // Collapsed, or moved to a different entry, while this was in flight:
      // the answer is about an exercise no longer on screen.
      if (generation !== gen) return;

      if (answer === null) {
        // Quiet failure: revert to the pre-tap state so the very next tap
        // retries (nothing was cached).
        currentKey = null;
        set({ expandedKey: null, text: null, pending: false });
        return;
      }

      set({ text: answer, pending: false });
    },

    collapse() {
      if (currentKey === null) return;

      currentKey = null;
      generation++;
      set({ expandedKey: null, text: null, pending: false });
    },
  }));
}

/**
 * The app-wide store. The database is required lazily so importing this
 * module does not pull in the database singleton at module-init time.
 */
export const exerciseQuestionStore = createExerciseQuestionStore({
  getSettings,
  loadDescription: (exerciseId: string) => {
    const { database } = require('@/db');
    return loadExerciseDescription(database, exerciseId);
  },
  createClient: createExerciseQuestionClient,
});
