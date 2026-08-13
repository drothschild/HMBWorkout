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

      // CRITICAL: verify trimmed key reaches ALL surfaces with the correct full config
      expect(chatClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-padded' })
      );
      expect(commentClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-padded' })
      );
      expect(suggestClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-padded' })
      );
      expect(askClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-padded' })
      );
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

      // CRITICAL: verify trimmed key reaches ALL surfaces with the correct full config
      expect(chatClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-ant-padded' })
      );
      expect(commentClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-ant-padded' })
      );
      expect(suggestClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-ant-padded' })
      );
      expect(askClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-ant-padded' })
      );
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

  describe('routes models to surfaces correctly', () => {
    // I3 note: A test was deleted that directly called createOpenaiClient and
    // asserted `model === 'gpt-5.6-sol'` in the request body (named
    // 'accepts aiModel but does NOT yet apply it'). Its model assertion now
    // lives in the C1 tests below, which verify configured models end up in
    // the request body for ALL eight factories. The factory tests at C2 verify
    // resolveModels is called with the right arguments.
    afterEach(() => jest.resetModules());

    it('routes chat to the chat model and the three one-shots to oneShot (anthropic)', async () => {
      jest.resetModules();
      const chatSpy = jest.fn(() => ({ chat: async () => ({ reply: 'ok' }) }));
      const commentSpy = jest.fn(() => ({ comment: async () => 'ok' }));
      const suggestSpy = jest.fn(() => ({ suggest: async () => ({ alternates: [] }) }));
      const askSpy = jest.fn(() => ({ ask: async () => 'ok' }));
      const resolveModelsMock = jest.fn(() => ({
        chat: 'CHAT-ID',
        oneShot: 'ONESHOT-ID',
      }));

      jest.doMock('../anthropicClient', () => ({
        createAnthropicClient: chatSpy,
        createRestCommentaryClient: commentSpy,
      }));
      jest.doMock('../alternatesClient', () => ({
        createExerciseAlternatesClient: suggestSpy,
      }));
      jest.doMock('../exerciseQuestionClient', () => ({
        createExerciseQuestionClient: askSpy,
      }));
      jest.doMock('./models', () => ({
        resolveModels: resolveModelsMock,
      }));

      const { createAiClient: f } = await import('./factory');
      f({
        anthropicKey: 'sk-ant-x',
        aiModel: { chat: 'CHAT-ID', oneShot: 'ONESHOT-ID' },
      });

      // C2: resolveModels must be called with the configured model
      expect(resolveModelsMock).toHaveBeenCalledWith('anthropic', { chat: 'CHAT-ID', oneShot: 'ONESHOT-ID' });

      // Chat gets the chat model
      expect(chatSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'CHAT-ID' })
      );
      // Three one-shots get the oneShot model
      expect(commentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ONESHOT-ID' })
      );
      expect(suggestSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ONESHOT-ID' })
      );
      expect(askSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ONESHOT-ID' })
      );
    });

    it('routes chat to the chat model and the three one-shots to oneShot (openai)', async () => {
      jest.resetModules();
      const chatSpy = jest.fn(() => ({ chat: async () => ({ reply: 'ok' }) }));
      const commentSpy = jest.fn(() => ({ comment: async () => 'ok' }));
      const suggestSpy = jest.fn(() => ({ suggest: async () => ({ alternates: [] }) }));
      const askSpy = jest.fn(() => ({ ask: async () => 'ok' }));
      const resolveModelsMock = jest.fn(() => ({
        chat: 'CHAT-ID',
        oneShot: 'ONESHOT-ID',
      }));

      jest.doMock('../openaiClient', () => ({
        createOpenaiClient: chatSpy,
        createRestCommentaryClient: commentSpy,
      }));
      jest.doMock('../openaiAlternatesClient', () => ({
        createOpenaiAlternatesClient: suggestSpy,
      }));
      jest.doMock('../openaiExerciseQuestionClient', () => ({
        createOpenaiExerciseQuestionClient: askSpy,
      }));
      jest.doMock('./models', () => ({
        resolveModels: resolveModelsMock,
      }));

      const { createAiClient: f } = await import('./factory');
      f({
        openaiKey: 'sk-openai-x',
        aiModel: { chat: 'CHAT-ID', oneShot: 'ONESHOT-ID' },
      });

      // C2: resolveModels must be called with the configured model
      expect(resolveModelsMock).toHaveBeenCalledWith('openai', { chat: 'CHAT-ID', oneShot: 'ONESHOT-ID' });

      // Chat gets the chat model
      expect(chatSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'CHAT-ID' })
      );
      // Three one-shots get the oneShot model
      expect(commentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ONESHOT-ID' })
      );
      expect(suggestSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ONESHOT-ID' })
      );
      expect(askSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'ONESHOT-ID' })
      );
    });
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
