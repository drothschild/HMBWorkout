import { createAiClient } from './factory';
import { createOpenaiClient } from '../openaiClient';
import type { ProviderConfig } from './types';

describe('createAiClient factory', () => {
  it('creates Anthropic client when anthropicKey is set', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
  });

  it('creates OpenAI client when openaiKey is set', () => {
    const config: ProviderConfig = {
      openaiKey: 'test-openai-key',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
  });

  it('prefers Anthropic when both keys are set but aiProvider is not set', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
      openaiKey: 'test-openai-key',
    };

    const client = createAiClient(config);
    // When both keys present, anthropic is default preference
    expect(client).toBeDefined();
  });

  it('uses aiProvider setting to override implicit detection', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-anthropic-key',
      openaiKey: 'test-openai-key',
      aiProvider: 'openai',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
  });

  it('throws when no provider is configured', () => {
    const config: ProviderConfig = {};

    expect(() => createAiClient(config)).toThrow();
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
    expect(captured.model).toBe('gpt-5.6');
  });
});
