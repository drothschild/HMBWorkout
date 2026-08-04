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
 *     entry in `input` with role `system`/`developer`. That is what keeps
 *     IMMUTABLE_DIRECTIVES in their own channel rather than sharing a
 *     buffer with user-controlled free text (routine notes, exercise
 *     titles, goals) — the precedence guarantee AGENTS.md requires is a
 *     *channel* property, so a role-tagged entry preserves it and folding
 *     the prompt into the user turn does not.
 *   - structured output is `text: { format: { type, name, strict, schema } }`
 *
 * NOT yet verified — the reference page was truncated on fetch, so these two
 * are carried over from the Chat Completions shape and are very likely wrong:
 *   - the token-budget parameter (Responses is believed to use
 *     `max_output_tokens`, not `max_tokens`)
 *   - reasoning effort (believed `reasoning: { effort }`, not
 *     `reasoning_effort`)
 * Both are marked below. **Confirm them before Phase 2 wires a live call** —
 * nothing calls this builder yet, so a wrong name here is currently inert,
 * and guessing would have made it silently wrong instead of visibly open.
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
    // UNVERIFIED (see docstring): Responses is believed to use
    // `max_output_tokens`. Confirm before Phase 2.
    max_tokens: getTokenBudget(request.surface),
    // System content is a role-tagged entry in `input`, not a top-level
    // field — Responses has no `system` parameter. Keeping it as its own
    // entry is what preserves IMMUTABLE_DIRECTIVES' channel precedence.
    input: [
      { role: 'system', content: request.system },
      ...request.messages,
    ],
    text: {
      format: {
        type: 'json_schema',
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
    },
  };

  // UNVERIFIED (see docstring): believed to be `reasoning: { effort }`.
  // Confirm before Phase 2.
  if (request.surface === 'restCommentary') {
    body.reasoning_effort = 'low';
  }

  return body;
}
