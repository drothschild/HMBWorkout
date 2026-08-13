// pattern: Functional Core
import {
  isScrollableIndex, computeChatScrollTarget, shouldDeferScrollForError } from './chatScrollTarget';

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

describe('shouldDeferScrollForError', () => {
  describe('store error surface (AiChatError)', () => {
    it('returns false when no error is present', () => {
      const error: { kind: 'network' } | null = null;
      expect(shouldDeferScrollForError(error, null)).toBe(false);
    });

    it('returns false when error was already present (same kind)', () => {
      const error = { kind: 'network' as const };
      expect(shouldDeferScrollForError(error, error)).toBe(false);
    });

    it('returns true when error transitions from null to present', () => {
      const error = { kind: 'unauthorized' as const };
      expect(shouldDeferScrollForError(error, null)).toBe(true);
    });

    it('returns false when error transitions from present to null', () => {
      const error = { kind: 'network' as const };
      expect(shouldDeferScrollForError(null, error)).toBe(false);
    });

    it('returns true when error kind changes (new error replaces old one)', () => {
      const oldError: { kind: string } = { kind: 'network' };
      const newError: { kind: string } = { kind: 'unauthorized' };
      expect(shouldDeferScrollForError(newError, oldError)).toBe(true);
    });
  });

  describe('acceptError surface (string message)', () => {
    it('returns false when no acceptError is present', () => {
      expect(shouldDeferScrollForError<string | null>(null, null)).toBe(false);
    });

    it('returns false when acceptError was already present (same message)', () => {
      const message = 'Failed to save routine. Try again.';
      expect(shouldDeferScrollForError(message, message)).toBe(false);
    });

    it('returns true when acceptError transitions from null to present', () => {
      const message = 'Failed to save routine. Try again.';
      expect(shouldDeferScrollForError(message, null)).toBe(true);
    });

    it('returns false when acceptError transitions from present to null', () => {
      const message = 'Failed to save routine. Try again.';
      expect(shouldDeferScrollForError(null, message)).toBe(false);
    });

    it('returns true when acceptError message changes (new error replaces old)', () => {
      const oldMessage = 'Failed to save routine. Try again.';
      const newMessage = 'Could not apply those settings. Try again.';
      expect(shouldDeferScrollForError(newMessage, oldMessage)).toBe(true);
    });
  });
});

describe('isScrollableIndex (issue #252)', () => {
  it('accepts an index inside the list', () => {
    expect(isScrollableIndex(0, 1)).toBe(true);
    expect(isScrollableIndex(1, 2)).toBe(true);
  });

  // The exact shape that threw: a target of index 1 computed against the
  // previous conversation, fired 50ms later at a list the debrief reset to
  // a single (hidden) opener. RN reported "requested index 1 is out of 0 to 0".
  it('rejects the index that crashed the debrief', () => {
    expect(isScrollableIndex(1, 1)).toBe(false);
  });

  it('rejects any index against an emptied list', () => {
    expect(isScrollableIndex(0, 0)).toBe(false);
    expect(isScrollableIndex(3, 0)).toBe(false);
  });

  it('rejects negative and non-integer indices', () => {
    expect(isScrollableIndex(-1, 5)).toBe(false);
    expect(isScrollableIndex(1.5, 5)).toBe(false);
    expect(isScrollableIndex(NaN, 5)).toBe(false);
  });
});
