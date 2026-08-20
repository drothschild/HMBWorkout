// pattern: Functional Core
import type { RoutineDraft, SettingsProposal } from '@/ai/draftSchema';

/**
 * Decides whether navigating away from the AI Coach screen should be
 * intercepted with a confirmation, so `src/app/ai-coach.tsx` only needs to
 * execute the result. Kept pure and out of the screen because `src/app`
 * carries zero jest coverage (see jest.config.js testMatch) — the decision
 * logic needs to live somewhere jest can actually reach it.
 *
 * Reads the exact same "pending" signal the DraftCard / settings-proposal UI
 * already reads off `aiChatStore` — `pendingDraft` and
 * `pendingSettingsProposal` — rather than inventing a second notion of
 * "unsaved". Both go back to `null` the moment the user accepts, approves, or
 * declines (see `acceptDraft`, `approveSettingsProposal`,
 * `declineSettingsProposal` in aiChatStore.ts), and `reset()` clears both when
 * a fresh conversation starts, so this stays in lockstep with the card that
 * prompted the warning in the first place.
 *
 * Must be a no-op — no dialog, no delay — when nothing is pending; that is
 * the discriminating case a caller must not get wrong, since the guard runs
 * on every navigation away from the screen, not just the ones that matter.
 */
export function shouldWarnBeforeLeaving(
  pendingDraft: RoutineDraft | null,
  pendingSettingsProposal: SettingsProposal | null
): boolean {
  return pendingDraft !== null || pendingSettingsProposal !== null;
}
