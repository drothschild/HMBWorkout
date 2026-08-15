/**
 * Whether to show the first-run API key prompt (#168).
 *
 * Until this existed, a brand-new user saw nothing: `shouldShowOnboardingCard`
 * requires a key to ALREADY be present, so the coach interview only invited
 * people who had somehow already configured one. There was no path from a fresh
 * install to a working AI feature that did not go through Settings unprompted.
 */

import type { BridgeSettings } from '@/state/settings';
import { hasAiKey } from '@/state/hasAiKey';

/**
 * True when the app should ask for a provider key before showing the tabs.
 *
 * Deliberately keys on `hasAiKey` alone:
 *
 * - It is the SAME predicate every AI surface gates on, so the prompt cannot
 *   appear for a user whose key already works, or hide from one whose does not.
 *   `hasAiKey` also trims, so a stray space is not mistaken for a key.
 *
 * - It does NOT consult `onboardingState`. Skipping the prompt writes nothing
 *   (the "ask again next launch" decision on #168), and the two states are
 *   independent anyway: a user who dismissed the coach interview but has no key
 *   still needs to be asked for one. Reusing `onboardingState` here would
 *   entangle two unrelated decisions and silently suppress the prompt for anyone
 *   who had ever dismissed the card.
 *
 * Re-showing within a single launch is the caller's concern — the prompt sets no
 * state, so the screen tracks "already answered this launch" locally.
 */
export function shouldShowFirstRunKeyPrompt(settings: BridgeSettings): boolean {
  return !hasAiKey(settings);
}
