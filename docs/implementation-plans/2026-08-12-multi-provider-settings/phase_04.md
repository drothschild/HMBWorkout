# Phase 4: Chat errors name the failing provider

**Design:** `docs/design-plans/2026-08-12-multi-provider-settings.md`
**Covers:** AC4.1 – AC4.10
**Gates:** AC7.1 (`tsc`), AC7.2 (`npm test`), AC7.3 (`lint` 0 errors)

---

## Context

After Phase 3 a user can configure OpenAI. When their key is rejected, the coach screen currently
says *"API key rejected — check Settings"* with no indication of which provider, account or billing
console to go look at.

This phase attributes chat errors to a provider — and, more consequentially for this codebase, moves
**every user-visible chat error string out of `src/app/ai-coach.tsx` and into a tested module in
`src/state`.** Today those strings live in a `switch` at `ai-coach.tsx:724-749`, in a file no jest
project can load.

**The only user-visible AI error surface in this app is the coach banner.** The three one-shot
surfaces (rest commentary, Question, Replace) swallow every failure by design, and stay that way —
AGENTS.md: a workout must never depend on the AI.

### One correction to the issue's stated rationale, so it is not silently inherited

#122 justifies this with: *"this phase is precisely what lets a user hold two [keys], at which point
'API key rejected' does not tell them which key to fix."* With the settled clear-on-switch decision,
**this phase does not let a user hold two keys** — exactly one is ever stored, so "API key rejected"
is already unambiguous about *which key*.

The feature is still right, on a different rationale: the user's mental model has two providers, the
settings screen shows a provider name, and *"OpenAI rejected your API key"* tells them which console
and billing page to check. `missing_key` naming the selected provider tells a user who picked OpenAI
which key to go get. Scope unchanged; justification restated.

---

## Investigation findings (done for you)

1. **`AiChatError`** is at `src/state/aiChatStore.ts:26-32`, six variants: `missing_key`,
   `unauthorized`, `network`, `http` (with `status`), `parse`, `unknown`.
2. **⚠ Verified blast radius.** Adding a required `provider` field to all six variants and running
   `npx tsc --noEmit` on this branch produced **exactly 6 errors, all construction sites, all inside
   `src/state/aiChatStore.ts`** (lines 68, 70, 79, 84, 88, 248). **`src/app/ai-coach.tsx` does not
   break** — it reads `error.kind` and `error.status` and never constructs one.
3. **⚠ Verified value pin.** `grep -c "toEqual({ kind:" src/state/aiChatStore.test.ts` → **12**.
   `toEqual` is exact, so all twelve break. **This is expected work, named here.** Lines include
   `:203, 218, 232, 244, 466, 690, 701, 724, 1032, 1059` and two more.
   **The remedy is to convert each assertion to `toStrictEqual` and add the field. **`toEqual` is not sufficient**: it ignores properties whose value is `undefined`, so an implementation that drops `?? null` (making `provider` undefined rather than null) survives it. Verified — that mutant passes under `toEqual` and fails 5 tests under `toStrictEqual`. Do NOT relax them to `toMatchObject`** —
   the exactness is what makes AC4.6 and AC4.7 discriminating.
4. **`mapError`** is at `aiChatStore.ts:60-88`. It discriminates Anthropic by `instanceof`
   (`AnthropicHttpError`, `AnthropicUnreachable`) and OpenAI by `error.name`
   (`'OpenaiHttpError'`, `'OpenaiUnreachable'`). Both are sound — `openaiClient.ts:18,28` set
   `this.name` explicitly. Phase 1 added tests for the OpenAI arms.
5. **`startTurn`** is at `aiChatStore.ts:238-260`; its `missing_key` construction is at `:248`.
6. **The error copy** is `ai-coach.tsx:724-749`, a `switch (error.kind)` assigning `errorMessage`,
   rendered at `:772-774`. `:775` additionally shows a Settings link for `unauthorized` and
   `missing_key` — leave that behaviour alone.
7. **`contextBuilder.test.ts`** holds the prompt secret-leak regression tests. They are about the
   **system prompt**, not error copy. This phase must not touch that file (AC4.10).

---

## Tasks

### Task 1 — Widen `AiChatError`

