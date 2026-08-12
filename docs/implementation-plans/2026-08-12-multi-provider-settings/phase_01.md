# Phase 1: Close #234 — cover the OpenAI path before it has a door

**Design:** `docs/design-plans/2026-08-12-multi-provider-settings.md`
**Covers:** AC1.1 – AC1.10
**Gates:** AC7.1 (`tsc`), AC7.2 (`npm test`), AC7.3 (`lint` 0 errors)

---

## Context for an engineer with no history here

Phase 3 of the multi-provider work (PR #211, merged at `11f53ed`) built a whole OpenAI code path:
a factory (`src/ai/provider/factory.ts`), four OpenAI clients, and four provider-aware Zustand
stores. **No user can reach any of it** — `src/app/(tabs)/settings/ai.tsx` only edits `anthropicKey`.

A mutation sweep at merge measured a 50% kill rate, and **17 of the 37 survivors are one pattern:
no test anywhere sets an OpenAI-only settings blob and drives a store.** That is issue #234.

Your job is to close that gap **before** a later phase adds the settings screen. The card's own
words: *"Wiring a UI to an untested path is the risk this card exists to prevent."*

**This phase changes no user-visible behaviour.** The only file under `src/app` you touch is a
one-symbol rename.

### Baseline, verified on this branch

```
npx tsc --noEmit   → exit 0
npx jest           → 90 suites, 1680 tests, all passing
npm run lint       → 0 errors, 52 warnings
```

A failure in any suite is yours.

### The coverage boundary

`jest.config.js` runs **one `node` project**. Its `testMatch` covers
`engine/db/interop/state/health/helpers/ai/theme/watch/components/export`.
**`src/app` is not in it.** Everything in this phase except the rename's call site is testable.

---

## Investigation findings (done for you; re-check the ones marked ⚠)

1. **The 17 survivors** are tabulated in #128's round-2 review comment. Read that comment before starting;
   the mutant-ID table (`S01`, `S05–S07`, `E01`, `E03–E06`, `R02–R05`, `X02–X05`, `F19b–F24`) is the
   phase's definition of done. #234 contains only a per-file survivor count, not the per-mutant IDs.
2. **Three store test doubles carry `{ apiKey: config.anthropicKey || 'test-key' }`** —
   `restCommentaryStore.test.ts:85`, `exerciseQuestionStore.test.ts:76`,
   `exerciseReplaceStore.test.ts:189`. That fallback is *why* mutants `E06`/`R05` (blanking
   `anthropicKey` in the store's forwarded config) are invisible. Remove it first, or the new tests
   you write cannot fail either.
3. **`factory.test.ts` already has the right technique** for testing the factory's wiring:
   `jest.resetModules()` + `jest.doMock('../openaiClient', …)` + `await import('./factory')`. See
   `factory.test.ts:65-108`. Reuse it; do not invent a second approach.
4. **Two Anthropic-only gates are NOT in #234's table** and are live defects the moment a settings
   screen exists. Both are in `src/state`, so both are fully testable:
   - `src/state/coachOnboarding.ts:28` — `shouldShowOnboardingCard` gates on `anthropicKey` only.
   - `src/state/postWorkoutDebrief.ts:33` — `planPostWorkoutDebrief` gates on `anthropicKey` only.
   #234's sweep covered the seven files Phase 3 *changed*; neither of these was changed.
5. **`errorMapper.ts` is confirmed dead** — `grep -rn "errorMapper\|ProviderUnreachable\|ProviderHttpError" src/`
   finds only its own declarations and its own test file. #234 asks for a decision; the design's
   decision is **delete**.
6. **`exerciseQuestionStore.ts:71` exports `hasAnthropicKey`**, which now means "has any API key", and
   `src/app/session.tsx:24,407` imports and calls it under that name (#234's `M9`).
7. ⚠ **Value pins:** `grep -rn "toEqual({ kind:" src/state/aiChatStore.test.ts` returns 12 hits. They
   pin `AiChatError`'s shape. **This phase does not change that shape** (Phase 4 does), so they should
   not break here. If one does, you changed something you should not have.
8. ⚠ **Re-run the gate sweep at the end**, do not trust finding 4's list:
   `grep -rn "anthropicKey" src/state src/components src/app | grep -v "\.test\."`
   Findings 4's two entries were found this way. Record the full output in the PR.

---

## Tasks

### Task 1 — Remove the `|| 'test-key'` fallbacks (do this first)

**Files:** `src/state/restCommentaryStore.test.ts`, `src/state/exerciseQuestionStore.test.ts`,
`src/state/exerciseReplaceStore.test.ts`

Each has a `makeStore()` helper with a `createUnifiedClient` that builds a real Anthropic client:

```ts
// src/state/restCommentaryStore.test.ts, around line 85 — BEFORE
const client = createRestCommentaryClient(
  { apiKey: config.anthropicKey || 'test-key' },
  mockFetch as unknown as typeof fetch
);
```

Change to a provider-aware double that **forwards whatever it was given** and records it:

```ts
// AFTER — the recorder is what makes key forwarding observable at all.
const capturedConfigs: ProviderConfig[] = [];

const createUnifiedClient = (config: ProviderConfig): AiClient => {
  capturedConfigs.push(config);
  const apiKey = config.aiProvider === 'openai' || config.openaiKey
    ? (config.openaiKey ?? '')
    : (config.anthropicKey ?? '');
  const client = createRestCommentaryClient(
    { apiKey },
    mockFetch as unknown as typeof fetch
  );
  return {
    async chat() { throw new Error('chat not used in test'); },
    async comment(request) { return client.comment(request); },
    async suggest() { throw new Error('suggest not used in test'); },
    async ask() { throw new Error('ask not used in test'); },
  };
};
```

Return `capturedConfigs` from `makeStore()` so tests can assert on it.

⚠ **Do not replace `|| 'test-key'` with `?? 'test-key'` or any other default.** The point is that a
blank key must reach the double, so a test asserting the key can fail.

**Verify:** `npx jest src/state` — all existing tests still pass. If one now fails, it was relying on
the fallback, which is the bug this task exists to expose. Fix the test by giving its fixture a real
key, never by restoring the default.

**AC1.2 — Explicit exact forwarded-key assertion.** After returning `capturedConfigs` from `makeStore()`,
add a **third** test to at least one store (e.g. `restCommentaryStore.test.ts`) that verifies the exact
key forwarding:

```ts
it('asserts the exact forwarded key, killing mutants E06 and R05', async () => {
  getSettings.mockReturnValue({
    anthropicKey: 'sk-ant-REAL',
    openaiKey: '',
    aiProvider: undefined,
  });

  const { store, capturedConfigs } = makeStore();
  await store.getState().request(/* …surface entry… */);

  expect(capturedConfigs[0]).toEqual({
    anthropicKey: 'sk-ant-REAL',
    openaiKey: '',
    aiProvider: undefined,
  });
});
```

This assertion is what makes blanking the key observable and detectable. Without it, Task 1's removal
of `|| 'test-key'` has nowhere to fail.

**Covers:** AC1.2

---

### Task 2 — One OpenAI-only test per store

**Files:** the four store test files.

For each store, add a test using a settings blob with **`openaiKey` set and `anthropicKey` empty**:

```ts
it('drives the surface from an OpenAI-only settings blob and forwards openaiKey', async () => {
  getSettings.mockReturnValue({
    anthropicKey: '',            // ⚠ MUST be empty. See discrimination note below.
    openaiKey: 'sk-openai-123',
    aiProvider: undefined,
  });

  const { store, capturedConfigs } = makeStore();
  await store.getState().request(/* …the surface's entry point… */);

  expect(capturedConfigs).toHaveLength(1);
  expect(capturedConfigs[0]).toEqual({
    anthropicKey: '',
    openaiKey: 'sk-openai-123',
    aiProvider: undefined,
  });
});
```

⚠ **`anthropicKey` must be empty.** With both keys set, the mutants that drop `openaiKey` from
`providerConfig` (`S06`, `E04`, `R04`, `X04`) still resolve a provider through the Anthropic key and
still fire the surface — the test passes against the defect. This is the criterion's whole content.

⚠ **Use `toEqual` on the whole config, not `objectContaining`.** `objectContaining` passes a builder
that drops a field.

Per-store entry points:

| Store | File | Entry point |
|---|---|---|
| `aiChatStore` | `src/state/aiChatStore.test.ts` | `store.getState().send('hello')` after `reset({ kind: 'create' })` |
| `restCommentaryStore` | `src/state/restCommentaryStore.test.ts` | the existing happy-path test's trigger |
| `exerciseQuestionStore` | `src/state/exerciseQuestionStore.test.ts` | `toggle(...)` then the ask path |
| `exerciseReplaceStore` | `src/state/exerciseReplaceStore.test.ts` | `open(target)` |

Also add, per store, the **no-key negative**: both keys empty → the surface does not fire and (for
`aiChatStore`) `error.kind === 'missing_key'`. Without it, mutants like `S05`
(`!hasAnthropicKey && !hasOpenaiKey` → `!hasAnthropicKey`) survive.

For `aiChatStore` the config assertion lives on `fakeCreateClient`:

```ts
expect(fakeCreateClient).toHaveBeenCalledWith({
  anthropicKey: '',
  openaiKey: 'sk-openai-123',
  aiProvider: undefined,
});
```

**Kills:** `S05`, `S06`, `S07`, `E03`–`E06`, `R02`–`R05`, `X02`–`X05`, `E01`.

**Covers:** AC1.1

---

### Task 3 — `mapError`'s OpenAI arms

**File:** `src/state/aiChatStore.test.ts`

`mapError` (`src/state/aiChatStore.ts:60-88`) discriminates Anthropic by `instanceof` and OpenAI by
`error.name`. The OpenAI arms have no tests (`S01`, `S02`).

```ts
import { OpenaiHttpError, OpenaiUnreachable } from '@/ai/openaiClient';

it('maps OpenaiHttpError 401 to unauthorized', async () => {
  const { store, fakeChat, fakeGetSettings } = makeStore();
  fakeGetSettings.mockReturnValue({ anthropicKey: '', openaiKey: 'sk-o' });
  store.getState().reset({ kind: 'create' });
  fakeChat.mockRejectedValue(new OpenaiHttpError(401, 'unauthorized'));

  await store.getState().send('hi');
  expect(store.getState().error).toEqual({ kind: 'unauthorized' });
});

it('maps OpenaiHttpError 500 to http with its status', async () => { /* … expects { kind: 'http', status: 500 } */ });
it('maps OpenaiUnreachable to network',                 async () => { /* … expects { kind: 'network' } */ });
```

⚠ **The 500 case is required.** With only the 401 test, the `else if (httpError.status)` arm is
unexercised and a mutant collapsing it into the `unauthorized` arm survives.

⚠ These three `toEqual` assertions become four-field objects in Phase 4. That is expected; do not
pre-empt it here.

**Kills:** `S01`, `S02`.

**Covers:** AC1.3

---

### Task 4 — The factory's eight payload wrappers

**File:** `src/ai/provider/factory.test.ts`

This is the security-relevant one. `factory.ts:95-100` and `:135-140` build the `suggest` wrapper as
`{ system: request.system, message: request.message }`. **Swapping those two fields survives the
entire suite** (`F23`/`F24`, which is round 1's `F09`, still unfixed). `system` is the channel
`IMMUTABLE_DIRECTIVES` ride in, and `requestBuilder.ts:94-100` records that the precedence guarantee
is a *channel* property — a swap puts user free text where the directives belong.

Use the file's existing `jest.doMock` technique. The difference from the existing key-forwarding
tests is that the spy must return a client whose **method** is a `jest.fn`, so you can assert what
the wrapper called it with:

```ts
describe('forwards payloads to each surface on its own channel', () => {
  afterEach(() => jest.resetModules());

  const SYS = 'SYSTEM-SENTINEL';         // ⚠ distinct, non-empty
  const MSG = 'MESSAGE-SENTINEL';        // ⚠ distinct, non-empty, != SYS

  it('anthropic: each surface forwards system and message to its own client', async () => {
    jest.resetModules();
    const chat = jest.fn(async () => ({ reply: 'ok' }));
    const comment = jest.fn(async () => 'ok');
    const suggest = jest.fn(async () => ({ alternates: [] }));
    const ask = jest.fn(async () => 'ok');

    jest.doMock('../anthropicClient', () => ({
      createAnthropicClient: () => ({ chat }),
      createRestCommentaryClient: () => ({ comment }),
    }));
    jest.doMock('../alternatesClient', () => ({
      createExerciseAlternatesClient: () => ({ suggest }),
    }));
    jest.doMock('../exerciseQuestionClient', () => ({
      createExerciseQuestionClient: () => ({ ask }),
    }));

    const { createAiClient: f } = await import('./factory');
    const client = f({ anthropicKey: 'sk-ant-x' });

    await client.chat({ system: SYS, messages: [{ role: 'user', content: MSG }] });
    await client.comment({ system: SYS, message: MSG });
    await client.suggest({ system: SYS, message: MSG });
    await client.ask({ system: SYS, message: MSG });

    expect(chat).toHaveBeenCalledWith({ system: SYS, messages: [{ role: 'user', content: MSG }] });
    expect(comment).toHaveBeenCalledWith({ system: SYS, message: MSG });
    expect(suggest).toHaveBeenCalledWith({ system: SYS, message: MSG });
    expect(ask).toHaveBeenCalledWith({ system: SYS, message: MSG });
  });

  it('openai: each surface forwards system and message to its own client', async () => {
    // Same shape against '../openaiClient', '../openaiAlternatesClient',
    // '../openaiExerciseQuestionClient', with { openaiKey: 'sk-o' }.
  });
});
```

⚠ **The two sentinels must differ and neither may be empty.** With `system: ''`, or with the two
strings equal, the swap is invisible and the test cannot fail on the mutant it exists for.

⚠ **`toHaveBeenCalledWith` with an exact object, not `objectContaining`.** A partial match on
`{ system: SYS }` passes a wrapper that *also* put `SYS` in `message`.

⚠ The non-empty `messages` array is what kills `F20`/`F21` (`messages: []`).

**Kills:** `F19b`, `F20`, `F21`, `F23`, `F24`.

**Covers:** AC1.4

---

### Task 5 — Widen `shouldShowOnboardingCard`

**Files:** `src/state/coachOnboarding.ts`, `src/state/coachOnboarding.test.ts`

```ts
// src/state/coachOnboarding.ts — BEFORE (line 28)
const hasKey = !!(settings.anthropicKey && settings.anthropicKey.trim().length > 0);
```

The function's own docstring says: *"The key check must match what `aiChatStore.startTurn` enforces,
or the card can open a conversation that immediately fails with `missing_key`."* `startTurn` was
widened in Phase 3 to accept either key. This was not. Reuse the existing predicate rather than
writing a fourth copy of the rule:

```ts
import { hasAiKey } from '@/state/exerciseReplaceStore';
// …
const hasKey = hasAiKey(settings);
```

(`hasAiKey` is at `src/state/exerciseReplaceStore.ts:164` and already means "either key, trimmed".)

Tests:

```ts
it('shows the card for an OpenAI-only install', () => {
  expect(shouldShowOnboardingCard({
    ...base, anthropicKey: '', openaiKey: 'sk-o', onboardingState: 'unseen',
  })).toBe(true);
});

it('does not show the card with no key at all', () => {
  expect(shouldShowOnboardingCard({
    ...base, anthropicKey: '', openaiKey: '', onboardingState: 'unseen',
  })).toBe(false);
});
```

⚠ The positive case **must** be OpenAI-only — with an Anthropic key it passes today.
⚠ The no-key negative is **required**, or the mutant `return settings.onboardingState === 'unseen'`
survives both cases.

**Covers:** AC1.5

---

### Task 6 — Widen `planPostWorkoutDebrief`

**Files:** `src/state/postWorkoutDebrief.ts`, `src/state/postWorkoutDebrief.test.ts`

Same shape. Widen the signature and the guard:

```ts
export function planPostWorkoutDebrief(
  finished: FinishedWorkout,
  settings: { anthropicKey?: string; openaiKey?: string }
): DebriefMode | null {
  if (!hasAiKey(settings)) {
    return null;
  }
  // …unchanged…
}
```

Update the docstring — it currently says *"with no Anthropic key there is nothing to talk to"*.

`src/state/activeSession.ts:235` is the only production caller; it passes the whole settings object,
so it needs no change. Confirm with `tsc`.

Same two tests as Task 5 (OpenAI-only → a `DebriefMode`; no key → `null`), same discrimination notes.

**Covers:** AC1.6

---

### Task 7 — Rename `hasAnthropicKey` → `hasApiKey`

**Files:** `src/state/exerciseQuestionStore.ts`, `src/state/exerciseQuestionStore.test.ts`,
`src/app/session.tsx`

`exerciseQuestionStore.ts:71` exports `hasAnthropicKey(settings)`, which since Phase 3 means "has any
API key", and `src/app/session.tsx:24` imports it and `:407` calls it. The name is a live misnomer
that the next phase makes actively misleading.

There is also a **zero-arg closure** `hasApiKey()` at `exerciseQuestionStore.ts:129` inside
`createExerciseQuestionStore`, which reads `deps.getSettings()`. The two cannot be simply collapsed
because they have different signatures (one parameterized, one a closure).

**Workable approach:** Rename the exported function at `:71` from `hasAnthropicKey(settings)` to
`hasApiKey(settings)`, and have the closure at `:129` delegate to it by calling
`hasApiKey(deps.getSettings())`. This makes the module use a single exported predicate name.

⚠ **`src/app/session.tsx` is in this phase's scope**, because the rename breaks it and no phase may
leave `tsc` broken for a later one.

**Verify:** `grep -rn "hasAnthropicKey" src/` returns nothing; `npx tsc --noEmit` exit 0.

**Covers:** AC1.7

---

### Task 8 — Delete `errorMapper.ts`

**Files:** delete `src/ai/provider/errorMapper.ts` and `src/ai/provider/errorMapper.test.ts`; remove
`ProviderUnreachable` and `ProviderHttpError` from `src/ai/provider/types.ts:96-112`.

#234 asks for a decision. It is dead — a second, unused error mapper sitting beside the live
`mapError` in `aiChatStore.ts`, which Phase 4 is about to grow a provider field on. Keeping it is the
"scaffolding outliving its mechanism" pattern this repo has hit three times.

**Verify:** `grep -rn "errorMapper\|ProviderUnreachable\|ProviderHttpError" src/` returns nothing;
`tsc` clean; suite count drops by one file (89 suites) with the test count reduced accordingly —
**report the new numbers** rather than claiming 90/1680.

**Covers:** AC1.8

---

### Task 9 — Run the mutants and the gate sweep

**Not a code task. This is the phase's exit condition.**

**Scope: 27 mutants** covered by this phase, sourced from #234's per-file survivor table at commit
`11f53ed`:

| file | count | survivors |
|---|---|---|
| `src/state/aiChatStore.ts` | 5 | `S01`, `S05`–`S07` |
| `src/state/exerciseQuestionStore.ts` | 5 | `E01`, `E03`–`E06` |
| `src/state/restCommentaryStore.ts` | 4 | `R02`–`R05` |
| `src/state/exerciseReplaceStore.ts` | 3 | `X02`–`X03` |
| **Subtotal (stores)** | **17** | — |
| `src/ai/provider/factory.ts` | 10 | `F19b`, `F20`, `F21`, `F23`, `F24` + 5 more |
| **Subtotal (factory)** | **10** | — |
| **Phase 1 total** | **27** | — |

**Out of Phase 1 scope** (10 survivors, owned by Phase 3 per #234):
- `src/ai/openaiAlternatesClient.ts`: 6 survivors
- `src/ai/openaiExerciseQuestionClient.ts`: 4 survivors

For each of the 27 mutants listed above:

1. Apply the mutation by hand.
2. Assert the file actually changed (`git diff --stat` non-empty) and the anchor was unique.
3. Run `npx tsc --noEmit` — if it fails, the mutant is non-compiling; record and discard, do not
   count as a survivor.
4. Run the **full** suite.
5. Record which **named** test failed.
6. Revert.

Report a table of `mutant → test that killed it`, plus an **anchor-miss count**. A mis-anchored
mutant is indistinguishable from a real gap; if the count is not zero, say so.

Then re-run the gate sweep and paste the full output:

```
grep -rn "anthropicKey" src/state src/components src/app | grep -v "\.test\."
```

Every remaining hit must be either the settings type/default itself, a `ProviderConfig` builder that
also carries `openaiKey`, or a justified exception named in the PR.

**Covers:** AC1.9, AC1.10

---

## Traps

1. **Replacing `|| 'test-key'` with another default.** The whole point is that a blank key must be
   observable. Any default restores the blindness.
2. **An OpenAI fixture that also sets `anthropicKey`.** It passes against every mutant it exists to
   catch. This is the single most likely way to get Task 2 wrong.
3. **`objectContaining` on a forwarded `ProviderConfig`.** Passes a builder that drops a field —
   which is exactly `S06`, `E04`, `R04`, `X04`.
4. **Equal or empty sentinels in Task 4.** `system: ''` or `SYS === MSG` makes the channel swap
   undetectable. `F23`/`F24` is the one finding with a stated security rationale; a vacuous test here
   is worse than no test, because it reads as coverage.
5. **Only testing the 401 in Task 3.** The `else if (httpError.status)` arm needs a non-401 status.
6. **Assuming finding 4's list of Anthropic-only gates is complete.** It came from a grep. Re-run the
   grep (Task 9). Two gates were missed by a professional mutation sweep because the sweep was scoped
   to changed files.
7. **Claiming "90 suites, 1680 tests" after Task 8.** Deleting a test file changes both numbers.
   Report what you measure.
8. **Widening `planPostWorkoutDebrief` by adding a second `||` clause inline** instead of calling
   `hasAiKey`. The codebase already has four copies of this predicate; a fifth is how they drift.
9. **Touching `src/app/session.tsx` beyond the rename.** AC1.10 is a `git diff` on `src/app` and
   `src/components`; anything else in it fails the phase.

---

## Verification

```
npx tsc --noEmit                # exit 0
npx jest                        # green; report the new suite/test counts after Task 8
npm run lint                    # 0 errors; report the warning count vs the 52 baseline
grep -rn "hasAnthropicKey" src/                                   # empty
grep -rn "errorMapper\|ProviderUnreachable\|ProviderHttpError" src/  # empty
grep -rn "|| 'test-key'" src/                                     # empty
git diff origin/main...HEAD -- src/app src/components             # rename only
```

**Three-dot diffs throughout.** This is a six-PR chain and `origin/main` moves under each branch; a
two-dot diff shows a later phase's merged changes as `-` lines in yours.
