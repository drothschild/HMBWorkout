import { AI_TURN_SCHEMA, AiTurn, DraftValidationError, parseAiTurn } from './draftSchema';
import { buildOpenAiBody } from './provider/requestBuilder';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
// gpt-5.6 is an alias that can be repointed; use explicit -sol to pin the frontier tier
const MODEL = 'gpt-5.6-sol';

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

export class OpenaiIncompleteError extends Error {
  constructor(
    public reason: string,
    message: string
  ) {
    super(message);
    this.name = 'OpenaiIncompleteError';
  }
}

/**
 * The model declined to answer. A `refusal` part is a normal, documented
 * Responses outcome, not a transport or parsing failure — without this the
 * refusal falls through to "no text content block", which points a reader at
 * the wire format instead of at the model's actual decision.
 */
export class OpenaiRefusalError extends Error {
  constructor(public refusal: string) {
    super(`model refused to answer: ${refusal}`);
    this.name = 'OpenaiRefusalError';
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
        // Unreachable today: the schema and schemaName above are hardcoded and
        // valid, so no caller can make buildOpenAiBody throw through this
        // surface. Kept as defence-in-depth, and it becomes reachable when
        // Phase 3 lets callers supply a schema. buildOpenAiBody's throw is a
        // deliberate build-time programmer-error signal, so it is converted to a
        // distinct type rather than swallowed into a generic failure — call
        // sites still catch it like any other AI failure, because a workout must
        // never depend on the AI.
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

      // Check for top-level error
      const topLevelError = (responseBody as { error?: { message?: string } }).error;
      if (topLevelError?.message) {
        throw new DraftValidationError(`OpenAI error: ${topLevelError.message}`);
      }

      // Check for incomplete response
      const status = (responseBody as { status?: string }).status;
      if (status === 'incomplete') {
        const incompleteDetails = (responseBody as { incomplete_details?: { reason?: string } }).incomplete_details;
        const reason = incompleteDetails?.reason ?? 'unknown';
        throw new OpenaiIncompleteError(reason, `response incomplete: ${reason}`);
      }

      // OpenAI Responses format: output is an array of items, find the message item
      const output = (responseBody as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] }).output;

      if (!Array.isArray(output)) {
        throw new DraftValidationError('response output is not an array');
      }

      // Find the message item in output (reasoning items may precede it)
      const messageItem = output.find((item): item is { type: string; content: { type?: string; text?: string }[] } =>
        item?.type === 'message' && Array.isArray(item?.content)
      );

      if (!messageItem) {
        throw new DraftValidationError('response output contains no message item');
      }

      // Part type is `output_text`, NOT `text`. `text` is Anthropic's discriminator
      // and was what this filter checked until PR #120's fix round 2 — with the
      // mocks agreeing, so the suite stayed green while a real response matched
      // nothing and threw 'no text content block'. Do not widen this to accept
      // both: accepting Anthropic's name here is what let the wrong shape survive
      // two rounds of review.
      const textBlocks = messageItem.content.filter((block): block is { type: string; text: string } =>
        block?.type === 'output_text' && typeof block.text === 'string'
      );

      const refusal = messageItem.content.find(
        (block): block is { type: string; refusal: string } =>
          (block as { type?: string }).type === 'refusal' &&
          typeof (block as { refusal?: unknown }).refusal === 'string'
      );
      if (refusal) {
        throw new OpenaiRefusalError(refusal.refusal);
      }

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
      let body: Record<string, unknown>;
      try {
        body = buildOpenAiBody(
          {
            system: request.system,
            messages: [{ role: 'user', content: request.message }],
            schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            schemaName: 'CommentaryResponse',
            surface: 'restCommentary',
            outputFormat: 'text',
          },
          MODEL
        );
      } catch (error) {
        throw new OpenaiSchemaError(
          error instanceof Error ? error.message : 'Failed to build OpenAI commentary request body'
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

      // Check for top-level error
      const topLevelError = (responseBody as { error?: { message?: string } }).error;
      if (topLevelError?.message) {
        throw new DraftValidationError(`OpenAI error: ${topLevelError.message}`);
      }

      // Check for incomplete response (critical for commentary with tight token budget)
      const status = (responseBody as { status?: string }).status;
      if (status === 'incomplete') {
        const incompleteDetails = (responseBody as { incomplete_details?: { reason?: string } }).incomplete_details;
        const reason = incompleteDetails?.reason ?? 'unknown';
        throw new OpenaiIncompleteError(reason, `response incomplete: ${reason}`);
      }

      // OpenAI Responses format: output is an array of items, find the message item
      const output = (responseBody as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] }).output;

      if (!Array.isArray(output)) {
        throw new DraftValidationError('response output is not an array');
      }

      // Find the message item in output (reasoning items may precede it)
      const messageItem = output.find((item): item is { type: string; content: { type?: string; text?: string }[] } =>
        item?.type === 'message' && Array.isArray(item?.content)
      );

      if (!messageItem) {
        throw new DraftValidationError('response output contains no message item');
      }

      // `output_text`, not `text` — see the note on the chat surface above.
      const textBlock = messageItem.content.find(
        (block): block is { type: string; text: string } =>
          block?.type === 'output_text' && typeof block.text === 'string' && block.text.trim().length > 0
      );

      const refusal = messageItem.content.find(
        (block): block is { type: string; refusal: string } =>
          (block as { type?: string }).type === 'refusal' &&
          typeof (block as { refusal?: unknown }).refusal === 'string'
      );
      if (refusal) {
        throw new OpenaiRefusalError(refusal.refusal);
      }

      if (!textBlock) {
        throw new DraftValidationError('response contains no usable commentary text');
      }

      return textBlock.text;
    },
  };
}

export type RestCommentaryClient = ReturnType<typeof createRestCommentaryClient>;
