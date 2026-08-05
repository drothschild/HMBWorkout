# Coach Onboarding Implementation Plan — Phase 1: Profile settings and onboarding state

**Goal:** Persist the three profile fields and the onboarding lifecycle flag so they survive app restarts and load correctly from legacy settings blobs.

**Architecture:** Extend the existing `BridgeSettings` interface and `DEFAULT_SETTINGS` in `src/state/settings.ts` with four new fields. The existing merge-on-load pattern already handles backward compatibility.

**Tech Stack:** TypeScript, Jest (node project, ts-jest).

**Scope:** Phase 1 of 7 from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-onboarding.AC1: Profile settings persist
- **coach-onboarding.AC1.1 Success:** The three `profile*` fields and `onboardingState` save and survive an app restart
- **coach-onboarding.AC1.2 Success:** A stored blob written before this feature loads without error; the new fields default to `''` and `onboardingState` to `'unseen'`
- **coach-onboarding.AC1.3 Success:** A refusal is stored as its own text, so `''` still means "never asked" and the two are distinguishable
- **coach-onboarding.AC1.4 Edge:** All three profile fields may be empty; every AI surface behaves normally

---

<!-- START_TASK_1 -->
### Task 1: Extend BridgeSettings interface with profile fields and onboarding state

**Verifies:** coach-onboarding.AC1.1, coach-onboarding.AC1.2, coach-onboarding.AC1.3, coach-onboarding.AC1.4

**Files:**
- Modify: `src/state/settings.ts` (interface + DEFAULT_SETTINGS + resetForTesting)
- Test: `src/state/settings.test.ts` (extend existing suite)

**Implementation:**

Extend the `BridgeSettings` interface to add four new fields after the existing `aiPersonality` field:

```typescript
/** Free text: "41", "early 40s", "prefer not to say". '' = never asked. */
profileAge: string;
/** Free text, including self-described. '' = never asked. */
profileGender: string;
/** Free text: "beginner", "strong squat, terrible overhead". '' = never asked. */
profileExperience: string;
/** Lifecycle of the opening conversation. Defaults to 'unseen'. */
onboardingState: 'unseen' | 'dismissed' | 'completed';
```

Update `DEFAULT_SETTINGS` constant to include all four new fields with their defaults:

```typescript
profileAge: '',
profileGender: '',
profileExperience: '',
onboardingState: 'unseen',
```

Refactor `resetForTesting()` to use `DEFAULT_SETTINGS` instead of a hardcoded reset object:

```typescript
export function resetForTesting(): void {
  cache = { ...DEFAULT_SETTINGS };
  storageBackend = null;
}
```

**Testing:**

Write tests in `src/state/settings.test.ts` following the existing pattern. Tests must verify:

- **AC1.1:** setSettings with all profile fields (age, gender, experience) and onboardingState persists them to JSON blob. A fresh loadSettings() + getSettings() roundtrip returns the same values.
- **AC1.2:** Legacy blob with only bridge/AI fields (no profile fields, no onboardingState) loads without error. New fields default to '' and onboardingState to 'unseen'. Existing fields remain intact.
- **AC1.3:** Setting profileAge to '' is distinguishable from setting it to 'prefer not to say' by value alone (no sentinel).
- **AC1.4:** All profile fields and onboardingState can be empty and store operations work normally.

**Verification:**

Run: `npx jest src/state/settings.test.ts`
Expected: All tests pass (existing + new).

**Commit:**

```bash
git add src/state/settings.ts src/state/settings.test.ts
git commit -m "feat(settings): add profile fields and onboarding state

Add profileName, profileAge, profileGender, profileExperience, and
onboardingState to BridgeSettings. Refactor resetForTesting() to use
DEFAULT_SETTINGS for consistency. Legacy blobs load with new fields
defaulting to empty/unseen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_1 -->
