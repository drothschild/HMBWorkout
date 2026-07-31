import { AI_TURN_SCHEMA, AiTurn, DraftValidationError, parseAiTurn } from './draftSchema';
import { normalizeCommentaryText } from './restCommentaryPrompt';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

/**
 * The rest-screen comment is 1-2 sentences and runs against a ticking
 * countdown, so it gets its own budget: a small ceiling and `effort: low`, both
 * of which the conversational client would be wrong to adopt.
 */
const COMMENTARY_MAX_TOKENS = 256;

type FetchFn = typeof fetch;

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AnthropicUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicUnreachable';
  }
}

export class AnthropicHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'AnthropicHttpError';
  }
}

export function createAnthropicClient(config: { apiKey: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    async chat(request: { system: string; messages: AiChatMessage[] }): Promise<AiTurn> {
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
            max_tokens: MAX_TOKENS,
            thinking: { type: 'disabled' },
            system: request.system,
            messages: request.messages,
            output_config: { format: { type: 'json_schema', schema: AI_TURN_SCHEMA } },
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

      const textBlocks = Array.isArray(content)
        ? content.filter((block): block is { type: string; text: string } =>
            block?.type === 'text' && typeof block.text === 'string'
          )
        : [];

      const textBlock = textBlocks.find((block) => block.text.length > 0);

      if (!textBlock) {
        // Truncated or refused responses (stop_reason 'max_tokens'/'refusal') may have no
        // text content or only empty text blocks; distinguish to guide retry logic.
        if (textBlocks.length > 0) {
          throw new DraftValidationError('text block is empty');
        }
        throw new DraftValidationError('response contains no text content block');
      }

      return parseAiTurn(textBlock.text);
    },
  };
}

export type AnthropicClient = ReturnType<typeof createAnthropicClient>;

/**
 * One-shot rest-screen commentary. Same conventions as `createAnthropicClient`
 * — hand-rolled fetch, no SDK, `fetchFn`-injectable, `AnthropicUnreachable` vs
 * `AnthropicHttpError` — but it asks for prose instead of the structured turn,
 * so there is no `output_config.format` and no `parseAiTurn`. It lives here
 * rather than being folded into `chat()` because that method is hardwired to
 * `AI_TURN_SCHEMA` and must stay that way.
 *
 * Callers are expected to swallow every error: rest must never depend on this.
 */
export function createRestCommentaryClient(config: { apiKey: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    /** @returns the comment, normalized to one bounded paragraph */
    async comment(request: { system: string; message: string }): Promise<string> {
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
            max_tokens: COMMENTARY_MAX_TOKENS,
            thinking: { type: 'disabled' },
            // Latency is the binding constraint here — the athlete is watching
            // a countdown, not waiting on a plan.
            output_config: { effort: 'low' },
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

      const comment = Array.isArray(content)
        ? content
            .filter(
              (block): block is { type: string; text: string } =>
                block?.type === 'text' && typeof block.text === 'string'
            )
            .map((block) => normalizeCommentaryText(block.text))
            .find((text): text is string => text !== null)
        : undefined;

      if (comment === undefined) {
        throw new DraftValidationError('response contains no usable commentary text');
      }

      return comment;
    },
  };
}

export type RestCommentaryClient = ReturnType<typeof createRestCommentaryClient>;
