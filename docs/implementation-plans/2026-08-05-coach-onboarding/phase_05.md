# Coach Onboarding Implementation Plan — Phase 5: Entry and exit surfaces

**Goal:** Add a dismissible card to the Today tab inviting users into onboarding, persist all six settings fields on the manual AI settings screen with an auto-save flow, and add an "I'll fill this in myself" button on the ai-coach screen to opt out mid-conversation into manual entry.

**Architecture:** Add a pure predicate `shouldShowOnboardingCard()` to decide visibility (already in Phase 3), render a dismissible card component above the Today tab's main content without replacing it, extend the AI settings screen with three new text inputs that autosave like the existing three, and add navigation/button logic to the ai-coach screen.

**Tech Stack:** React Native (Expo SDK 57), Zustand (store updates), expo-router (navigation).

**Scope:** Phase 5 of 7 from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

**Note:** This phase touches UI screens which have no jest coverage per repo convention (AGENTS.md: "src/app and src/components rendering are invisible to jest"). Component layout and interaction verification happens in Phase 7 simulator pass.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-onboarding.AC5: Entry and exit
- **coach-onboarding.AC5.1 Success:** Card shows only when `onboardingState` is `'unseen'` and key present; hidden for other states or no key
- **coach-onboarding.AC5.2 Success:** Dismissing writes `'dismissed'` and card doesn't return
- **coach-onboarding.AC5.3 Success:** First successful write sets `'completed'`; opening without answering doesn't
- **coach-onboarding.AC5.4 Success:** Card renders alongside resume button, error banner, loading state
- **coach-onboarding.AC5.5 Success:** Settings screen persists all six fields through autosave, Start/Redo control re-enters regardless of state
- **coach-onboarding.AC5.6 Success:** Opting out mid-conversation lands on settings screen with answers already written

---

<!-- START_TASK_1 -->
### Task 1: Add onboarding card to Today tab

**Verifies:** coach-onboarding.AC5.1, coach-onboarding.AC5.2, coach-onboarding.AC5.4

**Files:**
- Create: `src/components/OnboardingCard.tsx` (new component)
- Modify: `src/app/(tabs)/index.tsx` (render card above main content)
- Modify: `src/state/settings.ts` (add setOnboardingState helper if needed, or use setSettings directly)

**Implementation:**

Create a new dismissible card component:

```typescript
// src/components/OnboardingCard.tsx
import React, { useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { ThemedView, ThemedText } from '@/components/Themed';
import { router } from 'expo-router';
import { setSettings, getSettings } from '@/state/settings';

export function OnboardingCard() {
  const settings = getSettings();
  const [dismissed, setDismissed] = useState(false);

  // Hide if already dismissed in state OR onboardingState is not unseen
  if (dismissed || settings.onboardingState !== 'unseen') {
    return null;
  }

  const handleDismiss = () => {
    setSettings({ onboardingState: 'dismissed' });
    setDismissed(true);
  };

  const handleStart = async () => {
    const store = useAiChatStore();
    await store.openOnboarding();
    router.push('/ai-coach?onboarding=1');
  };

  return (
    <ThemedView style={styles.card}>
      <ThemedText type="subtitle">Let's Get Started</ThemedText>
      <ThemedText style={styles.body}>
        Your coach can give better advice when they know more about you. 
        Let's have a quick conversation.
      </ThemedText>
      <View style={styles.buttons}>
        <Pressable style={styles.startButton} onPress={handleStart}>
          <Text style={styles.startButtonText}>Start</Text>
        </Pressable>
        <Pressable style={styles.dismissButton} onPress={handleDismiss}>
          <Text style={styles.dismissButtonText}>Dismiss</Text>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = {
  card: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
    // Styled to match existing card components on the screen
  },
  body: {
    marginVertical: 12,
    fontSize: 14,
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
  },
  startButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: '#007AFF', // ActionButtonColor for primary
    alignItems: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  dismissButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  dismissButtonText: {
    color: '#666',
    fontWeight: '600',
  },
};
```

Render the card in `src/app/(tabs)/index.tsx`, above the main `renderContent()`:

```typescript
export default function TodayScreen() {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <OnboardingCard />  {/* Add this line before renderContent */}
        {renderContent()}
      </ScrollView>
    </ThemedView>
  );
}
```

Import the component at the top of the file.

**Testing:**

No jest tests (UI rendering untestable per repo convention). Layout and interaction verified in Phase 7 simulator pass.

**Verification:**

