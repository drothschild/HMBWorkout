/**
 * The handoff from launching onboarding to the chat store: constants
 * and decision functions for the opening conversation.
 *
 * Pure decisions only — the navigation is in debriefNavigation.ts style,
 * and the conversation itself belongs to aiChatStore.
 */

import type { BridgeSettings } from '@/state/settings';

/**
 * The user's opening turn. The Messages API needs a user message before the
 * coach can speak, and this is a true statement of what the user wants;
 * the persona is what makes the coach answer it by running the interview.
 *
 * Sent as hidden: true so it reaches the wire but is not rendered in the UI.
 */
export const ONBOARDING_OPENING_MESSAGE = 'I want to tell you about myself so you can coach me better.';

/**
 * True when the Today tab should invite the user into the opening conversation.
 * Requires both onboarding to be unseen AND a key to be present.
 *
 * The key check must match what aiChatStore.startTurn enforces, or the card can
 * open a conversation that immediately fails with missing_key.
 */
export function shouldShowOnboardingCard(settings: BridgeSettings): boolean {
  const hasKey = !!(settings.anthropicKey && settings.anthropicKey.trim().length > 0);
  return hasKey && settings.onboardingState === 'unseen';
}
