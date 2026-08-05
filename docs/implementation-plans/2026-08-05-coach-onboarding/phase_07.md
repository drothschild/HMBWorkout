# Coach Onboarding Implementation Plan — Phase 7: Simulator verification

**Goal:** Verify end-to-end behavior that the node jest project cannot see: card visibility and interaction on Today tab, real interview flow writing fields to SQLite and settings, opt-out navigation, and layout stability with long profile values.

**Architecture:** Manual testing via the iOS Simulator. No code changes; Phase 6 is complete. This phase verifies what Phases 1-6 built by running the app and stepping through user journeys.

**Tech Stack:** iOS Simulator, Expo dev client.

**Scope:** Phase 7 of 7 (final verification phase) from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

**Note:** This phase is verification-only. All code implementation happens in Phases 1-6. Phase 7 documents the test plan for manual execution.

---

## Acceptance Criteria Coverage

This phase verifies what cannot be tested in jest:

### coach-onboarding.AC5: Entry and exit (layout + interaction)
- **coach-onboarding.AC5.1:** Card visibility (shows/hides correctly based on state and key)
- **coach-onboarding.AC5.2:** Dismiss action (writes state, card gone on restart)
- **coach-onboarding.AC5.3:** Completion flag (set on first write, not on open-without-answering)
- **coach-onboarding.AC5.4:** Coexistence (card + resume button + error + loading all render together)
- **coach-onboarding.AC5.5:** Settings screen layout and autosave (all seven fields visible and persistent)
- **coach-onboarding.AC5.6:** Opt-out flow (navigate to settings, values intact)

### coach-onboarding.AC4: Auto-apply behavior (store integration)
- **coach-onboarding.AC4.6:** Coach speaks first (opening message sent, hidden in UI)

### coach-onboarding.AC3: Prompt behavior (live interaction)
- **coach-onboarding.AC3.1-AC3.4:** Coach asks in batches, records refusals, grounds in user text, sees current values

---

## Manual Test Plan

**Prerequisites:**
- All code from Phases 1-6 merged and building
- No uncommitted changes
- Simulator booted with dev client installed
- Create test account or use existing dev account
- Network connectivity (to Anthropic API for chat)

---

<!-- START_VERIFICATION_1 -->
### Verification 1: Card visibility and dismissal flow

**Setup:**
1. Fresh app install (or wipe Settings → AI Coach section to clear onboardingState)
2. Set anthropicKey to a valid test key in Settings → AI Coach
3. Confirm onboardingState is 'unseen' in SQLite (or verify visually: card appears)

**Test AC5.1 (card shows only for unseen + key present):**
1. Open Today tab — **expect:** OnboardingCard visible with "Let's Get Started" text
2. Navigate to Settings → AI Coach — **verify:** anthropicKey is set
3. Dismissal: Tap "Dismiss" button on card
4. **Expect:** Card immediately hidden (state updated)
5. Force app close (kill process) and relaunch
6. **Expect:** Card still hidden (onboardingState: 'dismissed' persisted)

**Test AC5.2 (dismissal writes state):**
Query SQLite after dismissal: `SELECT onboardingState FROM bridge_settings`
**Expect:** Value is 'dismissed'

**Test AC5.4 (card coexists with other content):**
1. Wipe onboardingState back to 'unseen'
2. Relaunch app
3. Look at Today tab layout
4. **Expect:** OnboardingCard visible at top, followed by resume button (or error banner, or loading state if workout available)

<!-- END_VERIFICATION_1 -->

<!-- START_VERIFICATION_2 -->
### Verification 2: Onboarding conversation flow

**Setup:**
1. onboardingState is 'unseen'
2. anthropicKey is set
3. All four profile fields empty in settings

**Test AC3.1-AC3.4 (interview interaction):**
1. On Today tab, tap "Start" button on OnboardingCard
2. **Expect:** Navigate to /ai-coach?onboarding=1 screen
3. **Expect:** No user-visible opening message (hidden turn not rendered)
4. **Expect:** Coach's first message appears, asking about goals/equipment/experience/name in batches

**Test AC4.6 (coach speaks first):**
Verify: The chat shows assistant message first (no user message visible before it)

**Test AC3.1 (batching, grounding, refusal handling):**
1. Respond to the coach with natural answers: "I want to get stronger and stay mobile. I have dumbbells."
2. **Expect:** Coach acknowledges, asks next batch (age, gender) near end
3. Respond: "I prefer not to say" to age
4. **Expect:** Coach records exactly "prefer not to say", asks gender next (does NOT re-ask age)
5. Respond: "she/her"
6. **Expect:** Coach records "she/her"
7. **Expect:** Near end, coach offers to draft a first routine

