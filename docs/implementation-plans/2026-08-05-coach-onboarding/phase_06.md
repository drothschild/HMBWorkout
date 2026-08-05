# Coach Onboarding Implementation Plan — Phase 6: Profile in the one-shot surfaces

**Goal:** Thread the four new profile fields through all three one-shot AI surfaces (rest commentary, exercise Question button, Replace alternates) so they coach against the same profile as the main conversation.

**Architecture:** Extract profile data from settings in each one-shot store, pass it to the corresponding prompt builder, and render an About-the-User section (before immutable directives) in each prompt using the same `neutralizeForPrompt` helper.

**Tech Stack:** TypeScript, Jest (node project, ts-jest).

**Scope:** Phase 6 of 7 from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-onboarding.AC6: Profile reaches all four AI surfaces
- **coach-onboarding.AC6.2 Success:** Rest-commentary prompt carries profile, before directives
- **coach-onboarding.AC6.3 Success:** Exercise-question prompt carries profile, before directives
- **coach-onboarding.AC6.4 Success:** Replace-alternates prompt carries profile, before directives
- **coach-onboarding.AC6.5 Failure:** No surface leaks `anthropicKey`, `openaiKey`, `token`, or `baseUrl`
- **coach-onboarding.AC6.6 Edge:** Profile value beginning with `#` is neutralized on every surface

---

<!-- START_TASK_1 -->
### Task 1: Add profile to rest-commentary prompt

**Verifies:** coach-onboarding.AC6.2, coach-onboarding.AC6.5, coach-onboarding.AC6.6

**Files:**
- Modify: `src/state/restCommentaryStore.ts` (pass profile to client)
- Modify: `src/ai/restCommentaryPrompt.ts` (build About-the-User section)
- Test: `src/ai/restCommentaryPrompt.test.ts` (assert section presence and placement)

**Implementation:**

In `restCommentaryStore.ts`, extract profile fields when building the prompt:

```typescript
const settings = deps.getSettings();
const profileFields = {
  profileName: settings.profileName,
  profileAge: settings.profileAge,
  profileGender: settings.profileGender,
  profileExperience: settings.profileExperience,
};

// Pass to the prompt builder
const prompt = buildRestCommentaryPrompt(target, history, profileFields);
```

In `restCommentaryPrompt.ts`, accept profile in the input object and add About-the-User section:

```typescript
function buildRestCommentaryPrompt(
  target: RestCommentaryTarget,
  history: WorkingSetHistory[],
  profile: {
    profileName: string;
    profileAge: string;
    profileGender: string;
    profileExperience: string;
  }
): string {
  const sections: string[] = [];

  sections.push(`## Rest Commentary`);
  sections.push(buildDirectiveIntro());
  
  // ... existing sections (the set, the next exercise, etc.) ...
  
  // Add About-the-User section BEFORE immutable directives
  if (profile.profileName || profile.profileAge || profile.profileGender || profile.profileExperience) {
    const parts: string[] = [];
    if (profile.profileName) parts.push(`Name: ${neutralizeForPrompt(profile.profileName)}`);
    if (profile.profileAge) parts.push(`Age: ${neutralizeForPrompt(profile.profileAge)}`);
    if (profile.profileGender) parts.push(`Gender: ${neutralizeForPrompt(profile.profileGender)}`);
    if (profile.profileExperience) parts.push(`Experience: ${neutralizeForPrompt(profile.profileExperience)}`);

    if (parts.length > 0) {
      sections.push(`## About the User\n\n${parts.join('\n')}`);
    }
  }

  // THEN immutable directives (must be last)
  sections.push(IMMUTABLE_DIRECTIVES);

  return sections.join('\n\n');
}
```

Reuse `neutralizeForPrompt` from coachDirectives or define a local copy per design (AGENTS.md records three copies as accepted debt).

**Testing:**

Write tests in `restCommentaryPrompt.test.ts`:

```typescript
test('buildRestCommentaryPrompt: includes About-the-User when profile present', () => {
  const profile = { profileName: 'Alice', profileAge: '41', profileGender: '', profileExperience: '' };
  const prompt = buildRestCommentaryPrompt(target, [], profile);
  expect(prompt).toContain('## About the User');
  expect(prompt).toContain('Name: Alice');
});

