# AI Coach Implementation Plan — Phase 5: Chat store

**Goal:** An ephemeral Zustand store drives the whole chat flow — send/receive turns, hold the single pending draft, expose typed error states with retry, delegate Accept to `acceptDraft` — fully testable with injected fakes and no UI.

**Architecture:** Factory + lazy-singleton Zustand store (`src/state/aiChatStore.ts`), mirroring `createActiveSessionStore`/`getActiveSessionStore` (`src/state/activeSession.ts:45, 269-274`). All effectful collaborators (client factory, system builder, accept function, settings reader) are injectable through the factory for node-Jest testability; the singleton wires the real implementations. State is in-memory only — `reset(mode)` on screen mount makes each visit start fresh (no persistence, no DB tables).

**Tech Stack:** TypeScript, Zustand 5 (`create` from `'zustand'`), Jest with injected fakes.

**Scope:** Phase 5 of 6 from `docs/design-plans/2026-07-29-ai-coach.md`.

**Codebase verified:** 2026-07-29 (codebase-investigator against worktree `.worktrees/ai-coach`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ai-coach.AC2: Conversation with Claude
- **ai-coach.AC2.5 Success:** Multi-turn conversations resend full history, including prior assistant drafts

### ai-coach.AC3: Draft + Accept persistence
- **ai-coach.AC3.2 Success:** Accepting a new-routine draft persists it via repository and navigates to the routine
- **ai-coach.AC3.6 Edge:** A newer draft replaces the pending one; only the latest is Accept-able

### ai-coach.AC4: Error handling
- **ai-coach.AC4.1 Success:** Missing key → chat shows "add key in Settings" state; no request is sent
- **ai-coach.AC4.2 Success:** 401 response → "API key rejected — check Settings" message
- **ai-coach.AC4.3 Failure:** Network failure → `AnthropicUnreachable`, inline error bubble with Retry; Retry re-sends the same turn

### ai-coach.AC5: Ephemerality & isolation
- **ai-coach.AC5.1 Success:** Opening the chat screen resets conversation state
- **ai-coach.AC5.3 Success:** The chat flow performs no DB writes except through Accept

**Cross-phase notes:** AC3.2's "navigates" half, AC4.1/AC4.2's on-screen rendering, and AC4.3's error-bubble UI complete in Phase 6. This phase tests the store halves: no-request-without-key (AC4.1), 401 → `unauthorized` error kind (AC4.2), retry re-sends the same turn (AC4.3), full-history resend (AC2.5), draft replacement (AC3.6), accept-returns-id (AC3.2), reset (AC5.1), and accept-is-the-only-write-path (AC5.3).

---

## Verified codebase state (inputs to this phase)

- Store pattern — `src/state/activeSession.ts`: factory `createActiveSessionStore(database, overrideExecutors?, syncFn?, healthKitDeps?)` (line 45); lazy singleton `let globalStore = null; export function getActiveSessionStore() { if (!globalStore) globalStore = createActiveSessionStore(getDatabase()); return globalStore; }` (lines 269-274). Tests create a fresh store per test with injected fakes and drive it via `store.getState().<action>(...)` (`src/state/activeSession.test.ts:96-100`).
- Phase 2: `acceptDraft(db, draft): Promise<string>`, `RoutineDraft`, `DraftValidationError` from `src/ai/acceptDraft.ts` / `src/ai/draftSchema.ts`.
- Phase 3: `createAnthropicClient({ apiKey }, fetchFn?)` with `chat({ system, messages }): Promise<AiTurn>`; `AiChatMessage { role: 'user' | 'assistant'; content: string }`; `AnthropicUnreachable`; `AnthropicHttpError` (public `status`).
- Phase 4: `buildSystem(db, mode): Promise<string>`, `AiCoachMode`.
- Phase 1: `getSettings().anthropicKey`.
- `getDatabase()` is **not importable** — `activeSession.ts` defines it privately at lines 9-18, deliberately deferring `require('@/db')` until first use ("Defer import until needed to avoid loading database singleton at module load time"), memoized in a module-level `let database: Database | null`. A top-level `import { database } from '@/db'` in `aiChatStore.ts` would instantiate the SQLite adapter at module load and break the node Jest project. Replicate the same private lazy-`require` helper in `aiChatStore.ts` (Task 2 includes it verbatim).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `aiChatStore` tests (TDD — write first)

**Verifies:** ai-coach.AC2.5, ai-coach.AC3.2, ai-coach.AC3.6, ai-coach.AC4.1, ai-coach.AC4.2, ai-coach.AC4.3, ai-coach.AC5.1, ai-coach.AC5.3 (store halves)

**Files:**
- Test: `src/state/aiChatStore.test.ts` (unit, injected fakes — no DB needed; `db` can be a dummy object because every DB-touching collaborator is faked)

**Step 1: Write the failing tests**

Build a `makeStore` helper that calls `createAiChatStore` with controllable fakes:

```typescript
const fakeChat = jest.fn();                       // resolves AiTurn
const fakeBuildSystem = jest.fn().mockResolvedValue('SYSTEM');
const fakeAccept = jest.fn().mockResolvedValue('routine-id-1');
const fakeGetSettings = jest.fn().mockReturnValue({ anthropicKey: 'sk-test' });
const store = createAiChatStore({
  db: {} as never,
  createClient: jest.fn().mockReturnValue({ chat: fakeChat }),
  buildSystem: fakeBuildSystem,
  accept: fakeAccept,
  getSettings: fakeGetSettings,
});
store.getState().reset({ kind: 'create' });
```

Cover:

- **Send happy path:** `fakeChat` resolves `{ reply: 'hi there' }`. After `await store.getState().send('hello')`: `messages` is `[user 'hello', assistant turn]` with the assistant entry carrying the parsed `reply` for display; `status === 'idle'`; `error === null`; `fakeBuildSystem` was called once with the mode passed to `reset`; `fakeChat` received `{ system: 'SYSTEM', messages: [{ role: 'user', content: 'hello' }] }`.
- **AC2.5 — full history incl. prior drafts:** first turn returns a draft; second `send('tweak it')` calls `fakeChat` with **three** wire messages: the first user message, an assistant message whose `content` is the JSON string of the first `AiTurn` (assert `JSON.parse(content).draft.name` equals the draft's name), and the new user message. `fakeBuildSystem` is still called only once per conversation (system cached after first turn).
- **AC3.6 — newer draft replaces pending:** turn 1 returns draft A, turn 2 returns draft B → `pendingDraft` deep-equals B, not A. A turn with no draft leaves the existing `pendingDraft` in place (reply-only answers don't clear a proposal).
- **AC4.1 — missing key:** `fakeGetSettings` returns `{ anthropicKey: '' }` → `await send('hi')` does **not** call `fakeChat` (or `fakeBuildSystem`), and sets `status: 'error'` with `error.kind === 'missing_key'`; the user message is not appended.
- **AC4.2 — 401:** `fakeChat` rejects `new AnthropicHttpError(401, 'Unauthorized')` → `status: 'error'`, `error.kind === 'unauthorized'`.
- **Error kinds:** `AnthropicUnreachable` → `error.kind === 'network'`; `AnthropicHttpError(500, ...)` → `'http'` with `status` preserved; `DraftValidationError` → `'parse'`.
- **AC4.3 — retry re-sends the same turn:** after a network failure of `send('hello')`, `retry()` calls `fakeChat` again with the **same** wire messages (exactly one trailing user message `'hello'` — no duplicate), and on success transitions to `idle` with the assistant message appended.
- **AC5.1 — reset:** after a conversation with messages, a pending draft, and an error, `reset({ kind: 'create' })` restores the initial state (`messages: []`, `pendingDraft: null`, `status: 'idle'`, `error: null`) and clears the cached system prompt (next `send` calls `fakeBuildSystem` again).
- **AC3.2 / AC5.3 — accept:** with a pending draft, `await store.getState().acceptDraft()` calls `fakeAccept(db, pendingDraft)` exactly once, returns `'routine-id-1'`, and clears `pendingDraft`. Across every other test, `fakeAccept` was never called — accept is the only write path the store touches.
- **Concurrency guard:** `send` while `status === 'sending'` is a no-op (does not fire a second request).

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/state/aiChatStore.test.ts`
Expected: fails (module does not exist).

**Step 3: Commit the failing tests**

```bash
git add src/state/aiChatStore.test.ts
git commit -m "test(state): ai chat store behavior tests"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `aiChatStore.ts`

**Verifies:** ai-coach.AC2.5, ai-coach.AC3.2, ai-coach.AC3.6, ai-coach.AC4.1, ai-coach.AC4.2, ai-coach.AC4.3, ai-coach.AC5.1, ai-coach.AC5.3 (store halves)

**Files:**
- Create: `src/state/aiChatStore.ts`

**Step 1: Implement**

Shapes and contract (generate the body following `activeSession.ts` idioms — `create<State>()((set, get) => ({ ... }))`):

```typescript
import { create } from 'zustand';
import { Database } from '@nozbe/watermelondb';
import { AiTurn, RoutineDraft, DraftValidationError } from '@/ai/draftSchema';
import { acceptDraft as acceptDraftFn } from '@/ai/acceptDraft';
import { AnthropicHttpError, AnthropicUnreachable, createAnthropicClient, AiChatMessage } from '@/ai/anthropicClient';
import { buildSystem as buildSystemFn, AiCoachMode } from '@/ai/contextBuilder';
import { getSettings } from '@/state/settings';

export interface AiDisplayMessage {
  role: 'user' | 'assistant';
  content: string;      // wire content: user text, or raw AiTurn JSON for assistant turns
  turn?: AiTurn;        // parsed turn for rendering (assistant only)
}

export type AiChatError =
  | { kind: 'missing_key' }
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'parse' };

interface AiChatState {
  mode: AiCoachMode;
  messages: AiDisplayMessage[];
  pendingDraft: RoutineDraft | null;
  status: 'idle' | 'sending' | 'error';
  error: AiChatError | null;
  reset(mode: AiCoachMode): void;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  acceptDraft(): Promise<string>;
}

export interface AiChatDeps {
  db: Database;
  createClient: typeof createAnthropicClient;
  buildSystem: typeof buildSystemFn;
  accept: typeof acceptDraftFn;
  getSettings: typeof getSettings;
}

export function createAiChatStore(deps: AiChatDeps) { /* zustand create(...) */ }
```

Behavior requirements:

- **`reset(mode)`** — replaces the entire state with `{ mode, messages: [], pendingDraft: null, status: 'idle', error: null }` and clears the internal cached system prompt (hold it in a factory-scoped `let cachedSystem: string | null`).
- **`send(text)`** —
  1. No-op if `status === 'sending'`.
  2. If `deps.getSettings().anthropicKey` is empty: set `{ status: 'error', error: { kind: 'missing_key' } }` and return without appending the message or touching the network.
  3. Append `{ role: 'user', content: text }`, set `status: 'sending'`, `error: null`.
  4. Build `cachedSystem` via `deps.buildSystem(deps.db, mode)` if not yet built (first turn only).
  5. Create the client per call — `deps.createClient({ apiKey })` — so a key changed in Settings takes effect immediately, and call `chat({ system, messages: wireMessages })`, where `wireMessages` maps state messages to `{ role, content }` only.
  6. On success: append `{ role: 'assistant', content: JSON.stringify(turn), turn }`; if `turn.draft` is present, replace `pendingDraft` with it (leave it untouched otherwise); set `status: 'idle'`.
  7. On failure: map the error — `AnthropicHttpError` with `status === 401` → `{ kind: 'unauthorized' }`, other `AnthropicHttpError` → `{ kind: 'http', status }`, `AnthropicUnreachable` → `{ kind: 'network' }`, `DraftValidationError` → `{ kind: 'parse' }` — and set `status: 'error'`. **Keep the appended user message** so `retry()` can re-send it.
- **`retry()`** — only meaningful when `status === 'error'` and the last message is a user turn: re-runs the request path (steps 4-7 of `send`) **without** appending a new user message.
- **`acceptDraft()`** — throws if `pendingDraft` is null; otherwise `const id = await deps.accept(deps.db, pendingDraft)`, clears `pendingDraft`, returns `id`. This is the store's **only** call into any write path — no engine dispatch, no sync, no direct DB access anywhere else (AC5.3/AC5.4).
- Serialization note: the assistant wire `content` is `JSON.stringify(turn)` — byte-identical semantics to the schema-constrained text the API returned, so resending it preserves prior drafts in history (AC2.5).

Lazy singleton at the bottom of the file, mirroring `activeSession.ts:269-274` — including its private, deferred `getDatabase` helper, copied verbatim from `activeSession.ts:9-18` (do **not** add a top-level `import` of `@/db`, which would load the SQLite adapter at module-import time and break the node Jest project):

```typescript
// Defer import until needed to avoid loading database singleton at module load time
let database: Database | null = null;

function getDatabase(): Database {
  if (!database) {
    const mod = require('@/db');
    database = mod.database as Database;
  }
  return database as Database;
}

let globalStore: ReturnType<typeof createAiChatStore> | null = null;

export function getAiChatStore() {
  if (!globalStore) {
    globalStore = createAiChatStore({
      db: getDatabase(),
      createClient: createAnthropicClient,
      buildSystem: buildSystemFn,
      accept: acceptDraftFn,
      getSettings,
    });
  }
  return globalStore;
}
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- src/state/aiChatStore.test.ts`
Expected: all pass.

**Step 3: Commit**

```bash
git add src/state/aiChatStore.ts
git commit -m "feat(state): ephemeral ai chat store with retry and draft accept"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
