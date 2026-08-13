/**
 * Factory for creating AI clients based on provider configuration.
 * Dispatches to Anthropic or OpenAI based on configured keys and settings.
 * Creates unified clients supporting all four surfaces: chat, comment, suggest, ask.
 */

import { createAnthropicClient, createRestCommentaryClient } from '../anthropicClient';
import { createOpenaiClient, createRestCommentaryClient as createOpenaiRestCommentaryClient } from '../openaiClient';
import { createExerciseAlternatesClient } from '../alternatesClient';
import { createOpenaiAlternatesClient } from '../openaiAlternatesClient';
import { createExerciseQuestionClient } from '../exerciseQuestionClient';
import { createOpenaiExerciseQuestionClient } from '../openaiExerciseQuestionClient';
import { resolveModels } from './models';
import type { AiClient, ProviderConfig, AiProvider } from './types';

/**
 * Determine which provider is configured.
 * Explicit aiProvider setting wins if set, otherwise uses whichever key is present.
 * Throws if no provider can be determined.
 *
 * Resolution logic matches src/state/settings.ts:resolveAiProvider() — when both
 * keys are set, no implicit choice is made (requires explicit aiProvider to resolve).
 */
function resolveProvider(config: ProviderConfig): AiProvider {
  // Explicit setting wins
  if (config.aiProvider) {
    return config.aiProvider;
  }

  // Implicit detection from keys — only if exactly one is set
  const hasAnthropicKey = (config.anthropicKey ?? '').trim().length > 0;
  const hasOpenaiKey = (config.openaiKey ?? '').trim().length > 0;

  if (hasAnthropicKey && !hasOpenaiKey) {
    return 'anthropic';
  }

  if (hasOpenaiKey && !hasAnthropicKey) {
    return 'openai';
  }

  // Both or neither: no implicit choice
  throw new Error('No AI provider configured: set either anthropicKey or openaiKey, or specify aiProvider explicitly');
}

/**
 * Create an AI client based on configuration.
 * The returned client implements a unified interface for both providers,
 * supporting all four surfaces: chat, comment, suggest, and ask.
 *
 * @param config Provider configuration (keys, provider preference, model overrides)
 * @returns An AI client with unified interface (all four methods)
 * @throws If no provider is configured
 */
export function createAiClient(config: ProviderConfig): AiClient {
  const provider = resolveProvider(config);
  const models = resolveModels(provider, config.aiModel);

  if (provider === 'anthropic') {
    // Guard matches resolveProvider's logic: require non-empty trimmed value
    if (!config.anthropicKey?.trim()) {
      throw new Error('Anthropic provider selected but anthropicKey not configured');
    }

    const apiKey = config.anthropicKey.trim();
    const chatClient = createAnthropicClient({ apiKey, model: models.chat });
    const commentClient = createRestCommentaryClient({ apiKey, model: models.oneShot });
    const suggestClient = createExerciseAlternatesClient({ apiKey, model: models.oneShot });
    const askClient = createExerciseQuestionClient({ apiKey, model: models.oneShot });

    return {
      async chat(request) {
        return chatClient.chat({
          system: request.system,
          messages: request.messages,
        });
      },
      async comment(request) {
        return commentClient.comment({
          system: request.system,
          message: request.message,
        });
      },
      async suggest(request) {
        return suggestClient.suggest({
          system: request.system,
          message: request.message,
        });
      },
      async ask(request) {
        return askClient.ask({
          system: request.system,
          message: request.message,
        });
      },
    };
  }

  // provider === 'openai'
  // Guard matches resolveProvider's logic: require non-empty trimmed value
  if (!config.openaiKey?.trim()) {
    throw new Error('OpenAI provider selected but openaiKey not configured');
  }

  const apiKey = config.openaiKey.trim();
  const chatClient = createOpenaiClient({ apiKey, model: models.chat });
  const commentClient = createOpenaiRestCommentaryClient({ apiKey, model: models.oneShot });
  const suggestClient = createOpenaiAlternatesClient({ apiKey, model: models.oneShot });
  const askClient = createOpenaiExerciseQuestionClient({ apiKey, model: models.oneShot });

  return {
    async chat(request) {
      return chatClient.chat({
        system: request.system,
        messages: request.messages,
      });
    },
    async comment(request) {
      return commentClient.comment({
        system: request.system,
        message: request.message,
      });
    },
    async suggest(request) {
      return suggestClient.suggest({
        system: request.system,
        message: request.message,
      });
    },
    async ask(request) {
      return askClient.ask({
        system: request.system,
        message: request.message,
      });
    },
  };
}
