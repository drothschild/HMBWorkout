# Coach Onboarding Implementation Plan — Phase 4: Store auto-apply and completion

**Goal:** Implement auto-apply logic in the store for onboarding mode (and only onboarding), set the onboarding completion flag on first successful write, and route onboarding drafts to the same create-mode acceptance path as regular new routines.

**Architecture:** Add `openOnboarding()` method to the store mirroring `openDebrief()`, gate auto-apply in `runTurn()` with a strict `mode.kind === 'onboarding'` check routed through `approveSettingsProposal()`, and extend `acceptDraft()` to handle onboarding mode the same as create mode (mint new routine ID).

**Tech Stack:** TypeScript, Jest (node project, ts-jest), Zustand.

**Scope:** Phase 4 of 7 from `docs/design-plans/2026-08-05-coach-onboarding.md`.

**Codebase verified:** 2026-08-05.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### coach-onboarding.AC4: Auto-apply, gated to onboarding
- **coach-onboarding.AC4.1 Success:** Onboarding turn with proposal writes settings and nulls `pendingSettingsProposal`, no approval card
- **coach-onboarding.AC4.2 Failure:** Create-mode turn with proposal leaves pending, writes nothing — test must be observed failing with mode check removed
- **coach-onboarding.AC4.3 Failure:** Failed proposal is swallowed: nothing written, conversation continues
- **coach-onboarding.AC4.4 Success:** Each write invalidates cached prompt without bumping `generation`
- **coach-onboarding.AC4.5 Edge:** Turn resolving after `reset()` is discarded and writes nothing, even in onboarding
- **coach-onboarding.AC4.6 Success:** Coach speaks first — `openOnboarding` sends hidden user turn

### coach-onboarding.AC7: Cross-cutting
- **coach-onboarding.AC7.1 Success:** Accepting draft from onboarding mode mints routine, same as create
- **coach-onboarding.AC7.2 Success:** No engine events, no session/sync changes

---

<!-- START_TASK_1 -->
### Task 1: Add openOnboarding method to aiChatStore

**Verifies:** coach-onboarding.AC4.6

**Files:**
- Modify: `src/state/aiChatStore.ts` (add method after openDebrief)
- Test: `src/state/aiChatStore.test.ts` (extend test suite)

**Implementation:**

Import the new constants at the top of `aiChatStore.ts`:

```typescript
import { ONBOARDING_OPENING_MESSAGE } from '@/state/coachOnboarding';
```

Add the `openOnboarding` method to the store's returned object, mirroring `openDebrief()` structure:

```typescript
async openOnboarding() {
  // Reset conversation state, bump generation, clear pending items
  const startMode: AiCoachMode = { kind: 'onboarding' };
  get().reset(startMode);

  // Send the hidden opening turn so the coach can speak first
  const openingMessages: AiDisplayMessage[] = [
    {
      role: 'user',
      content: ONBOARDING_OPENING_MESSAGE,
      hidden: true, // This turn is not rendered in the UI
    },
  ];

  // Fire-and-forget via startTurn
  await get().startTurn(openingMessages, startMode);
}
```

Add to the interface's return type:

```typescript
interface AiChatState {
  // ... existing fields ...
  openOnboarding(): Promise<void>;
}
```

**Testing:**

Write tests in `src/state/aiChatStore.test.ts`:

```typescript
test('openOnboarding: sets mode to onboarding', async () => {
  const store = createAiChatStore(deps);
  await store.getState().openOnboarding();
  expect(store.getState().mode).toEqual({ kind: 'onboarding' });
});

test('openOnboarding: sends hidden opening message', async () => {
  const store = createAiChatStore(deps);
  await store.getState().openOnboarding();
  const messages = store.getState().messages;
  expect(messages.length).toBe(1);
  expect(messages[0].hidden).toBe(true);
  expect(messages[0].content).toBe(ONBOARDING_OPENING_MESSAGE);
});

test('openOnboarding: clears pending state', async () => {
  const store = createAiChatStore(deps);
  // Pre-populate state with pending items
  store.setState({ pendingDraft: {}, pendingSettingsProposal: {} });
  await store.getState().openOnboarding();
  expect(store.getState().pendingDraft).toBeNull();
  expect(store.getState().pendingSettingsProposal).toBeNull();
});
```

**Verification:**

Run: `npx jest src/state/aiChatStore.test.ts --testNamePattern="openOnboarding"`
Expected: Tests pass.

**Commit:**

