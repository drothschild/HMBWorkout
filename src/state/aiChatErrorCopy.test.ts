import { aiChatErrorMessage } from '@/state/aiChatErrorCopy';
import type { AiChatError } from '@/state/aiChatStore';

describe('aiChatErrorMessage', () => {
  it('names the provider on unauthorized, differently for each', () => {
    const a = aiChatErrorMessage({ kind: 'unauthorized', provider: 'anthropic' });
    const o = aiChatErrorMessage({ kind: 'unauthorized', provider: 'openai' });
    expect(a).toContain('Anthropic');
    expect(o).toContain('OpenAI');
    expect(a).not.toBe(o);
  });

  it('tells an OpenAI user to add an OpenAI key', () => {
    expect(aiChatErrorMessage({ kind: 'missing_key', provider: 'openai' }))
      .toContain('OpenAI API key');
  });

  it('is provider-neutral when no provider is implicated', () => {
    const m = aiChatErrorMessage({ kind: 'missing_key', provider: null });
    expect(m).not.toContain('OpenAI');
    expect(m).not.toContain('Anthropic');
  });

  it('never returns anything that could be key material', () => {
    const errors: AiChatError[] = [];
    for (const provider of ['anthropic', 'openai', null] as const) {
      errors.push(
        { kind: 'missing_key', provider }, { kind: 'unauthorized', provider },
        { kind: 'network', provider },     { kind: 'parse', provider },
        { kind: 'unknown', provider },     { kind: 'http', status: 500, provider },
      );
    }
    for (const e of errors) {
      const msg = aiChatErrorMessage(e);
      expect(msg).not.toContain('sk-');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
