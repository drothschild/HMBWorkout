// pattern: Functional Core
import { computeChatScrollTarget } from './chatScrollTarget';

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
    expect(target).toEqual({ kind: 'end' });
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
    expect(target).toEqual({ kind: 'end' });
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
      expect(previous).toEqual({ kind: 'end' });

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
      expect(target).toEqual({ kind: 'end' });
    });

    it('has no previous-target special case for none — an empty/all-hidden list is always none', () => {
      const target = computeChatScrollTarget([{ role: 'user', hidden: true }], { kind: 'end' });
      expect(target).toEqual({ kind: 'none' });
    });
  });
});