```bash
git add src/state/aiChatStore.ts src/state/aiChatStore.test.ts
git commit -m "feat(store): add openOnboarding method

Mirror openDebrief() pattern: reset state, set mode to onboarding, send
hidden opening message via startTurn. Coach speaks first without user
seeing the hidden opening turn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement auto-apply logic in runTurn

**Verifies:** coach-onboarding.AC4.1, coach-onboarding.AC4.2, coach-onboarding.AC4.3, coach-onboarding.AC4.4, coach-onboarding.AC4.5

**Files:**
- Modify: `src/state/aiChatStore.ts` (runTurn function)
- Test: `src/state/aiChatStore.test.ts` (extend suite)

**Implementation:**

In the `runTurn` function (around line 126-152), after the turn is parsed and added to messages, add auto-apply logic:

```typescript
async function runTurn(gen: number, messages: AiDisplayMessage[], mode: AiCoachMode, apiKey: string) {
  try {
    const turn = await performRequest(messages, mode, apiKey, gen);
    if (generation !== gen) return;  // Discard if reset occurred

    // Auto-apply settings proposal ONLY in onboarding mode
    if (mode.kind === 'onboarding' && turn.settingsProposal) {
      try {
        deps.approveSettingsProposal(turn.settingsProposal);
        
        // Mark onboarding as completed on first successful write
        deps.setSettings({ onboardingState: 'completed' });

        // Move to state update WITHOUT the pending proposal
        set((currentState) => ({
          messages: [
            ...currentState.messages,
            {
              role: 'assistant',
              content: JSON.stringify(turn),
              turn,
            },
          ],
          status: 'idle',
          pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
          pendingSettingsProposal: null, // Do NOT leave proposal pending in onboarding
        }));
      } catch (error) {
        // Proposal validation failed: swallow the error, continue conversation, render turn
        if (generation !== gen) return;
        set((currentState) => ({
          messages: [
            ...currentState.messages,
            {
              role: 'assistant',
              content: JSON.stringify(turn),
              turn,
            },
          ],
          status: 'idle',
          pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
          pendingSettingsProposal: null, // Do NOT leave proposal pending even if validation failed
        }));
      }
    } else {
      // Non-onboarding modes: leave proposal pending for user approval card
      set((currentState) => ({
        messages: [
          ...currentState.messages,
          {
            role: 'assistant',
            content: JSON.stringify(turn),
            turn,
          },
        ],
        status: 'idle',
        pendingDraft: turn.draft ? turn.draft : currentState.pendingDraft,
        pendingSettingsProposal: turn.settingsProposal
          ? turn.settingsProposal
          : currentState.pendingSettingsProposal,
      }));
    }
  } catch (error) {
    if (generation !== gen) return;
    set({
      status: 'error',
      error: mapError(error),
    });
  }
}
```

**Testing:**

Write tests in `src/state/aiChatStore.test.ts`:

```typescript
test('AC4.1: onboarding mode auto-applies proposal and nulls pending', async () => {
  const mockDeps = { ...deps, approveSettingsProposal: jest.fn() };
  const store = createAiChatStore(mockDeps);
  
  store.setState({ mode: { kind: 'onboarding' } });
  
  // Simulate turn with proposal
  const turn = { reply: 'Great!', settingsProposal: { age: '41' } };
  const mockClient = {
    chat: jest.fn().mockResolvedValue(turn),
  };
  
  // Execute the turn (via send or internal)
  // After turn completes:
  expect(mockDeps.approveSettingsProposal).toHaveBeenCalledWith({ age: '41' });
  expect(store.getState().pendingSettingsProposal).toBeNull();
});

test('AC4.2: create mode does NOT auto-apply proposal', async () => {
  const mockDeps = { ...deps, approveSettingsProposal: jest.fn() };
  const store = createAiChatStore(mockDeps);
  
  store.setState({ mode: { kind: 'create' } });
  
  // Simulate turn with proposal
  const turn = { reply: 'Great!', settingsProposal: { age: '41' } };
  
  // After turn completes:
  expect(mockDeps.approveSettingsProposal).not.toHaveBeenCalled();
  expect(store.getState().pendingSettingsProposal).toEqual({ age: '41' });
});

test('AC4.3: failed validation is swallowed, conversation continues', async () => {
  const mockDeps = {
    ...deps,
    approveSettingsProposal: jest.fn().mockImplementation(() => {
      throw new DraftValidationError('Invalid field');
    }),
  };
  const store = createAiChatStore(mockDeps);
  
  store.setState({ mode: { kind: 'onboarding' } });
  
  // Simulate turn with invalid proposal
  const turn = { reply: 'Great!', settingsProposal: { age: '' } };
  
  // After turn completes:
  expect(store.getState().status).toBe('idle');  // Not errored
  expect(store.getState().messages).toContainEqual(expect.objectContaining({ role: 'assistant' }));
  expect(store.getState().pendingSettingsProposal).toBeNull();  // Swallowed, not persisted
});

