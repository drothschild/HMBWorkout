/**
 * Factory for creating AI clients based on provider configuration.
 * Dispatches to Anthropic or OpenAI based on configured keys and settings.
 * Creates unified clients supporting all four surfaces: chat, comment, suggest, ask.
 */

import { createAnthropicClient, createRestCommentaryClient } from '../anthropicClient';
import { createOpenaiClient } from '../openaiClient';
import { createRestCommentaryClient as createOpenaiRestCommentaryClient } from '../openaiClient';
import { createExerciseAlternatesClient } from '../alternatesClient';
import { createOpenaiAlternatesClient } from '../openaiAlternatesClient';
import { createExerciseQuestionClient } from '../exerciseQuestionClient';
import { createOpenaiExerciseQuestionClient } from '../openaiExerciseQuestionClient';
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
    // Guard matches resolveProvider's logic: require non-empty trimmed value
    if (!config.anthropicKey?.trim()) {
      throw new Error('Anthropic provider selected but anthropicKey not configured');
    }

    const apiConfig = { apiKey: config.anthropicKey.trim() };
    const chatClient = createAnthropicClient(apiConfig);
    const commentClient = createRestCommentaryClient(apiConfig);
    const suggestClient = createExerciseAlternatesClient(apiConfig);
    const askClient = createExerciseQuestionClient(apiConfig);

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

  const apiConfig = { apiKey: config.openaiKey.trim() };
  const chatClient = createOpenaiClient(apiConfig);
  const commentClient = createOpenaiRestCommentaryClient(apiConfig);
  const suggestClient = createOpenaiAlternatesClient(apiConfig);
  const askClient = createOpenaiExerciseQuestionClient(apiConfig);

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
