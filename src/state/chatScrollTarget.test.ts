// pattern: Functional Core
import { computeChatScrollTarget, didErrorSurfaceAppear } from './chatScrollTarget';

describe('computeChatScrollTarget', () => {
  it('returns none for an empty message list', () => {
    expect(computeChatScrollTarget([])).toEqual({ kind: 'none' });
  });

  it('returns none when every message is hidden', () => {
    // The debrief/onboarding opening turn is sent hidden before any reply
    // arrives — nothing visible exists yet, so there is nothing to scroll to.
    const target = computeChatScrollTarget([{ role: 'user', hidden: true }]);
    expect(target).toEqual({ kind: 'none' });
  });

  it('returns end when the last visible message is the user\'s own', () => {
    const target = computeChatScrollTarget([
      { role: 'assistant' }, // "Hi, how can I help?"
      { role: 'user' }, // "Build me a leg day routine"
    ]);
    expect(target).toEqual({ kind: 'end', index: 1 });
  });

  it('returns a top anchor at the message\'s own index when the last visible message is the assistant\'s', () => {
    const target = computeChatScrollTarget([
      { role: 'user' }, // "Build me a leg day routine"
      { role: 'assistant' }, // "Here is a plan..."
    ]);
    expect(target).toEqual({ kind: 'top', index: 1 });
  });

  it('indexes against the raw array, including hidden entries, so it lines up with FlatList data', () => {
    // The debrief opening turn is a hidden user message at index 0; the
    // coach's first visible reply lands at index 1. FlatList still renders a
    // (null) slot for the hidden entry, so the index must not be recomputed
    // over a filtered/visible-only list.
    const target = computeChatScrollTarget([
      { role: 'user', hidden: true }, // debrief opener
      { role: 'assistant' }, // "Great session! Here is a long recap..."
    ]);
    expect(target).toEqual({ kind: 'top', index: 1 });
  });

  it('ignores trailing hidden messages and anchors on the last visible one', () => {
    const target = computeChatScrollTarget([
      { role: 'user' }, // "Build me a leg day routine"
      { role: 'assistant' }, // "Here is a plan..."
      { role: 'user', hidden: true }, // hidden follow-up
    ]);
    expect(target).toEqual({ kind: 'top', index: 1 });
  });

  it('returns end for a single, freshly-sent user message with no reply yet', () => {
    const target = computeChatScrollTarget([{ role: 'user' }]); // "Hello"
    expect(target).toEqual({ kind: 'end', index: 0 });
  });

  describe('with a previously-applied target (issue #215 review, C1)', () => {
    // A re-render can fire this effect without `messages` changing at all —
    // e.g. declining/approving a settings proposal, or a failed accept —
    // which recomputes the exact same target from the exact same messages.
    // Re-applying it is not a no-op in the real FlatList: scrollToIndex runs
    // again and yanks the user away from whatever they were doing. The
    // decision to skip must live here, not as a comparison in the screen.

    it('returns none when the recomputed top target matches the previously-applied one', () => {
      const messages = [
        { role: 'user' as const }, // "Build me a leg day routine"
        { role: 'assistant' as const }, // "Here is a plan..."
      ];
      const previous = computeChatScrollTarget(messages);
      expect(previous).toEqual({ kind: 'top', index: 1 });

      const target = computeChatScrollTarget(messages, previous);
      expect(target).toEqual({ kind: 'none' });
    });

    it('returns none when the recomputed end target matches the previously-applied one', () => {
      const messages = [{ role: 'user' as const }]; // "Hello"
      const previous = computeChatScrollTarget(messages);
      expect(previous).toEqual({ kind: 'end', index: 0 });

      const target = computeChatScrollTarget(messages, previous);
      expect(target).toEqual({ kind: 'none' });
    });

    it('still returns the top target when the index differs from the previous one', () => {
      // A later assistant reply anchors at a new, later index — must not be
      // swallowed just because the previous target was also `top`.
      const previous = { kind: 'top' as const, index: 1 };
      const target = computeChatScrollTarget(
        [
          { role: 'user' as const },
          { role: 'assistant' as const },
          { role: 'user' as const },
          { role: 'assistant' as const },
        ],
        previous
      );
      expect(target).toEqual({ kind: 'top', index: 3 });
    });

    it('still returns end when the previous target was a top anchor', () => {
      // The user sending a fresh message after an assistant reply must
      // still scroll to the end, even though a `top` target was applied last.
      const previous = { kind: 'top' as const, index: 1 };
      const target = computeChatScrollTarget(
        [{ role: 'user' as const }, { role: 'assistant' as const }, { role: 'user' as const }],
        previous
      );
      expect(target).toEqual({ kind: 'end', index: 2 });
    });

    it('has no previous-target special case for none — an empty/all-hidden list is always none', () => {
      const target = computeChatScrollTarget([{ role: 'user', hidden: true }], { kind: 'end', index: 0 });
      expect(target).toEqual({ kind: 'none' });
    });

    it('still scrolls to end for a second user message sent after a failed request (regression guard)', () => {
      // aiChatStore.ts's catch block (startTurn/runTurn) sets status: 'error'
      // and appends NO assistant message, and the send gate only checks
      // `status === 'sending'` — so after a failure the user can immediately
      // send a second message. The list grows by one, but the last visible
      // message is still the user's own, so the target kind ('end') is
      // identical to what was already applied for the first message. A
      // same-kind comparison alone can't tell these apart from the
      // retry()-bail case below — it must also notice *which* message is
      // being anchored on, which is why `end` carries an `index` too.
      const firstMessages = [{ role: 'user' as const }]; // "Build me a leg day routine"
      const firstTarget = computeChatScrollTarget(firstMessages);
      expect(firstTarget).toEqual({ kind: 'end', index: 0 });

      const secondMessages = [...firstMessages, { role: 'user' as const }]; // failure, then "ok, try squats instead"
      const secondTarget = computeChatScrollTarget(secondMessages, firstTarget);
      expect(secondTarget).toEqual({ kind: 'end', index: 1 });
    });

    it('bails on the exact retry() re-fire: same message array, target recomputed, no scroll', () => {
      // aiChatStore.ts's retry() calls startTurn(state.messages, ...) — the
      // *same* array reference, appending nothing — while `status` goes
      // error -> sending. The effect refires on the `status` dependency
      // alone. Unlike the case above, nothing about the messages changed,
      // so this must stay a bail: the list is already at the end from when
      // the (still-unanswered) message was first sent.
      const messages = [{ role: 'user' as const }]; // the message that failed and is being retried
      const appliedTarget = computeChatScrollTarget(messages);
      expect(appliedTarget).toEqual({ kind: 'end', index: 0 });

      const retryTarget = computeChatScrollTarget(messages, appliedTarget);
      expect(retryTarget).toEqual({ kind: 'none' });
    });

    it('does not treat a top and an end target at the same index as equal (issue #215 review round 2, D10)', () => {
      // Both variants carry an index, so a comparator that only looked at
      // the index (ignoring kind) would wrongly treat these as the same
      // target. Not reachable today (the ref that holds `previousTarget`
      // only ever survives within one conversation, where an index doesn't
      // change identity — see the review's M2), but nothing pinned it.
      const target = computeChatScrollTarget([{ role: 'user' }, { role: 'user' }], { kind: 'top', index: 1 });
      expect(target).toEqual({ kind: 'end', index: 1 });
    });
  });
});

