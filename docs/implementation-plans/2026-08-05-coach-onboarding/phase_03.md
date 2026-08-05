# Coach Onboarding Implementation Plan — Phase 3: Onboarding mode and persona

**Goal:** Add a fourth `AiCoachMode` variant for onboarding, write the interview persona into `personaSection()` and `buildSystem()`, extend route-param mapping to recognize the `onboarding` parameter, and create a pure module for onboarding constants.

**Architecture:** Add `{ kind: 'onboarding' }` to `AiCoachMode` union, branch `personaSection()` on mode to emit interview-specific guidance, add an About-the-User section to `buildSystem()` before immutable directives, extend `aiCoachModeFromParams()` to recognize `?onboarding=1`, and create `src/state/coachOnboarding.ts` for the opening message and predicate.

**Tech Stack:** TypeScript, Jest (node project, ts-jest).

**Scope:** Phase 3 of 7 from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-onboarding.AC3: The interview prompt
- **coach-onboarding.AC3.1 Success:** Onboarding system prompt instructs batching, age/gender placement, verbatim refusal recording, grounding values in user text
- **coach-onboarding.AC3.2 Success:** Onboarding prompt instructs closing by offering to draft a first routine
- **coach-onboarding.AC3.3 Success:** Approval sentence absent in onboarding, present in create/edit/debrief
- **coach-onboarding.AC3.4 Success:** Already-recorded profile values appear in prompt
- **coach-onboarding.AC3.5 Success:** `/ai-coach?onboarding=1` maps to onboarding mode; `?onboarding=1&routineId=X` still yields onboarding
- **coach-onboarding.AC3.6 Failure:** No other param combo yields onboarding unless param present

### coach-onboarding.AC6: Profile reaches all four AI surfaces
- **coach-onboarding.AC6.1 Success:** `buildSystem` renders profile before immutable directives

---

<!-- START_TASK_1 -->
### Task 1: Add onboarding variant to AiCoachMode and extend personaSection

**Verifies:** coach-onboarding.AC3.1, coach-onboarding.AC3.2, coach-onboarding.AC3.3

**Files:**
- Modify: `src/ai/contextBuilder.ts` (AiCoachMode union + personaSection function)
- Test: `src/ai/contextBuilder.test.ts` (extend persona text pinning tests)

**Implementation:**

Add `onboarding` variant to `AiCoachMode` type (after `DebriefMode`):

```typescript
export type AiCoachMode = 
  | { kind: 'create' } 
  | { kind: 'edit'; routineId: string } 
  | DebriefMode 
  | { kind: 'onboarding' };
```

Extend `personaSection()` to branch on `mode.kind`:

```typescript
export function personaSection(mode: AiCoachMode): string {
  const basePersona = `You are a supportive strength-training coach...`; // existing text

  if (mode.kind === 'onboarding') {
    return basePersona + `

You are interviewing a new user to build their profile. Ask their goals, equipment, personality, name, age, and experience in natural batches—not one question per turn. Age and gender are sensitive; ask them last. If the user declines to answer, record their refusal verbatim (e.g. "prefer not to say") and do not re-ask it in later turns.

Every field you record must be grounded in something the user actually said. Do not infer or guess.

At the end of the interview, offer to draft a first routine based on what you've learned about them.`;
  }

  if (mode.kind === 'debrief') {
    return basePersona + `

You are debriefing a workout the user just finished...`; // existing debrief text
  }

  // create and edit modes: no special persona additions
  return basePersona;
}
```

Update personaSection tests in `contextBuilder.test.ts` to pin the onboarding-mode sentences as exact strings, ensuring future changes to bounds are reflected in prose:

```typescript
test('onboarding mode: persona includes interview instructions', () => {
  const onboarding = personaSection({ kind: 'onboarding' });
  expect(onboarding).toContain('You are interviewing a new user to build their profile');
  expect(onboarding).toContain('Age and gender are sensitive; ask them last');
  expect(onboarding).toContain('Every field you record must be grounded in something the user actually said');
});

test('onboarding mode: does not request approval', () => {
  const onboarding = personaSection({ kind: 'onboarding' });
  // The text about user approval should NOT be in onboarding
  // (this is the "do not approve settings" directive, pinned elsewhere)
  expect(onboarding).not.toContain('for your approval');
});

test('create mode: still requests approval', () => {
  const create = personaSection({ kind: 'create' });
  // Verify approval text IS present in create mode (pinned to catch regressions)
  expect(create).toContain('for your approval'); // exact text from current persona
});
```

**Verification:**

Run: `npx jest src/ai/contextBuilder.test.ts --testNamePattern="onboarding"`
Expected: Tests pass.

**Commit:**

```bash
git add src/ai/contextBuilder.ts src/ai/contextBuilder.test.ts
git commit -m "feat(context): add onboarding mode with interview persona