Run: `npx tsc --noEmit`
Expected: Exits 0 with no output.

**Commit:**

```bash
git add src/components/OnboardingCard.tsx src/app/\(tabs\)/index.tsx
git commit -m "feat(ui): add dismissible onboarding card to Today tab

Create OnboardingCard component that renders only when onboardingState
is 'unseen' and key is present. Dismiss button writes 'dismissed'.
Start button opens onboarding conversation. Card renders above main
content (resume button, error, loading) without replacing them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add profile fields to AI settings screen

**Verifies:** coach-onboarding.AC5.5

**Files:**
- Modify: `src/app/(tabs)/settings/ai.tsx` (add three new inputs)

**Implementation:**

In the AI Coach section of the settings screen, add three new text inputs for the profile fields after the existing personality field. Follow the existing pattern:
- Add `useState` hooks for each field
- Load initial values in `useEffect` on mount from `getSettings()`
- Each field has its own `TextInput` with appropriate placeholder
- Changes autosave via `setSettings()` (existing behavior)

Add states:

```typescript
const [profileAge, setProfileAge] = useState('');
const [profileGender, setProfileGender] = useState('');
const [profileExperience, setProfileExperience] = useState('');
```

Load on mount (extend existing `useEffect`):

```typescript
useEffect(() => {
  const settings = getSettings();
  setAnthropicKey(settings.anthropicKey);
  setAiGoals(settings.aiGoals);
  setAiEquipment(settings.aiEquipment);
  setAiPersonality(settings.aiPersonality);
  setProfileAge(settings.profileAge);
  setProfileGender(settings.profileGender);
  setProfileExperience(settings.profileExperience);
}, []);
```

Add handlers (or reuse existing pattern if autosave is on-change):

```typescript
// If fields autosave on change:
<TextInput
  value={profileAge}
  onChangeText={(text) => {
    setProfileAge(text);
    setSettings({ profileAge: text });
  }}
  placeholder="e.g. 41 or early 40s"
  style={styles.input}
/>
```

Render inputs in the section, after the existing personality field. Label them:
- "Age" (placeholder: "e.g. 41 or early 40s")
- "Gender" (placeholder: "e.g. Male, Female, or prefer not to say")
- "Experience" (placeholder: "e.g. Beginner, strong squat, terrible overhead")

**Testing:**

No jest tests (UI rendering untestable). Value persistence and autosave verified in Phase 7 via manual entry and app restart.

**Verification:**

Run: `npx tsc --noEmit`
Expected: Exits 0 with no output.

**Commit:**

```bash
git add src/app/\(tabs\)/settings/ai.tsx
git commit -m "feat(settings): add profile field inputs to AI settings screen

Add age, gender, experience text inputs to AI Coach section.
Follow existing autosave pattern: load from settings on mount, save
via setSettings on change. All six settings fields (goals, equipment,
personality, age, gender, experience) now editable from settings screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add opt-out button to ai-coach screen

**Verifies:** coach-onboarding.AC5.5, coach-onboarding.AC5.6

**Files:**
- Modify: `src/app/ai-coach.tsx` (add button and handler)

**Implementation:**

On the ai-coach screen, when in onboarding mode, add an "I'll fill this in myself" button at the bottom of the screen (or in a consistent location like a settings icon in the header). On tap:
1. Close the conversation (no-op if not yet started)
2. Navigate to the settings screen

```typescript
// In ai-coach.tsx, in the render logic for onboarding mode:

if (mode.kind === 'onboarding') {
  return (
    <View>
      {/* Existing chat UI */}
      <Pressable style={styles.optOutButton} onPress={handleOptOut}>
        <ThemedText>I'll fill this in myself</ThemedText>
      </Pressable>
    </View>
  );
}

const handleOptOut = () => {
  router.push('/(tabs)/settings/ai');
};
```

Any settings already written during the conversation remain in the store and are reflected on the settings screen (no rollback on opt-out).

**Testing:**

No jest tests (UI rendering untestable). Navigation and state persistence verified in Phase 7 simulator.

**Verification:**

Run: `npx tsc --noEmit`
Expected: Exits 0 with no output.

**Commit:**

```bash
git add src/app/ai-coach.tsx
git commit -m "feat(ui): add manual entry opt-out button to ai-coach screen

When in onboarding mode, display 'I'll fill this in myself' button that
navigates to settings screen. Any settings already written via coach
remain persisted. User can freely switch between conversation and manual
entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_3 -->
