# AI Coach Implementation Plan — Phase 6: Chat screen and entry points

**Goal:** The user-facing AI Coach experience — chat screen with message list, input bar, draft cards with Accept, error/missing-key states, and entry buttons on the routines tab (create mode) and routine detail screen (edit mode).

**Architecture:** One expo-router screen (`src/app/ai-coach.tsx`) driven entirely by `getAiChatStore()` — the screen holds no business logic and never touches the DB, engine, or sync directly. `reset(mode)` runs on mount so every visit starts a fresh conversation. Navigation and styling follow the verified conventions of `src/app/routine/[id].tsx` and `src/app/(tabs)/settings.tsx`.

**Tech Stack:** TypeScript, React Native (Expo SDK 57), expo-router ~57.0.4, ThemedView/ThemedText, `Spacing`/`MaxContentWidth` from `@/constants/theme`, `react-native-safe-area-context`.

**Scope:** Phase 6 of 6 from `docs/design-plans/2026-07-29-ai-coach.md`.

**Codebase verified:** 2026-07-29 (codebase-investigator against worktree `.worktrees/ai-coach`).

---

## Acceptance Criteria Coverage

This phase implements and operationally verifies (UI screens have no RN-env Jest tests per repo convention — the node Jest project deliberately excludes `src/app/`):

### ai-coach.AC4: Error handling
- **ai-coach.AC4.1 Success:** Missing key → chat shows "add key in Settings" state; no request is sent
- **ai-coach.AC4.2 Success:** 401 response → "API key rejected — check Settings" message
- **ai-coach.AC4.4 Failure:** Non-401 HTTP error → `AnthropicHttpError(status)`, error bubble, no crash (typed-error halves tested in Phases 3 and 5; this phase renders the error bubble)

### ai-coach.AC5: Ephemerality & isolation
- **ai-coach.AC5.4 Success:** Accepting a draft never dispatches engine events or alters sessions/sync state

This phase also completes the UI halves of earlier ACs: AC2.1 (reply rendered in chat), AC3.1 (draft renders as a card), AC3.2 (navigate to routine after Accept), AC3.6 (only latest draft is Accept-able), AC4.3 (error bubble with Retry), AC5.1 (reset on screen mount), and AC1.3's manual check (masked key input renders and saves).

---

## Verified codebase state (inputs to this phase)

- `src/app/_layout.tsx:107-119`: `<Stack screenOptions={{ headerShown: false }}>` registers `(tabs)` and `session` (modal). File-based routes not listed (e.g. `routine/[id]`) work automatically; an explicit `Stack.Screen` entry is added here for `ai-coach` for parity/clarity.
- `src/app/(tabs)/routines.tsx`: navigation via `router.push(\`/routine/${routineId}\`)` (line 43); button pattern is `Pressable` with disabled/pressed style arrays wrapping `ThemedText` (lines 87-99); "Import More Routines" button ends around line 128, above the FlatList (line 142).
- `src/app/routine/[id].tsx`: `const { id } = useLocalSearchParams<{ id: string }>()` (line 16); primary button `Pressable` pattern at lines ~138-149 ("Start from this routine").
- Themed components: `ThemedText` (`@/components/themed-text`, types include `'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | ...`), `ThemedView` (`@/components/themed-view`), `Spacing`/`BottomTabInset`/`MaxContentWidth` from `@/constants/theme`, `SafeAreaView` from `react-native-safe-area-context`. No `KeyboardAvoidingView` precedent in the codebase — the chat screen introduces one (standard RN component; wrap the screen content with `behavior="padding"` on iOS).
- Phase 5: `getAiChatStore()` — zustand hook usable as `store((s) => s.messages)` etc. via the factory's returned hook; actions via `store.getState().send(...)` (or expose the store object and call actions directly, matching how screens consume `activeSessionStore`).
- Settings screen route for the missing-key link: the settings tab lives at `src/app/(tabs)/settings.tsx`; navigate with `router.push('/settings')` — expo-router resolves hrefs through the `(tabs)` group, so `/settings` is the route path.

---

<!-- START_TASK_1 -->
### Task 1: `ai-coach.tsx` chat screen + route registration

**Verifies:** ai-coach.AC4.1, ai-coach.AC4.2 (UI), plus UI halves of AC2.1, AC3.1, AC3.2, AC3.6, AC4.3, AC5.1

