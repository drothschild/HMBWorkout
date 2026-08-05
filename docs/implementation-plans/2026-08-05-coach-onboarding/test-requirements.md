# Test Requirements: Coach Onboarding Feature

This document maps acceptance criteria to automated tests and human verification points. It serves as the single source of truth for what tests must pass before the implementation is complete.

---

## AC1: Profile settings persist

### AC1.1: Four profile fields and onboardingState save and survive app restart

**Automated test:** `src/state/settings.test.ts`
- Test: "profile settings: persist and reload all fields"
- Verifies: setSettings with profileName, profileAge, profileGender, profileExperience, onboardingState persists to JSON blob and reloads intact

**Automated test:** `src/state/settings.test.ts`
- Test: "profile settings: survive app restart"
- Verifies: After resetForTesting() + loadSettings(), persisted values are intact

**Human verification:** Phase 7, Verification 3 (app close/relaunch, check SQLite)

---

### AC1.2: Legacy blob loads without error; new fields default to empty/'unseen'

**Automated test:** `src/state/settings.test.ts`
- Test: "profile settings: legacy blob without profile fields loads with empty defaults"
- Verifies: Old blob (no profileName/profileAge/profileGender/profileExperience/onboardingState) loads without error, new fields default to '' and 'unseen'

---

### AC1.3: Refusal stored as text; '' still means "never asked"

**Automated test:** `src/state/settings.test.ts`
- Test: "profile settings: distinguish empty from declined"
- Verifies: profileName: '' and profileName: 'prefer not to say' persist as different values

---

### AC1.4: All four profile fields may be empty; AI surfaces behave normally

**Automated test:** `src/state/settings.test.ts`
- Test: "profile settings: empty fields cause no errors"
- Verifies: setSettings with all profile fields '' completes without error, getSettings returns them

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "buildSystem with empty profile: no About-the-User section"
- Verifies: If all profile fields are '', About-the-User section is omitted from prompt

---

## AC2: Widened settings-proposal contract

### AC2.1: Proposal carrying only age/gender/experience validates and round-trips

**Automated test:** `src/ai/draftSchema.test.ts`
- Test: "validateSettingsProposal: single new field"
- Verifies for each of age, gender, experience: { [field]: "value" } validates and round-trips

---

### AC2.2: expectStructuredOutputSafe(AI_TURN_SCHEMA) passes with three new properties

**Automated test:** `src/ai/draftSchema.test.ts` (existing test, must still pass)
- Test: "AI_TURN_SCHEMA: structuredOutputSafe"
- Verifies: Schema passes safe-check with all seven settingsProposal properties present

---

### AC2.3: Empty string/whitespace/non-string/length-exceeded fields rejected

**Automated test:** `src/ai/draftSchema.test.ts`
- Test: "validateSettingsProposal: rejects empty string"
- Verifies: { name: '' } throws DraftValidationError

**Automated test:** `src/ai/draftSchema.test.ts`
- Test: "validateSettingsProposal: rejects whitespace"
- Verifies: { name: '   ' } throws DraftValidationError

**Automated test:** `src/ai/draftSchema.test.ts`
- Test: "validateSettingsProposal: rejects non-string"
- Verifies: { name: 123 } throws DraftValidationError

**Automated test:** `src/ai/draftSchema.test.ts`
- Test: "validateSettingsProposal: rejects exceeds max length"
- Verifies: { name: 'x' * (SETTINGS_FIELD_MAX_LENGTH + 1) } throws DraftValidationError

---

### AC2.4: All-undefined proposal rejected as empty; parseAiTurn still drops it

**Automated test:** `src/ai/draftSchema.test.ts`
- Test: "validateSettingsProposal: rejects all undefined"
- Verifies: Proposal with all six fields undefined throws "must include at least one field"

**Automated test:** `src/ai/draftSchema.test.ts` (existing, must still pass)
- Test: "parseAiTurn: drops empty settingsProposal"
- Verifies: Turn with empty settingsProposal is still dropped before validation

---

## AC3: The interview prompt

