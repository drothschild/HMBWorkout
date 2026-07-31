/**
 * The exercise-question one-shot call: same conventions as
 * `createAnthropicClient`/`createRestCommentaryClient` in `anthropicClient.ts`
 * — hand-rolled fetch, fetchFn-injectable, `AnthropicUnreachable` vs
 * `AnthropicHttpError`, no SDK — but its own token budget. A "detailed
 * how-to" answer runs longer than the rest screen's 1-2 sentence comment
 * (`COMMENTARY_MAX_TOKENS` in `anthropicClient.ts`), and the call is not
 * racing a rest countdown, so `effort` is left at its default instead of
 * forced to 'low'.
 *
 * This duplicates the POST/parse boilerplate from `createRestCommentaryClient`
 * rather than extending `anthropicClient.ts`, to keep this feature's
 * footprint to new files only — two concurrent PRs already touch the session
 * screen and its timer. A follow-up should hoist the shared shape once all
 * three call shapes (chat, comment, ask) exist side by side.
 */

import { AnthropicHttpError, AnthropicUnreachable } from './anthropicClient';
import { DraftValidationError } from './draftSchema';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';

/**
 * A detailed how-to needs more room than the rest-screen's 1-2 sentences
 * (256 tokens there), but is still bounded so a runaway response can't blow
 * up the session screen's inline expand block. Paired with EXERCISE_QUESTION_MAX_CHARS
 * (2000); tokens and chars should stay roughly in sync (512 tokens ≈ 2000 chars).
 */
export const EXERCISE_QUESTION_MAX_TOKENS = 512;

type FetchFn = typeof fetch;

export function createExerciseQuestionClient(config: { apiKey: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    /** @returns the first non-empty text block, raw; callers normalize. */
    async ask(request: { system: string; message: string }): Promise<string> {
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
            model: MODEL,
            max_tokens: EXERCISE_QUESTION_MAX_TOKENS,
            thinking: { type: 'disabled' },
            system: request.system,
            messages: [{ role: 'user', content: request.message }],
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
              block?.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0
          )
        : undefined;

      if (!textBlock) {
        throw new DraftValidationError('response contains no usable answer text');
      }

      return textBlock.text;
    },
  };
}

export type ExerciseQuestionClient = ReturnType<typeof createExerciseQuestionClient>;
