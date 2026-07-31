# AI Coach Implementation Plan — Phase 3: Anthropic client

**Goal:** The app can exchange a conversation (system prompt + message history) for a guaranteed-parseable `AiTurn`, with typed errors for network, HTTP, and parse failures.

**Architecture:** Hand-rolled `fetch` client mirroring `src/sync/bridgeClient.ts` (factory + injectable `fetchFn` + typed error classes). The official `@anthropic-ai/sdk` does not run on React Native/Hermes, and Hermes fetch streaming is unreliable, so this is a **non-streaming raw-HTTP** POST to the Anthropic Messages API with **structured outputs** (`output_config.format` + the Phase 2 `AI_TURN_SCHEMA`) constraining every assistant turn to parse as `AiTurn`.

**Tech Stack:** TypeScript, `fetch` (global on RN/Hermes and node ≥18), Anthropic Messages API (`claude-sonnet-5`), Jest with fake fetch.

**Scope:** Phase 3 of 6 from `docs/design-plans/2026-07-29-ai-coach.md`.

**Codebase verified:** 2026-07-29 (codebase-investigator against worktree `.worktrees/ai-coach`). External API details verified against the bundled Anthropic API reference (claude-api skill, cached 2026-06).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ai-coach.AC2: Conversation with Claude
- **ai-coach.AC2.1 Success:** Sending a message yields an assistant reply rendered in the chat (via `claude-sonnet-5`, structured output)
- **ai-coach.AC2.4 Success:** Requests carry the settings key in `x-api-key`

### ai-coach.AC4: Error handling
- **ai-coach.AC4.3 Failure:** Network failure → `AnthropicUnreachable`, inline error bubble with Retry; Retry re-sends the same turn
- **ai-coach.AC4.4 Failure:** Non-401 HTTP error → `AnthropicHttpError(status)`, error bubble, no crash
- **ai-coach.AC4.5 Failure:** Malformed/unparseable response body → typed parse error, no crash

**Cross-phase notes:** AC2.1's "rendered in the chat" half and AC4.3's "inline error bubble with Retry" half complete in Phases 5-6. This phase tests: a request produces a parsed `AiTurn` (AC2.1), the `x-api-key` header carries the configured key (AC2.4), and the three typed failure modes (AC4.3/4.4/4.5). The 401 case (AC4.2's foundation) is tested here as `AnthropicHttpError` with `status === 401`.

---

## Verified codebase state and API facts (inputs to this phase)

**Pattern to mirror — `src/sync/bridgeClient.ts`:**
- Factory: `export function createBridgeClient(config: BridgeConfig, fetchFn?: FetchFn)` (line 49); `const fetch = fetchFn ?? globalThis.fetch;` (line 50).
- Errors: `BridgeUnreachable extends Error` (line 6); `BridgeHttpError extends Error` with `constructor(public status: number, message: string)` (line 13). Network rejections are wrapped as `Unreachable`; `!response.ok` throws `HttpError(response.status, await response.text())`.
- Tests (`src/sync/bridgeClient.test.ts`): `let mockFetch: jest.Mock` recreated in `beforeEach`; success via `mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValueOnce(...) })`; HTTP error via `{ ok: false, status: 401, text: jest.fn().mockResolvedValueOnce('Unauthorized') }`; network failure via `mockFetch.mockRejectedValueOnce(new Error('Network error'))`.

**Anthropic Messages API facts (authoritative for this client):**
- Endpoint: `POST https://api.anthropic.com/v1/messages`.
- Required headers: `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- Structured outputs: request field `output_config: { format: { type: 'json_schema', schema: AI_TURN_SCHEMA } }`. Every object node in the schema must have `additionalProperties: false` (Phase 2 schema already complies). The constrained JSON arrives as the **text content block's** `text` string.
- Model: `claude-sonnet-5` (per the design). On this model, **adaptive thinking is on by default when the `thinking` field is omitted**, and `max_tokens` is a hard cap on thinking **plus** response text — at the default `effort: high`, thinking could consume most of a 4096-token budget and truncate the JSON. The request therefore sets **`thinking: { type: 'disabled' }`** explicitly (accepted on Sonnet 5), keeping the full budget for the structured response and keeping latency predictable for a chat UI. The client still selects the first block with `type === 'text'` rather than assuming `content[0]` (defensive against API changes and thinking-bearing responses).
- Non-streaming with `max_tokens: 4096` per the design. If the response hits `stop_reason: 'max_tokens'` or `'refusal'`, the text block may be missing or contain incomplete JSON — both funnel into the typed parse-error path (`DraftValidationError`), which the UI surfaces as a retryable error. With thinking disabled these are rare edge cases, not routine outcomes.
- iOS-only caveat: `api.anthropic.com` rejects browser-origin requests unless the `anthropic-dangerous-direct-browser-access` header is sent. This client targets the iOS app; web builds (`adapter.web.ts`/react-native-web exist in the repo) are out of scope for this feature — do not add the browser-access header.
- Multi-turn: the `messages` array alternates `user`/`assistant` with plain string `content`; assistant turns are the raw JSON strings of prior `AiTurn`s (Phase 5 supplies them). This is regular history, not a trailing-assistant prefill (the array always ends with a `user` turn), so it is compatible with structured outputs.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `anthropicClient.ts` tests (TDD — write first)

**Verifies:** ai-coach.AC2.1, ai-coach.AC2.4, ai-coach.AC4.3, ai-coach.AC4.4, ai-coach.AC4.5 (client halves)

**Files:**
- Test: `src/ai/anthropicClient.test.ts` (unit, fake fetch — mirror `src/sync/bridgeClient.test.ts`)

**Step 1: Write the failing tests**

Using the `mockFetch = jest.fn()` pattern, cover:

- **Success parse (AC2.1):** `mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValueOnce(body) })` where `body` is a realistic Messages API response:
  ```javascript
  {
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify({ reply: 'Here is a plan', draft: { name: 'Push Day', exercises: [{ title: 'Bench Press', kind: 'strength', targetSets: 3, targetReps: 8 }] } }) },
    ],
    stop_reason: 'end_turn',
  }
  ```
  `client.chat({ system, messages })` resolves to the parsed `AiTurn` (assert `reply` and `draft.name`). The `thinking` block before the `text` block is deliberate — asserts the client does not read `content[0]`.
- **Request shape (AC2.4):** after a successful call, inspect `mockFetch.mock.calls[0]`: URL is `https://api.anthropic.com/v1/messages`; `method: 'POST'`; headers include `x-api-key` equal to the configured key, `anthropic-version: '2023-06-01'`, and a JSON content-type; `JSON.parse(body)` has `model: 'claude-sonnet-5'`, `max_tokens: 4096`, `thinking` deep-equal to `{ type: 'disabled' }`, the passed `system` string, the passed `messages` array verbatim, and `output_config.format.schema` deep-equal to `AI_TURN_SCHEMA`.
- **401 (AC4.2 foundation):** `{ ok: false, status: 401, text: jest.fn().mockResolvedValueOnce('Unauthorized') }` → rejects with `AnthropicHttpError`, `error.status === 401`.
- **Non-401 HTTP (AC4.4):** status 500 → `AnthropicHttpError` with `status === 500`.
- **Network failure (AC4.3):** `mockFetch.mockRejectedValueOnce(new Error('Network error'))` → rejects with `AnthropicUnreachable`.
- **Malformed bodies (AC4.5)** — each rejects with `DraftValidationError` (the Phase 2 typed parse error), **not** `AnthropicUnreachable`:
  - `json()` rejects (invalid JSON body);
  - `content` present but with no `text` block (e.g. only a `thinking` block, as a refusal/truncation would produce);
  - `text` block whose `text` is not valid JSON;
  - `text` block whose JSON fails `AiTurn` validation (e.g. missing `reply`).
