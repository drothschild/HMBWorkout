import { shouldShowFirstRunKeyPrompt } from '@/state/firstRunKeyPrompt';
import type { BridgeSettings } from '@/state/settings';

const base = { onboardingState: 'unseen' } as BridgeSettings;

describe('shouldShowFirstRunKeyPrompt', () => {
  it('prompts when no provider key is configured', () => {
    expect(shouldShowFirstRunKeyPrompt({ ...base, anthropicKey: '', openaiKey: '' })).toBe(true);
  });

  // The decision keys on the SAME predicate every AI surface gates on. If it
  // drifted, the prompt could appear for a user whose key already works, or
  // stay hidden from one whose does not.
  it('does not prompt once an Anthropic key exists', () => {
    expect(shouldShowFirstRunKeyPrompt({ ...base, anthropicKey: 'sk-ant-x', openaiKey: '' })).toBe(
      false
    );
  });

  it('does not prompt once an OpenAI key exists', () => {
    expect(shouldShowFirstRunKeyPrompt({ ...base, anthropicKey: '', openaiKey: 'sk-o' })).toBe(
      false
    );
  });

  // Whitespace is not a key. hasAiKey trims, and this must inherit that or a
  // stray space would permanently suppress the prompt.
  it('still prompts when the stored key is whitespace only', () => {
    expect(shouldShowFirstRunKeyPrompt({ ...base, anthropicKey: '   ', openaiKey: '' })).toBe(true);
  });

  // "Ask again next launch" is the product decision (#168): skipping writes
  // NOTHING, so a user who skips is asked again next launch. That means the
  // predicate must NOT consult onboardingState — a user who dismissed the coach
  // interview but has no key still needs the key prompt.
  it('ignores onboardingState entirely', () => {
    for (const onboardingState of ['unseen', 'dismissed', 'completed'] as const) {
      expect(
        shouldShowFirstRunKeyPrompt({ ...base, onboardingState, anthropicKey: '', openaiKey: '' })
      ).toBe(true);
      expect(
        shouldShowFirstRunKeyPrompt({
          ...base,
          onboardingState,
          anthropicKey: 'sk-ant-x',
          openaiKey: '',
        })
      ).toBe(false);
    }
  });
});
