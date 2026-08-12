# Phase 2: The provider decision layer

**Design:** `docs/design-plans/2026-08-12-multi-provider-settings.md`
**Covers:** AC2.1 – AC2.12
**Gates:** AC7.1 (`tsc`), AC7.2 (`npm test`), AC7.3 (`lint` 0 errors)

---

## Context for an engineer with no history here

The next phase adds a settings screen where the user picks an AI provider (Anthropic or OpenAI) and
then enters that provider's API key.

**`src/app` has zero jest coverage.** `jest.config.js` runs one `node` project whose `testMatch`
covers `engine/db/interop/state/health/helpers/ai/theme/watch/components/export` — `app` is not in
the list. A screen is invisible to all 1680 tests.

So this phase builds **every decision that screen will make** as pure functions in `src/state`, with
full tests. Phase 3's screen then contains a `useState`, a `Pressable`, a `Modal`, and calls into
this module — and nothing else. The precedent is `src/state/coachOnboarding.ts`, whose
`dismissOnboardingPatch` docstring says it exists as a function precisely because *"the screens that
call it live in `src/app`, which jest does not cover, so inlining … would put the decision
permanently out of reach of any suite."*

**This module has no consumer until Phase 3.** That is deliberate; see the design's *Additional
Considerations*. Lint will not complain — exported functions are not unused-warned.

### Settled decisions you are implementing, not evaluating

- **Switching provider clears the other provider's key.** Only one key is ever stored per install.
  This keeps `ProviderConfig`'s existing docstring — *"Only one key is set per install"*
  (`src/ai/provider/types.ts:33`) — **true**, which is why the docstring must be left alone.
- **The clear is confirmed**, but only when the outgoing provider actually has a key.
- **The key is trimmed on write, here, at one named boundary.**
- **Key-format validation warns, never blocks.**

---

## Investigation findings (done for you)

1. **`BridgeSettings`** (`src/state/settings.ts:10-37`) holds `anthropicKey: string` (required,
   default `''`), `openaiKey?: string`, `aiProvider?: AiProvider`, `aiModel?: AiModelConfig`.
2. **`resolveAiProvider`** (`src/state/settings.ts:137-159`) implements "explicit `aiProvider` wins,
   else whichever key is non-empty after trim, else `null`". It reads the module cache via
   `getSettings()` and takes no argument. **It has zero production callers** — six tests and nothing
   else. This phase gives it its first.
3. **Every "is there a key" predicate in the codebase uses `.trim()`**: `resolveAiProvider:146-147`,
   `factory.ts:30-31`, `exerciseReplaceStore.ts:165-166` (`hasAiKey`),
   `exerciseQuestionStore.ts:131-133`. A whitespace-only value is **not** a key anywhere.
4. **`setSettings`** (`settings.ts:115`) does `cache = { ...cache, ...newSettings }` then
   `JSON.stringify(cache)` into `expo-secure-store`. ⚠ **`JSON.stringify` drops `undefined`
   values**, so clearing a key to `undefined` leaves *no evidence* in the persisted blob. Clear to
   `''`.
5. **`buildSettingsPatch`** (`src/state/aiChatStore.ts:92-101`) does the **opposite** of what you
   need here: it deliberately omits `undefined` fields so a normalized OpenAI response cannot blank
   the other settings. AGENTS.md documents that rule. **Do not copy its shape.** Your patch must
   carry an explicit blanking value.
6. **API key prefixes.** Anthropic keys carry `sk-ant-`. OpenAI has shipped `sk-`, `sk-proj-`,
   `sk-svcacct-` and org-scoped variants — and **`sk-` is a prefix of `sk-ant-`**. There is no sound
   rule for "this looks like an OpenAI key"; there is a sound rule for "this is unmistakably an
   Anthropic key". The validation is one-directional for that reason.
7. **`AiProvider`** is `'anthropic' | 'openai'`, exported from `src/ai/provider/types.ts:11`.

---

## Tasks

### Task 1 — Create `src/state/aiProviderSettings.ts`