- **Error-class distinctness:** `AnthropicUnreachable` and `AnthropicHttpError` are distinct classes (mirror `bridgeClient.test.ts:228-237`).

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/ai/anthropicClient.test.ts`
Expected: fails (module does not exist).

**Step 3: Commit the failing tests**

```bash
git add src/ai/anthropicClient.test.ts
git commit -m "test(ai): anthropic client request/response/error tests"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `anthropicClient.ts`

**Verifies:** ai-coach.AC2.1, ai-coach.AC2.4, ai-coach.AC4.3, ai-coach.AC4.4, ai-coach.AC4.5 (client halves)

**Files:**
- Create: `src/ai/anthropicClient.ts`

**Step 1: Implement**

```typescript
import { AI_TURN_SCHEMA, AiTurn, DraftValidationError, parseAiTurn } from './draftSchema';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

type FetchFn = typeof fetch;

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AnthropicUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicUnreachable';
  }
}

export class AnthropicHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'AnthropicHttpError';
  }
}

export function createAnthropicClient(config: { apiKey: string }, fetchFn?: FetchFn) {
  const fetch = fetchFn ?? globalThis.fetch;

  return {
    async chat(request: { system: string; messages: AiChatMessage[] }): Promise<AiTurn> {
      let response: Response;
      try {
        response = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'disabled' },
            system: request.system,
            messages: request.messages,
            output_config: { format: { type: 'json_schema', schema: AI_TURN_SCHEMA } },
          }),
        });
      } catch (error) {
        throw new AnthropicUnreachable(
          error instanceof Error ? error.message : 'Network request failed'
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new AnthropicHttpError(response.status, text);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DraftValidationError('response body is not valid JSON');
      }

      const content = (body as { content?: { type?: string; text?: string }[] }).content;
      const textBlock = Array.isArray(content)
        ? content.find((block) => block?.type === 'text' && typeof block.text === 'string')
        : undefined;
      if (!textBlock?.text) {
        throw new DraftValidationError('response contains no text content block');
      }

      return parseAiTurn(textBlock.text);
    },
  };
}

export type AnthropicClient = ReturnType<typeof createAnthropicClient>;
```

Notes for the implementor:
- The `fetch` failure wrap → `AnthropicUnreachable` covers **only** the network call, mirroring `bridgeClient.ts`'s error split — do not wrap the JSON/parse steps in the same try/catch, or malformed bodies would be misreported as unreachable (the tests distinguish these).
- `AnthropicClient` type export mirrors `BridgeClient = ReturnType<typeof createBridgeClient>` (`bridgeClient.ts:121`).
- The API key is used only in the header — never log it or include it in error messages.

**Step 2: Run tests to verify they pass**

Run: `npm test -- src/ai/anthropicClient.test.ts`
Expected: all pass.

**Step 3: Commit**

```bash
git add src/ai/anthropicClient.ts
git commit -m "feat(ai): hand-rolled anthropic messages client with structured outputs"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
