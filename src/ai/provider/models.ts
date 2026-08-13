/**
 * Which model each surface uses, per provider.
 *
 * The list is CONSTRAINED, never free text. Every AI failure in this app is
 * swallowed, so a typo'd model id produces four silently dead features and no
 * error anywhere — indistinguishable from a broken app.
 *
 * Membership is governed by a hard rule: every client sends a FIXED request
 * contract — `reasoning: { effort: 'none' }` on OpenAI, `thinking: { type:
 * 'disabled' }` on Anthropic, `output_config: { effort: 'low' }` on Anthropic
 * rest commentary — against FIXED per-surface budgets (4096/1024/512/256). A
 * model that rejects those, or whose minimum reasoning effort exceeds 'none',
 * either 400s or returns `status: 'incomplete'` with no text and a bill.
 *
 * So an id may only be added here after one live call PER SURFACE that returns
 * rendered text. This is not a config edit. See the design doc and AGENTS.md.
 */

import type {AiModelConfig, AiProvider} from './types';

export const DEFAULT_MODELS: Record<AiProvider, AiModelConfig> = {
  anthropic: {chat: 'claude-sonnet-5', oneShot: 'claude-sonnet-5'},
  openai: {chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol'},
};

/**
 * Populated in Phase 6 Task 1 from a live `GET /v1/models` plus a per-surface
 * probe. Seeded with the two ids already in the tree so the floor is a working
 * default rather than an invented id.
 */
export const AI_MODEL_CHOICES: Record<AiProvider, readonly string[]> = {
  anthropic: ['claude-sonnet-5'],
  openai: ['gpt-5.6-sol'],
};

/**
 * Resolve the per-surface models for a provider.
 *
 * An id that is not on the selected provider's current list is IGNORED and that
 * FIELD falls back to the default — per field, not per object.
 *
 * The setting is NOT rewritten. A model pulled from the list in one release and
 * restored in a later one restores the user's choice, with no migration and no
 * silent settings mutation.
 *
 * The reachable stale value is a CROSS-PROVIDER id: what a blob written before
 * the clear-on-switch rule, or a hand-edited one, carries — and exactly what
 * would 400.
 */
export function resolveModels(
  provider: AiProvider,
  configured: AiModelConfig | undefined,
): AiModelConfig {
  const defaults = DEFAULT_MODELS[provider];
  const allowed = AI_MODEL_CHOICES[provider];
  const pick = (id: string | undefined, fallback: string) =>
    id && allowed.includes(id) ? id : fallback;

  return {
    chat: pick(configured?.chat, defaults.chat),
    oneShot: pick(configured?.oneShot, defaults.oneShot),
  };
}
