# Phase 5: Model resolution and plumbing

**Design:** `docs/design-plans/2026-08-12-multi-provider-settings.md`
**Covers:** AC5.1 – AC5.11
**Gates:** AC7.1 (`tsc`), AC7.2 (`npm test`), AC7.3 (`lint` 0 errors)

---

## Context

`BridgeSettings.aiModel` is an `AiModelConfig` — `{ chat: string; oneShot: string }` — added two
phases ago and **read by nothing**. `src/ai/provider/factory.ts:57-68` carries an explicit comment
saying so, and a pinning test in `factory.test.ts` asserts the accepted-but-ignored behaviour. #122
exists partly to end that: *"Deferring it again would leave a third phase's worth of
declared-but-unwired field."*

This phase wires it **end to end with no UI**, so the whole mechanism is covered before the
untestable half arrives in Phase 6.

**All three layers are required. Any two of them is a no-op.**

| Layer | Where | Why it is not optional |
|---|---|---|
| 1 | eight client factories accept `model` | otherwise the id has nowhere to go |
| 2 | `factory.ts` resolves and passes it | otherwise the clients keep their constants |
| 3 | **four stores forward `settings.aiModel`** | otherwise the field never reaches the factory |

Layer 3 is the one that gets skipped, because layers 1 and 2 look like the whole job and their tests
pass. The four stores currently build `{ anthropicKey, openaiKey, aiProvider }` and stop
(`aiChatStore.ts:137-139`, `restCommentaryStore.ts:200-202`, `exerciseQuestionStore.ts:168-170`,
`exerciseReplaceStore.ts:245-247`).

---

## Investigation findings (done for you)

1. **The eight hardcoded model constants:**

   | File | Const | Surface |
   |---|---|---|
   | `src/ai/anthropicClient.ts:5` | `claude-sonnet-5` | chat **and** rest commentary (one const, two factories) |
   | `src/ai/alternatesClient.ts:28` | `claude-sonnet-5` | suggest |
   | `src/ai/exerciseQuestionClient.ts:23` | `claude-sonnet-5` | ask |
   | `src/ai/openaiClient.ts:6` | `gpt-5.6-sol` | chat **and** rest commentary |
   | `src/ai/openaiAlternatesClient.ts:29` | `gpt-5.6-sol` | suggest |
   | `src/ai/openaiExerciseQuestionClient.ts:18` | `gpt-5.6-sol` | ask |

   ⚠ `anthropicClient.ts` and `openaiClient.ts` each export **two** factories sharing one `MODEL`
   constant — `createAnthropicClient` (chat) and `createRestCommentaryClient` (comment). Those two get
   **different** models (`chat` vs `oneShot`), so each factory needs its own parameter; you cannot
   thread one module-level variable.

2. **`getTokenBudget`** (`src/ai/provider/requestBuilder.ts:34-48`) is keyed on **surface alone**,
   is **not exported**, and must not change. Budgets: chat 4096, alternates 1024, exerciseQuestion
   512, restCommentary 256.

3. **The fixed request contract, which is the real coupling.** `buildOpenAiBody` sends
   `reasoning: { effort: 'none' }` **unconditionally** (`requestBuilder.ts:161`), the Anthropic
   clients send `thinking: { type: 'disabled' }` unconditionally, and
   `anthropicClient.createRestCommentaryClient` additionally sends `output_config: { effort: 'low' }`
   (`anthropicClient.ts:141`). These are fixed, not negotiated per model. A model that rejects
   `reasoning` 400s the request; a reasoning-only model whose minimum effort exceeds `none` burns the
   256-token rest-commentary budget on reasoning tokens and returns `status: 'incomplete'` with **zero
   text and a bill** — the failure `requestBuilder.ts:145-161` documents at length, and one that ships
   silently because that surface swallows everything.
   **Consequence: the model list may only contain ids this fixed contract is known-good for.**
   Populating and probing the list is **Phase 6 Task 1**, not this phase.

4. **The pinning test** in `factory.test.ts` asserts the ignored-`aiModel` behaviour. It must be
   **replaced** by real assertions, not deleted silently — #128 round 1 flagged exactly that pattern
   (a test renamed to match a regression).

5. **`AiModelConfig`'s docstring** (`src/ai/provider/types.ts:13-17`) says the interface is *"reserved
   for Phase 3 when per-surface model selection is implemented"*. Stale phase label (#128 `M10`);
   correct it here.

---

## Tasks

### Task 1 — `src/ai/provider/models.ts` (new)

