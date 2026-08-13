import {
  AI_PROVIDERS,
  PROVIDER_LABEL,
  keyPlaceholder,
  storedKeyFor,
  initialProviderSelection,
  providerSwitchPlan,
  apiKeyPatch,
  modelSelectionPatch,
  crossProviderKeyWarning,
} from './aiProviderSettings';
import {DEFAULT_MODELS} from '@/ai/provider/models';

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

    it('returns different values for the two providers', () => {
      // Catches mutations like: return provider === 'anthropic' ? 'sk-...' : 'sk-...'
      const anthropic = keyPlaceholder('anthropic');
      const openai = keyPlaceholder('openai');
      expect(anthropic).not.toBe(openai);
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

    it('distinguishes between the two providers for the same settings blob', () => {
      // Catches mutations like: return settings.anthropicKey || ''
      // or swapped keys: return settings.openaiKey when provider is 'anthropic'
      const settings = {anthropicKey: 'ant-KEY', openaiKey: 'oai-KEY'};
      expect(storedKeyFor(settings, 'anthropic')).toBe('ant-KEY');
      expect(storedKeyFor(settings, 'openai')).toBe('oai-KEY');
      expect(storedKeyFor(settings, 'anthropic')).not.toBe(storedKeyFor(settings, 'openai'));
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

    it('defaults to anthropic when both keys are set and no explicit provider', () => {
      expect(
        initialProviderSelection({
          ...base,
          anthropicKey: 'sk-ant-x',
          openaiKey: 'sk-oai-y',
        }),
      ).toBe('anthropic');
    });

    it('defaults specifically to anthropic, not openai, for the neither-or-both case', () => {
      // Catches: return 'openai' or return null (if arm-3 is broken)
      expect(initialProviderSelection(base)).toBe('anthropic');
      expect(initialProviderSelection(base)).not.toBe('openai');
    });
  });

  describe('providerSwitchPlan', () => {
    it('clears the outgoing key and the model when switching away from anthropic', () => {
      const {patch, outgoing} = providerSwitchPlan(
        {anthropicKey: 'sk-ant-x', openaiKey: '', aiProvider: 'anthropic'},
        'openai',
      );
      expect(outgoing).toBe('anthropic');
      expect(patch).toStrictEqual({
        aiProvider: 'openai',
        anthropicKey: '',
        aiModel: undefined,
      });
      expect('aiModel' in patch).toBe(true);
    });

    it('clears the openai key when switching away from openai', () => {
      const {patch, outgoing} = providerSwitchPlan(
        {anthropicKey: '', openaiKey: 'sk-123', aiProvider: 'openai'},
        'anthropic',
      );
      // Counter-intuitive but pinned: `outgoing` is a total function of `next`
      // alone, so re-selecting anthropic still reports openai as the provider a
      // switch would clear. Nothing is switched away from on this path.
      expect(outgoing).toBe('openai');
      expect(patch).toStrictEqual({
        aiProvider: 'anthropic',
        openaiKey: '',
        aiModel: undefined,
      });
      expect('aiModel' in patch).toBe(true);
    });

    it.each([
      ['a real key', 'sk-ant-x', true],
      ['an empty key', '', false],
      ['a whitespace key', '   ', false],
    ])('needsConfirmation is %s -> %s', (_label, outgoingKey, expected) => {
      const {needsConfirmation, outgoing} = providerSwitchPlan(
        {anthropicKey: outgoingKey, openaiKey: '', aiProvider: 'anthropic'},
        'openai',
      );
      expect(outgoing).toBe('anthropic');
      expect(needsConfirmation).toBe(expected);
    });

    it('re-selecting the active provider clears nothing', () => {
      const {patch, outgoing, needsConfirmation} = providerSwitchPlan(
        {anthropicKey: 'sk-ant-x', openaiKey: '', aiProvider: 'anthropic'},
        'anthropic',
      );
      expect(outgoing).toBe('openai');
      expect(needsConfirmation).toBe(false);
      expect(patch).toStrictEqual({aiProvider: 'anthropic'});
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
      // Both directions. `toEqual` above cannot see an extra field whose value
      // is `undefined`, so without this the anthropic path accepts a patch
      // carrying `openaiKey: undefined` — which `setSettings` spreads into the
      // cache and `JSON.stringify` then drops, destroying the stored key.
      expect(Object.keys(apiKeyPatch('openai', 'sk-x'))).toEqual(['openaiKey']);
      expect(Object.keys(apiKeyPatch('anthropic', 'sk-x'))).toEqual([
        'anthropicKey',
      ]);
    });
  });

  describe('modelSelectionPatch', () => {
    // Three ids per provider, deliberately. With only two, the written id and the
    // surviving id collide in the asserted output and a whole-object write
    // ({chat: id, oneShot: id}) is indistinguishable from a per-field one.
    const testChoices = {
      anthropic: ['m-a', 'm-b', 'm-c'],
      openai: ['o-a', 'o-b'],
    };

    it('changes only the named field', () => {
      expect(
        modelSelectionPatch(
          {aiModel: {chat: 'm-a', oneShot: 'm-b'}},
          'anthropic',
          'chat',
          'm-c',
          testChoices,
        ),
      ).toStrictEqual({aiModel: {chat: 'm-c', oneShot: 'm-b'}});
    });

    // The other half of `keyof AiModelConfig`. Without this, `field` is only ever
    // 'chat' and an implementation that ignores `field` entirely survives.
    it('changes oneShot when that is the named field, leaving chat alone', () => {
      expect(
        modelSelectionPatch(
          {aiModel: {chat: 'm-a', oneShot: 'm-b'}},
          'anthropic',
          'oneShot',
          'm-c',
          testChoices,
        ),
      ).toStrictEqual({aiModel: {chat: 'm-a', oneShot: 'm-c'}});
    });

    it('normalises an unlisted stored id before writing', () => {
      const patch = modelSelectionPatch(
        {aiModel: {chat: 'retired', oneShot: 'retired'}},
        'anthropic',
        'chat',
        'm-a',
        testChoices,
      );
      expect(patch.aiModel).toStrictEqual({
        chat: 'm-a',
        oneShot: DEFAULT_MODELS.anthropic.oneShot,
      });
    });

    it('handles undefined aiModel by using provider defaults', () => {
      const patch = modelSelectionPatch({aiModel: undefined}, 'openai', 'chat', 'o-b', testChoices);
      expect(patch.aiModel).toStrictEqual({
        chat: 'o-b',
        oneShot: DEFAULT_MODELS.openai.oneShot,
      });
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
