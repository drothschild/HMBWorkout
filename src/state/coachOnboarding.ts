/**
 * The handoff from launching onboarding to the chat store: constants
 * and decision functions for the opening conversation.
 *
 * Pure decisions only — the navigation is in debriefNavigation.ts style,
 * and the conversation itself belongs to aiChatStore.
 */

import type { BridgeSettings } from '@/state/settings';
import { hasAiKey } from '@/state/hasAiKey';

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
  return hasAiKey(settings) && settings.onboardingState === 'unseen';
}

/**
 * The route that opens the interview. A constant rather than a literal at each
 * call site because three surfaces navigate here — the Today card, the settings
 * screen's Start/Redo control, and any future entry point — and the param is
 * load-bearing: without `onboarding=1`, `aiCoachModeFromParams` returns create
 * mode and the user gets an ordinary chat instead of the interview, with nothing
 * to indicate anything went wrong (that was issue #189).
 */
export const ONBOARDING_ROUTE = '/ai-coach?onboarding=1';

/**
 * The settings patch written when the user turns the invitation down — from the
 * card's dismiss control, or by opting out mid-conversation into manual entry.
 *
 * Pure and exported so the write is testable: the screens that call it live in
 * `src/app`, which jest does not cover, so inlining `{ onboardingState:
 * 'dismissed' }` at each call site would put the decision permanently out of
 * reach of any suite.
 */
export function dismissOnboardingPatch(): Pick<BridgeSettings, 'onboardingState'> {
  return { onboardingState: 'dismissed' };
}

/**
 * The patch for opting out mid-conversation, which is NOT always a dismissal.
 *
 * If the coach already recorded something this session, `onboardingState` is
 * already `'completed'`, and writing `'dismissed'` over it would walk the
 * lifecycle backwards. Nothing reads `'completed'` today — only `'unseen'` is
 * ever tested — so this is a correctness-of-the-state-machine fix rather than a
 * live bug, but the tri-state is documented as a lifecycle and a future reader
 * of `'completed'` would be misled.
 *
 * Returns an empty patch when there is nothing to change, which `setSettings`
 * spreads harmlessly.
 */
export function optOutPatch(settings: BridgeSettings): Partial<BridgeSettings> {
  if (settings.onboardingState === 'completed') {
    return {};
  }
  return dismissOnboardingPatch();
}