describe('didErrorSurfaceAppear (issue #215 review round 2, F1)', () => {
  // An error surface (the ErrorBubble+Retry for a failed send, or the local
  // acceptError bubble) lives in ListFooterComponent, below every message.
  // Its appearing GROWS the footer — the opposite of decline/approve, which
  // shrink it — so it needs its own additive scroll-to-end rule rather than
  // widening computeChatScrollTarget's comparison (which would risk
  // reintroducing C1 for the shrinking cases). Presence, not content, is
  // what's compared: both `error` and `acceptError` are always cleared to
  // null before they can be set again (aiChatStore.ts's startTurn; the
  // screen's own setAcceptError(null) at the top of handleSend/handleAccept/
  // handleApproveSettings/handleDeclineSettings), so an absent -> present
  // transition is always a genuinely new surface, never a content swap.

  it('returns true when the error surface transitions from absent to present', () => {
    const appeared = didErrorSurfaceAppear(
      { hasError: false, hasAcceptError: false },
      { hasError: true, hasAcceptError: false }
    );
    expect(appeared).toBe(true);
  });

  it('returns true when the acceptError surface transitions from absent to present', () => {
    const appeared = didErrorSurfaceAppear(
      { hasError: false, hasAcceptError: false },
      { hasError: false, hasAcceptError: true }
    );
    expect(appeared).toBe(true);
  });

  it('returns false when an error surface disappears (decline/retry-starts style shrink)', () => {
    const appeared = didErrorSurfaceAppear(
      { hasError: true, hasAcceptError: false },
      { hasError: false, hasAcceptError: false }
    );
    expect(appeared).toBe(false);
  });

  it('returns false when a present error surface is unchanged across a re-render', () => {
    // e.g. pendingDraft changing while a send error is still showing —
    // nothing new to reveal, must not re-scroll.
    const appeared = didErrorSurfaceAppear(
      { hasError: true, hasAcceptError: false },
      { hasError: true, hasAcceptError: false }
    );
    expect(appeared).toBe(false);
  });

  it('returns false when a present acceptError surface is unchanged across a re-render (issue #215 review round 3, M1)', () => {
    // Mirrors the `error` case immediately above, for the `acceptError`
    // arm specifically. Reachable: handleApproveSettings has no
    // `status === 'sending'` guard (unlike handleAccept), so approving an
    // invalid proposal while a reply is in flight leaves `acceptError` set
    // when that reply lands — the effect re-runs with acceptError
    // unchanged (still present), and must top-anchor on the new reply
    // rather than re-scrolling to the end.
    const appeared = didErrorSurfaceAppear(
      { hasError: false, hasAcceptError: true },
      { hasError: false, hasAcceptError: true }
    );
    expect(appeared).toBe(false);
  });

  it('returns false when neither surface is present in either render', () => {
    const appeared = didErrorSurfaceAppear(
      { hasError: false, hasAcceptError: false },
      { hasError: false, hasAcceptError: false }
    );
    expect(appeared).toBe(false);
  });

  it('returns true for a second failure after retry() cleared the first error (regression guard)', () => {
    // Mirrors the messages-level D2 guard, one layer up: retry() clears
    // `error` to null before re-sending, so a second failure is a genuine
    // absent -> present transition and must scroll again, exactly like the
    // first failure did.
    const firstFailureAppeared = didErrorSurfaceAppear(
      { hasError: false, hasAcceptError: false },
      { hasError: true, hasAcceptError: false }
    );
    expect(firstFailureAppeared).toBe(true);

    const retryStartedAppeared = didErrorSurfaceAppear(
      { hasError: true, hasAcceptError: false },
      { hasError: false, hasAcceptError: false }
    );
    expect(retryStartedAppeared).toBe(false);

    const secondFailureAppeared = didErrorSurfaceAppear(
      { hasError: false, hasAcceptError: false },
      { hasError: true, hasAcceptError: false }
    );
    expect(secondFailureAppeared).toBe(true);
  });

  it('returns true when acceptError appears while error is already present (independent surfaces, OR semantics)', () => {
    const appeared = didErrorSurfaceAppear(
      { hasError: true, hasAcceptError: false },
      { hasError: true, hasAcceptError: true }
    );
    expect(appeared).toBe(true);
  });
});
