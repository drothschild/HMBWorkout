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
 * Per-surface model selection. Currently frontier tier (gpt-5.6-sol / claude-sonnet-5)
 * is used for all surfaces; this interface is reserved for Phase 3 when per-surface
 * model selection is implemented.
 */
export interface AiModelConfig {
  /**
   * Main chat/debrief and routine drafting. Frontier tier.
   * E.g. 'claude-sonnet-5', 'gpt-5.6-sol'
   */
  chat: string;

  /**
   * Rest commentary and exercise question. Currently same as chat.
   * E.g. 'claude-sonnet-5', 'gpt-5.6-sol'
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
 * Supports four surfaces: conversational, rest commentary, exercise question, and alternates.
 * Used by the shell to talk to either provider without caring which.
 */
export interface AiClient {
  /**
   * Conversational chat: send messages and get back structured JSON output (AiTurn).
   * Used by aiChatStore for coach conversations and routine drafting.
   */
  chat(request: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<unknown>;

  /**
   * Rest-screen commentary: one-shot prose response for athlete coaching during rest.
   * Single message (not array), returns raw text. Used by restCommentaryStore.
   */
  comment(request: { system: string; message: string }): Promise<string>;

  /**
   * Exercise alternates: one-shot structured JSON (ExerciseAlternates) suggesting
   * exercise substitutions. Single message (not array). Used by exerciseReplaceStore.
   */
  suggest(request: { system: string; message: string }): Promise<unknown>;

  /**
   * Exercise question: one-shot prose response answering "how do I do this exercise?"
   * Single message (not array), returns raw text. Used by exerciseQuestionStore.
   */
  ask(request: { system: string; message: string }): Promise<string>;
}