**File:** `src/state/aiChatStore.ts`

```ts
import type { AiProvider } from '@/ai/provider/types';

/**
 * `provider` names which provider failed, so the banner can point the user at
 * the right console. It is `null` only when no provider is implicated — no key
 * configured and none explicitly chosen.
 *
 * It is a two-member union, never a string derived from a key, so key material
 * cannot reach the UI through this field by construction.
 */
export type AiChatError =
  | { kind: 'missing_key'; provider: AiProvider | null }
  | { kind: 'unauthorized'; provider: AiProvider | null }
  | { kind: 'network'; provider: AiProvider | null }
  | { kind: 'http'; status: number; provider: AiProvider | null }
  | { kind: 'parse'; provider: AiProvider | null }
  | { kind: 'unknown'; provider: AiProvider | null };
```

Then fix the six construction sites. `mapError` learns the provider from the error class:

```ts
function providerOf(error: unknown): AiProvider | null {
  if (error instanceof AnthropicHttpError || error instanceof AnthropicUnreachable) {
    return 'anthropic';
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === 'OpenaiHttpError' || name === 'OpenaiUnreachable') return 'openai';
  return null;
}
```

⚠ Keep the existing discrimination style — `instanceof` for Anthropic, `name` for OpenAI. #128 round
1's `I1` established that `constructor.name` breaks under Metro's Release minification; `error.name`
is safe because those classes set it explicitly. Do not "unify" on `constructor.name`.

`parse` and `unknown` reach `mapError` from errors with no provider identity, so `providerOf` returns
`null` for them — correct, and covered by AC4.4's `provider: null` cases.

**`startTurn`'s `missing_key`** (`:248`):

```ts
set({
  status: 'error',
  // settings.aiProvider, NOT initialProviderSelection: that function defaults to
  // 'anthropic' when nothing is configured, which would tell a user who picked
  // OpenAI and left the key blank to go find an Anthropic key. See AC4.8.
  error: { kind: 'missing_key', provider: settings.aiProvider ?? null },
});
```

**Covers:** AC4.5 (mechanism), AC4.7, AC4.8

---

### Task 2 — Create `src/state/aiChatErrorCopy.ts`

```ts
/**
 * Every user-visible chat error string.
 *
 * These lived in a switch inside `src/app/ai-coach.tsx`, which no jest project
 * can load. Here they are testable — including the assertion that none of them
 * can carry key material.
 *
 * The parameter type is the AiChatError union, which has no key field, so a
 * leak is impossible by construction rather than by filtering.
 */

import type { AiChatError } from '@/state/aiChatStore';
import { PROVIDER_LABEL } from '@/state/aiProviderSettings';

export function aiChatErrorMessage(error: AiChatError): string {
  const name = error.provider ? PROVIDER_LABEL[error.provider] : null;

  switch (error.kind) {
    case 'missing_key':
      return name
        ? `Add your ${name} API key in Settings to use the AI Coach`
        : 'Add an AI provider API key in Settings to use the AI Coach';
    case 'unauthorized':
      return name
        ? `${name} rejected your API key — check Settings`
        : 'API key rejected — check Settings';
    case 'network':
      return name
        ? `Couldn't reach ${name}. Check your connection.`
        : "Couldn't reach the AI service. Check your connection.";
    case 'http':
      return name
        ? `${name} returned an error (${error.status}). Try again.`
        : `The AI service returned an error (${error.status}). Try again.`;
    case 'parse':
      return name
        ? `Got an unreadable response from ${name}. Try again.`
        : 'Got an unreadable response. Try again.';
    case 'unknown':
      return 'Something went wrong. Try again.';
  }
}
```

⚠ `PROVIDER_LABEL` is reused from `aiProviderSettings.ts`, so the name the banner shows and the name
the picker shows cannot drift.

⚠ The `unknown` arm is deliberately provider-free: if `mapError` could not identify the error class,
it cannot honestly name a provider either.

**Covers:** AC4.1 – AC4.4

---

### Task 3 — `src/state/aiChatErrorCopy.test.ts` (new)

```ts
it('names the provider on unauthorized, differently for each', () => {
  const a = aiChatErrorMessage({ kind: 'unauthorized', provider: 'anthropic' });
  const o = aiChatErrorMessage({ kind: 'unauthorized', provider: 'openai' });
  expect(a).toContain('Anthropic');
  expect(o).toContain('OpenAI');
  expect(a).not.toBe(o);
});
```
⚠ **Both providers, and the inequality.** Asserting only the OpenAI case cannot distinguish "names
the provider" from "hardcodes OpenAI" — the single most likely way to get this wrong.

```ts
it('tells an OpenAI user to add an OpenAI key', () => {
  expect(aiChatErrorMessage({ kind: 'missing_key', provider: 'openai' }))
    .toContain('OpenAI API key');
});

