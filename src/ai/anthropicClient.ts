import { AI_TURN_SCHEMA, AiTurn, DraftValidationError, parseAiTurn } from './draftSchema';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

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
        throw new AnthropicHttpError(response.status, text);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DraftValidationError('response body is not valid JSON');
      }

      const content = (body as { content?: { type?: string; text?: string }[] }).content;
      const textBlock = Array.isArray(content)
        ? content.find((block) => block?.type === 'text' && typeof block.text === 'string')
        : undefined;
      if (!textBlock?.text) {
        throw new DraftValidationError('response contains no text content block');
      }

      return parseAiTurn(textBlock.text);
    },
  };
}

export type AnthropicClient = ReturnType<typeof createAnthropicClient>;
