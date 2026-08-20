/**
 * The stored Hevy API key (#267 Phase 3).
 *
 * Sits beside `aiProviderSettings.ts` and follows its rules, because this is
 * the same hazard class: a secret typed into a screen that no jest project can
 * load, so the decisions live here and the screen only calls in.
 *
 * The key rides in the existing `bridge_settings` blob. **That storage key is
 * not renamed** — AGENTS.md is explicit that it holds every user's API keys and
 * onboarding state, and renaming it orphans every existing install. The
 * `BridgeSettings` name is already a misnomer for the same reason.
 */

import type { BridgeSettings } from './settings';

/**
 * THE single boundary where a raw input value becomes the stored Hevy key.
 *
 * Trim the PATCH only, never the screen's `useState` value — trimming what the
 * user is currently typing makes the cursor jump. `hevyClient.ts` trims again
 * at the wire, which is deliberate double-normalisation and also the reason an
 * untrimmed store would be invisible to every wire-level assertion; this
 * function's own test is the only cover for that layer.
 *
 * Clearing writes `''` rather than `undefined`: `setSettings` persists through
 * `JSON.stringify`, which drops `undefined` and would leave no evidence of the
 * clear in the blob.
 */
export function hevyApiKeyPatch(raw: string): Partial<BridgeSettings> {
  return { hevyApiKey: raw.trim() };
}

/** Whether a usable key is stored. Whitespace is not a key. */
export function hasHevyApiKey(settings: Pick<BridgeSettings, 'hevyApiKey'>): boolean {
  return (settings.hevyApiKey ?? '').trim().length > 0;
}