it('is provider-neutral when no provider is implicated', () => {
  const m = aiChatErrorMessage({ kind: 'missing_key', provider: null });
  expect(m).not.toContain('OpenAI');
  expect(m).not.toContain('Anthropic');
});

it('never returns anything that could be key material', () => {
  const errors: AiChatError[] = [];
  for (const provider of ['anthropic', 'openai', null] as const) {
    errors.push(
      { kind: 'missing_key', provider }, { kind: 'unauthorized', provider },
      { kind: 'network', provider },     { kind: 'parse', provider },
      { kind: 'unknown', provider },     { kind: 'http', status: 500, provider },
    );
  }
  for (const e of errors) {
    const msg = aiChatErrorMessage(e);
    expect(msg).not.toContain('sk-');
    expect(msg.length).toBeGreaterThan(0);
  }
});
```
⚠ Enumerate **every** `kind` × `provider` combination — 18. A spot check leaves arms unexercised, and
an unexercised arm is where a `${JSON.stringify(error)}` debug line survives.

**Covers:** AC4.1 – AC4.4

---

### Task 4 — Update the 12 pinned assertions and add the store cases

**File:** `src/state/aiChatStore.test.ts`

Twelve `toEqual({ kind: … })` assertions gain a `provider` field. For the existing
Anthropic-configured fixtures that is `provider: 'anthropic'`; for the `missing_key` ones whose
fixture has no `aiProvider`, it is `provider: null`.

⚠ **Add the field. Do not relax to `toMatchObject`.** Exactness is what makes the next three tests
able to fail.

New tests:

```ts
it('attributes an OpenAI 401 to openai', async () => {
  const { store, fakeChat, fakeGetSettings } = makeStore();
  fakeGetSettings.mockReturnValue({ anthropicKey: '', openaiKey: 'sk-o', aiProvider: undefined });
  store.getState().reset({ kind: 'create' });
  fakeChat.mockRejectedValue(new OpenaiHttpError(401, 'nope'));

  await store.getState().send('hi');
  expect(store.getState().error).toEqual({ kind: 'unauthorized', provider: 'openai' });
});

it('attributes an Anthropic 401 to anthropic', /* … expects provider: 'anthropic' … */);

it('names the chosen provider on missing_key', async () => {
  const { store, fakeGetSettings } = makeStore();
  fakeGetSettings.mockReturnValue({ anthropicKey: '', openaiKey: '', aiProvider: 'openai' });
  store.getState().reset({ kind: 'create' });

  await store.getState().send('hi');
  expect(store.getState().error).toEqual({ kind: 'missing_key', provider: 'openai' });
});

it('does not guess a provider the user never chose', async () => {
  const { store, fakeGetSettings } = makeStore();
  fakeGetSettings.mockReturnValue({ anthropicKey: '', openaiKey: '', aiProvider: undefined });
  store.getState().reset({ kind: 'create' });

  await store.getState().send('hi');
  expect(store.getState().error).toEqual({ kind: 'missing_key', provider: null });
});
```

⚠ The last two are a **pair**. AC4.7 alone passes an implementation that derives the provider through
`initialProviderSelection`, which defaults to `'anthropic'`; AC4.8 is what forbids it. Neither is
sufficient alone.

⚠ The 401 pair must cover **both** providers and be asserted to differ, for the same reason as
AC4.1.

**Covers:** AC4.5, AC4.6, AC4.7, AC4.8

---

### Task 5 — Replace the copy in `src/app/ai-coach.tsx`

Delete the `switch` at `:724-749` and its `let errorMessage: string;`. Replace with:

```tsx
import { aiChatErrorMessage } from '@/state/aiChatErrorCopy';
// …
const errorMessage = aiChatErrorMessage(error);
```

Leave `:775`'s `(error.kind === 'unauthorized' || error.kind === 'missing_key')` Settings-link
condition exactly as it is — that is behaviour, not copy.

**Structural read for the PR:**

```
grep -n "API key\|Couldn't reach\|unreadable\|Something went wrong" src/app/ai-coach.tsx
    → expected: EXACTLY ONE match — `:347`, the no-key empty state (`Add your API key in Settings`). AC4.9 permits that line and requires it to survive; only the four `errorMessage = …` assignments go. **Do not delete the empty state to make this grep empty.**
