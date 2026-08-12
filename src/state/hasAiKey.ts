/**
 * Canonical predicate: true when a usable API key is configured (either Anthropic or OpenAI).
 *
 * Used by all AI surfaces as the gate for whether an AI feature should be
 * offered/enabled: onboarding, post-workout debrief, exercise question button,
 * replace button, rest commentary.
 *
 * This is the single source of truth to prevent drift across inlined checks.
 */
export function hasAiKey(settings: { anthropicKey?: string; openaiKey?: string }): boolean {
  const hasAnthropicKey = settings.anthropicKey?.trim();
  const hasOpenaiKey = settings.openaiKey?.trim();
  return Boolean(hasAnthropicKey || hasOpenaiKey);
}