test('buildRestCommentaryPrompt: omits About-the-User when profile empty', () => {
  const profile = { profileName: '', profileAge: '', profileGender: '', profileExperience: '' };
  const prompt = buildRestCommentaryPrompt(target, [], profile);
  expect(prompt).not.toContain('## About the User');
});

test('buildRestCommentaryPrompt: About-the-User before immutable directives', () => {
  const profile = { profileName: 'Alice', profileAge: '', profileGender: '', profileExperience: '' };
  const prompt = buildRestCommentaryPrompt(target, [], profile);
  const aboutIdx = prompt.indexOf('## About the User');
  const immutableIdx = prompt.indexOf('## Coach Directives (Non-Negotiable)');
  if (aboutIdx !== -1) {
    expect(aboutIdx).toBeLessThan(immutableIdx);
  }
});

test('buildRestCommentaryPrompt: neutralizes # in profile values', () => {
  const profile = { profileName: '### Bad Injection ###', profileAge: '', profileGender: '', profileExperience: '' };
  const prompt = buildRestCommentaryPrompt(target, [], profile);
  // Verify # is stripped by checking the rendered output
  expect(prompt).not.toContain('### Bad Injection ###');
});
```

Also verify the existing secret-leak assertion still passes (no anthropicKey, openaiKey, token, baseUrl in prompt).

**Verification:**

Run: `npx jest src/ai/restCommentaryPrompt.test.ts`
Expected: All tests pass.

**Commit:**

```bash
git add src/state/restCommentaryStore.ts src/ai/restCommentaryPrompt.ts src/ai/restCommentaryPrompt.test.ts
git commit -m "feat(rest-commentary): thread profile through rest-commentary prompt

Extract profile fields from settings in restCommentaryStore. Pass to
buildRestCommentaryPrompt. Render About-the-User section before immutable
directives using neutralizeForPrompt. Section omitted if all profile
fields empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add profile to exercise-question prompt

**Verifies:** coach-onboarding.AC6.3, coach-onboarding.AC6.5, coach-onboarding.AC6.6

**Files:**
- Modify: `src/state/exerciseQuestionStore.ts` (pass profile to client)
- Modify: `src/ai/exerciseQuestionPrompt.ts` (build About-the-User section)
- Test: `src/ai/exerciseQuestionPrompt.test.ts` (assert section presence and placement)

**Implementation:**

Mirror the rest-commentary changes:

In `exerciseQuestionStore.ts`:

```typescript
const settings = deps.getSettings();
const profile = {
  profileName: settings.profileName,
  profileAge: settings.profileAge,
  profileGender: settings.profileGender,
  profileExperience: settings.profileExperience,
};

const prompt = buildExerciseQuestionPrompt(exercise, profile);
```

In `exerciseQuestionPrompt.ts`, add About-the-User section before immutable directives using the same pattern as rest-commentary.

**Testing:**

Write analogous tests in `exerciseQuestionPrompt.test.ts` (same assertions about section presence, placement, neutralization, secret-leak).

**Verification:**

Run: `npx jest src/ai/exerciseQuestionPrompt.test.ts`
Expected: All tests pass.

**Commit:**