```ts
/**
 * Every provider/key decision the AI Provider settings screen makes.
 *
 * The screen lives in `src/app`, which no jest project covers, so each decision
 * is a pure function here and the screen is a renderer. Same reason as
 * `coachOnboarding.dismissOnboardingPatch`.
 */

import type { AiProvider } from '@/ai/provider/types';
import type { BridgeSettings } from '@/state/settings';

/** Display order in the picker. */
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai'] as const;

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/** The settings field each provider's key lives in. */
const KEY_FIELD: Record<AiProvider, 'anthropicKey' | 'openaiKey'> = {
  anthropic: 'anthropicKey',
  openai: 'openaiKey',
};

/** Placeholder for the key field. Provider-dependent; lives here so no `sk-`
 *  literal appears in an untestable file. */
export function keyPlaceholder(provider: AiProvider): string {
  return provider === 'anthropic' ? 'sk-ant-...' : 'sk-...';
}

type ProviderKeySettings = Pick<BridgeSettings, 'anthropicKey'> &
  Partial<Pick<BridgeSettings, 'openaiKey' | 'aiProvider'>>;

function hasKey(settings: ProviderKeySettings, provider: AiProvider): boolean {
  const raw = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
  return (raw ?? '').trim().length > 0;
}

/**
 * What the picker shows when the screen mounts.
 *
 * DISPLAY ONLY. Mounting must never write `aiProvider` — installs that predate
 * the picker have it undefined and resolve implicitly through `factory.ts`, and
 * writing a value the user never chose would freeze that fallback.
 *
 * Arms 1 and 2 are `settings.resolveAiProvider`'s rule. Arm 3 is the addition:
 * that function returns null for "neither or both", and a picker must show
 * something.
 */
export function initialProviderSelection(settings: ProviderKeySettings): AiProvider {
  if (settings.aiProvider === 'anthropic' || settings.aiProvider === 'openai') {
    return settings.aiProvider;
  }
  const anthropic = hasKey(settings, 'anthropic');
  const openai = hasKey(settings, 'openai');
  if (anthropic && !openai) return 'anthropic';
  if (openai && !anthropic) return 'openai';
  return 'anthropic';
}

export interface ProviderSwitchPlan {
  /** Apply this whole object. Do not hand-build a subset. */
  patch: Partial<BridgeSettings>;
  /**
   * True only when the outgoing provider has a key worth losing. An
   * unconditional dialog trains the user to dismiss it, at which point the one
   * that matters gets dismissed too.
   */
  needsConfirmation: boolean;
}

/**
 * Switching provider CLEARS the other provider's key. Only one key is ever
 * stored, which is what keeps ProviderConfig's "Only one key is set per
 * install" docstring true.
 *
 * The cleared value is '' and not undefined: `setSettings` persists via
 * JSON.stringify, which DROPS undefined keys, so an undefined clear leaves no
 * evidence in the blob and "cleared" becomes indistinguishable from "never
 * set". '' is also already this codebase's spelling of "no key" — every
 * predicate reads `(x ?? '').trim().length > 0`.
 *
 * NOTE the contrast with `aiChatStore.buildSettingsPatch`, which deliberately
 * OMITS undefined fields for the opposite reason. Two patch builders, opposite
 * rules. Copying that one here produces a switch that clears nothing.
 */
export function providerSwitchPlan(
  settings: ProviderKeySettings,
  next: AiProvider
): ProviderSwitchPlan {
  const current = initialProviderSelection(settings);

  if (next === current) {
    // Re-selecting the active provider destroys nothing.
    return { patch: { aiProvider: next }, needsConfirmation: false };
  }

  const outgoing = next === 'anthropic' ? 'openai' : 'anthropic';
  return {
    patch: {
      aiProvider: next,
      [KEY_FIELD[outgoing]]: '',
      // Model ids are provider-specific; a stale one would be sent to the wrong
      // API. Cleared here from this phase on, before anything reads it.
      aiModel: undefined,
    },
    needsConfirmation: hasKey(settings, outgoing),
  };
}

/**
 * THE single boundary where a raw input value becomes a stored key.
 *
 * `factory.ts:76,116` trims again at the wire; both layers stay, matching the
 * codebase's existing double-normalisation habit. But the factory's trim is
 * also why an untrimmed store is invisible to every wire-level assertion — this
 * function is the only place the trim is observable.
 *
 * Trim the PATCH only. The screen's useState value stays raw, or the cursor
 * jumps while typing.
 */
export function apiKeyPatch(provider: AiProvider, raw: string): Partial<BridgeSettings> {
  return { [KEY_FIELD[provider]]: raw.trim() };
}

const ANTHROPIC_MARKER = 'sk-ant-';

/**
 * A non-blocking hint, never a save gate.
 *
 * Blocking would be worse than the paste it prevents: every AI failure in this
 * app is swallowed, so a false positive produces four dead features and no
 * error anywhere, on a `secureTextEntry` field the user cannot inspect.
 *
 * The rule is one-directional on purpose. `sk-ant-` is an unmistakable
 * Anthropic marker. OpenAI has no counterpart — it ships `sk-`, `sk-proj-`,
 * `sk-svcacct-` and more, and `sk-` is itself a prefix of `sk-ant-`. So an
 * OpenAI key under an Anthropic selection is NOT flagged; there is no rule for
 * it that does not also fire on legitimate keys.
 */
export function crossProviderKeyWarning(provider: AiProvider, raw: string): string | null {
  const key = raw.trim();
  if (key.length === 0) return null;
  if (provider === 'openai' && key.startsWith(ANTHROPIC_MARKER)) {
    return 'That looks like an Anthropic key. Switch the provider above, or paste an OpenAI key.';
  }
  return null;
}
```

