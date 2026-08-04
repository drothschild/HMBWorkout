/**
 * Build request bodies for Anthropic and OpenAI APIs.
 * Both providers accept the same input shape but have different wire formats.
 */

interface RequestInput {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: unknown;
  schemaName: string;
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
    max_tokens: 4096,
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
 * Build OpenAI Responses API request body.
 * CRITICAL: Uses text: { format: { type: 'json_schema', ... } }
 * NOT the older response_format from Chat Completions.
 *
 * Messages API requires user to speak first, so system prompt
 * is prepended to the first user message.
 */
export function buildOpenAiBody(
  request: RequestInput,
  model: string
): Record<string, unknown> {
  if (!request.schemaName?.trim()) {
    throw new Error('schema name required for OpenAI structured output');
  }

  // OpenAI Messages API requires user to speak first.
  // Combine system prompt with first user message.
  const messages = [...request.messages];

  if (messages.length > 0 && messages[0].role === 'user') {
    messages[0] = {
      ...messages[0],
      content: `${request.system}\n\n${messages[0].content}`,
    };
  } else if (messages.length === 0) {
    // No messages provided; shouldn't happen but handle it
    messages.push({
      role: 'user',
      content: request.system,
    });
  }

  return {
    model,
    max_tokens: 4096,
    messages,
    text: {
      type: 'text',
      format: {
        type: 'json_schema',
        strict: true,
        name: request.schemaName,
        schema: request.schema,
      },
    },
  };
}
