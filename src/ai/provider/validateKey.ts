/**
 * A free, token-free check that a provider key actually authenticates (#168).
 *
 * Uses each provider's model-list endpoint rather than a real completion: it
 * proves the credential without spending tokens, and without depending on the
 * fixed request contract that governs `AI_MODEL_CHOICES` membership. This
 * answers "is this key valid", not "does this model work" — the latter is what
 * the per-surface probe in #245 is for.
 *
 * `fetchFn` is injected so this tests in the node jest project, matching every
 * other client in `src/ai`. There is no SDK here for the same reason.
 */

import type { AiProvider } from '@/ai/provider/types';

export type KeyValidation =
  | { ok: true }
  // `unauthorized` is separated from `http`/`unreachable` because only the first
  // is the user's mistake and actionable. #168 warns rather than blocks either
  // way, but a network outage must not read as "your key is wrong".
  | { ok: false; reason: 'unauthorized' | 'http' | 'unreachable'; status?: number };

const ANTHROPIC_VERSION = '2023-06-01';

export async function validateProviderKey(
  provider: AiProvider,
  key: string,
  fetchFn: typeof fetch = fetch
): Promise<KeyValidation> {
  const trimmed = key.trim();
  // Trimmed to match `apiKeyPatch`, which trims on the way into storage — an
  // untrimmed check would 401 a key that works fine once saved.
  if (!trimmed) {
    return { ok: false, reason: 'unauthorized' };
  }

  const [url, headers] =
    provider === 'anthropic'
      ? ([
          'https://api.anthropic.com/v1/models?limit=1',
          { 'x-api-key': trimmed, 'anthropic-version': ANTHROPIC_VERSION },
        ] as const)
      : (['https://api.openai.com/v1/models', { Authorization: `Bearer ${trimmed}` }] as const);

  let response: Response;
  try {
    response = await fetchFn(url, { method: 'GET', headers });
  } catch {
    // Network vs HTTP stays a distinct outcome here, the same split the
    // Anthropic/OpenAI clients make between Unreachable and HttpError.
    return { ok: false, reason: 'unreachable' };
  }

  if (response.ok) {
    return { ok: true };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'unauthorized', status: response.status };
  }
  return { ok: false, reason: 'http', status: response.status };
}
