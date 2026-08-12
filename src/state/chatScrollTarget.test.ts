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
});