Add onboarding variant to AiCoachMode. Extend personaSection() to emit
interview-specific guidance: batch questions, ask sensitive fields last,
record refusals verbatim, ground answers in user text, close with routine
offer. Pin persona sentences as exact strings to catch future drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add About-the-User section to buildSystem

**Verifies:** coach-onboarding.AC3.4, coach-onboarding.AC6.1

**Files:**
- Modify: `src/ai/contextBuilder.ts` (buildSystem function, add new section)
- Test: `src/ai/contextBuilder.test.ts` (assert section exists and placement)

**Implementation:**

After the `personalitySection()` call in `buildSystem()`, add a new section function call:

```typescript
sections.push(personalitySection());
sections.push(aboutTheUserSection());  // NEW

// Build routine details... (existing code at line 89)
```

Create the new `aboutTheUserSection()` function:

```typescript
function aboutTheUserSection(): string {
  const settings = getSettings();
  
  // All four fields might be empty; section is conditional but always calls this
  const parts: string[] = [];
  if (settings.profileName) parts.push(`Name: ${neutralizeForPrompt(settings.profileName)}`);
  if (settings.profileAge) parts.push(`Age: ${neutralizeForPrompt(settings.profileAge)}`);
  if (settings.profileGender) parts.push(`Gender: ${neutralizeForPrompt(settings.profileGender)}`);
  if (settings.profileExperience) parts.push(`Experience: ${neutralizeForPrompt(settings.profileExperience)}`);

  if (parts.length === 0) {
    return ''; // Section is omitted if no profile fields set
  }

  return `## About the User\n\n${parts.join('\n')}`;
}
```

(Reuse the existing `neutralizeForPrompt` from the coachDirectives module to strip leading `#` characters.)

Update the comment explaining placement to note that About-the-User sits before immutable directives:

```typescript
  // Placement (immutable half): deliberately last, after every section built
  // from user-controlled free text — aiGoals/aiEquipment/aiPersonality and
  // profileName/profileAge/profileGender/profileExperience above, and routine
  // notes/exercise titles woven in. [... existing justification ...]
```

**Testing:**

Add tests in `contextBuilder.test.ts`:

```typescript
test('buildSystem: includes About-the-User section when profile is present', async () => {
  // Mock getSettings to return some profile values
  const system = await buildSystem(db, { kind: 'create' });
  if (profileName is set) expect(system).toContain('## About the User');
  if (profileName is set) expect(system).toContain('Name:');
});

test('buildSystem: omits About-the-User section when profile is empty', async () => {
  // Mock getSettings to return empty profile
  const system = await buildSystem(db, { kind: 'create' });
  expect(system).not.toContain('## About the User');
});

test('buildSystem: About-the-User section sits before immutable directives', async () => {
  // Index positions: About-the-User must come after personality but before immutable
  const system = await buildSystem(db, { kind: 'create' });
  const aboutIdx = system.indexOf('## About the User');
  const immutableIdx = system.indexOf('## Coach Directives (Non-Negotiable)');
  if (aboutIdx !== -1) {
    expect(aboutIdx).toBeLessThan(immutableIdx);
  }
});
```

**Verification:**

Run: `npx jest src/ai/contextBuilder.test.ts`
Expected: All tests pass.

**Commit:**

```bash
git add src/ai/contextBuilder.ts src/ai/contextBuilder.test.ts
git commit -m "feat(context): add About-the-User section to system prompt

Add aboutTheUserSection() that renders profile fields (name, age, gender,
experience) before immutable directives. Reuses neutralizeForPrompt to
strip leading # characters. Section is omitted if all profile fields
are empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Extend route-param mapping to recognize onboarding

**Verifies:** coach-onboarding.AC3.5, coach-onboarding.AC3.6

**Files:**
- Modify: `src/state/postWorkoutDebrief.ts` (aiCoachModeFromParams function)
- Test: `src/state/postWorkoutDebrief.ts` — add tests for new param

**Implementation:**

Extend `AiCoachRouteParams` interface to include optional onboarding flag:

```typescript
export interface AiCoachRouteParams {
  routineId?: string;
  debriefSessionId?: string;
  onboarding?: '1' | true;  // accepts both '1' (string from URL) and true (programmatic)
}
```

Update `aiCoachModeFromParams()` to check onboarding FIRST, before routineId branches:

```typescript
export function aiCoachModeFromParams(params: AiCoachRouteParams): AiCoachMode {
  // Onboarding takes priority over routineId branches
  if (params.onboarding === '1' || params.onboarding === true) {
    return { kind: 'onboarding' };
  }

  const routineId = params.routineId;

  if (!routineId) {
    return { kind: 'create' };
  }

  if (params.debriefSessionId) {
    return { kind: 'debrief', routineId, sessionId: params.debriefSessionId };
  }

  return { kind: 'edit', routineId };
}
```

**Testing:**

Write tests in a test block at the end of the file:

```typescript
describe('aiCoachModeFromParams', () => {
  test('onboarding param yields onboarding mode (string "1")', () => {
    const mode = aiCoachModeFromParams({ onboarding: '1' });
    expect(mode).toEqual({ kind: 'onboarding' });
  });

  test('onboarding param yields onboarding mode (boolean true)', () => {
    const mode = aiCoachModeFromParams({ onboarding: true });
    expect(mode).toEqual({ kind: 'onboarding' });
  });

  test('onboarding param takes priority over routineId (edit)', () => {
    const mode = aiCoachModeFromParams({ onboarding: '1', routineId: 'routine-123' });
    expect(mode).toEqual({ kind: 'onboarding' });
  });

  test('onboarding param takes priority over debrief params', () => {
    const mode = aiCoachModeFromParams({
      onboarding: '1',
      routineId: 'routine-123',
      debriefSessionId: 'session-456',
    });
    expect(mode).toEqual({ kind: 'onboarding' });
  });

  test('no onboarding param yields create mode', () => {
    const mode = aiCoachModeFromParams({});
    expect(mode).toEqual({ kind: 'create' });
  });

  test('routineId alone yields edit mode (existing behavior)', () => {
    const mode = aiCoachModeFromParams({ routineId: 'routine-123' });
    expect(mode).toEqual({ kind: 'edit', routineId: 'routine-123' });
  });
});
```

**Verification:**

Run: `npx jest src/state/postWorkoutDebrief.ts`
Expected: All tests pass (existing + new).

**Commit:**

```bash
git add src/state/postWorkoutDebrief.ts
git commit -m "feat(routing): add onboarding param to aiCoachModeFromParams

