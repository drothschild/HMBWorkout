/**
 * Multi-provider AI infrastructure.
 * Supports both Anthropic and OpenAI with per-surface model selection.
 */

/**
 * Provider type: which AI service to use.
 * Determined implicitly from whichever key is set, with explicit
 * aiProvider setting winning when both are present.
 */
export type AiProvider = 'anthropic' | 'openai';

/**
 * Per-surface model selection. The frontier tier (gpt-5.6-sol / claude-sonnet)
 * goes to coach chat/debrief and routine drafting; cheaper tier (gpt-5.6-terra/luna)
 * for rest commentary and the exercise ? button.
 */
export interface AiModelConfig {
  /**
   * Main chat/debrief and routine drafting. Frontier tier.
   * E.g. 'claude-sonnet-5', 'gpt-5.6-sol'
   */
  chat: string;

  /**
   * Rest commentary and exercise question. Cheaper tier.
   * E.g. 'claude-sonnet-5', 'gpt-5.6-terra'
   */
  oneShot: string;
}

/**
 * Provider-specific configuration. Only one key is set per install.
 * Provider selection follows: explicit aiProvider setting wins,
 * otherwise whichever key is present.
 */
export interface ProviderConfig {
  /** Anthropic API key (set on anthropic-only installs) */
  anthropicKey?: string;

  /** OpenAI API key (set on openai-only installs) */
  openaiKey?: string;

  /**
   * Explicit provider selection. When set, it wins over implicit
   * key-based detection. Allows an install with both keys set to
   * explicitly choose one.
   */
  aiProvider?: AiProvider;

  /**
   * Per-surface model selection. Defaults provided for each provider
   * if not specified.
   */
  aiModel?: AiModelConfig;
}

/**
 * Unified AI client interface that both providers implement.
 * Used by the shell to talk to either provider without caring which.
 */
export interface AiClient {
  /**
   * Send a chat message and get back structured JSON output.
   *
   * NOTE: `schema` and `model` parameters are deferred to Phase 3.
   * The plan names per-surface model selection (chat/debrief on frontier,
   * exerciseQuestion/restCommentary on cheaper tier), but Phase 2 hardcodes
   * models in the clients themselves and doesn't expose schema selection.
   * Both fields will be added to this request type when Phase 3 wires the
   * underlying clients to accept them. See factory.ts:51-62 for the gap docs.
   */
  chat(request: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<unknown>;
}

/**
 * Error types for provider operations. Both providers emit these
 * when network or HTTP errors occur.
 */
export class ProviderUnreachable extends Error {
  constructor(public provider: AiProvider, message: string) {
    super(`${provider} unreachable: ${message}`);
    this.name = 'ProviderUnreachable';
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public provider: AiProvider,
    public status: number,
    message: string
  ) {
    super(`${provider} HTTP ${status}: ${message}`);
    this.name = 'ProviderHttpError';
  }
}
