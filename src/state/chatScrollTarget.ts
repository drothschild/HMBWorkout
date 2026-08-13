// pattern: Functional Core
import type { AiChatError } from './aiChatStore';

/**
 * Decides where the AI Coach chat list should scroll after a render, so
 * `src/app/ai-coach.tsx` only needs to execute the result. Kept pure and out
 * of the screen because `src/app` carries zero jest coverage (see
 * jest.config.js testMatch) — the decision logic needs to live somewhere
 * jest can actually reach it.
 *
 * When an error surface appears (error bubble with Retry button), the
 * ListFooterComponent grows. scrollToEnd fires on the same commit, scrolling
 * to pre-growth height, leaving the Retry button below the fold (issue #222).
 * The fix is to defer the scroll to after layout settles, using
 * onContentSizeChange. Use shouldDeferScrollForError to detect when a deferred
 * scroll is needed.
 *
 * Unconditionally calling `scrollToEnd()` (the prior behavior) lands the
 * user mid-sentence at the *end* of a long coach reply — worst case is the
 * post-workout debrief summary. The fix is to anchor on the reply's *top*
 * instead of the list's bottom, via `scrollToIndex({ viewPosition: 0 })`.
 * That single call also covers the "a short reply should not jump"
 * requirement for free, but not because the two positions coincide — it's
 * scroll clamping. `scrollToIndex` targets the item's own top-of-viewport
 * offset (`contentHeight - itemHeight - footerHeight`); for a short reply
 * that offset is *greater than* the max scroll offset (`contentHeight -
 * viewportHeight`), so the underlying ScrollView clamps it down to the max
 * — which is exactly where the list was already sitting from the prior
 * `scrollToEnd`. A long reply's own offset stays *below* the max, so
 * nothing clamps it and the jump lands right where the ticket asks.
 *
 * `previousTarget` lets a caller make the decision idempotent: pass back
 * whatever target was last actually applied, and a render that recomputes
 * the identical target (e.g. a re-render triggered by something other than
 * new messages — declining a settings proposal, a failed accept) returns
 * `{ kind: 'none' }` instead of asking the caller to re-run the same scroll.
 * That matters because re-running `scrollToIndex`/`scrollToEnd` is not a
 * no-op the way re-running the old unconditional `scrollToEnd` was: it
 * unconditionally moves the list, even if the user has since scrolled
 * elsewhere on their own. See issue #215 review, finding C1.
 *
 * "Identical target" means the same *message*, not just the same `kind` —
 * `end` therefore carries an `index` too, even though the caller never
 * needs it (`scrollToEnd` takes none). Comparing by `kind` alone made two
 * genuinely different `end`s look identical: after a failed send the
 * status changes but no message is appended, so retrying re-fires this
 * decision over the *same* last message and must bail — but sending a
 * *second* message after that same failure also lands on `end` (the new
 * message is the user's own too) and must NOT bail, or the second message
 * silently fails to scroll into view. Only the message's own index tells
 * those two cases apart; see issue #215 review follow-up.
 */

export interface ChatScrollMessage {
  role: 'user' | 'assistant';
  hidden?: boolean;
}

export type ChatScrollTarget =
  // Nothing visible yet (e.g. only a hidden debrief/onboarding opener has
  // been sent) — nothing to scroll to.
  | { kind: 'none' }
  // The user's own message should always come fully into view. `index` is
  // the position of that message in the raw array — the caller (`kind ===
  // 'end'`) never needs it for the scroll itself, only so two `end`
  // decisions for two different messages don't compare equal; see the
  // module doc comment.
  | { kind: 'end'; index: number }
  // Anchor the coach's reply so its top sits at the top of the viewport.
  // `index` is the position in the raw (unfiltered) message array — FlatList
  // renders a slot for every entry, hidden ones included (as null), so the
  // index must match `data`, not a visible-only subset.
  | { kind: 'top'; index: number };

export function computeChatScrollTarget(
  messages: ChatScrollMessage[],
  previousTarget: ChatScrollTarget | null = null
): ChatScrollTarget {
  let lastVisibleIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].hidden) {
      lastVisibleIndex = i;
      break;
    }
  }

  if (lastVisibleIndex === -1) {
    return { kind: 'none' };
  }

  const target: ChatScrollTarget =
    messages[lastVisibleIndex].role === 'user'
      ? { kind: 'end', index: lastVisibleIndex }
      : { kind: 'top', index: lastVisibleIndex };

  if (targetsEqual(target, previousTarget)) {
    return { kind: 'none' };
  }

  return target;
}

function targetsEqual(a: ChatScrollTarget, b: ChatScrollTarget | null): boolean {
  if (b === null) {
    return false;
  }
  if (a.kind === 'end' && b.kind === 'end') {
    return a.index === b.index;
  }
  if (a.kind === 'top' && b.kind === 'top') {
    return a.index === b.index;
  }
  // 'none' is excluded by construction: `target` at the call site above is
  // only ever 'end'/'top' (computed after the lastVisibleIndex === -1 early
  // return), and callers only ever feed back a target they actually applied,
  // which is never 'none' either — so this line is unreachable, not a
  // meaningful "none equals none" case.
  return false;
}

/**
 * Detects when either error surface appears (store error or local acceptError),
 * triggering a deferred scroll to reveal the Retry button or error message.
 * Used by ai-coach.tsx to decide whether to execute a scroll on
 * onContentSizeChange rather than inline in the effect (issue #222).
 *
 * Works with any nullable error type (AiChatError | null or string | null).
 * Returns true when error transitions from null to non-null, or when the error
 * changes (indicating a new error replaces an old one, which needs the footer
 * re-laid-out and scrolled into view).
 *
 * Must be called for BOTH error surfaces independently: store error and
 * acceptError. A guard added to one surface only and tested only on that one
 * is the bug this function fixes — don't fall into that trap.
 */
/**
 * Is `index` still addressable in a list of `messageCount` items?
 *
 * `scrollToIndex` THROWS on an out-of-range index — it is not a no-op — and
 * the screen's retry path fires from a `setTimeout` 50ms after the target was
 * computed. A conversation reset in that window (`aiChatStore.reset`, which
 * `openDebrief` calls) empties the list while a target from the PREVIOUS
 * conversation is still held in the caller's ref, so the deferred scroll asks
 * for an index the new list does not have. That is issue #252: finishing a
 * workout opened the debrief and threw
 * `scrollToIndex out of range: requested index 1 is out of 0 to 0`.
 *
 * Lives here rather than in the screen because `src/app` has no jest coverage
 * and this is the whole decision.
 */
export function isScrollableIndex(index: number, messageCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < messageCount;
}

export function shouldDeferScrollForError<T>(
  currentError: T | null,
  previousError: T | null
): boolean {
  // No error now, no need to scroll
  if (currentError === null) {
    return false;
  }

  // Error was already present, check if it's the same one
  if (previousError !== null) {
    // Error changed (kind changed for AiChatError, or message changed for string)
    return currentError !== previousError;
  }

  // Error transitioned from null to present
  return true;
}