Extend AiCoachRouteParams to include onboarding flag (accepts '1' from
URL or true programmatically). Onboarding param takes priority over
routineId branches, so ?onboarding=1&routineId=X still yields onboarding
mode. Existing create/edit/debrief mappings unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create coachOnboarding.ts pure module

**Verifies:** coach-onboarding.AC4.6 (partially; the full AC6 requires store integration in Phase 4)

**Files:**
- Create: `src/state/coachOnboarding.ts`
- Test: `src/state/coachOnboarding.test.ts`

**Implementation:**

Create a new pure module alongside `postWorkoutDebrief.ts` to hold onboarding-specific constants and predicates:

```typescript
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
export const ONBOARDING_OPENING_MESSAGE =
  'I want to tell you about myself so you can coach me better.';

/**
 * True when the Today tab should invite the user into the opening conversation.
 * Requires both onboarding to be unseen AND a key to be present.
 *
 * The key check must match what aiChatStore.startTurn enforces, or the card can
 * open a conversation that immediately fails with missing_key.
 */
export function shouldShowOnboardingCard(settings: BridgeSettings): boolean {
  const hasKey = settings.anthropicKey && settings.anthropicKey.trim().length > 0;
  return hasKey && settings.onboardingState === 'unseen';
}
```

**Testing:**

Write tests in `src/state/coachOnboarding.test.ts`:

```typescript
test('shouldShowOnboardingCard: true when onboardingState is unseen and key present', () => {
  const settings = { onboardingState: 'unseen', anthropicKey: 'sk-ant-test' };
  expect(shouldShowOnboardingCard(settings)).toBe(true);
});

test('shouldShowOnboardingCard: false when onboardingState is dismissed', () => {
  const settings = { onboardingState: 'dismissed', anthropicKey: 'sk-ant-test' };
  expect(shouldShowOnboardingCard(settings)).toBe(false);
});

test('shouldShowOnboardingCard: false when onboardingState is completed', () => {
  const settings = { onboardingState: 'completed', anthropicKey: 'sk-ant-test' };
  expect(shouldShowOnboardingCard(settings)).toBe(false);
});

test('shouldShowOnboardingCard: false when no key', () => {
  const settings = { onboardingState: 'unseen', anthropicKey: '' };
  expect(shouldShowOnboardingCard(settings)).toBe(false);
});

test('shouldShowOnboardingCard: false when key is null or undefined', () => {
  expect(shouldShowOnboardingCard({ onboardingState: 'unseen', anthropicKey: undefined })).toBe(false);
  expect(shouldShowOnboardingCard({ onboardingState: 'unseen', anthropicKey: null })).toBe(false);
});

test('ONBOARDING_OPENING_MESSAGE is a non-empty string', () => {
  expect(typeof ONBOARDING_OPENING_MESSAGE).toBe('string');
  expect(ONBOARDING_OPENING_MESSAGE.length).toBeGreaterThan(0);
});
```

**Verification:**

Run: `npx jest src/state/coachOnboarding.test.ts`
Expected: All tests pass.

**Commit:**

```bash
git add src/state/coachOnboarding.ts src/state/coachOnboarding.test.ts
git commit -m "feat(onboarding): create pure module with constants and predicates

Create coachOnboarding.ts alongside postWorkoutDebrief.ts for opening
conversation constants and decision functions. Export ONBOARDING_OPENING_MESSAGE
and shouldShowOnboardingCard(). Both are pure and testable in node jest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_4 -->