### AC3.1: Onboarding prompt instructs batching, age/gender last, verbatim refusal, grounding

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "personaSection: onboarding mode includes interview instructions"
- Verifies exact string pinning: "You are interviewing a new user", "Age and gender are sensitive; ask them last", "Every field you record must be grounded"

**Human verification:** Phase 7, Verification 2 (observe coach asking in batches, recording refusals, grounding answers)

---

### AC3.2: Onboarding prompt instructs closing with routine offer

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "personaSection: onboarding mode offers to draft first routine"
- Verifies exact string: "offer to draft a first routine"

**Human verification:** Phase 7, Verification 2 (observe coach offering to draft routine at end of interview)

---

### AC3.3: Approval sentence absent in onboarding, present in create/edit/debrief

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "personaSection: onboarding mode does not request approval"
- Verifies: Onboarding persona does NOT contain "for your approval" or similar approval request

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "personaSection: create/edit/debrief modes request approval"
- Verifies for each mode: persona DOES contain approval request sentence

---

### AC3.4: Already-recorded profile values appear in prompt

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "buildSystem: profile values appear in About-the-User section"
- Verifies: If profileName: 'Alice' is set, buildSystem prompt contains "Name: Alice"

**Human verification:** Phase 7, Verification 2 (second turn, observe coach references previously entered values)

---

### AC3.5: /ai-coach?onboarding=1 maps to onboarding mode; param + routineId yields onboarding

**Automated test:** `src/state/postWorkoutDebrief.test.ts`
- Test: "aiCoachModeFromParams: onboarding param yields onboarding mode"
- Verifies: { onboarding: '1' } → { kind: 'onboarding' }

**Automated test:** `src/state/postWorkoutDebrief.test.ts`
- Test: "aiCoachModeFromParams: onboarding param takes priority over routineId"
- Verifies: { onboarding: '1', routineId: 'X' } → { kind: 'onboarding' }, not edit mode

---

### AC3.6: No other param combo yields onboarding unless param present

**Automated test:** `src/state/postWorkoutDebrief.test.ts`
- Test: "aiCoachModeFromParams: no onboarding param yields create mode"
- Verifies: {} → { kind: 'create' }

**Automated test:** `src/state/postWorkoutDebrief.test.ts`
- Test: "aiCoachModeFromParams: routineId alone yields edit mode (existing behavior unchanged)"
- Verifies: { routineId: 'X' } → { kind: 'edit', routineId: 'X' }

---

### AC3.7: Onboarding prompt does not ask for name; no settings field exists to record it

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "onboarding mode: does not solicit name, no settings field exists for it"
- Verifies: Onboarding persona does not contain language soliciting a name (phrases like "ask for your name", "what is your name"). The test also verifies that profile interview references only "age and gender" when mentioning profile fields, not "name and age" or similar.

**Code inspection:** 
- Verify: `SettingsProposal` interface has no `name` field (AC2)
- Verify: `BridgeSettings` has no `profileName` field (AC1)

---

## AC4: Auto-apply, gated to onboarding

### AC4.1: Onboarding turn with proposal writes settings and nulls pendingSettingsProposal

**Automated test:** `src/state/aiChatStore.test.ts`
- Test: "AC4.1: onboarding mode auto-applies proposal"
- Verifies: After turn with settingsProposal in onboarding mode, approveSettingsProposal was called and pendingSettingsProposal is null

---

### AC4.2: Create-mode turn with proposal leaves pending, writes nothing — observe test failing with condition removed

**Automated test:** `src/state/aiChatStore.test.ts`
- Test: "AC4.2: create mode does NOT auto-apply proposal"
- Verifies: After turn with settingsProposal in create mode, approveSettingsProposal was NOT called and pendingSettingsProposal is set

**CRITICAL MUTATION TEST:** The test must be observed failing when the `mode.kind === 'onboarding'` condition is removed from runTurn. Implementation must not pass unless the guard is present. (Document this in the implementation task: "Run the test, remove the guard, verify test fails, restore the guard.")

---

### AC4.3: Failed proposal is swallowed; conversation continues, turn renders