```ts
/**
 * Which model each surface uses, per provider.
 *
 * The list is CONSTRAINED, never free text. Every AI failure in this app is
 * swallowed, so a typo'd model id produces four silently dead features and no
 * error anywhere — indistinguishable from a broken app.
 *
 * Membership is governed by a hard rule: every client sends a FIXED request
 * contract — `reasoning: { effort: 'none' }` on OpenAI, `thinking: { type:
 * 'disabled' }` on Anthropic, `output_config: { effort: 'low' }` on Anthropic
 * rest commentary — against FIXED per-surface budgets (4096/1024/512/256). A
 * model that rejects those, or whose minimum reasoning effort exceeds 'none',
 * either 400s or returns `status: 'incomplete'` with no text and a bill.
 *
 * So an id may only be added here after one live call PER SURFACE that returns
 * rendered text. This is not a config edit. See the design doc and AGENTS.md.
 */

import type { AiModelConfig, AiProvider } from './types';

export const DEFAULT_MODELS: Record<AiProvider, AiModelConfig> = {
  anthropic: { chat: 'claude-sonnet-5', oneShot: 'claude-sonnet-5' },
  openai: { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' },
};

/**
 * Populated in Phase 6 Task 1 from a live `GET /v1/models` plus a per-surface
 * probe. Seeded with the two ids already in the tree so the floor is a working
 * default rather than an invented id.
 */
export const AI_MODEL_CHOICES: Record<AiProvider, readonly string[]> = {
  anthropic: ['claude-sonnet-5'],
  openai: ['gpt-5.6-sol'],
};

/**
 * Resolve the per-surface models for a provider.
 *
 * An id that is not on the selected provider's current list is IGNORED and that
 * FIELD falls back to the default — per field, not per object.
 *
 * The setting is NOT rewritten. A model pulled from the list in one release and
 * restored in a later one restores the user's choice, with no migration and no
 * silent settings mutation.
 *
 * The reachable stale value is a CROSS-PROVIDER id: what a blob written before
 * the clear-on-switch rule, or a hand-edited one, carries — and exactly what
 * would 400.
 */
export function resolveModels(
  provider: AiProvider,
  configured: AiModelConfig | undefined,
  choices: Record<AiProvider, readonly string[]> = AI_MODEL_CHOICES,
): AiModelConfig {
  const defaults = DEFAULT_MODELS[provider];
  const allowed = choices[provider];
  const pick = (id: string | undefined, fallback: string) =>
    id && allowed.includes(id) ? id : fallback;

  return {
    chat: pick(configured?.chat, defaults.chat),
    oneShot: pick(configured?.oneShot, defaults.oneShot),
  };
}
```

⚠ `resolveModels` is pure and takes no settings module import. It never writes.

**Covers:** AC5.1 – AC5.6

---

### Task 2 — `src/ai/provider/models.test.ts` (new)

```ts
it('returns today\'s hardcoded ids when nothing is configured', () => {
  expect(resolveModels('anthropic', undefined))
    .toEqual({ chat: 'claude-sonnet-5', oneShot: 'claude-sonnet-5' });
  expect(resolveModels('openai', undefined))
    .toEqual({ chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' });
});
```
⚠ Hard-code the ids. `expect(...).toEqual(DEFAULT_MODELS.anthropic)` is a tautology that passes if
`DEFAULT_MODELS` is wrong.

```ts
it('ignores a CROSS-PROVIDER id and falls back to the provider default', () => {
  expect(resolveModels('anthropic', { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' }))
    .toEqual({ chat: 'claude-sonnet-5', oneShot: 'claude-sonnet-5' });
});
```
⚠ A **cross-provider** id, not `'not-a-model'`. Both pass a membership check, but only the
cross-provider one is the value a real stale blob carries and the one that would 400 — that is what
makes this criterion about the reachable case rather than a synthetic one.

```ts
it('falls back per FIELD, not per object', () => {
  expect(resolveModels('openai', { chat: 'retired-id', oneShot: '<a listed non-default>' }))
    .toEqual({ chat: 'gpt-5.6-sol', oneShot: '<a listed non-default>' });
});
```
⚠ **One good field and one bad.** With both bad, per-field and whole-object fallback are
indistinguishable.
⚠ If Phase 6 has not yet added a second id, write this against a temporary `AI_MODEL_CHOICES` fixture
rather than skipping it — the per-field behaviour is what AC5.5 is about, and it must not wait on the
list.

