/**
 * Factory for creating AI clients based on provider configuration.
 * Dispatches to Anthropic or OpenAI based on configured keys and settings.
 */

import { createAnthropicClient } from '../anthropicClient';
import { createOpenaiClient } from '../openaiClient';
import type { AiClient, ProviderConfig, AiProvider } from './types';

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

  // NOTE: `config.aiModel` is deliberately NOT read here. The settings field is
  // real (Phase 1 added it, and settings.test.ts round-trips it), but neither
  // client factory accepts a model argument yet — both hardcode their own. So a
  // user-chosen model would be silently ignored.
  //
  // An earlier revision computed a `modelConfig` here, dropped it on the floor,
  // and silenced the resulting unused-variable warning with an eslint-disable.
  // That is strictly worse than not reading it: it looks wired, lints clean, and
  // two tests named "uses provided model config" asserted only that the factory
  // returned something. Wiring it for real is Phase 3 (it changes both client
  // signatures, including the working Anthropic one) and is pinned by the
  // accepted-but-ignored test in factory.test.ts until then.

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
