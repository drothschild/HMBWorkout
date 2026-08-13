import { hasAiKey } from './hasAiKey';

describe('hasAiKey', () => {
  it('is false when both keys are empty', () => {
    expect(hasAiKey({ anthropicKey: '', openaiKey: '' })).toBe(false);
  });

  it('is false when both keys are whitespace only', () => {
    expect(hasAiKey({ anthropicKey: '   ', openaiKey: '   ' })).toBe(false);
  });

  it('is true when an Anthropic key is configured', () => {
    expect(hasAiKey({ anthropicKey: 'sk-ant-test' })).toBe(true);
  });

  it('is true when an OpenAI key is configured', () => {
    expect(hasAiKey({ openaiKey: 'sk-openai-test' })).toBe(true);
  });
});
