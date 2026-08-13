/**
 * The one-shot exercise-alternates call.
 *
 * Same conventions as `anthropicClient.ts`: hand-rolled `fetch` POST to
 * `/v1/messages`, no SDK, non-streaming, `thinking: disabled`, structured
 * output via `output_config.format.json_schema`, `fetchFn`-injectable so it
 * tests in the node jest project, and `AnthropicUnreachable` vs
 * `AnthropicHttpError` kept distinct.
 *
 * It lives in its own module rather than as a third method on
 * `createAnthropicClient` because that client is hardwired to `AI_TURN_SCHEMA`
 * and must stay that way; this one is hardwired to `ALTERNATES_SCHEMA`.
 *
 * Callers are expected to swallow every error: a workout must never depend on
 * this call succeeding.
 */

import { AnthropicHttpError, AnthropicUnreachable } from './anthropicClient';
import {
  ALTERNATES_SCHEMA,
  ExerciseAlternates,
  parseExerciseAlternates,
} from './alternatesSchema';
import { DraftValidationError } from './draftSchema';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';

/**
 * Three short exercise descriptions. Larger than the rest-commentary budget
 * (this is a list, not a sentence) and far smaller than the conversational
 * client's, which has to fit a whole routine draft.
 */
const ALTERNATES_MAX_TOKENS = 1024;

type FetchFn = typeof fetch;

export function createExerciseAlternatesClient(config: { apiKey: string; model?: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;
  const model = config.model ?? MODEL;

  return {
    /** @returns alternates already validated against `ALTERNATES_SCHEMA`'s bounds. */
    async suggest(request: { system: string; message: string }): Promise<ExerciseAlternates> {
      let response: Response;
      try {
        response = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: ALTERNATES_MAX_TOKENS,
            thinking: { type: 'disabled' },
            system: request.system,
            messages: [{ role: 'user', content: request.message }],
            output_config: { format: { type: 'json_schema', schema: ALTERNATES_SCHEMA } },
          }),
        });
      } catch (error) {
        throw new AnthropicUnreachable(
          error instanceof Error ? error.message : 'Network request failed'
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new AnthropicHttpError(response.status, `HTTP ${response.status}: ${text}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DraftValidationError('response body is not valid JSON');
      }

      if (body === null || typeof body !== 'object') {
        throw new DraftValidationError('response body is not a valid object');
      }

      const content = (body as { content?: { type?: string; text?: string }[] }).content;

      const textBlock = Array.isArray(content)
        ? content.find(
            (block): block is { type: string; text: string } =>
              block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0
          )
        : undefined;

      if (!textBlock) {
        // A truncated or refused response (stop_reason 'max_tokens'/'refusal')
        // carries no usable text; the caller shows nothing rather than guessing.
        throw new DraftValidationError('response contains no text content block');
      }

      // Validate on receipt. `acceptExerciseAlternate` validates the single
      // chosen one again before it writes — structured output is not a guarantee.
      return parseExerciseAlternates(textBlock.text);
    },
  };
}

export type ExerciseAlternatesClient = ReturnType<typeof createExerciseAlternatesClient>;