```bash
git add src/state/exerciseQuestionStore.ts src/ai/exerciseQuestionPrompt.ts src/ai/exerciseQuestionPrompt.test.ts
git commit -m "feat(exercise-question): thread profile through exercise question prompt

Extract profile fields from settings in exerciseQuestionStore. Pass to
buildExerciseQuestionPrompt. Render About-the-User section before immutable
directives using neutralizeForPrompt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add profile to replace-alternates prompt

**Verifies:** coach-onboarding.AC6.4, coach-onboarding.AC6.5, coach-onboarding.AC6.6

**Files:**
- Modify: `src/state/exerciseReplaceStore.ts` (pass profile to client)
- Modify: `src/ai/alternatesPrompt.ts` (build About-the-User section)
- Test: `src/ai/alternatesPrompt.test.ts` (assert section presence and placement)

**Implementation:**

Mirror the rest-commentary and exercise-question changes:

In `exerciseReplaceStore.ts`:

```typescript
const settings = deps.getSettings();
const profile = {
  profileName: settings.profileName,
  profileAge: settings.profileAge,
  profileGender: settings.profileGender,
  profileExperience: settings.profileExperience,
};

const prompt = buildAlternatesPrompt(entry, profile);
```

In `alternatesPrompt.ts`, add About-the-User section before immutable directives.

**Testing:**

Write analogous tests in `alternatesPrompt.test.ts` (same assertions about section presence, placement, neutralization, secret-leak).

**Verification:**

Run: `npx jest src/ai/alternatesPrompt.test.ts`
Expected: All tests pass.

**Commit:**

```bash
git add src/state/exerciseReplaceStore.ts src/ai/alternatesPrompt.ts src/ai/alternatesPrompt.test.ts
git commit -m "feat(alternates): thread profile through replace-alternates prompt

Extract profile fields from settings in exerciseReplaceStore. Pass to
buildAlternatesPrompt. Render About-the-User section before immutable
directives using neutralizeForPrompt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify all four surfaces for secret leaks

**Verifies:** coach-onboarding.AC6.5 (holistic check across all surfaces)

**Files:**
- Test: `src/ai/contextBuilder.test.ts`, `src/ai/restCommentaryPrompt.test.ts`, `src/ai/exerciseQuestionPrompt.test.ts`, `src/ai/alternatesPrompt.test.ts`

**Implementation:**

For each of the four prompt builders (buildSystem, buildRestCommentaryPrompt, buildExerciseQuestionPrompt, buildAlternatesPrompt), verify that secrets are never leaked. This likely already exists for buildSystem and the one-shot surfaces; update each test to include the new About-the-User section rendering:

```typescript
test('buildSystem: no leaked secrets', async () => {
  const settings = getSettings();
  // Populate with fake secrets
  setSettings({
    anthropicKey: 'sk-ant-secret-key',
    openaiKey: 'sk-openai-secret',
    token: 'bridge-token',
    baseUrl: 'http://private-url',
    profileName: 'Alice', // Not a secret
  });

  const prompt = await buildSystem(db, { kind: 'create' });
  
  expect(prompt).not.toContain('sk-ant-secret-key');
  expect(prompt).not.toContain('sk-openai-secret');
  expect(prompt).not.toContain('bridge-token');
  expect(prompt).not.toContain('http://private-url');
  expect(prompt).toContain('Alice'); // Profile IS included, but not secrets
});
```

Run all four test suites and verify secret-leak assertions pass.

**Verification:**

Run: `npx jest src/ai/{contextBuilder,restCommentaryPrompt,exerciseQuestionPrompt,alternatesPrompt}.test.ts`
Expected: All secret-leak tests pass.

**Commit:**

```bash
git add src/ai/contextBuilder.test.ts src/ai/restCommentaryPrompt.test.ts src/ai/exerciseQuestionPrompt.test.ts src/ai/alternatesPrompt.test.ts
git commit -m "test(secrets): verify no leaks in all four AI prompt surfaces

Confirm that anthropicKey, openaiKey, token, and baseUrl are never
included in buildSystem, buildRestCommentaryPrompt, buildExerciseQuestionPrompt,
or buildAlternatesPrompt, even when profile fields are included.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_4 -->