**Files:**
- Create: `src/app/ai-coach.tsx`
- Modify: `src/app/_layout.tsx` (add `<Stack.Screen name="ai-coach" />` after the `session` entry, line ~119)

**Step 1: Implement the screen**

Structure (follow `routine/[id].tsx` conventions — `SafeAreaView` root, `ThemedView` sections, `StyleSheet.create` at the bottom, `MaxContentWidth` content cap):

1. **Params & mount reset (AC5.1):**
   ```typescript
   const { routineId } = useLocalSearchParams<{ routineId?: string }>();
   const store = getAiChatStore();
   useEffect(() => {
     store.getState().reset(routineId ? { kind: 'edit', routineId } : { kind: 'create' });
   }, [routineId]);
   ```
   Subscribe to state via the store hook (`const messages = store((s) => s.messages)`, likewise `pendingDraft`, `status`, `error`).
2. **Missing-key state (AC4.1):** if `getSettings().anthropicKey` is empty (check on render), render — instead of the chat UI — a centered message ("Add your Anthropic API key in Settings to use the AI Coach") with a `Pressable` linking to the settings tab (`router.push('/settings')`). The store also guards independently (`error.kind === 'missing_key'` renders the same message), so no request can ever fire without a key.
3. **Message list:** `FlatList` (inverted or with `onContentSizeChange` scroll-to-end) over `messages`; user bubbles right-aligned, assistant bubbles left-aligned rendering `message.turn?.reply ?? message.content`. While `status === 'sending'`, show a typing indicator row (`ActivityIndicator` + "Coach is thinking…").
4. **Draft card (AC3.1, AC3.6):** rendered **once**, below the latest messages, only when `pendingDraft` is non-null — the single card always reflects the newest draft, so only the latest is Accept-able. Contents: draft `name` (subtitle), optional `notes`, one row per exercise — title, kind tag, targets formatted as `warmupSets` warmups + `targetSets x targetReps` (or `targetDurationSeconds` as `Ns`/`Nmin`) + `rest Ns` — and exercises sharing a `supersetGroup` visually grouped under a "Superset" label (group consecutive entries by `supersetGroup`, mirroring how `routine/[id].tsx` displays its superset groups). An "Accept" `Pressable` (primary-button style from `routine/[id].tsx:~138-149`, disabled while accepting or sending) calls:
   ```typescript
   const id = await store.getState().acceptDraft();
   router.push(`/routine/${id}`);
   ```
   (AC3.2's navigation half; AC5.4 holds by construction — the screen calls only store actions, never `activeSessionStore.dispatch`, sync, or repository functions.)
5. **Error bubble (AC4.2, AC4.3, AC4.4):** when `status === 'error'`, render an inline error row above the input bar with a message mapped from `error.kind`:
   - `unauthorized` → `API key rejected — check Settings` (plus a link to Settings)
   - `network` → `Couldn't reach the AI service. Check your connection.`
   - `http` → `The AI service returned an error (<status>). Try again.`
   - `parse` → `Got an unreadable response. Try again.`
   - `missing_key` → the missing-key state from item 2.
   Include a "Retry" `Pressable` (calls `store.getState().retry()`) for every kind except `missing_key`.
6. **Input bar:** `TextInput` (multiline-capable, `styles.input` look borrowed from settings.tsx) + Send `Pressable`, disabled while `status === 'sending'` or when the trimmed text is empty; on send, clear the input and call `store.getState().send(text)`. Wrap list + input in `KeyboardAvoidingView` (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`).
7. **Header:** simple `ThemedText type="title"` — "AI Coach" (create) or "Edit with AI Coach" (edit) — plus a back affordance (`router.back()`), since the Stack hides native headers.

**Step 2: Register the route**

In `src/app/_layout.tsx`, after the `session` screen (line ~119):

```tsx
<Stack.Screen name="ai-coach" options={{ headerShown: false }} />
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: exits 0 with no output. (Do **not** run `npm run lint` — ESLint is not installed and `expo lint`'s auto-bootstrap fails with an ERESOLVE conflict, mutating `package.json` before it dies.)

**Step 4: Commit**

```bash
git add src/app/ai-coach.tsx src/app/_layout.tsx
git commit -m "feat(ai): AI Coach chat screen with draft cards and error states"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Entry points on routines tab and routine detail

**Verifies:** UI halves of ai-coach.AC2.3 (edit mode carries the routineId param)

**Files:**
- Modify: `src/app/(tabs)/routines.tsx` (below the "Import More Routines" button, ~line 128)
- Modify: `src/app/routine/[id].tsx` (after the "Start from this routine" `Pressable`, which spans lines ~138-150 — insert at ~line 151)

**Step 1: Routines tab — create mode**

Add an "AI Coach" `Pressable` styled like the existing import button (lines 87-99 pattern, secondary look is fine):

```tsx
<Pressable style={styles.aiCoachButton} onPress={() => router.push('/ai-coach')}>
  <ThemedText type="default" style={styles.aiCoachButtonText}>AI Coach</ThemedText>
</Pressable>
```

**Step 2: Routine detail — edit mode**

Add an "Edit with AI Coach" `Pressable` after the start button, passing the routine id:

```tsx
<Pressable style={styles.aiEditButton} onPress={() => router.push(`/ai-coach?routineId=${id}`)}>
  <ThemedText type="default" style={styles.aiEditButtonText}>Edit with AI Coach</ThemedText>
</Pressable>
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: exits 0 with no output. (Do **not** run `npm run lint` — ESLint is not installed and `expo lint`'s auto-bootstrap fails with an ERESOLVE conflict, mutating `package.json` before it dies.)

**Step 4: Commit**

```bash
git add "src/app/(tabs)/routines.tsx" "src/app/routine/[id].tsx"
git commit -m "feat(ai): AI Coach entry points on routines tab and routine detail"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full-suite check and manual simulator run-through

**Verifies:** ai-coach.AC4.1, ai-coach.AC4.2, ai-coach.AC5.4 operationally; end-to-end confirmation of AC1-AC5 UI behavior

**Files:** none (verification only)

**Step 1: Automated checks**

Run each new/touched suite individually (repo convention — no full-suite runs):

```bash
npm test -- src/state/settings.test.ts
npm test -- src/ai/draftSchema.test.ts
npm test -- src/ai/acceptDraft.test.ts
npm test -- src/ai/anthropicClient.test.ts
npm test -- src/ai/contextBuilder.test.ts
npm test -- src/state/aiChatStore.test.ts
npx tsc --noEmit
```

Expected: all suites pass; `tsc` exits 0 with no output. (`npm run lint` is not runnable in this repo — ESLint is not installed and `expo lint`'s bootstrap fails; the design's "lint passes" done-criterion is satisfied by the typecheck.)

**Step 2: Manual run-through on the iOS simulator**

Launch with `npm run ios` (dev client required; after any `.lv` edits — none in this feature — Metro would need `npx expo start --clear`, not applicable here). Walk through:

1. **Settings (AC1.1-AC1.4):** open Settings → AI Coach section renders; key input is masked while typing; save key + goals + equipment; kill and relaunch the app; values persist (key field shows masked content); bridge URL/token untouched.
2. **Missing-key state (AC4.1):** temporarily clear the key in Settings → open AI Coach from the routines tab → "add key in Settings" state shows, and no network request fires (no error bubble appears without sending). Restore the key.
3. **Create flow (AC2.1, AC3.1, AC3.2, AC5.1):** routines tab → "AI Coach" → ask for a new routine → reply bubble renders; a draft card renders with exercises/targets/supersets; DB check: routine list unchanged until Accept; tap Accept → lands on the new routine's detail screen showing the drafted exercises. Navigate away and back into AI Coach → conversation is empty (reset).
4. **Edit flow (AC2.3, AC3.3):** open an existing routine → "Edit with AI Coach" → ask for a change (e.g. "add a finisher") → returned draft card shows a revision; Accept → same routine updated in place (same detail screen, changed content).
5. **Draft replacement (AC3.6):** in one conversation request a routine, then ask for a modification → the card shows only the newest draft; Accept persists the newest.
6. **Error/retry (AC4.2, AC4.3):** with airplane mode (or an unreachable network) send a message → network error bubble with Retry; re-enable network, tap Retry → the same turn completes. With a deliberately wrong key, send → "API key rejected — check Settings".
7. **Isolation (AC5.4):** after accepting drafts, confirm no workout session was started (session screen not shown, no active-session banner) and sync state is untouched (Settings sync status unchanged until a manual sync).

**Step 3: Record results**

Note any deviations as issues to fix before review; when clean, the phase is done (no commit — verification only, unless fixes were needed).
<!-- END_TASK_3 -->
