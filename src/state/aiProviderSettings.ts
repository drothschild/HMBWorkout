/**
 * Every provider/key decision the AI Provider settings screen makes.
 *
 * The screen lives in `src/app`, which no jest project covers, so each decision
 * is a pure function here and the screen is a renderer. Same reason as
 * `coachOnboarding.dismissOnboardingPatch`.
 */

import type {AiProvider} from '@/ai/provider/types';
import type {BridgeSettings} from '@/state/settings';

/** Display order in the picker. */
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai'] as const;

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/** The settings field each provider's key lives in. */
const KEY_FIELD: Record<AiProvider, 'anthropicKey' | 'openaiKey'> = {
  anthropic: 'anthropicKey',
  openai: 'openaiKey',
};

/** Placeholder for the key field. Provider-dependent; lives here so no `sk-`
 *  literal appears in an untestable file. */
export function keyPlaceholder(provider: AiProvider): string {
  return provider === 'anthropic' ? 'sk-ant-...' : 'sk-...';
}

/**
 * Returns the stored key for a given provider.
 * Used by Phase 3 to populate the key input's initial value.
 */
export function storedKeyFor(
  settings: Partial<BridgeSettings>,
  provider: AiProvider,
): string {
  const raw = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
  return raw ?? '';
}

type ProviderKeySettings = Pick<BridgeSettings, 'anthropicKey'> &
  Partial<Pick<BridgeSettings, 'openaiKey' | 'aiProvider'>>;

function hasKey(settings: ProviderKeySettings, provider: AiProvider): boolean {
  const raw = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
  return (raw ?? '').trim().length > 0;
}

/**
 * What the picker shows when the screen mounts.
 *
 * DISPLAY ONLY. Mounting must never write `aiProvider` — installs that predate
 * the picker have it undefined and resolve implicitly through `factory.ts`, and
 * writing a value the user never chose would freeze that fallback.
 *
 * Arms 1 and 2 are `settings.resolveAiProvider`'s rule. Arm 3 is the addition:
 * that function returns null for "neither or both", and a picker must show
 * something.
 */
export function initialProviderSelection(settings: ProviderKeySettings): AiProvider {
  if (settings.aiProvider === 'anthropic' || settings.aiProvider === 'openai') {
    return settings.aiProvider;
  }
  const anthropic = hasKey(settings, 'anthropic');
  const openai = hasKey(settings, 'openai');
  if (anthropic && !openai) return 'anthropic';
  if (openai && !anthropic) return 'openai';
  return 'anthropic';
}

export interface ProviderSwitchPlan {
  /** Apply this whole object. Do not hand-build a subset. */
  patch: Partial<BridgeSettings>;
  /**
   * The provider that is NOT `next` — the one whose key a switch clears.
   *
   * A total function of `next` alone, which is why it is computed before the
   * branch rather than inside it: on a same-provider re-select nothing is being
   * switched away from and this is simply the other provider. Phase 3 renders it
   * in the confirmation dialog; recomputing it screen-side is what puts a
   * provider decision back into `src/app`, where nothing can test it.
   */
  outgoing: AiProvider;
  /**
   * True only when the outgoing provider has a key worth losing. An
   * unconditional dialog trains the user to dismiss it, at which point the one
   * that matters gets dismissed too.
   */
  needsConfirmation: boolean;
}

/**
 * Switching provider CLEARS the other provider's key. Only one key is ever
 * stored, which is what keeps ProviderConfig's "Only one key is set per
 * install" docstring true.
 *
 * The cleared value is '' and not undefined: `setSettings` persists via
 * JSON.stringify, which DROPS undefined keys, so an undefined clear leaves no
 * evidence in the blob and "cleared" becomes indistinguishable from "never
 * set". '' is also already this codebase's spelling of "no key" — every
 * predicate reads `(x ?? '').trim().length > 0`.
 *
 * NOTE the contrast with `aiChatStore.buildSettingsPatch`, which deliberately
 * OMITS undefined fields for the opposite reason. Two patch builders, opposite
 * rules. Copying that one here produces a switch that clears nothing.
 */
export function providerSwitchPlan(
  settings: ProviderKeySettings,
  next: AiProvider,
): ProviderSwitchPlan {
  const current = initialProviderSelection(settings);
  const outgoing = next === 'anthropic' ? 'openai' : 'anthropic';

  if (next === current) {
    // Re-selecting the active provider destroys nothing.
    return {patch: {aiProvider: next}, outgoing, needsConfirmation: false};
  }

  return {
    patch: {
      aiProvider: next,
      [KEY_FIELD[outgoing]]: '',
      // Model ids are provider-specific; a stale one would be sent to the wrong
      // API. Cleared here from this phase on, before anything reads it.
      aiModel: undefined,
    },
    outgoing,
    needsConfirmation: hasKey(settings, outgoing),
  };
}

/**
 * THE intended single boundary where a raw input value becomes a stored key.
 *
 * Phase 3 must remove the untrimmed `queueSave({anthropicKey: value})` from
 * `src/app/(tabs)/settings/ai.tsx:147` to complete this boundary.
 *
 * `factory.ts:76,116` trims again at the wire; both layers stay, matching the
 * codebase's existing double-normalisation habit. But the factory's trim is
 * also why an untrimmed store is invisible to every wire-level assertion — this
 * function is the only place the trim is observable.
 *
 * Trim the PATCH only. The screen's useState value stays raw, or the cursor
 * jumps while typing.
 */
export function apiKeyPatch(
  provider: AiProvider,
  raw: string,
): Partial<BridgeSettings> {
  return {[KEY_FIELD[provider]]: raw.trim()};
}

const ANTHROPIC_MARKER = 'sk-ant-';

/**
 * A non-blocking hint, never a save gate.
 *
 * Blocking would be worse than the paste it prevents: every AI failure in this
 * app is swallowed, so a false positive produces four dead features and no
 * error anywhere, on a `secureTextEntry` field the user cannot inspect.
 *
 * The rule is one-directional on purpose. `sk-ant-` is an unmistakable
 * Anthropic marker. OpenAI has no counterpart — it ships `sk-`, `sk-proj-`,
 * `sk-svcacct-` and more, and `sk-` is itself a prefix of `sk-ant-`. So an
 * OpenAI key under an Anthropic selection is NOT flagged; there is no rule for
 * it that does not also fire on legitimate keys.
 */
export function crossProviderKeyWarning(provider: AiProvider, raw: string): string | null {
  const key = raw.trim();
  if (key.length === 0) return null;
  if (provider === 'openai' && key.startsWith(ANTHROPIC_MARKER)) {
    return 'That looks like an Anthropic key. Switch the provider above, or paste an OpenAI key.';
  }
  return null;
}
