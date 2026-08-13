import { createAiClient } from './factory';
import { createOpenaiClient } from '../openaiClient';
import type { ProviderConfig } from './types';

describe('createAiClient factory', () => {
  it('creates a client when anthropicKey is set and openaiKey is not', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
    expect(typeof client.chat).toBe('function');
  });

  it('creates a client when openaiKey is set and anthropicKey is not', () => {
    const config: ProviderConfig = {
      openaiKey: 'test-openai-key',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
    expect(typeof client.chat).toBe('function');
  });

  it('requires explicit aiProvider when both keys are set', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
      openaiKey: 'test-openai-key',
    };

    expect(() => createAiClient(config)).toThrow();
  });

  it('uses aiProvider setting to override implicit detection', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
      openaiKey: 'test-openai-key',
      aiProvider: 'openai',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
    expect(typeof client.chat).toBe('function');
  });

  it('sends messages with the correct provider key when openai is selected', async () => {
    const captured: { header?: string } = {};
    const mockFetch = jest.fn(async (_url: string, init: { headers?: Record<string, string> }) => {
      captured.header = init.headers?.authorization;
      throw new Error('stop here');
    });

    const client = createOpenaiClient({ apiKey: 'test-openai-key-123' }, mockFetch as never);
    await client.chat({ system: 'test', messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});

    expect(captured.header).toBe('Bearer test-openai-key-123');
    expect.assertions(1);
  });

  // The test above lives in factory.test.ts but calls createOpenaiClient
  // DIRECTLY — it never goes through createAiClient, so it proves nothing about
  // the factory's own key forwarding. That is why the review's F07/F08 mutants
  // (hand each client a 'WRONG-KEY' instead of the configured one) survived: the
  // coverage looked present because of where the test lived, not what it called.
  // Right file, wrong unit. These two go through the factory.
  describe('forwards trimmed keys to all client factories', () => {
    afterEach(() => jest.resetModules());

    it('trims openaiKey before passing to OpenAI chat client', async () => {
      jest.resetModules();
      const chatClientSpy = jest.fn(() => ({ chat: async () => ({ reply: 'ok' }) }));
      const commentClientSpy = jest.fn(() => ({ comment: async () => 'ok' }));
      const suggestClientSpy = jest.fn(() => ({ suggest: async () => ({ alternates: [] }) }));
      const askClientSpy = jest.fn(() => ({ ask: async () => 'ok' }));

      jest.doMock('../openaiClient', () => ({
        createOpenaiClient: chatClientSpy,
        createRestCommentaryClient: commentClientSpy,
      }));
      jest.doMock('../openaiAlternatesClient', () => ({
        createOpenaiAlternatesClient: suggestClientSpy,
      }));
      jest.doMock('../openaiExerciseQuestionClient', () => ({
        createOpenaiExerciseQuestionClient: askClientSpy,
      }));

      const { createAiClient: freshFactory } = await import('./factory');
      freshFactory({ openaiKey: '  sk-padded  ', aiProvider: 'openai' });

      // CRITICAL: verify trimmed key reaches ALL surfaces
      expect(chatClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-padded' });
      expect(commentClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-padded' });
      expect(suggestClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-padded' });
      expect(askClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-padded' });
    });

    it('trims anthropicKey before passing to Anthropic clients', async () => {
      jest.resetModules();
      const chatClientSpy = jest.fn(() => ({ chat: async () => ({ reply: 'ok' }) }));
      const commentClientSpy = jest.fn(() => ({ comment: async () => 'ok' }));
      const suggestClientSpy = jest.fn(() => ({ suggest: async () => ({ alternates: [] }) }));
      const askClientSpy = jest.fn(() => ({ ask: async () => 'ok' }));

      jest.doMock('../anthropicClient', () => ({
        createAnthropicClient: chatClientSpy,
        createRestCommentaryClient: commentClientSpy,
      }));
      jest.doMock('../alternatesClient', () => ({
        createExerciseAlternatesClient: suggestClientSpy,
      }));
      jest.doMock('../exerciseQuestionClient', () => ({
        createExerciseQuestionClient: askClientSpy,
      }));

      const { createAiClient: freshFactory } = await import('./factory');
      freshFactory({ anthropicKey: '  sk-ant-padded  ', aiProvider: 'anthropic' });

      // CRITICAL: verify trimmed key reaches ALL surfaces
      expect(chatClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-padded' });
      expect(commentClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-padded' });
      expect(suggestClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-padded' });
      expect(askClientSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-padded' });
    });
  });

  it('throws when explicit aiProvider requires missing key', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
      aiProvider: 'openai',
      // Missing openaiKey but requesting openai provider
    };

    expect(() => createAiClient(config)).toThrow(/openaiKey.*not configured/i);
  });

  it('throws when both keys are missing', () => {
    const config: ProviderConfig = {
      // Neither key set
    };

    expect(() => createAiClient(config)).toThrow();
  });

  it('throws when no provider is configured', () => {
    const config: ProviderConfig = {};

    expect(() => createAiClient(config)).toThrow();
  });

  describe('rejects whitespace-only keys (F03/F04/F05 guards)', () => {
    // F03: Explicit anthropic provider with whitespace-only anthropicKey
    // The guard at line 72 must trim() before checking emptiness
    it('throws when anthropicKey is whitespace-only with explicit provider (F03)', () => {
      const config: ProviderConfig = {
        anthropicKey: '   ',
        aiProvider: 'anthropic',
      };

      expect(() => createAiClient(config)).toThrow(/anthropicKey.*not configured/i);
    });

    // F04: Explicit openai provider with whitespace-only openaiKey
    // The guard at line 112 must trim() before checking emptiness
    it('throws when openaiKey is whitespace-only with explicit provider (F04)', () => {
      const config: ProviderConfig = {
        openaiKey: '   ',
        aiProvider: 'openai',
      };

      expect(() => createAiClient(config)).toThrow(/openaiKey.*not configured/i);
    });

    // F05: Implicit detection path (lines 30-31) must trim before checking length
    // When anthropicKey is whitespace-only and it's the only key, resolveProvider
    // should reject it (not return 'anthropic')
    it('throws when only anthropicKey is set and it is whitespace-only (F05a)', () => {
      const config: ProviderConfig = {
        anthropicKey: '   ',
      };

      expect(() => createAiClient(config)).toThrow(/No AI provider configured/i);
    });

    // F05: Implicit detection for openaiKey
    it('throws when only openaiKey is set and it is whitespace-only (F05b)', () => {
      const config: ProviderConfig = {
        openaiKey: '   ',
      };

      expect(() => createAiClient(config)).toThrow(/No AI provider configured/i);
    });

    // Verify tabs and mixed whitespace are also rejected
    it('throws when anthropicKey is tabs/mixed whitespace (F03 variant)', () => {
      const config: ProviderConfig = {
        anthropicKey: '\t\n  \r',
        aiProvider: 'anthropic',
      };

      expect(() => createAiClient(config)).toThrow(/anthropicKey.*not configured/i);
    });

    it('throws when openaiKey is tabs/mixed whitespace (F04 variant)', () => {
      const config: ProviderConfig = {
        openaiKey: '\t\n  \r',
        aiProvider: 'openai',
      };

      expect(() => createAiClient(config)).toThrow(/openaiKey.*not configured/i);
    });
  });

  it('accepts aiModel but does NOT yet apply it — pinning a known Phase 3 gap', async () => {
    // This test pins a limitation, not a feature. `aiModel` is a real settings
    // field, but neither client factory takes a model argument yet, so a
    // user-chosen model is silently ignored. Two earlier tests here were named
    // "uses provided model config" and "uses default models when none provided"
    // and asserted only `expect(client).toBeDefined()` — they would have passed
    // no matter what the factory did with the config, which is how the gap
    // stayed invisible.
    //
    // Asserting the wrong-but-actual behaviour makes Phase 3 change it
    // deliberately: whoever wires model selection has to delete this test and
    // say so, rather than finding green tests that already claim it works.
    const captured: { model?: string } = {};
    const fetchFn = jest.fn(async (_url: string, init: { body: string }) => {
      captured.model = (JSON.parse(init.body) as { model?: string }).model;
      throw new Error('stop here — we only need the request body');
    });

    const client = createOpenaiClient({ apiKey: 'k' }, fetchFn as never);
    await client
      .chat({ system: 's', messages: [{ role: 'user', content: 'hi' }] })
      .catch(() => undefined);

    // The hardcoded model, NOT any caller-supplied one.
    // Uses explicit -sol (frontier tier) rather than the alias 'gpt-5.6'
    expect(captured.model).toBe('gpt-5.6-sol');
  });

  describe('forwards payloads correctly to each surface on its own channel', () => {
    afterEach(() => jest.resetModules());

    // Security-relevant: system/message swap puts user free text where immutable
    // directives belong. These sentinels must be distinct and non-empty so the
    // swap is detectable.
    const SYSTEM_SENTINEL = 'SYSTEM-IMMUTABLE-DIRECTIVES-CHANNEL';
    const MESSAGE_SENTINEL = 'MESSAGE-USER-CONTENT-CHANNEL';

    it('anthropic: each surface forwards system and message to its client with correct field positions', async () => {
      jest.resetModules();
      const chatSpy = jest.fn(async () => ({ reply: 'ok' }));
      const commentSpy = jest.fn(async () => 'ok');
      const suggestSpy = jest.fn(async () => ({ alternates: [] }));
      const askSpy = jest.fn(async () => 'ok');

      jest.doMock('../anthropicClient', () => ({
        createAnthropicClient: () => ({ chat: chatSpy }),
        createRestCommentaryClient: () => ({ comment: commentSpy }),
      }));
      jest.doMock('../alternatesClient', () => ({
        createExerciseAlternatesClient: () => ({ suggest: suggestSpy }),
      }));
      jest.doMock('../exerciseQuestionClient', () => ({
        createExerciseQuestionClient: () => ({ ask: askSpy }),
      }));

      const { createAiClient: factory } = await import('./factory');
      const client = factory({ anthropicKey: 'sk-ant-test' });

      // Call each surface with distinct sentinels to detect field swaps
      await client.chat({ system: SYSTEM_SENTINEL, messages: [{ role: 'user', content: MESSAGE_SENTINEL }] });
      await client.comment({ system: SYSTEM_SENTINEL, message: MESSAGE_SENTINEL });
      await client.suggest({ system: SYSTEM_SENTINEL, message: MESSAGE_SENTINEL });
      await client.ask({ system: SYSTEM_SENTINEL, message: MESSAGE_SENTINEL });

      // CRITICAL: exact object match to catch system/message swap (F23/F24 mutant)
      expect(chatSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        messages: [{ role: 'user', content: MESSAGE_SENTINEL }],
      });
      expect(commentSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        message: MESSAGE_SENTINEL,
      });
      expect(suggestSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        message: MESSAGE_SENTINEL,
      });
      expect(askSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        message: MESSAGE_SENTINEL,
      });
    });

    it('openai: each surface forwards system and message to its client with correct field positions', async () => {
      jest.resetModules();
      const chatSpy = jest.fn(async () => ({ reply: 'ok' }));
      const commentSpy = jest.fn(async () => 'ok');
      const suggestSpy = jest.fn(async () => ({ alternates: [] }));
      const askSpy = jest.fn(async () => 'ok');

      jest.doMock('../openaiClient', () => ({
        createOpenaiClient: () => ({ chat: chatSpy }),
        createRestCommentaryClient: () => ({ comment: commentSpy }),
      }));
      jest.doMock('../openaiAlternatesClient', () => ({
        createOpenaiAlternatesClient: () => ({ suggest: suggestSpy }),
      }));
      jest.doMock('../openaiExerciseQuestionClient', () => ({
        createOpenaiExerciseQuestionClient: () => ({ ask: askSpy }),
      }));

      const { createAiClient: factory } = await import('./factory');
      const client = factory({ openaiKey: 'sk-openai-test', aiProvider: 'openai' });

      // Same sentinel test on OpenAI path
      await client.chat({ system: SYSTEM_SENTINEL, messages: [{ role: 'user', content: MESSAGE_SENTINEL }] });
      await client.comment({ system: SYSTEM_SENTINEL, message: MESSAGE_SENTINEL });
      await client.suggest({ system: SYSTEM_SENTINEL, message: MESSAGE_SENTINEL });
      await client.ask({ system: SYSTEM_SENTINEL, message: MESSAGE_SENTINEL });

      // CRITICAL: exact object match to catch system/message swap
      expect(chatSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        messages: [{ role: 'user', content: MESSAGE_SENTINEL }],
      });
      expect(commentSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        message: MESSAGE_SENTINEL,
      });
      expect(suggestSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        message: MESSAGE_SENTINEL,
      });
      expect(askSpy).toHaveBeenCalledWith({
        system: SYSTEM_SENTINEL,
        message: MESSAGE_SENTINEL,
      });
    });
  });
});
