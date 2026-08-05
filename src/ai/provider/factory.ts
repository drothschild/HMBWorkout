/**
 * Factory for creating AI clients based on provider configuration.
 * Dispatches to Anthropic or OpenAI based on configured keys and settings.
 */

import { createAnthropicClient } from '../anthropicClient';
import { createOpenaiClient } from '../openaiClient';
import type { AiClient, ProviderConfig, AiProvider, AiModelConfig } from './types';

const DEFAULT_ANTHROPIC_MODELS: AiModelConfig = {
  chat: 'claude-sonnet-5',
  oneShot: 'claude-sonnet-5',
};

const DEFAULT_OPENAI_MODELS: AiModelConfig = {
  chat: 'gpt-4-turbo',
  oneShot: 'gpt-4-turbo',
};

/**
 * Determine which provider is configured.
 * Explicit aiProvider setting wins if set, otherwise uses whichever key is present.
 * Throws if no provider can be determined.
 */
function resolveProvider(config: ProviderConfig): AiProvider {
  // Explicit setting wins
  if (config.aiProvider) {
    return config.aiProvider;
  }

  // Implicit detection from keys
  if (config.anthropicKey) {
    return 'anthropic';
  }

  if (config.openaiKey) {
    return 'openai';
  }

  throw new Error('No AI provider configured: set either anthropicKey or openaiKey');
}

/**
 * Create an AI client based on configuration.
 * The returned client implements a unified interface for both providers.
 *
 * @param config Provider configuration (keys, provider preference, model overrides)
 * @returns An AI client with unified interface (chat method, parseAiTurn validation)
 * @throws If no provider is configured
 */
export function createAiClient(config: ProviderConfig): AiClient {
  const provider = resolveProvider(config);
  const modelConfig = config.aiModel ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODELS : DEFAULT_OPENAI_MODELS);

  if (provider === 'anthropic') {
    if (!config.anthropicKey) {
      throw new Error('Anthropic provider selected but anthropicKey not configured');
    }

    const client = createAnthropicClient({ apiKey: config.anthropicKey });

    return {
      async chat(request) {
        return client.chat({
          system: request.system,
          messages: request.messages,
        });
      },
    };
  }

  // provider === 'openai'
  if (!config.openaiKey) {
    throw new Error('OpenAI provider selected but openaiKey not configured');
  }

  const client = createOpenaiClient({ apiKey: config.openaiKey });

  return {
    async chat(request) {
      return client.chat({
        system: request.system,
        messages: request.messages,
      });
    },
  };
}
