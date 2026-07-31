# AI Coach — Test Requirements

**Scope:** All acceptance criteria from `docs/design-plans/2026-07-29-ai-coach.md` (ai-coach.AC1.1 through ai-coach.AC5.4), mapped to automated tests or documented human verification.

**Source of truth:** the six phase plans in this directory. Where a phase file's "Acceptance Criteria Coverage" or "Cross-phase notes" section splits a criterion into a logic half and a UI half, that split is reproduced here verbatim in intent — an AC listed in both tables below is a *split* criterion, not a duplicate.

**Codebase verified:** 2026-07-29 (against worktree `.worktrees/ai-coach`).

---

## Testing constraints (why some criteria cannot be automated)

Per `AGENTS.md` and `jest.config.js`, this repo runs a **single `node` Jest project** with no React Native runtime. `testMatch` covers `src/{engine,db,interop,state,sync,health,helpers}/**/*.test.ts` — extended to include `ai` by Phase 2, Task 1 — and **deliberately excludes `src/app/`**. The commented-out `rn` project is intentional future work; there is no `jest-expo` preset, no `@testing-library/react-native`, and no renderer available.

Consequences:

- Anything that lives in `src/app/` — the chat screen, the settings screen section, the entry-point buttons, route registration, navigation — **cannot** be unit- or integration-tested in this repo. It is verified by the manual simulator run-through in `phase_06.md` Task 3, Step 2, and gated on `npx tsc --noEmit` (Phase 6, Tasks 1-3).
- `npm run lint` is **not runnable** here (ESLint is not installed; `expo lint`'s auto-bootstrap fails with an ERESOLVE conflict and mutates `package.json` before dying). The typecheck substitutes for it.
- Every suite is run individually (`npm test -- <path>`), per the repo's TDD convention — no full-suite runs.

---

## Automated tests

| Criterion | Type | Test file | What the test verifies |
|---|---|---|---|
| **ai-coach.AC1.1** | unit | `src/state/settings.test.ts` | `setSettings({ anthropicKey, aiGoals, aiEquipment })` writes all three into the `'bridge_settings'` JSON blob, and a fresh `resetForTesting()` + `loadSettings()` against that blob rehydrates the same three values. |
| **ai-coach.AC1.2** | unit | `src/state/settings.test.ts` | A legacy blob containing only `baseUrl`/`token` loads without error; `getSettings()` returns `anthropicKey`/`aiGoals`/`aiEquipment` as `''` with bridge fields intact (the `{ ...cache, ...parsed }` merge). |
| **ai-coach.AC1.3** *(bridge-isolation half)* | unit | `src/state/settings.test.ts` | `setSettings({ anthropicKey })` leaves `baseUrl`/`token` unchanged in cache and persisted blob, and conversely `setSettings({ baseUrl })` leaves the AI fields unchanged. |
| **ai-coach.AC1.4** | unit | `src/state/settings.test.ts` | All three new fields default to `''` before any set (including after `resetForTesting()`, whose reset object is extended to five fields), and setting all three explicitly to `''` persists and reloads without error. |
| **ai-coach.AC2.1** *(client + store halves)* | unit | `src/ai/anthropicClient.test.ts` | A realistic Messages API body — a `thinking` block **followed by** a `text` block — resolves to a parsed `AiTurn` (`reply` and `draft.name` asserted), proving the client selects the first `type === 'text'` block rather than `content[0]`. |
| **ai-coach.AC2.1** *(client + store halves)* | unit | `src/state/aiChatStore.test.ts` | Send happy path: `messages` becomes `[user text, assistant turn]` with the assistant entry carrying the parsed `reply` for display; `status === 'idle'`, `error === null`. |
| **ai-coach.AC2.2** | integration | `src/ai/contextBuilder.test.ts` | Against a seeded LokiJS DB plus injected settings: the prompt contains `aiGoals` and `aiEquipment` text, both routine names with every exercise title and its targets/rest, and a history section with the seeded working sets. |
| **ai-coach.AC2.3** *(prompt half)* | integration | `src/ai/contextBuilder.test.ts` | `buildSystem(db, { kind: 'edit', routineId })` against a seeded routine contains the routine name and the instruction to return any draft as a complete revision of that routine — the prompt names the routine by name only; drafts carry no routine id (the conversation mode owns routine identity); an unknown `routineId` falls back to create-mode content without throwing. |
| **ai-coach.AC2.4** | unit | `src/ai/anthropicClient.test.ts` | Request shape from `mockFetch.mock.calls[0]`: URL `https://api.anthropic.com/v1/messages`, `method: 'POST'`, headers `x-api-key` equal to the configured key plus `anthropic-version: '2023-06-01'` and a JSON content-type; body carries `model: 'claude-sonnet-5'`, `max_tokens: 4096`, `thinking` deep-equal `{ type: 'disabled' }`, the `system` string, the `messages` array verbatim, and `output_config.format.schema` deep-equal to `AI_TURN_SCHEMA`. |
| **ai-coach.AC2.5** | unit | `src/state/aiChatStore.test.ts` | After a first turn that returns a draft, a second `send()` calls the client with three wire messages — original user turn, an assistant message whose `content` is the JSON string of the first `AiTurn` (`JSON.parse(content).draft.name` asserted), and the new user turn — while `buildSystem` is called only once per conversation (system cached after the first turn). |
| **ai-coach.AC3.1** *(inertness half)* | integration | `src/ai/acceptDraft.test.ts` | Constructing and running `validateRoutineDraft` on a valid draft performs no writes: the `routines`, `exercises`, and `routine_exercises` collections stay empty until `acceptDraft` is invoked. |
| **ai-coach.AC3.2** *(persistence half)* | integration | `src/ai/acceptDraft.test.ts` | Accepting a draft in create mode (`{ kind: 'create' }`) creates the routine, one exercise per distinct slugified title with the draft's `kind`, and `routine_exercises` rows whose `order` matches array index and whose target fields match the draft; the returned id matches `/^routine-\d+$/` (the `routine-${Date.now()}` id convention — not `crypto.randomUUID()`, which is not guaranteed on Hermes). |
| **ai-coach.AC3.2** *(store half)* | unit | `src/state/aiChatStore.test.ts` | With a pending draft, `acceptDraft()` calls the injected accept fn exactly once as `accept(db, pendingDraft, mode)` with the store's live conversation mode passed unchanged (exercised for both `{ kind: 'create' }` and `{ kind: 'edit', routineId: 'routine-1' }`), returns the routine id, and clears `pendingDraft`. |
| **ai-coach.AC3.3** | integration | `src/ai/acceptDraft.test.ts` | Accepting a draft in edit mode (`{ kind: 'edit', routineId }`) against an existing routine leaves exactly one routine with that id, updates its `name`, replaces its `routine_exercises` with the draft's entries, and returns `mode.routineId`; `mode.routineId` alone selects the target — drafts carry no routine id, and editing one routine leaves a second routine untouched. |
| **ai-coach.AC3.4** *(kind validity)* | unit | `src/ai/draftSchema.test.ts` | `validateRoutineDraft` throws `DraftValidationError` for a `kind` outside `'strength' \| 'cardio' \| 'stretch'` — the repository types `kind` as an unvalidated `string`, so the validator is the enforcement point. |
| **ai-coach.AC3.4** *(slug dedupe)* | integration | `src/ai/acceptDraft.test.ts` | A draft containing `"Bench Press"` twice and `"bench   press"` once creates exactly one exercise with id `'bench-press'` referenced by all three `routine_exercises` rows; a brand-new free-form title creates `'bulgarian-split-squat'` with the draft's `kind`. |
| **ai-coach.AC3.5** *(validation half)* | unit | `src/ai/draftSchema.test.ts` | `validateRoutineDraft` throws `DraftValidationError` for: non-object, missing/empty `name`, missing/empty `exercises`, an exercise missing `title`, a title slugifying to empty (`"!!!"`), an invalid `kind`, and non-numeric `warmupSets`/`targetSets`/`targetReps`/`targetDurationSeconds`/`restSeconds`; accepts minimal and fully-populated drafts. |
| **ai-coach.AC3.5** *(no-partial-writes half)* | integration | `src/ai/acceptDraft.test.ts` | `acceptDraft` with an invalid draft rejects with `DraftValidationError` and leaves `routines`, `exercises`, and `routine_exercises` all empty — validation is the function's first statement, before any upsert. |
| **ai-coach.AC3.6** *(store half)* | unit | `src/state/aiChatStore.test.ts` | Turn 1 returns draft A, turn 2 returns draft B → `pendingDraft` deep-equals B; a subsequent reply-only turn leaves `pendingDraft` untouched (it does not clear an outstanding proposal). |
| **ai-coach.AC4.1** *(store half)* | unit | `src/state/aiChatStore.test.ts` | With `getSettings()` returning `{ anthropicKey: '' }`, `send()` calls neither `buildSystem` nor `chat`, does not append the user message, and sets `status: 'error'` with `error.kind === 'missing_key'`. |
| **ai-coach.AC4.2** *(client half)* | unit | `src/ai/anthropicClient.test.ts` | A `{ ok: false, status: 401 }` response rejects with `AnthropicHttpError` carrying `status === 401`, distinct from `AnthropicUnreachable`. |
| **ai-coach.AC4.2** *(store half)* | unit | `src/state/aiChatStore.test.ts` | A `chat()` rejection of `AnthropicHttpError(401, ...)` maps to `status: 'error'` with `error.kind === 'unauthorized'` (the kind the screen renders as "API key rejected — check Settings"). |
| **ai-coach.AC4.3** *(client half)* | unit | `src/ai/anthropicClient.test.ts` | A rejected `fetch` yields `AnthropicUnreachable`; the wrap covers only the network call, so malformed-body failures are never misreported as unreachable. |
| **ai-coach.AC4.3** *(store + retry half)* | unit | `src/state/aiChatStore.test.ts` | `AnthropicUnreachable` maps to `error.kind === 'network'` with the user message retained; `retry()` re-sends the identical wire messages (exactly one trailing user turn — no duplicate) and on success transitions to `idle` with the assistant message appended. |
| **ai-coach.AC4.4** *(client half)* | unit | `src/ai/anthropicClient.test.ts` | A status-500 response rejects with `AnthropicHttpError` carrying `status === 500`. |
| **ai-coach.AC4.4** *(store half)* | unit | `src/state/aiChatStore.test.ts` | A non-401 `AnthropicHttpError` maps to `error.kind === 'http'` with `status` preserved for the error-bubble copy. |
| **ai-coach.AC4.5** *(parser half)* | unit | `src/ai/draftSchema.test.ts` | `parseAiTurn` throws `DraftValidationError` on non-JSON text and on JSON missing/non-string `reply`; returns a typed `AiTurn` for valid draft-bearing and reply-only payloads. Plus an `AI_TURN_SCHEMA` walk asserting every object node carries `additionalProperties: false` (required by Anthropic structured outputs). |
| **ai-coach.AC4.5** *(client half)* | unit | `src/ai/anthropicClient.test.ts` | Four malformed-body shapes each reject with `DraftValidationError` — **not** `AnthropicUnreachable`: `json()` rejects; `content` has no `text` block (the truncation/refusal shape, which `thinking: { type: 'disabled' }` makes rare rather than routine); the `text` block is not valid JSON; the `text` block's JSON fails `AiTurn` validation. |
| **ai-coach.AC4.5** *(store half)* | unit | `src/state/aiChatStore.test.ts` | `DraftValidationError` from `chat()` maps to `error.kind === 'parse'` and `status: 'error'` — no throw escapes the action. |
| **ai-coach.AC5.1** *(store half)* | unit | `src/state/aiChatStore.test.ts` | After a conversation with messages, a pending draft, and an error, `reset(mode)` restores `{ messages: [], pendingDraft: null, status: 'idle', error: null }` and clears the cached system prompt (the next `send` calls `buildSystem` again). |
| **ai-coach.AC5.2** | integration | `src/ai/contextBuilder.test.ts` | With 7 working sets seeded at explicitly ascending `_raw.created_at` timestamps and reps 11-17, the prompt contains `'17 reps'` through `'13 reps'` and does **not** contain `'11 reps'` or `'12 reps'` — `HISTORY_SETS_PER_EXERCISE = 5`, most-recent-first. |
| **ai-coach.AC5.3** | unit | `src/state/aiChatStore.test.ts` | The injected accept fn is never called by `send`, `retry`, or `reset` in any other test — `acceptDraft()` is the store's only call into a write path; the store holds no direct DB access. |

**Suite run commands** (individually, per repo convention — `phase_06.md` Task 3, Step 1):

```bash
npm test -- src/state/settings.test.ts
npm test -- src/ai/draftSchema.test.ts
npm test -- src/ai/acceptDraft.test.ts
npm test -- src/ai/anthropicClient.test.ts
npm test -- src/ai/contextBuilder.test.ts
npm test -- src/state/aiChatStore.test.ts
npx tsc --noEmit
```

---

## Human verification

All items below are verified in the **manual simulator run-through** of `phase_06.md` Task 3, Step 2 (`npm run ios`, dev client required), except where a different step is named. Each is preceded by `npx tsc --noEmit` exiting 0.

| Criterion | What must be checked by hand | Why it cannot be automated |
|---|---|---|
| **ai-coach.AC1.3** *(masked-input half)* | Run-through item 1: the "AI Coach" section renders on the Settings tab; the key field masks characters while typing (`secureTextEntry`); goals and equipment are multiline; Save persists; bridge URL/token are visibly unchanged. | The input lives in `src/app/(tabs)/settings.tsx`. `secureTextEntry` is a rendered-prop behavior with no node-testable surface, and `src/app/` is outside the node Jest project (`phase_01.md` Task 2 marks it operational verification for exactly this reason). |
| **ai-coach.AC1.1** *(restart half)* | Run-through item 1: kill and relaunch the app; key, goals, and equipment survive; the key field shows masked content. | The storage round-trip is automated in `settings.test.ts` against a fake `StorageBackend`; the real `expo-secure-store` write and the app-restart hydration path (`injectSettingsStorage`/`loadSettings` from the `_layout.tsx` boot effect) require a device runtime. |
| **ai-coach.AC2.1** *(rendering half)* | Run-through item 3: a real reply from `claude-sonnet-5` renders as an assistant bubble; the typing indicator appears while `status === 'sending'`. | Bubble rendering and `FlatList` scroll behavior live in `src/app/ai-coach.tsx`; the parse-and-store half is fully automated. This is also the only check that exercises a live API call end to end. |
| **ai-coach.AC2.3** *(entry-point half)* | Run-through item 4: "Edit with AI Coach" on a routine detail screen opens the chat in edit mode and the returned draft is a revision of that routine. | The `router.push(\`/ai-coach?routineId=${id}\`)` param plumbing and the mount-time `reset({ kind: 'edit', routineId })` are expo-router/screen concerns (`phase_06.md` Tasks 1-2); only the resulting prompt text is automated. |
| **ai-coach.AC3.1** *(card half)* | Run-through item 3: the draft renders as a card with name, notes, exercise rows (kind tag, warmups, sets×reps or duration, rest) and supersets visually grouped; the routine list is unchanged until Accept. | Card layout and superset grouping are rendering logic in `src/app/ai-coach.tsx`. The "database untouched" invariant is automated in `acceptDraft.test.ts`; this confirms it visibly on real data. |
| **ai-coach.AC3.2** *(navigation half)* | Run-through item 3: tapping Accept lands on `/routine/[id]` for the newly created routine, showing the drafted exercises. | `router.push` navigation cannot be exercised without an expo-router runtime; persistence and the returned id are automated. |
| **ai-coach.AC3.6** *(single-card half)* | Run-through item 5: after requesting a modification in the same conversation, exactly one card is shown and it reflects the newest draft; Accept persists that newest draft. | "Only the latest is Accept-able" is enforced by rendering a single card bound to `pendingDraft`; the state-level replacement is automated in `aiChatStore.test.ts`. |
| **ai-coach.AC4.1** *(state-rendering half)* | Run-through item 2: with the key cleared, opening AI Coach shows the "Add your Anthropic API key in Settings" state with a working link to Settings, and no request fires (no error bubble, no network activity). | The missing-key screen state and the Settings link are `src/app/ai-coach.tsx`; the no-request guard is automated in `aiChatStore.test.ts`. Both the screen check and the store guard must hold — they are independent gates. |
| **ai-coach.AC4.2** *(message half)* | Run-through item 6: sending with a deliberately wrong key shows "API key rejected — check Settings" plus a Settings link, with no crash. | The `error.kind === 'unauthorized'` → copy mapping is rendering; the 401 → `AnthropicHttpError` → `'unauthorized'` chain is automated across `anthropicClient.test.ts` and `aiChatStore.test.ts`. |
| **ai-coach.AC4.3** *(bubble + retry UX half)* | Run-through item 6: in airplane mode the inline error bubble appears above the input bar with a Retry control; re-enabling the network and tapping Retry completes the same turn. | The bubble and Retry `Pressable` are screen elements; retry's re-send semantics (same wire messages, no duplicate user turn) are automated. |
| **ai-coach.AC4.4** *(bubble + no-crash half)* | Any non-401 HTTP failure observed during the run-through shows "The AI service returned an error (\<status\>). Try again." and the app stays usable. | Rendering the status-bearing copy is screen logic. Reproducing a specific non-401 status against the live API is opportunistic; the typed-error path is deterministic in `anthropicClient.test.ts` and `aiChatStore.test.ts`. |
| **ai-coach.AC4.5** *(no-crash half)* | Run-through: if an unreadable response occurs, "Got an unreadable response. Try again." renders and the app does not crash. | Malformed-body shapes cannot be induced reliably against the live API; all four are covered deterministically in `anthropicClient.test.ts`. Only the on-screen no-crash outcome is manual. |
| **ai-coach.AC5.1** *(mount-reset half)* | Run-through item 3: navigating away from AI Coach and back yields an empty conversation. | `reset(mode)` firing from the screen's mount `useEffect` requires a React render cycle; the reset action's own semantics are automated. |
| **ai-coach.AC5.4** | Run-through item 7: after accepting drafts, no workout session was started (no session screen, no active-session banner) and sync state is unchanged in Settings until a manual sync. | This is a whole-app isolation property spanning the engine, the active-session store, and the sync queue — none of which the AI slice imports. It holds **by construction** (`phase_06.md` Task 1: the screen calls only `aiChatStore` actions, never `activeSessionStore.dispatch`, sync, or repository functions) and is bounded by the automated `aiChatStore.test.ts` check that accept is the store's only write path (AC5.3). Confirming that no engine event or sync mutation occurred requires observing the running app. |

---

## Coverage ledger

Every criterion resolves to at least one row above. Split criteria appear in both tables by design, per the phases' "Cross-phase notes".

| Criterion | Automated | Human | Owning phases |
|---|---|---|---|
| ai-coach.AC1.1 | yes | yes (restart) | 1, 6 |
| ai-coach.AC1.2 | yes | — | 1 |
| ai-coach.AC1.3 | yes (isolation) | yes (masking) | 1, 6 |
| ai-coach.AC1.4 | yes | — | 1 |
| ai-coach.AC2.1 | yes (parse + store) | yes (rendering) | 3, 5, 6 |
| ai-coach.AC2.2 | yes | — | 4 |
| ai-coach.AC2.3 | yes (prompt) | yes (entry point) | 4, 6 |
| ai-coach.AC2.4 | yes | — | 3 |
| ai-coach.AC2.5 | yes | — | 5 |
| ai-coach.AC3.1 | yes (inertness) | yes (card) | 2, 6 |
| ai-coach.AC3.2 | yes (persist + store) | yes (navigation) | 2, 5, 6 |
| ai-coach.AC3.3 | yes | — | 2 |
| ai-coach.AC3.4 | yes | — | 2 |
| ai-coach.AC3.5 | yes | — | 2 |
| ai-coach.AC3.6 | yes (replacement) | yes (single card) | 5, 6 |
| ai-coach.AC4.1 | yes (no request) | yes (screen state) | 5, 6 |
| ai-coach.AC4.2 | yes (401 → unauthorized) | yes (message copy) | 3, 5, 6 |
| ai-coach.AC4.3 | yes (typed error + retry) | yes (bubble UX) | 3, 5, 6 |
| ai-coach.AC4.4 | yes (typed error + kind) | yes (bubble, no crash) | 3, 5, 6 |
| ai-coach.AC4.5 | yes (parse errors) | yes (no crash) | 2, 3, 5, 6 |
| ai-coach.AC5.1 | yes (reset action) | yes (mount reset) | 5, 6 |
| ai-coach.AC5.2 | yes | — | 4 |
| ai-coach.AC5.3 | yes | — | 5 |
| ai-coach.AC5.4 | partial (via AC5.3) | yes | 5, 6 |

No orphans: 24 criteria, 24 mapped.