```ts
it('returns a listed non-default id unchanged', /* … */);

it('does not write settings', () => {
  const configured = { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' };
  const before = JSON.stringify(configured);
  resolveModels('anthropic', configured);
  expect(JSON.stringify(configured)).toBe(before);   // input not mutated
});
```

**Covers:** AC5.1 – AC5.6

---

### Task 3 — Eight client factories accept `model`

For each of the eight factories, widen the config and default to the existing constant:

```ts
// src/ai/anthropicClient.ts — chat
export function createAnthropicClient(
  config: { apiKey: string; model?: string },
  fetchFn?: FetchFn
) {
  const model = config.model ?? MODEL;
  // …
  body: JSON.stringify({ model, max_tokens: MAX_TOKENS, /* … */ })
}

// same file — rest commentary, its OWN parameter (it gets `oneShot`, not `chat`)
export function createRestCommentaryClient(
  config: { apiKey: string; model?: string },
  fetchFn?: FetchFn
) {
  const model = config.model ?? MODEL;
  // …
}
```

Same shape for `alternatesClient.ts`, `exerciseQuestionClient.ts`, `openaiClient.ts` (×2),
`openaiAlternatesClient.ts`, `openaiExerciseQuestionClient.ts`. The four OpenAI ones pass `model`
through to `buildOpenAiBody(request, model)`, which already takes it as its second argument.

⚠ **`model?: string` optional, defaulting to the constant.** That is what keeps all 1680 existing
tests green and makes this layer additive.

⚠ **Do not delete the `MODEL` constants.** They are the defaults.

Per-client tests — both halves:

```ts
it('sends the configured model', async () => { /* { apiKey, model: 'x' } → body.model === 'x' */ });
it('falls back to the built-in model when none is given', async () => {
  /* { apiKey } → body.model === 'claude-sonnet-5' */
});
```
⚠ **The omitted case is required.** Without it, the mutant `const model = config.model;` (undefined
in the body) passes every new test and breaks every real call.

**Covers:** AC5.7

---

### Task 4 — `factory.ts` reads `config.aiModel`

**File:** `src/ai/provider/factory.ts`

Delete the comment block at `:57-68` and replace it with the resolution:

```ts
import { resolveModels } from './models';

export function createAiClient(config: ProviderConfig): AiClient {
  const provider = resolveProvider(config);
  const models = resolveModels(provider, config.aiModel);

  if (provider === 'anthropic') {
    if (!config.anthropicKey?.trim()) { /* unchanged */ }
    const apiKey = config.anthropicKey.trim();

    const chatClient    = createAnthropicClient({ apiKey, model: models.chat });
    const commentClient = createRestCommentaryClient({ apiKey, model: models.oneShot });
    const suggestClient = createExerciseAlternatesClient({ apiKey, model: models.oneShot });
    const askClient     = createExerciseQuestionClient({ apiKey, model: models.oneShot });
    // …wrappers unchanged…
  }
  // …the OpenAI half, same shape…
}
```

⚠ Keep the `.trim()` on both keys. That is #128 `C1`'s fix and this phase must not undo it.

Tests in `factory.test.ts`, using the file's existing `jest.doMock` + `await import` technique:

```ts
it('routes chat to the chat model and the three one-shots to oneShot (anthropic)', async () => {
  // spies as in the existing key-forwarding tests
  const { createAiClient: f } = await import('./factory');
  f({
    anthropicKey: 'sk-ant-x',
    aiModel: { chat: 'CHAT-ID', oneShot: 'ONESHOT-ID' },   // ⚠ DIFFERENT ids
  });

  expect(chatSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-x', model: 'CHAT-ID' });
  expect(commentSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-x', model: 'ONESHOT-ID' });
  expect(suggestSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-x', model: 'ONESHOT-ID' });
  expect(askSpy).toHaveBeenCalledWith({ apiKey: 'sk-ant-x', model: 'ONESHOT-ID' });
});
```

⚠ **The two ids must differ.** With `chat === oneShot`, the mutant that passes `models.chat` to all
four surfaces survives every assertion — and the whole point of `AiModelConfig` is that they can
differ.

⚠ These ids must be on `AI_MODEL_CHOICES` for the test, or `resolveModels` will replace them with
defaults and the test asserts the wrong thing. Either add test-only ids to the constant or stub
`resolveModels` — stubbing is cleaner and keeps the constant honest.

⚠ **Replace** the accepted-but-ignored pinning test with these. Do not delete it silently.

**Covers:** AC5.8, AC5.10

---

### Task 5 — Four stores forward `settings.aiModel`

**Files:** `src/state/aiChatStore.ts:137-139`, `restCommentaryStore.ts:200-202`,
`exerciseQuestionStore.ts:168-170`, `exerciseReplaceStore.ts:245-247`.

