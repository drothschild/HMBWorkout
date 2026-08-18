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
 *  1. ONE call per REST per session. The cache is keyed by the rest's own
 *     engine position (`sessionId#exerciseIndex:setIndex`), which is unique per
 *     rest within a session, so re-entering the same rest — a remount, a
 *     pause/resume — reuses the first answer while a genuinely new rest gets its
 *     own. Before #270 the key was `sessionId#entryIdx`, one call per exercise;
 *     commenting on the set just completed needs a fresh call per working set,
 *     and the user accepted that cost (roughly 4x on a 4x4 workout).
 *     `pendingRequests` dedupes the in-flight case, so a rest that restarts
 *     before the first response lands does not double-bill.
 *  2. A stale answer is discarded, never shown. `generation` advances on every
 *     `show` for a new rest and on every `hide`, the `aiChatStore` pattern; a
 *     response resolving under an old generation is dropped from the UI. It is
 *     still written to the cache — it cost a call either way, and rule 1 says we
 *     do not pay for it twice.
 *  3. Rest never depends on the AI. No key means no call and no placeholder; any
 *     failure is logged and swallowed, exactly as `src/health` treats HealthKit.
 *
 * Nothing here is persisted. The cache is gone on app restart, by design.
 */

import { create } from 'zustand';
import {
  buildRestCommentaryPrompt,
  normalizeCommentaryText,
  type RestCommentaryCompletedSet,
  type RestCommentaryHistorySet,
} from '@/ai/restCommentaryPrompt';
import { loadRestCommentaryHistory } from '@/ai/restCommentaryHistory';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import { getSettings } from '@/state/settings';
import { hasAiKey } from '@/state/hasAiKey';
import { isRestingPhase, deriveSetPosition } from '@/state/sessionPresenter';
import { createAiClient } from '@/ai/provider/factory';
import { supersetRunEndIndex } from '@/domain/supersetGrouping';
import type { ExerciseKind, LoggedSet, RoutineSet, SessionState } from '@/engine/types';
import type { AiClient, ProviderConfig } from '@/ai/provider/types';

/**
 * The exercise the remark is about, plus the ids that scope the cache. Built by
 * `restCommentaryTarget` from engine state; display data (`exerciseTitle`) is
 * resolved shell-side, since engine entries carry ids only.
 */
interface RestCommentaryTargetBase {
  sessionId: string;
  /**
   * 0-based routine entry index of the exercise this remark is about. For
   * `lastSet` that is the entry the completed set was performed on, which in a
   * superset group is NOT `exerciseIndex`.
   */
  entryIdx: number;
  /** The engine's own position at this rest. Together with `setIndex`, the cache identity. */
  exerciseIndex: number;
  setIndex: number;
  exerciseId: string;
  exerciseTitle: string;
  kind: ExerciseKind;
  restSeconds: number;
  /**
   * The entry's ordered prescription (#276 AC4.12). Carried through to
   * `buildRestCommentaryPrompt`'s target summary, which is what lets the remark
   * name the load the athlete is ramping to instead of a set count.
   */
  sets: readonly RoutineSet[];
  isWarmupSet: boolean;
  setNumber: number;
  /**
   * `setNumber`'s denominator: how many sets of the same type the entry's own
   * list prescribes (#276 AC3.4). Carried alongside `setNumber` because both
   * come out of one `deriveSetPosition` call and must not be re-derived apart.
   */
  totalOfType: number;
}

export type RestCommentaryTarget =
  | (RestCommentaryTargetBase & { shape: 'upNext' })
  | (RestCommentaryTargetBase & {
      shape: 'lastSet';
      completedSet: RestCommentaryCompletedSet;
      /**
       * Index of `lastLoggedSet` within `loggedSets`. Identifies the logged set
       * this remark is about, so a second rest arriving with the same index —
       * which means the visit in between was skipped, not logged — can be
       * refused. See `claimLogIndex`.
       */
      logIndex: number;
    });

