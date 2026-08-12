// pattern: Functional Core
/**
 * Decides where the AI Coach chat list should scroll after a render, so
 * `src/app/ai-coach.tsx` only needs to execute the result. Kept pure and out
 * of the screen because `src/app` carries zero jest coverage (see
 * jest.config.js testMatch) — the decision logic needs to live somewhere
 * jest can actually reach it.
 *
 * Unconditionally calling `scrollToEnd()` (the prior behavior) lands the
 * user mid-sentence at the *end* of a long coach reply — worst case is the
 * post-workout debrief summary. The fix is to anchor on the reply's *top*
 * instead of the list's bottom. That single change also covers the "a short
 * reply should not jump" requirement for free: before a reply arrives the
 * list is already scrolled to the end (showing the user's own message /the
 * typing indicator), so a short reply's top lands almost exactly where the
 * view already was — there is nothing further to reveal, hence no jarring
 * scroll. A long reply's top, by contrast, is far above where `scrollToEnd`
 * would have landed, which is exactly the jump this fixes.
 */

export interface ChatScrollMessage {
  role: 'user' | 'assistant';
  hidden?: boolean;
}

export type ChatScrollTarget =
  // Nothing visible yet (e.g. only a hidden debrief/onboarding opener has
  // been sent) — nothing to scroll to.
  | { kind: 'none' }
  // The user's own message should always come fully into view.
  | { kind: 'end' }
  // Anchor the coach's reply so its top sits at the top of the viewport.
  // `index` is the position in the raw (unfiltered) message array — FlatList
  // renders a slot for every entry, hidden ones included (as null), so the
  // index must match `data`, not a visible-only subset.
  | { kind: 'top'; index: number };

export function computeChatScrollTarget(messages: ChatScrollMessage[]): ChatScrollTarget {
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

  if (messages[lastVisibleIndex].role === 'user') {
    return { kind: 'end' };
  }

  return { kind: 'top', index: lastVisibleIndex };
}