**Automated test:** `src/state/aiChatStore.test.ts`
- Test: "AC4.3: failed validation is swallowed"
- Verifies: Turn with invalid proposal in onboarding mode: approveSettingsProposal throws, but status becomes 'idle' (not 'error'), turn is rendered, pendingSettingsProposal is null

---

### AC4.4: Each write invalidates cached prompt without advancing generation

**Automated test:** (implicit in approveSettingsProposal implementation)
- Verifies: approveSettingsProposal calls invalidateCachedSystem() (systemEpoch increments, generation does not)

---

### AC4.5: Turn resolving after reset() is discarded and writes nothing

**Automated test:** `src/state/aiChatStore.test.ts` (existing reset guard test, still applies)
- Test: "generation guard: stale turn from reset conversation discarded"
- Verifies: After reset(), a response with gen != current generation is discarded (existing behavior, still holds)

---

### AC4.6: Coach speaks first — openOnboarding sends hidden user turn

**Automated test:** `src/state/aiChatStore.test.ts`
- Test: "openOnboarding: sends hidden opening message"
- Verifies: openOnboarding() results in one message with hidden: true

**Human verification:** Phase 7, Verification 2 (no user message visible before coach's first message)

---

## AC5: Entry and exit

### AC5.1: Card shows only when onboardingState='unseen' and key present; hidden otherwise

**Automated test:** `src/state/coachOnboarding.test.ts`
- Test: "shouldShowOnboardingCard: true for unseen+key"
- Verifies: { onboardingState: 'unseen', anthropicKey: 'sk-...' } → true

**Automated test:** `src/state/coachOnboarding.test.ts`
- Test: "shouldShowOnboardingCard: false for dismissed/completed/no-key"
- Verifies for each case: false

**Human verification:** Phase 7, Verification 1 (card visible when criteria met, hidden otherwise)

---

### AC5.2: Dismissing writes 'dismissed' and card doesn't return

**Automated test:** (integration - dismiss button behavior)
- Not directly testable in jest (UI interaction); verified humanly

**Human verification:** Phase 7, Verification 1 (tap dismiss, card gone, survives restart)

---

### AC5.3: First successful write sets 'completed'; opening without answering doesn't

**Automated test:** (implicit in store integration)
- Verifies: approveSettingsProposal in onboarding → setSettings({ onboardingState: 'completed' })

**Human verification:** Phase 7, Verification 3 (onboardingState: 'completed' after first write)

---

### AC5.4: Card renders alongside resume button, error, loading without replacing

**Human verification only:** Phase 7, Verification 2 (layout inspection: card + resume button coexist)

---

### AC5.5: Settings screen persists all seven fields through autosave; Start/Redo re-enters

**Human verification only:** Phase 7, Verification 3 (all seven fields editable, autosave works, values survive restart)

---

### AC5.6: Opting out mid-conversation lands on settings screen with values intact

**Human verification only:** Phase 7, Verification 4 (opt-out button navigates, values present in form)

---

## AC6: Profile reaches all four AI surfaces

### AC6.1: buildSystem renders profile before immutable directives

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "buildSystem: includes About-the-User section when profile present"
- Verifies: If profileName is set, buildSystem includes "## About the User" section

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "buildSystem: About-the-User sits before immutable directives"
- Verifies: indexOf('About the User') < indexOf('Immutable Directives')

---

### AC6.2: Rest-commentary prompt carries profile before directives

**Automated test:** `src/ai/restCommentaryPrompt.test.ts`
- Test: "buildRestCommentaryPrompt: includes About-the-User when profile present"
- Verifies: If profileName is set, prompt includes "## About the User"

**Automated test:** `src/ai/restCommentaryPrompt.test.ts`
- Test: "buildRestCommentaryPrompt: About-the-User before immutable directives"
- Verifies: indexOf('About the User') < indexOf('Immutable Directives')

---

### AC6.3: Exercise-question prompt carries profile before directives

**Automated test:** `src/ai/exerciseQuestionPrompt.test.ts`
- Test: "buildExerciseQuestionPrompt: includes About-the-User when profile present"
- Verifies: Same as AC6.2

**Automated test:** `src/ai/exerciseQuestionPrompt.test.ts`
- Test: "buildExerciseQuestionPrompt: About-the-User before immutable directives"
- Verifies: Same as AC6.2

---

### AC6.4: Replace-alternates prompt carries profile before directives

**Automated test:** `src/ai/alternatesPrompt.test.ts`
- Test: "buildAlternatesPrompt: includes About-the-User when profile present"
- Verifies: Same as AC6.2

**Automated test:** `src/ai/alternatesPrompt.test.ts`
- Test: "buildAlternatesPrompt: About-the-User before immutable directives"
- Verifies: Same as AC6.2

---

### AC6.5: No surface leaks anthropicKey, openaiKey, token, or baseUrl

**Automated test:** `src/ai/contextBuilder.test.ts` (existing, must still pass)
- Test: "buildSystem: no leaked secrets"
- Verifies: Secrets not in prompt

**Automated test:** `src/ai/restCommentaryPrompt.test.ts` (existing, must still pass)
- Test: "buildRestCommentaryPrompt: no leaked secrets"
- Verifies: Secrets not in prompt

**Automated test:** `src/ai/exerciseQuestionPrompt.test.ts` (existing, must still pass)
- Test: "buildExerciseQuestionPrompt: no leaked secrets"
- Verifies: Secrets not in prompt

**Automated test:** `src/ai/alternatesPrompt.test.ts` (existing, must still pass)
- Test: "buildAlternatesPrompt: no leaked secrets"
- Verifies: Secrets not in prompt

---

### AC6.6: Profile value beginning with # is neutralized on every surface

**Automated test:** `src/ai/contextBuilder.test.ts`
- Test: "buildSystem: neutralizes # in profile values"
- Verifies: If profileName: '### Injection ###', prompt does not contain the raw string

**Automated test:** `src/ai/restCommentaryPrompt.test.ts`
- Test: "buildRestCommentaryPrompt: neutralizes # in profile"
- Verifies: Same

**Automated test:** `src/ai/exerciseQuestionPrompt.test.ts`
- Test: "buildExerciseQuestionPrompt: neutralizes # in profile"
- Verifies: Same

**Automated test:** `src/ai/alternatesPrompt.test.ts`
- Test: "buildAlternatesPrompt: neutralizes # in profile"
- Verifies: Same

---

## AC7: Cross-cutting

### AC7.1: Accepting draft from onboarding mode mints routine, same as create

**Automated test:** `src/ai/acceptDraft.test.ts`
- Test: "acceptDraft in onboarding mode mints new routine ID"
- Verifies: { kind: 'onboarding' } generates routine-<epoch> ID, same shape as create mode

---

### AC7.2: No engine event dispatched; no session/sync state changes

**Implicit:** Onboarding is shell-only (settings + routine persistence). No session dispatch or sync queue integration.

**Verification method:** Code inspection (Phase 1-6 implementations must not touch engine, sync, or session state). Automated tests verify settings and routine writes only.

---

### AC7.3: With no key set, card absent; reached anyway, shows existing missing-key state

**Automated test:** `src/state/coachOnboarding.test.ts`
- Test: "shouldShowOnboardingCard: false when no key"
- Verifies: anthropicKey: '' → false

**Automated test:** `src/state/aiChatStore.test.ts` (existing, must still pass)
- Test: "startTurn: missing key shows missing_key error"
- Verifies: If key is empty, status → error with kind: 'missing_key'

**Human verification:** Phase 7, Verification 2 (if card somehow opens with no key, shows existing missing-key state not crash)

---

## Summary: Automated vs Manual

| Count | Type | Coverage |
|-------|------|----------|
| 35+ | Automated (jest) | Settings persistence, schema validation, routing, store behavior, prompt structure, secret-leak guards |
| 7 | Manual (simulator) | Card visibility/interaction, conversation flow, settings UI, opt-out, layout, long-value handling |

**Automated tests must pass:** `npx jest src/{state,ai}/{settings,draftSchema,contextBuilder,postWorkoutDebrief,coachOnboarding,aiChatStore,acceptDraft}` (all test files related to these modules)

**Manual tests:** Phase 7 simulator run-through with the verification checklist.

**Success criteria:** All automated tests pass + all manual verification checks pass.
