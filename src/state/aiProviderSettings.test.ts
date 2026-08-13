import {
  AI_PROVIDERS,
  PROVIDER_LABEL,
  keyPlaceholder,
  storedKeyFor,
  initialProviderSelection,
  providerSwitchPlan,
  apiKeyPatch,
  crossProviderKeyWarning,
} from './aiProviderSettings';

describe('aiProviderSettings', () => {
  describe('AI_PROVIDERS', () => {
    it('is a readonly array with both providers in display order', () => {
      expect(AI_PROVIDERS).toEqual(['anthropic', 'openai']);
    });
  });

  describe('PROVIDER_LABEL', () => {
    it('maps anthropic to "Anthropic"', () => {
      expect(PROVIDER_LABEL.anthropic).toBe('Anthropic');
    });

    it('maps openai to "OpenAI"', () => {
      expect(PROVIDER_LABEL.openai).toBe('OpenAI');
    });
  });

  describe('keyPlaceholder', () => {
    it('returns sk-ant-... for anthropic', () => {
      expect(keyPlaceholder('anthropic')).toBe('sk-ant-...');
    });

    it('returns sk-... for openai', () => {
      expect(keyPlaceholder('openai')).toBe('sk-...');
    });
  });

  describe('storedKeyFor', () => {
    it('returns anthropic key when provider is anthropic', () => {
      expect(
        storedKeyFor({anthropicKey: 'sk-ant-abc', openaiKey: 'sk-123'}, 'anthropic'),
      ).toBe('sk-ant-abc');
    });

    it('returns openai key when provider is openai', () => {
      expect(
        storedKeyFor({anthropicKey: 'sk-ant-abc', openaiKey: 'sk-123'}, 'openai'),
      ).toBe('sk-123');
    });

    it('returns empty string when anthropic key is undefined', () => {
      expect(storedKeyFor({anthropicKey: ''}, 'anthropic')).toBe('');
    });

    it('returns empty string when openai key is undefined', () => {
      expect(storedKeyFor({anthropicKey: ''}, 'openai')).toBe('');
    });
  });

  describe('initialProviderSelection', () => {
    const base = {anthropicKey: '', openaiKey: undefined, aiProvider: undefined};

    it('returns the explicit provider even when the OTHER key is the one present', () => {
      expect(
        initialProviderSelection({
          ...base,
          aiProvider: 'openai',
          anthropicKey: 'sk-ant-x',
          openaiKey: '',
        }),
      ).toBe('openai');
    });

    it('derives anthropic from an anthropic-only blob', () => {
      expect(
        initialProviderSelection({
          ...base,
          anthropicKey: 'sk-ant-x',
          openaiKey: '',
        }),
      ).toBe('anthropic');
    });

    it('derives openai from an openai-only blob', () => {
      expect(
        initialProviderSelection({
          ...base,
          anthropicKey: '',
          openaiKey: 'sk-123',
        }),
      ).toBe('openai');
    });

    it('defaults to anthropic when nothing is configured', () => {
      expect(initialProviderSelection(base)).toBe('anthropic');
    });

    it('treats a whitespace-only key as no key', () => {
      expect(
        initialProviderSelection({
          ...base,
          anthropicKey: '   ',
          openaiKey: 'sk-o',
        }),
      ).toBe('openai');
    });
  });

  describe('providerSwitchPlan', () => {
    it('clears the outgoing key and the model when switching away from anthropic', () => {
      const {patch} = providerSwitchPlan(
        {anthropicKey: 'sk-ant-x', openaiKey: '', aiProvider: 'anthropic'},
        'openai',
      );
      expect(patch).toEqual({
        aiProvider: 'openai',
        anthropicKey: '',
        aiModel: undefined,
      });
    });

    it('clears the openai key when switching away from openai', () => {
      const {patch} = providerSwitchPlan(
        {anthropicKey: '', openaiKey: 'sk-123', aiProvider: 'openai'},
        'anthropic',
      );
      expect(patch).toEqual({
        aiProvider: 'anthropic',
        openaiKey: '',
        aiModel: undefined,
      });
    });

    it.each([
      ['a real key', 'sk-ant-x', true],
      ['an empty key', '', false],
      ['a whitespace key', '   ', false],
    ])('needsConfirmation is %s -> %s', (_label, outgoingKey, expected) => {
      const {needsConfirmation} = providerSwitchPlan(
        {anthropicKey: outgoingKey, openaiKey: '', aiProvider: 'anthropic'},
        'openai',
      );
      expect(needsConfirmation).toBe(expected);
    });

    it('re-selecting the active provider clears nothing', () => {
      const {patch, needsConfirmation} = providerSwitchPlan(
        {anthropicKey: 'sk-ant-x', openaiKey: '', aiProvider: 'anthropic'},
        'anthropic',
      );
      expect(needsConfirmation).toBe(false);
      expect(patch).toEqual({aiProvider: 'anthropic'});
      expect(patch.anthropicKey).toBeUndefined();
    });
  });

  describe('apiKeyPatch', () => {
    it('trims the stored anthropic key', () => {
      expect(apiKeyPatch('anthropic', '  sk-ant-x\n')).toEqual({
        anthropicKey: 'sk-ant-x',
      });
    });

    it('trims the stored openai key', () => {
      expect(apiKeyPatch('openai', '\tsk-proj-x  ')).toEqual({
        openaiKey: 'sk-proj-x',
      });
    });

    it('writes only the selected provider field', () => {
      expect(Object.keys(apiKeyPatch('openai', 'sk-x'))).toEqual(['openaiKey']);
    });
  });

  describe('crossProviderKeyWarning', () => {
    it('warns on an Anthropic key under an OpenAI selection', () => {
      expect(crossProviderKeyWarning('openai', 'sk-ant-CANARY123')).not.toBeNull();
    });

    it.each([
      ['openai', 'sk-CANARY123'],
      ['openai', 'sk-proj-CANARY123'],
      ['anthropic', 'sk-proj-CANARY123'],
      ['anthropic', 'sk-ant-CANARY123'],
      ['openai', ''],
      ['anthropic', ''],
    ] as const)('does not warn for %s / %s', (provider, key) => {
      expect(crossProviderKeyWarning(provider, key)).toBeNull();
    });

    it('computes the warning on the trimmed value', () => {
      expect(crossProviderKeyWarning('openai', '  sk-ant-CANARY123  ')).not.toBeNull();
    });

    it('never echoes the key', () => {
      const w = crossProviderKeyWarning('openai', 'sk-ant-CANARY123');
      expect(w).not.toBeNull();
      expect(w).not.toContain('CANARY');
    });
  });
});