⚠ The warning string is a **constant** and must never interpolate the key.

⚠ `providerSwitchPlan`'s same-provider arm still returns `aiProvider: next`. That is intentional: a
user who taps the provider they are already on has now *explicitly* chosen it, which is a legitimate
write. It clears nothing, which is what AC2.7 checks.

**Covers:** AC2.5 (shape), AC2.8, AC2.9, AC2.10, AC2.11, AC2.12

---

### Task 2 — Create `src/state/aiProviderSettings.test.ts`

Write these, in this order. **Every ⚠ is a case without which a real defect passes.**

#### `initialProviderSelection`

```ts
const base = { anthropicKey: '', openaiKey: undefined, aiProvider: undefined };

it('returns the explicit provider even when the OTHER key is the one present', () => {
  expect(initialProviderSelection({
    ...base, aiProvider: 'openai', anthropicKey: 'sk-ant-x', openaiKey: '',
  })).toBe('openai');
});
```
⚠ The explicit provider and the present key **must disagree**. A fixture where they agree cannot
distinguish "explicit wins" from "derived from keys" — both return the same value.

```ts
it('derives anthropic from an anthropic-only blob', /* … */);
it('derives openai from an openai-only blob',       /* … */);

it('defaults to anthropic when nothing is configured', () => {
  expect(initialProviderSelection(base)).toBe('anthropic');
});

it('treats a whitespace-only key as no key', () => {
  expect(initialProviderSelection({
    ...base, anthropicKey: '   ', openaiKey: 'sk-o',
  })).toBe('openai');
});
```
⚠ `'   '` is the legal-adjacent value. With `''` the test cannot distinguish
`.trim().length > 0` from a bare truthiness check — the same weakness #128 round 2 classified as
`F05`/`F06`.

**Covers:** AC2.1, AC2.2, AC2.3, AC2.4

#### `providerSwitchPlan`

```ts
it('clears the outgoing key and the model when switching away from anthropic', () => {
  const { patch } = providerSwitchPlan(
    { anthropicKey: 'sk-ant-x', openaiKey: '', aiProvider: 'anthropic' },
    'openai'
  );
  expect(patch).toEqual({
    aiProvider: 'openai',
    anthropicKey: '',
    aiModel: undefined,
  });
});
```
⚠ **`toEqual` on the whole patch.** `toMatchObject` or `objectContaining` passes a patch that omits
`anthropicKey` entirely — which clears nothing, silently, forever. The criterion is that the key is
**present with value `''`**, not merely absent.
⚠ Note `toEqual` treats an explicit `aiModel: undefined` and an absent `aiModel` as equal. If you want
that pinned, add `expect('aiModel' in patch).toBe(true)` as a second line.

```ts
it('clears the openai key when switching away from openai', /* mirror image */);

it.each([
  ['a real key',        'sk-ant-x', true],
  ['an empty key',      '',         false],
  ['a whitespace key',  '   ',      false],   // ⚠ legal-adjacent
])('needsConfirmation is %s -> %s', (_label, outgoingKey, expected) => {
  const { needsConfirmation } = providerSwitchPlan(
    { anthropicKey: outgoingKey, openaiKey: '', aiProvider: 'anthropic' },
    'openai'
  );
  expect(needsConfirmation).toBe(expected);
});

it('re-selecting the active provider clears nothing', () => {
  const { patch, needsConfirmation } = providerSwitchPlan(
    { anthropicKey: 'sk-ant-x', openaiKey: '', aiProvider: 'anthropic' },
    'anthropic'
  );
  expect(needsConfirmation).toBe(false);
  expect(patch).toEqual({ aiProvider: 'anthropic' });
  expect(patch.anthropicKey).toBeUndefined();   // the key it would destroy
});
```
⚠ The same-provider case is the **only** fixture that separates "clears the provider that is not
`next`" from "clears `next`'s own key". Every other case passes both implementations. Without it, an
implementation that wipes the key the user is actively using ships green.

**Covers:** AC2.5, AC2.6, AC2.7

#### `apiKeyPatch`