**Test AC3.4 (already-recorded values appear):**
1. Send another message (e.g., "what would you recommend?")
2. **Expect:** Coach's response mentions or references the previously entered profile (goals, equipment, experience)
   - This proves the prompt included the saved profile values

<!-- END_VERIFICATION_2 -->

<!-- START_VERIFICATION_3 -->
### Verification 3: Auto-apply and settings persistence

**Setup:**
From the previous verification, onboarding conversation is partway through with some answers written.

**Test AC4.1 (auto-apply to settings):**
1. Continue conversation until coach confirms a settings proposal (e.g., "I've noted your goals as...")
2. During the conversation flow, check Settings → AI Coach
3. **Expect:** Answers already written (goals, equipment visible as user responses)
4. Navigate back to chat, continue
5. Finish the interview (or quit mid-conversation)

**Test AC5.3 (completion flag set on first write):**
Query SQLite: `SELECT onboardingState FROM bridge_settings`
**Expect:** Value is 'completed' (changed from 'unseen' during conversation)

**Test AC5.5 (settings screen autosave):**
1. Open Settings → AI Coach
2. **Expect:** All seven fields visible:
   - Anthropic Key, Goals, Equipment, Personality (existing)
   - Name, Age, Gender, Experience (new)
3. Edit each field manually (add test values)
4. **Expect:** Changes save automatically (no Save button needed for these fields)
5. Force close and relaunch
6. **Expect:** All values persisted

<!-- END_VERIFICATION_3 -->

<!-- START_VERIFICATION_4 -->
### Verification_4: Opt-out flow

**Setup:**
1. Reset onboardingState back to 'unseen'
2. Clear or reset profile fields to empty
3. Open onboarding again: Today tab "Start" → onboarding conversation

**Test AC5.6 (opt-out mid-conversation):**
1. Participate in conversation until some values are written (e.g., name and goals)
2. Look for "I'll fill this in myself" button (should be visible on ai-coach screen)
3. Tap the button
4. **Expect:** Navigate to Settings → AI Coach screen
5. **Expect:** Already-entered values (name, goals) are still present in the form
6. Manually finish filling the remaining fields if desired
7. Force close and relaunch
8. **Expect:** All values (from conversation + manual) persisted

<!-- END_VERIFICATION_4 -->

<!-- START_VERIFICATION_5 -->
### Verification 5: Layout and UX polish

**Test AC5.4 (card layout doesn't break main content):**
1. onboardingState is 'unseen', key present
2. Open Today tab
3. **Expect:** OnboardingCard + resume button both visible in one screen (if space permits) or card on top, scroll down for resume
4. **Verify:** No overlapping text, buttons are tappable, spacing is consistent with other cards

**Test AC6.6 (long profile values don't break UI):**
1. On Settings → AI Coach, enter a very long name: "My name is this extremely long string that goes on and on and really tests whether the input layout handles long text gracefully without breaking"
2. **Expect:** Text wraps or truncates gracefully, input remains usable
3. Navigate to Today tab → Start onboarding
4. Check that long value doesn't break the system prompt or conversation rendering
5. In conversation, if coach mentions or uses the value, **verify:** it's truncated or wrapped appropriately (not crashing the chat UI)

<!-- END_VERIFICATION_5 -->

---

## Verification Checklist

- [ ] Card visibility: Shows for unseen+key, hidden for dismissed/completed/no-key
- [ ] Card dismissal: Writes 'dismissed', persists across restart
- [ ] Card coexistence: Renders above resume button, error, loading without replacing
- [ ] Coach speaks first: No user message rendered before coach's opening
- [ ] Interview interaction: Coach asks in batches, records refusals verbatim, doesn't re-ask
- [ ] Completion flag: Set to 'completed' on first successful write, not on open-without-answer
- [ ] Auto-apply: Settings visible and updated during conversation (not pending card)
- [ ] Settings screen: All seven fields editable and autosaved
- [ ] Opt-out: "I'll fill this in myself" navigates to settings with values intact
- [ ] Layout: Long profile values don't break UI, no overlapping text

**Pass Criteria:** All checkboxes checked, app behaves as expected.

**Fail Criteria:** Any checkbox unchecked, or UX breaks (crash, overlapping text, untappable buttons, lost values).

---

## Note: No Code Changes

This phase is verification-only. All implementation is in Phases 1-6. If any verification fails:
1. Note the specific failure in a bug report
2. Return to the appropriate phase (1-6) to fix implementation
3. Re-run verification after the fix

Do not attempt fixes during Phase 7 — that's what Phases 1-6 are for.
