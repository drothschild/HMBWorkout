/**
 * Build request bodies for Anthropic and OpenAI APIs.
 * Both providers accept the same input shape but have different wire formats.
 */

import { transformSchemaForOpenAI, expectStructuredOutputSafeForOpenAI } from './subset';

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
      return 4096;
    case undefined:
      return 4096;
    // Exhaustive check: if a new surface type is added, tsc will flag it
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
 * Build an OpenAI **Responses API** request body.
 *
 * Targeting Responses (`text.format`) rather than Chat Completions
 * (`response_format`) is a settled decision, not a preference — see
 * docs/design-plans/2026-08-04-multi-provider-ai.md. A previous revision
 * reverted this to Chat Completions and labelled the Responses shape
 * "incorrect"; it is not, and the reversal has been undone.
 *
 * Verified against OpenAI's live documentation 2026-08-04:
 *   - `input` replaces `messages`
 *   - there is **no** top-level `system` parameter; system content is an
 *     entry in `input` with role `developer`. That is what keeps
 *     IMMUTABLE_DIRECTIVES in their own channel rather than sharing a
 *     buffer with user-controlled free text (routine notes, exercise
 *     titles, goals) — the precedence guarantee AGENTS.md requires is a
 *     *channel* property, so a role-tagged entry preserves it and folding
 *     the prompt into the user turn does not.
 *   - structured output is `text: { format: { type, name, strict, schema } }`
 *   - token budget is `max_output_tokens`
 *   - reasoning effort (when present) is `reasoning: { effort }`, used for
 *     extended thinking on frontier models
 */
export function buildOpenAiBody(
  request: RequestInput,
  model: string
): Record<string, unknown> {
  if (!request.schemaName?.trim()) {
    throw new Error('schema name required for OpenAI structured output');
  }

  const transformedSchema = transformSchemaForOpenAI(request.schema);
  // Verify transformed schema is safe for OpenAI strict mode before sending
  expectStructuredOutputSafeForOpenAI(transformedSchema);

  const body: Record<string, unknown> = {
    model,
    max_output_tokens: getTokenBudget(request.surface),
    // System content is a role-tagged entry in `input`, not a top-level
    // field — Responses has no `system` parameter. Keeping it as its own
    // entry is what preserves IMMUTABLE_DIRECTIVES' channel precedence.
    // Role 'developer' is recommended by OpenAI for system-level instructions.
    input: [
      { role: 'developer', content: request.system },
      ...request.messages,
    ],
    text: {
      format: {
        type: 'json_schema',
        name: request.schemaName,
        schema: transformedSchema,
        strict: true,
      },
    },
  };

  // Apply extended thinking for rest commentary (lower effort to save tokens)
  if (request.surface === 'restCommentary') {
    body.reasoning = { effort: 'low' };
  }

  return body;
}
