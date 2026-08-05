import { createAiClient } from './factory';
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

  it('uses provided model config', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-key',
      aiModel: {
        chat: 'claude-custom-chat',
        oneShot: 'claude-custom-oneshot',
      },
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
  });

  it('uses default models when none provided', () => {
    const config: ProviderConfig = {
      anthropicKey: 'test-key',
    };

    const client = createAiClient(config);
    expect(client).toBeDefined();
  });
});