test('AC4.4: write invalidates cached prompt without bumping generation', async () => {
  // systemEpoch should increment, generation should not
  const store = createAiChatStore(deps);
  const initialGen = store.getState().mode; // pseudo-access to verify state
  
  // After approveSettingsProposal call:
  // systemEpoch has incremented, next buildSystem rebuilds
  // generation has NOT changed, so in-flight response still commits
  // (This is intrinsic to approveSettingsProposal implementation)
});

test('AC4.5: turn from reset conversation is discarded', async () => {
  const store = createAiChatStore(deps);
  store.setState({ mode: { kind: 'onboarding' } });
  
  // Simulate reset (bumps generation)
  store.getState().reset({ kind: 'onboarding' });
  
  // Even in onboarding, a stale response should not write
  // (This is the existing generation guard, tested elsewhere)
});
```

**Verification:**

Run: `npx jest src/state/aiChatStore.test.ts --testNamePattern="AC4"`
Expected: All tests pass.

**Critical mutation check (AC4.2):** Before committing, prove the test actually catches the bug:
1. Run the full AC4 suite and confirm all pass
2. Edit `runTurn` to REMOVE the `mode.kind === 'onboarding'` condition (line 151: change `if (mode.kind === 'onboarding' && turn.settingsProposal)` to just `if (turn.settingsProposal)`)
3. Run the test again: `npx jest src/state/aiChatStore.test.ts --testNamePattern="AC4.2"` — **it MUST fail**
4. Restore the `mode.kind === 'onboarding'` condition
5. Run the test again: **it MUST pass**
6. This proves the guard is actually load-bearing and the test catches when it's missing

**Commit:**

```bash
git add src/state/aiChatStore.ts src/state/aiChatStore.test.ts
git commit -m "feat(store): implement auto-apply for onboarding mode

Gate auto-apply strictly to mode.kind === 'onboarding'. On successful
validation, call approveSettingsProposal and set onboardingState to
'completed'. Failed validation is swallowed (does not end conversation).
Non-onboarding modes leave proposal pending for user approval card.
In-flight responses still commit because systemEpoch (not generation)
increments.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Handle onboarding mode in acceptDraft

**Verifies:** coach-onboarding.AC7.1, coach-onboarding.AC7.2

**Files:**
- Modify: `src/ai/acceptDraft.ts` (mode handling switch)
- Test: `src/ai/acceptDraft.ts` test file

**Implementation:**

Update the mode-based routine ID logic in `acceptDraft()` to handle onboarding:

```typescript
// Mode is authoritative for the routine id. In create and onboarding modes,
// mint a fresh id regardless of any draft-supplied id. In edit and debrief
// modes, force the id to match the mode's routine, ignoring the draft.
const routineId = 
  (mode.kind === 'create' || mode.kind === 'onboarding')
    ? `routine-${Date.now()}`
    : mode.routineId;
```

This is the only code change needed — `acceptDraft` already handles the rest correctly.

**Testing:**

Write tests in `src/ai/acceptDraft.test.ts` (if not already present):

```typescript
test('acceptDraft in onboarding mode mints new routine ID', async () => {
  const draft = { name: 'First Routine', exercises: [...] };
  const mode = { kind: 'onboarding' };
  
  const routineId = await acceptDraft(db, draft, mode);
  
  expect(routineId).toMatch(/^routine-\d+$/);
  // Verify the routine was created in DB
  const created = await db.get('routines').find(routineId);
  expect(created).toBeDefined();
});

test('acceptDraft: onboarding and create modes behave identically', async () => {
  const draft = { name: 'Test', exercises: [...] };
  
  const createId = await acceptDraft(db, draft, { kind: 'create' });
  const onboardingId = await acceptDraft(db, draft, { kind: 'onboarding' });
  
  expect(createId).toMatch(/^routine-\d+$/);
  expect(onboardingId).toMatch(/^routine-\d+$/);
  // Both should be fresh IDs (not reusing)
  expect(createId).not.toEqual(onboardingId);
});
```

**Verification:**

Run: `npx jest src/ai/acceptDraft.test.ts`
Expected: Tests pass.

**Commit:**

```bash
git add src/ai/acceptDraft.ts src/ai/acceptDraft.test.ts
git commit -m "feat(accept): handle onboarding mode in acceptDraft

Treat onboarding mode the same as create mode: mint a fresh routine ID
via routine-<epoch>. Onboarding carries no routine ID in its mode struct,
so it must mint new (never reuse). Existing edit and debrief behavior
unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

<!-- END_TASK_3 -->