/**
 * The cache identity of a rest. Exported because `src/app/session.tsx` needs
 * exactly the same string to decide when its commentary effect re-fires, and a
 * screen-side copy would silently go stale the moment this changed. `src/app`
 * has no jest coverage, so a structural test in the sibling spec asserts the
 * screen calls this rather than rebuilding it.
 */
export function restCommentaryKey(target: RestCommentaryTarget): string {
  return `${target.sessionId}#${target.exerciseIndex}:${target.setIndex}`;
}

export interface RestCommentaryDeps {
  getSettings: typeof getSettings;
  loadHistory: (exerciseId: string) => Promise<RestCommentaryHistorySet[]>;
  createClient: (config: ProviderConfig) => AiClient;
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
 * Which entry the round that just ended was actually performed on, or null when
 * the position does not identify one.
 *
 * Read off `transition.lv`/`helpers.lv` rather than re-deciding anything: a
 * round visits the members of the current superset group in index order and
 * skips any member whose own prescribed set list is already exhausted
 * (`h.next_active_idx` is active at round r iff `r < length(entry.sets)`, #276),
 * so the LAST member
 * visited in round `setIndex - 1` is the highest-indexed member of the group
 * still active at that round. A standalone entry is a group of exactly one —
 * `h.group_end_idx` compares labels and `None` (the `""` sentinel here) never
 * matches, so two adjacent unlabelled entries are two groups, not one.
 *
 * This is display derivation, not session flow: nothing it returns can change
 * what the engine does next.
 *
 * `supersetPosition` earns its place here only as a defensive one. On every
 * state the engine can actually produce at `setIndex >= 1`, `exerciseIndex` is
 * the first member active at the NEXT round, and a member active at round + 1
 * is necessarily active at round too — so `exerciseIndex` can never sit past the
 * member being looked for, and starting the backwards scan from `exerciseIndex`
 * would find the same entry. It is kept because `hydrate` restores a stored
 * position that no rule ever validates (AGENTS.md engine convention 5), and
 * because the true group start is the honest thing to scan. A mutation that
 * drops it therefore survives the suite, and that is expected.
 */
function performedEntryIndex(sessionState: SessionState): number | null {
  const round = sessionState.setIndex - 1;
  if (round < 0) return null;

  const entries = sessionState.entries ?? [];
  const groupStart = sessionState.exerciseIndex - (sessionState.supersetPosition ?? 0);
  // An out-of-range groupStart, or an entry with no `supersetGroup` field at
  // all, identifies nothing to scan. (The engine always supplies the field —
  // `""` when there is no superset — so this is the hydrate/partial-state
  // guard, not the no-superset case.)
  if (entries[groupStart]?.supersetGroup === undefined) return null;

  // The contiguity scan itself is shared (#278): `""` is the no-superset
  // sentinel and can never join a run, so a standalone entry's group ends
  // where it starts.
  const groupEnd = supersetRunEndIndex(entries, groupStart, (entry) => entry.supersetGroup);

  for (let idx = groupEnd; idx >= groupStart; idx -= 1) {
    const entry = entries[idx];
    if (entry && entry.sets.length > round) return idx;
  }

  return null;
}

/** The engine hands RPE back as -1 when unset (AGENTS.md engine convention 8). */
function withoutRpeSentinel(set: LoggedSet): RestCommentaryCompletedSet {
  return {
    reps: set.reps ?? null,
    weightKg: set.weightKg ?? null,
    durationSeconds: set.durationSeconds ?? null,
    rpe: set.rpe == null || set.rpe < 0 ? null : set.rpe,
  };
}

/**
 * Derive what the rest screen's coach should talk about, or null when there is
 * nothing to say.
 *
 * THE DISCRIMINATOR, verified against `transition.lv`'s `advance_after_set`:
 * `ScheduleRest` is emitted from exactly two sites, and they differ in
 * `setIndex`. The round-repeat rest (transition.lv:66-70) writes
 * `setIndex: s.setIndex + 1`, so it is always >= 1 and `exerciseIndex` stays
 * inside the current superset group. The group-exhausted rest
 * (transition.lv:103-107) writes `setIndex: 0` and moves `exerciseIndex` to a
 * fresh landing. So during Resting, `setIndex >= 1` means the rest landed
 * INSIDE an exercise or group and `setIndex === 0` means it landed BETWEEN two
 * different exercises. This is snapshot-only and stays correct when a routine
 * lists the same exercise twice, which an `exerciseId` comparison would not.
 * Resume/AppForegrounded re-enter Resting without touching `setIndex`, so a
 * rehydrated or foregrounded rest reads the same as the one it recovers.
 *
 * `setIndex === 0` keeps today's behaviour: the entry at `exerciseIndex` is the
 * upcoming one, and the remark previews it.
 *
 * `setIndex >= 1` comments on the set just completed, subject to three guards,
 * each of which yields SILENCE rather than falling back to the up-next shape:
 *
 *  - `lastLoggedSet` must exist. A session whose first set was skipped has none.
 *  - Its `setType` must not be `'warmup'` — working sets only. The test is
 *    `!== 'warmup'`, never `=== 'working'`: transition.lv:190 stamps the entry's
 *    own `kind` for non-strength entries, so a cardio set is `'cardio'` and a
 *    stretch set `'stretch'`, and an equality test would kill the feature on
 *    every non-strength exercise.
 *  - It must belong to the entry the round actually just left. `SetDone`
 *    ("Skip Set", transition.lv:208-210) routes straight to `advance_after_set`
 *    and never writes `lastLoggedSet`, so a rest reached by skipping still
 *    carries the previous set. Comparing against `performedEntryIndex` catches
 *    the cross-member case (skip one superset partner after logging the other);
 *    the store's `claimLogIndex` latch catches the same-entry case, where the
 *    exercise id alone cannot tell the two apart.
 */
export function restCommentaryTarget(
  sessionState: SessionState | null | undefined,
  exerciseTitles?: Record<string, string>
): RestCommentaryTarget | null {
  if (!sessionState) return null;

  // Use shared predicate: true during resting or paused-mid-rest
  if (!isRestingPhase(sessionState)) return null;

  const currentEntry = sessionState.entries?.[sessionState.exerciseIndex];
  if (!currentEntry) return null;

  const position = {
    sessionId: sessionState.sessionId,
    exerciseIndex: sessionState.exerciseIndex,
    setIndex: sessionState.setIndex,
  };

  if (sessionState.setIndex >= 1) {
    const lastSet = sessionState.lastLoggedSet;
    if (!lastSet) return null;
    if (lastSet.setType === 'warmup') return null;

    const performedIdx = performedEntryIndex(sessionState);
    if (performedIdx === null) return null;

    const performed = sessionState.entries[performedIdx];
    if (performed.exerciseId !== lastSet.exerciseId) return null;

    // The completed set sat one round back; the shared derivation reads the
    // position off setIndex, so hand it the round that was actually performed.
    const setPos = deriveSetPosition(
      { ...sessionState, setIndex: sessionState.setIndex - 1 },
      performed
    );
    if (!setPos) return null;

    return {
      ...position,
      shape: 'lastSet',
      entryIdx: performed.idx,
      exerciseId: performed.exerciseId,
      exerciseTitle: exerciseTitles?.[performed.exerciseId] || performed.exerciseId,
      kind: performed.kind,
      restSeconds: performed.restSeconds,
      sets: performed.sets,
      isWarmupSet: setPos.isWarmupSet,
      setNumber: setPos.setNumber,
      totalOfType: setPos.totalOfType,
      completedSet: withoutRpeSentinel(lastSet),
      logIndex: sessionState.loggedSets.length - 1,
    };
  }

  // Use shared derivation for set position (same calculation as presenter)
  const setPos = deriveSetPosition(sessionState, currentEntry);
  if (!setPos) return null;

  return {
    ...position,
    shape: 'upNext',
    entryIdx: currentEntry.idx,
    exerciseId: currentEntry.exerciseId,
    exerciseTitle: exerciseTitles?.[currentEntry.exerciseId] || currentEntry.exerciseId,
    kind: currentEntry.kind,
    restSeconds: currentEntry.restSeconds,
    sets: currentEntry.sets,
    isWarmupSet: setPos.isWarmupSet,
    setNumber: setPos.setNumber,
    totalOfType: setPos.totalOfType,
  };
}

export function createRestCommentaryStore(deps: RestCommentaryDeps) {
  const log = deps.logError ?? ((message: string, error: unknown) => console.warn(message, error));

  /** Rest position key → comment. In-memory only; never persisted. */
  const cache = new Map<string, string>();
  /** Same key → the single in-flight request, so a restart cannot double-bill. */
  const pendingRequests = new Map<string, Promise<string | null>>();
  /**
   * Logged-set index → the rest that already commented on it. A logged set
   * earns exactly one remark; a second rest naming the same set means the visit
   * in between was skipped rather than logged (`SetDone` never advances
   * `lastLoggedSet`), so the snapshot is stale and the athlete gets silence.
   *
   * This is the half of the skip guard the snapshot cannot supply on its own:
   * for a standalone exercise, log-then-skip leaves an engine state that is
   * indistinguishable from log-then-log by exercise id alone. Re-entering the
   * SAME rest re-reads its own claim and is allowed through, so a remount or a
   * pause/resume still shows the comment it already paid for.
   */
  const claimedLogIndex = new Map<number, string>();

  let cachedSessionId: string | null = null;
  let currentKey: string | null = null;
  let generation = 0;

  /** True when `key` owns the remark for `logIndex` — either already, or now. */
  function claimLogIndex(logIndex: number, key: string): boolean {
    const owner = claimedLogIndex.get(logIndex);
    if (owner === undefined) {
      claimedLogIndex.set(logIndex, key);
      return true;
    }
    return owner === key;
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
      // Check if any key is configured
      if (!hasAiKey(settings)) return null;

      // `target.exerciseId` is whichever exercise the remark is about — the
      // performed one for `lastSet`, the upcoming one for `upNext` — so the
      // history shown always belongs to the exercise being discussed.
      const history = await deps.loadHistory(target.exerciseId);
      const exercise = {
        title: target.exerciseTitle,
        kind: target.kind,
        restSeconds: target.restSeconds,
        sets: target.sets,
        isWarmupSet: target.isWarmupSet,
        setNumber: target.setNumber,
        totalOfType: target.totalOfType,
      };
      const prompt = buildRestCommentaryPrompt({
        ...(target.shape === 'lastSet'
          ? { shape: 'lastSet' as const, completedSet: target.completedSet }
          : { shape: 'upNext' as const }),
        exercise,
        history,
        personality: settings.aiPersonality,
        // The non-negotiable tier only, matching exerciseReplaceStore's
        // choice — rendered last by buildRestCommentaryPrompt so it outranks
        // the user-controlled coaching-style text above it.
        directives: IMMUTABLE_DIRECTIVES,
        profileAge: settings.profileAge,
        profileExperience: settings.profileExperience,
      });

      const providerConfig: ProviderConfig = {
        anthropicKey: settings.anthropicKey,
        openaiKey: settings.openaiKey,
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
      };
      const client = deps.createClient(providerConfig);
      const rawComment = await client.comment(prompt);
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
        claimedLogIndex.clear();
        cachedSessionId = target.sessionId;
      }

      const key = restCommentaryKey(target);
      // Same rest: the answer on screen is still the right one, and re-entering
      // must not re-request or disturb an in-flight response.
      if (key === currentKey) return;

      currentKey = key;
      const gen = ++generation;

      // The set this remark would be about already had its rest, so the visit
      // since then was a skip and `lastLoggedSet` no longer describes what the
      // athlete just did. Silence, and no reserved slot — the same shape the
      // no-key path takes, because rest never depends on the AI either way.
      if (target.shape === 'lastSet' && !claimLogIndex(target.logIndex, key)) {
        set({ text: null, pending: false, attempted: false });
        return;
      }

      const cached = cache.get(key);
      if (cached !== undefined) {
        set({ text: cached, pending: false, attempted: true });
        return;
      }

      // No key configured: silence, and no reserved space either.
      if (!hasAiKey(deps.getSettings())) {
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
  createClient: createAiClient,
});