```ts
const providerConfig: ProviderConfig = {
  anthropicKey: settings.anthropicKey,
  openaiKey: settings.openaiKey,
  aiProvider: settings.aiProvider,
  aiModel: settings.aiModel,      // ← the layer everyone skips
};
```

Extend Phase 1's OpenAI-only tests (and add an Anthropic counterpart) to assert the whole config:

```ts
expect(fakeCreateClient).toHaveBeenCalledWith({
  anthropicKey: '',
  openaiKey: 'sk-openai-123',
  aiProvider: undefined,
  aiModel: { chat: 'CHAT-ID', oneShot: 'ONESHOT-ID' },
});
```

⚠ **`toEqual` / exact `toHaveBeenCalledWith`, never `objectContaining`.** A partial match passes a
builder that drops `aiModel` — which is the whole of layer 3.

**Covers:** AC5.9

---

### Task 6 — Correct the stale docstrings

- `src/ai/provider/types.ts:13-17` — `AiModelConfig` says *"reserved for Phase 3 when per-surface
  model selection is implemented"*. It is implemented now; describe the `chat` / `oneShot` → surface
  mapping instead.
- ⚠ **Leave `ProviderConfig`'s "Only one key is set per install" (`types.ts:33`) alone.** The
  clear-on-switch decision keeps it true, deliberately.

**Verify AC5.11:**

```
git diff origin/main...HEAD -- src/ai/provider/requestBuilder.ts
    → expected: EMPTY
```

`getTokenBudget` and the `reasoning` / `thinking` contract are untouched by this phase. Per-surface
*model* choice does not move a budget; the coupling is discharged through the list's membership, in
Phase 6.

**Covers:** AC5.10, AC5.11

---

## Traps

1. **Doing layers 1 and 2 and stopping.** The stores never forward `aiModel`, so nothing changes and
   every new test passes. AC5.9's exact-match assertion is the only cover.
2. **`objectContaining` on the forwarded `ProviderConfig`.** Passes a builder that drops the field.
3. **Equal `chat` and `oneShot` ids in the factory test.** Makes the four-surface routing mutant
   undetectable, and it is the most natural fixture to write.
4. **Threading one module-level `model` variable in `anthropicClient.ts` / `openaiClient.ts`.** Each
   file exports **two** factories that get **different** models. One variable collapses `oneShot` into
   `chat`.
5. **Deleting the `MODEL` constants.** They are the no-configuration defaults, and AC5.1 asserts the
   exact ids.
6. **Omitting the "falls back when no model is given" client test.** The mutant `const model =
   config.model;` writes `undefined` into every body and passes everything else.
7. **`expect(resolveModels(...)).toEqual(DEFAULT_MODELS.anthropic)`.** A tautology.
8. **A `resolveModels` fallback fixture with both fields bad.** Cannot distinguish per-field from
   whole-object.
9. **Making `resolveModels` "helpfully" rewrite the setting when it rejects an id.** That is a silent
   settings mutation, and it destroys the restore-on-relist behaviour AC5.6 specifies.
10. **Adding a model id to `AI_MODEL_CHOICES` in this phase.** Membership requires live per-surface
    probing — Phase 6 Task 1. An id added from memory here is exactly the "UNVALIDATED, no live calls
    made" admission that produced #128's `C2`.
11. **Dropping the `.trim()` while restructuring `factory.ts`.** It is #128 `C1`'s fix; it protects
    all four surfaces.
12. **Editing `requestBuilder.ts`.** AC5.11 is a diff.

---

## Verification

```
npx tsc --noEmit                                    # exit 0
npx jest                                            # green, all suites
npm run lint                                        # 0 errors; report warnings vs 51
! grep -n "deliberately NOT read" src/ai/provider/factory.ts
git diff origin/main...HEAD -- src/ai/provider/requestBuilder.ts # empty
git diff origin/main...HEAD -- src/app src/components             # empty (no UI this phase)
```

Then write and run these mutants:

| Mutant | Expected killer |
|---|---|
| drop `aiModel` from `aiChatStore`'s `providerConfig` | the exact-match config assertion |
| `factory.ts` passes `models.chat` to all four surfaces | the different-ids routing test |
| `resolveModels` returns `configured ?? defaults` (no membership check) | the cross-provider fallback test |
| `pick` falls back on the whole object when either field is bad | the per-field fallback test |
| `const model = config.model` (no `?? MODEL`) | the "falls back when none given" client test |