```ts
it('trims the stored key', () => {
  expect(apiKeyPatch('anthropic', '  sk-ant-x\n')).toEqual({ anthropicKey: 'sk-ant-x' });
});
it('trims the openai key', () => {
  expect(apiKeyPatch('openai', '\tsk-proj-x  ')).toEqual({ openaiKey: 'sk-proj-x' });
});
it('writes only the selected provider field', () => {
  expect(Object.keys(apiKeyPatch('openai', 'sk-x'))).toEqual(['openaiKey']);
});
```
⚠ **The input must carry whitespace, and the assertion must be on the patch.** `factory.ts:76,116`
already trims at the wire, so the mutant `return { [field]: raw }` survives every end-to-end check,
every simulator run, and any test that asserts what reaches the client. This test is the only thing
that can see it. Phase 3 of the multi-provider work shipped exactly this regression.

**Covers:** AC2.8, AC2.9

#### `crossProviderKeyWarning`

```ts
it('warns on an Anthropic key under an OpenAI selection', () => {
  expect(crossProviderKeyWarning('openai', 'sk-ant-CANARY123')).not.toBeNull();
});

it.each([
  ['openai',    'sk-CANARY123'],        // ⚠ legal OpenAI key; `sk-` is a PREFIX of `sk-ant-`
  ['openai',    'sk-proj-CANARY123'],   // ⚠ legal OpenAI key
  ['anthropic', 'sk-proj-CANARY123'],   // ⚠ legal OpenAI key under Anthropic — must NOT warn
  ['anthropic', 'sk-ant-CANARY123'],    // matching key
  ['openai',    ''],
  ['anthropic', ''],
] as const)('does not warn for %s / %s', (provider, key) => {
  expect(crossProviderKeyWarning(provider, key)).toBeNull();
});

it('computes the warning on the trimmed value', () => {
  expect(crossProviderKeyWarning('openai', '  sk-ant-CANARY123  ')).not.toBeNull();
});

it('never echoes the key', () => {
  const w = crossProviderKeyWarning('openai', 'sk-ant-CANARY123');
  expect(w).not.toBeNull();
  expect(w).not.toContain('CANARY');
});
```
⚠ `('openai', 'sk-CANARY123')` is the value that kills a naive `startsWith('sk-')`.
⚠ `('anthropic', 'sk-proj-CANARY123')` is the value that kills a per-provider allowlist, which would
warn on every OpenAI shape the app does not happen to enumerate.
⚠ The `CANARY` tail is what makes the no-echo assertion able to fail.

**Covers:** AC2.10, AC2.11, AC2.12

---

## Traps

1. **Copying `buildSettingsPatch`'s omit-undefined shape.** It lives two files away, it is the
   codebase's other settings-patch builder, and AGENTS.md documents its rule. Its rule is the
   **inverse** of this one. Copying it produces a switch that clears nothing.
2. **Clearing to `undefined` instead of `''`.** `JSON.stringify` drops it, so the persisted blob
   carries no evidence of the clear — and "cleared" becomes indistinguishable from "never set" for
   every reader, human or test.
3. **`toMatchObject` / `objectContaining` on the switch patch.** Passes a patch that omits the key.
   This is the single most consequential assertion in the phase.
4. **Omitting the same-provider case.** The only fixture that catches a plan wiping the key the user
   is actively using.
5. **Omitting the whitespace-only fixtures.** `initialProviderSelection` and `needsConfirmation` both
   have a trim in them, and neither is observable with `''`.
6. **A `crossProviderKeyWarning` test suite made only of matches and nonsense.** `'not-a-key'` under
   either provider proves nothing. The discriminating values are *legal keys for the other provider*.
7. **Trimming inside the screen's `useState`.** Not this phase, but it is what an implementer
   naturally does next: it makes the field impossible to type into normally. Only the patch is
   trimmed.
8. **Editing `ProviderConfig`'s docstring.** It says "Only one key is set per install" and this
   design's whole clear-on-switch decision exists partly to keep it true. Leave it.

---

## Verification

```
npx tsc --noEmit                                    # exit 0
npx jest src/state/aiProviderSettings.test.ts       # green
npx jest                                            # green, all suites
npm run lint                                        # 0 errors; report warnings vs 52
git diff origin/main...HEAD --stat                  # only the two new files
```

Then write and run these three mutants, and confirm each fails a **named** test:

| Mutant | Site | Expected to be killed by |
|---|---|---|
| `raw.trim()` → `raw` | `apiKeyPatch` | "trims the stored key" |
| drop `[KEY_FIELD[outgoing]]: ''` from the patch | `providerSwitchPlan` | the `toEqual` patch test |
| `key.startsWith(ANTHROPIC_MARKER)` → `key.startsWith('sk-')` | `crossProviderKeyWarning` | `('openai', 'sk-CANARY123')` |

If any survives, the fixture cannot discriminate the condition it names — fix the fixture, not the
mutant.
