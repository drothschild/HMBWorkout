import { aiChatErrorMessage, aiChatErrorAllowsRetry } from '@/state/aiChatErrorCopy';
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

describe('aiChatErrorAllowsRetry (issue #248)', () => {
  // missing_key is the ONE kind Retry cannot help — there is nothing to retry
  // until a key exists, which is why that bubble offers the Settings link.
  it('withholds Retry only for missing_key', () => {
    expect(aiChatErrorAllowsRetry({ kind: 'missing_key', provider: null })).toBe(false);
  });

  it.each(['unauthorized', 'network', 'parse', 'unknown'] as const)(
    'offers Retry for %s',
    (kind) => {
      expect(aiChatErrorAllowsRetry({ kind, provider: null } as AiChatError)).toBe(true);
    }
  );

  it('offers Retry for http, which carries a status', () => {
    expect(aiChatErrorAllowsRetry({ kind: 'http', status: 500, provider: null })).toBe(true);
  });

  // Pins the behaviour the screen used to express as `kind !== 'missing_key'`,
  // so moving it here cannot silently change which bubbles get a Retry button.
  it('matches the negation it replaced, across every kind', () => {
    const kinds = ['missing_key', 'unauthorized', 'network', 'http', 'parse', 'unknown'] as const;
    for (const kind of kinds) {
      const error = (
        kind === 'http' ? { kind, status: 500, provider: null } : { kind, provider: null }
      ) as AiChatError;
      expect(aiChatErrorAllowsRetry(error)).toBe(kind !== 'missing_key');
    }
  });
});
