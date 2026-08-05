import { AI_TURN_SCHEMA, AiTurn, DraftValidationError, parseAiTurn } from './draftSchema';
import { buildOpenAiBody } from './provider/requestBuilder';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.6';

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

export class OpenaiUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenaiUnreachable';
  }
}

export class OpenaiHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'OpenaiHttpError';
  }
}

export class OpenaiSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenaiSchemaError';
  }
}

export function createOpenaiClient(config: { apiKey: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    async chat(request: { system: string; messages: AiChatMessage[] }): Promise<AiTurn> {
      let body: Record<string, unknown>;
      try {
        body = buildOpenAiBody(
          {
            system: request.system,
            messages: request.messages,
            schema: AI_TURN_SCHEMA,
            schemaName: 'AiTurn',
            surface: 'chat',
          },
          MODEL
        );
      } catch (error) {
        throw new OpenaiSchemaError(
          error instanceof Error ? error.message : 'Failed to build OpenAI request body'
        );
      }

      let response: Response;
      try {
        response = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new OpenaiUnreachable(
          error instanceof Error ? error.message : 'Network request failed'
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new OpenaiHttpError(response.status, `HTTP ${response.status}: ${text}`);
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new DraftValidationError('response body is not valid JSON');
      }

      if (responseBody === null || typeof responseBody !== 'object') {
        throw new DraftValidationError('response body is not a valid object');
      }

      const content = (responseBody as { content?: { type?: string; text?: string }[] }).content;

      const textBlocks = Array.isArray(content)
        ? content.filter((block): block is { type: string; text: string } =>
            block?.type === 'text' && typeof block.text === 'string'
          )
        : [];

      const textBlock = textBlocks.find((block) => block.text.length > 0);

      if (!textBlock) {
        if (textBlocks.length > 0) {
          throw new DraftValidationError('text block is empty');
        }
        throw new DraftValidationError('response contains no text content block');
      }

      return parseAiTurn(textBlock.text);
    },
  };
}

export type OpenaiClient = ReturnType<typeof createOpenaiClient>;

/**
 * One-shot rest-screen commentary. Same conventions as `createOpenaiClient`
 * — hand-rolled fetch, no SDK, `fetchFn`-injectable, `OpenaiUnreachable` vs
 * `OpenaiHttpError` — but it asks for prose instead of the structured turn.
 * It lives here rather than being folded into `chat()` because that method
 * is hardwired to `AI_TURN_SCHEMA` and must stay that way.
 *
 * Callers are expected to swallow every error: rest must never depend on this.
 */
export function createRestCommentaryClient(config: { apiKey: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    /** @returns the first non-empty text block, raw; callers normalize. */
    async comment(request: { system: string; message: string }): Promise<string> {
      const body = {
        model: MODEL,
        max_output_tokens: COMMENTARY_MAX_TOKENS,
        reasoning: { effort: 'low' as const },
        input: [
          { role: 'developer' as const, content: request.system },
          { role: 'user' as const, content: request.message },
        ],
        text: {
          type: 'text' as const,
        },
      };

      let response: Response;
      try {
        response = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new OpenaiUnreachable(
          error instanceof Error ? error.message : 'Network request failed'
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new OpenaiHttpError(response.status, `HTTP ${response.status}: ${text}`);
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new DraftValidationError('response body is not valid JSON');
      }

      if (responseBody === null || typeof responseBody !== 'object') {
        throw new DraftValidationError('response body is not a valid object');
      }

      const content = (responseBody as { content?: { type?: string; text?: string }[] }).content;

      const textBlock = Array.isArray(content)
        ? content.find(
            (block): block is { type: string; text: string } =>
              block?.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0
          )
        : undefined;

      if (!textBlock) {
        throw new DraftValidationError('response contains no usable commentary text');
      }

      return textBlock.text;
    },
  };
}

export type RestCommentaryClient = ReturnType<typeof createRestCommentaryClient>;