```

**Covers:** AC4.9

---

### Task 6 — Confirm the prompt secret-leak tests are untouched

```
git diff origin/main...HEAD -- src/ai/contextBuilder.test.ts
    → expected: EXACTLY ONE match — `:347`, the no-key empty state (`Add your API key in Settings`). AC4.9 permits that line and requires it to survive; only the four `errorMessage = …` assignments go. **Do not delete the empty state to make this grep empty.**
```

Those tests assert `anthropicKey` / `token` / `baseUrl` never appear in the **system prompt**. They
are a different guarantee from this phase's error-copy one, and this phase must neither modify nor
lean on them. Three-dot, because `origin/main` moves under this branch.

**Covers:** AC4.10

---

## Traps

1. **Relaxing the 12 `toEqual` assertions to `toMatchObject`.** It makes the phase compile in one
   edit and destroys every discrimination AC4.6–AC4.8 depend on. `provider` is the field under test;
   a partial match never sees it.
2. **Deriving `missing_key`'s provider through `initialProviderSelection`.** It defaults to
   `'anthropic'`, so a user who picked OpenAI and left the key blank is told to find an Anthropic key.
   AC4.8 is the only cover.
3. **Testing only the OpenAI copy.** Cannot distinguish "names the provider" from "hardcodes OpenAI".
4. **Interpolating the error object into a message** (`` `…${JSON.stringify(error)}` ``) in an arm
   the tests do not reach. AC4.4's 18-case enumeration exists for this.
5. **Switching `mapError` to `constructor.name`.** #128 `I1`: Metro's default minifier does not set
   `keep_classnames`, so class names do not survive a Release build. `instanceof` and `error.name` are
   both safe; `constructor.name` is not. Invisible to jest — the dev bundle is not minified.
6. **Touching `contextBuilder.test.ts`.** Different guarantee, different phase, and AC4.10 is a diff.
7. **Changing the Settings-link condition at `ai-coach.tsx:775`.** It is behaviour, and it is correct.
8. **Assuming the union widening is contained because `tsc` says so.** `tsc` reported 6 errors; the
   *suite* reported 12 more. The two gates disagree, and only running both finds everything.

---

## Verification

```
npx tsc --noEmit                                  # exit 0
npx jest src/state/aiChatErrorCopy.test.ts        # green
npx jest src/state/aiChatStore.test.ts            # green, 12 assertions updated
npx jest                                          # green, all suites
npm run lint                                      # 0 errors; report warnings vs 52
grep -n "API key\|Couldn't reach\|unreadable" src/app/ai-coach.tsx      # empty
git diff origin/main...HEAD -- src/ai/contextBuilder.test.ts            # empty
git diff origin/main...HEAD -- src/state/aiChatStore.test.ts | grep "^-" | grep -v "^---" | grep toMatchObject
    → expected: EXACTLY ONE match — `:347`, the no-key empty state (`Add your API key in Settings`). AC4.9 permits that line and requires it to survive; only the four `errorMessage = …` assignments go. **Do not delete the empty state to make this grep empty.** (no assertion was weakened)
```

Then write and run these mutants:

| Mutant | Expected killer |
|---|---|
| `providerOf` returns `'anthropic'` unconditionally | the OpenAI-401 store test **and** the copy inequality test |
| `missing_key`'s provider ← `initialProviderSelection(settings)` | "does not guess a provider the user never chose" |
| `aiChatErrorMessage`'s `unauthorized` arm ignores `name` | "names the provider … differently for each" |
