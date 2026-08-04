/**
 * Build request bodies for Anthropic and OpenAI APIs.
 * Both providers accept the same input shape but have different wire formats.
 */

/**
 * AI surface type determines token budget and settings.
 * - chat: frontier tier, 4096 tokens (conversation, debrief, routine drafting)
 * - alternates: 1024 tokens (exercise replacement suggestions)
 * - exerciseQuestion: 512 tokens (per-exercise Q&A)
 * - restCommentary: 256 tokens + effort: 'low' (timed rest tips)
 */
export type AiSurface = 'chat' | 'alternates' | 'exerciseQuestion' | 'restCommentary';

interface RequestInput {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: unknown;
  schemaName: string;
  surface?: AiSurface;
}

function getTokenBudget(surface: AiSurface | undefined): number {
  switch (surface) {
    case 'alternates':
      return 1024;
    case 'exerciseQuestion':
      return 512;
    case 'restCommentary':
      return 256;
    case 'chat':
    default:
      return 4096;
  }
}

/**
 * Build Anthropic Messages API request body using Responses API.
 * Uses output_config.format.json_schema with strict structured output.
 */
export function buildAnthropicBody(
  request: RequestInput,
  model: string
): Record<string, unknown> {
  return {
    model,
    max_tokens: getTokenBudget(request.surface),
    thinking: { type: 'disabled' },
    system: request.system,
    messages: request.messages,
    output_config: {
      format: {
        type: 'json_schema',
        schema: request.schema,
      },
    },
  };
}

/**
 * Build OpenAI API request body with system prompt in separate channel.
 *
 * System prompt is sent separately from user content to preserve
 * the precedence of IMMUTABLE_DIRECTIVES as the last section.
 * Per-surface reasoning effort is applied for rest commentary.
 */
export function buildOpenAiBody(
  request: RequestInput,
  model: string
): Record<string, unknown> {
  if (!request.schemaName?.trim()) {
    throw new Error('schema name required for OpenAI structured output');
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: getTokenBudget(request.surface),
    system: request.system,
    messages: request.messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
    },
  };

  // Rest commentary uses lower reasoning effort for latency
  if (request.surface === 'restCommentary') {
    body.reasoning_effort = 'low';
  }

  return body;
}
