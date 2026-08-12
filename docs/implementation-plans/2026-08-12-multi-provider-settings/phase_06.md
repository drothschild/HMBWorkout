# Phase 6: Model picker, live verification, docs

**Design:** `docs/design-plans/2026-08-12-multi-provider-settings.md`
**Covers:** AC6.1 – AC6.8
**Gates:** AC7.1 (`tsc`), AC7.2 (`npm test`), AC7.3 (`lint` 0 errors)

---

## Context

Phase 5 made `config.aiModel` real end to end but exposed no control. This phase adds the pickers,
establishes which model ids are actually safe to offer, and updates AGENTS.md.

Like Phase 3, **almost nothing here is testable** — the UI is in `src/app`. The gates are two
structural reads, four simulator scenarios, and a documentation read.

**Task 1 comes before any code**, and it is the reason this phase is not a config edit.

---

## Task 1 — Establish the model list from live data (do this first, write no UI until it is done)

`AI_MODEL_CHOICES` (`src/ai/provider/models.ts`) ships from Phase 5 seeded with the two ids already
in the tree. Its membership rule is hard, and it is the answer to "does per-surface model choice
interact with the token budget and the reasoning contract":

> Every client sends a **fixed** request contract — `reasoning: { effort: 'none' }` on OpenAI,
> `thinking: { type: 'disabled' }` on Anthropic, plus `output_config: { effort: 'low' }` on Anthropic
> rest commentary — against **fixed** per-surface budgets: chat 4096, alternates 1024,
> exerciseQuestion 512, restCommentary 256. A model that rejects those parameters 400s. A model whose
> minimum reasoning effort exceeds `none` spends the 256-token rest-commentary budget on reasoning
> tokens and returns `status: 'incomplete'` with **no text and a bill**.

`requestBuilder.ts:145-161` records that this exact failure "would have shipped silently dead",
because that surface swallows everything.

### Procedure

1. `GET https://api.openai.com/v1/models` and the Anthropic equivalent, with the user's own keys.
   Record the raw responses in the PR.
2. For each candidate id, make **one live call per surface** using the app's real bodies — same
   budget, same `reasoning` / `thinking` / `output_config` fields. The simplest way is to set the id
   through the picker once it exists and drive the app; the more direct way is a throwaway node
   script that imports the client factories.
3. Keep an id **only if all four surfaces return rendered, non-empty output.** Record the
   `max_output_tokens`, the `status`, and the first line of output for each.
4. Write the survivors into `AI_MODEL_CHOICES`.

⚠ **`status: 'ok'` with an empty body is a failure.** It is what an exhausted budget looks like, and
it is indistinguishable from success from every angle except the rendered text.

⚠ **Do not author a model id from memory.** #128's PR body flagged the OpenAI surfaces as
"UNVALIDATED (no live calls made)", and `C2` — a Chat Completions body posted to the Responses
endpoint — is exactly the defect that admission predicted.

⚠ If a provider yields no second viable id, **ship the single-entry list.** The picker still earns
its place by showing which model each surface uses, and inventing an id to make it look richer is the
one outcome worse than a short list. Say so in the PR.

**Covers:** the precondition for AC6.1 and AC6.4

---

## Task 2 — `modelSelectionPatch` in `src/state/aiProviderSettings.ts`

The screen must still hold no decision, so the patch builder lives with the others:

```ts
import { AI_MODEL_CHOICES, DEFAULT_MODELS, resolveModels } from '@/ai/provider/models';

/**
 * Choosing one surface's model leaves the other's alone.
 *
 * The current pair is read through `resolveModels`, so a stored id that is no
 * longer offered resolves to the default before the write — the user cannot
 * silently re-persist a value the app has stopped honouring.
 */
export function modelSelectionPatch(
  settings: Pick<BridgeSettings, 'aiModel'>,
  provider: AiProvider,
  field: keyof AiModelConfig,
  id: string
): Partial<BridgeSettings> {
  const current = resolveModels(provider, settings.aiModel);
  return { aiModel: { ...current, [field]: id } };
}
```

Tests in `src/state/aiProviderSettings.test.ts`:

```ts
it('changes only the named field', () => {
  expect(modelSelectionPatch(
    { aiModel: { chat: 'A', oneShot: 'B' } }, 'anthropic', 'chat', 'C'
  )).toEqual({ aiModel: { chat: 'C', oneShot: /* whatever B resolves to */ } });
});

it('normalises an unlisted stored id before writing', () => {
  expect(modelSelectionPatch(
    { aiModel: { chat: 'retired', oneShot: 'retired' } }, 'anthropic', 'chat', 'claude-sonnet-5'
  ).aiModel).toEqual({ chat: 'claude-sonnet-5', oneShot: DEFAULT_MODELS.anthropic.oneShot });
});
```

⚠ The "only the named field" test needs the two fields to hold **different** values, or it cannot
distinguish per-field from whole-object.

**Covers:** part of AC6.1

---

## Task 3 — Two model pickers on the provider screen

**File:** `src/app/(tabs)/settings/ai-provider.tsx`

Below the key field, two rows using the **same** `Pressable` + `Modal` control as the provider
picker:

| Label | Field | Options |
|---|---|---|
| `Coach model` | `chat` | `AI_MODEL_CHOICES[provider]` |
| `Quick replies model` | `oneShot` | `AI_MODEL_CHOICES[provider]` |

Add a one-line caption under the second: *"Used for rest tips, exercise questions and replacement
suggestions."*

Each row displays `resolveModels(provider, getSettings().aiModel)[field]` and, on selection, calls
`queueSave(modelSelectionPatch(getSettings(), provider, field, id))` then `flush()`.

⚠ **No model id literal may appear in `src/app`.** AC6.1's grep is `grep -rn "claude-\|gpt-" src/app/`
→ empty. Labels come from the constant.

⚠ **Route the write through `queueSave` + `flush`, never `setSettings` directly** — the same rule as
Phase 3's AC3.3, for the same debounce reason.

**Covers:** AC6.1

---

## Task 4 — Switching provider clears the model, through the whole patch

The switch handler from Phase 3 already applies `plan.patch`. Confirm it applies the **whole object**
rather than naming fields:

```tsx
// CORRECT — aiModel is cleared because the patch carries it.
queueSave(plan.patch);
flush();

// WRONG — clears the key and silently keeps a model id belonging to the
// provider the user just left, which the new provider's API will reject.
queueSave({ aiProvider: next, anthropicKey: '' });
```

Also reset the local model display state after the switch, so the rows show the new provider's
defaults immediately.

**Structural read for the PR:**

```
grep -n "plan.patch" "src/app/(tabs)/settings/ai-provider.tsx"
    → expected: the queueSave call, applying the whole object
grep -rn "claude-\|gpt-" src/app/
    → expected: EMPTY
```

**Covers:** AC6.2

---

## Task 5 — Simulator verification (four scenarios)

| # | AC | Procedure | Why it discriminates |
|---|---|---|---|
| 1 | AC6.3 | Choose a **non-default** chat model → force-quit → relaunch. Still selected. | The relaunch separates persisted from in-memory. Skip if Task 1 yielded only one id per provider — **and say so** rather than reporting a pass. |
| 2 | AC6.4 | **Eight live calls: four surfaces × two providers.** Coach conversation, rest-screen commentary, the exercise Question button, and the Replace button — each producing **visible text on screen**. | ⚠ Rest commentary at 256 tokens is the one that returns `status: 'incomplete'` with zero text when the fixed contract does not hold, and it swallows the failure. A "did not crash" check passes that. **The evidence is the rendered text, screenshotted.** |
| 3 | AC6.5 | With a non-default model selected, switch provider → confirm → relaunch. Model resets to the new provider's default; all four surfaces still work. | Proves `aiModel` was actually cleared. Without the relaunch, a cleared-in-cache-only implementation looks identical. |
| 4 | AC6.8 | Under an **OpenAI** key: ask the coach for a routine, accept it, start the session, finish it, and confirm the post-workout debrief opens. | End-to-end proof the OpenAI path is complete, not merely reachable. ⚠ The debrief half exercises `planPostWorkoutDebrief`, widened in Phase 1 — this is its only user-visible check. |

⚠ Scenario 2 is the phase's most important step and the easiest to fake. Eight screenshots, one per
surface per provider.

**Covers:** AC6.3, AC6.4, AC6.5, AC6.8

---

## Task 6 — AGENTS.md

Update these sections. Every sentence must describe code that exists.

**Intro / Tech stack** — already multi-provider after #128's `I8` fix; verify, do not rewrite.

**AI Coach section** — add:

- **The settings split.** `/settings/ai-provider` (provider, key, models) and `/settings/ai` (goals,
  equipment, coaching style, age, experience). The provider/key/model decisions live in
  `src/state/aiProviderSettings.ts` and the screen holds none of them, because `src/app` has no jest
  coverage.
- **One key per install.** Switching provider clears the outgoing provider's key, to `''` rather than
  `undefined` because `setSettings` persists through `JSON.stringify`, which drops `undefined` and
  would leave no evidence of the clear in the blob. **This is what keeps `ProviderConfig`'s "Only one
  key is set per install" docstring true — the sentence is load-bearing, not incidental, and must not
  be edited without changing the rule it describes.** The switch is confirmed only when the outgoing
  key is non-empty after trim. The write goes through the screen's `queueSave` + `flush`, never a bare
  `setSettings`: a bare write leaves a pending 500 ms autosave patch alive that fires afterwards and
  restores the key the user just destroyed.
- **`aiProvider` is written only from the picker.** Mounting the screen derives the displayed value
  through `initialProviderSelection` and writes nothing, so installs that predate the picker keep
  resolving implicitly in `factory.ts`. Nothing can test this — `src/app` is uncovered and an
  automated fixture cannot distinguish "no write" from "wrote the derived value" — so it rests on a
  structural criterion (AC3.2).
- **The key is trimmed at one boundary on the way in**, `apiKeyPatch`; `factory.ts:76,116` trims again
  at the wire. **Keep both layers.** Note that the factory's trim makes an untrimmed *store* invisible
  to every wire-level assertion, so `apiKeyPatch`'s own test is the only cover.
- **Key-format validation warns, never blocks**, and is one-directional: `sk-ant-` under an OpenAI
  selection is flagged; nothing is flagged under Anthropic, because OpenAI has no unmistakable marker
  and `sk-` is a prefix of `sk-ant-`.
- **Chat error copy lives in `src/state/aiChatErrorCopy.ts`**, not in the screen, and names the failing
  provider. The provider is a two-member union, so key material cannot reach the banner by
  construction.
- **The model list is constrained and its membership is governed by the fixed request contract.**
  Spell out the contract (`reasoning: { effort: 'none' }`, `thinking: { type: 'disabled' }`,
  `output_config: { effort: 'low' }` on Anthropic rest commentary) and the fixed budgets, and state
  that **adding an id requires one live call per surface returning rendered text — it is not a config
  edit.** `resolveModels` ignores an id not on the selected provider's list and falls back per field,
  without rewriting the setting.

**Structure section** — add `src/ai/provider/models.ts` and the two new `src/state` modules; note
`errorMapper.ts` is gone.

**Testing gotchas** — add the verified typed-routes note: `.expo/types/router.d.ts` is gitignored and
enumerates static routes as literals, so a **new static route** fails `tsc` in any checkout that has
not run Metro since it landed; and a git worktree with no generated types type-checks everything
because `expo-router` falls back to `string`. The existing note covers only dynamic routes.

**Bump `Last verified`.**

**Covers:** AC6.6, AC6.7

---

## Traps

1. **Authoring a model id from memory.** The single worst outcome of this phase: a list entry that
   404s, on a surface that swallows the error. Task 1 exists to make this impossible.
2. **Accepting `status: 'ok'` with an empty body as a passing live call.** That is what an exhausted
   budget looks like on the 256-token surface.
3. **A model id literal in `src/app`.** AC6.1's grep.
4. **Hand-building the switch patch** instead of applying `plan.patch`, which clears the key and keeps
   a cross-provider model id — a config the new provider will reject on every request.
5. **Skipping AC6.3 silently** because the list has one entry. Report it as not-applicable with the
   reason; a claimed pass on an unrunnable scenario is worse than a gap.
6. **Editing `ProviderConfig`'s docstring** while "tidying" `types.ts`. AC6.7 is a read.
7. **Documenting the model list as "add ids here as needed".** That is the sentence that turns the
   live-call rule into folklore within one release.
8. **Reading a green suite as evidence.** Tasks 3–5 are entirely uncovered.

---

## Verification

```
npx tsc --noEmit                         # exit 0
npx jest                                 # green, all suites
npm run lint                             # 0 errors; report warnings vs the 52 baseline
grep -rn "claude-\|gpt-" src/app/        # empty
```

Plus, in the PR:
- the two structural greps;
- the `GET /v1/models` responses and the per-surface probe results for every candidate id;
- **eight screenshots** — four surfaces × two providers, each showing rendered text;
- the AGENTS.md diff.

**And one closing statement, because this is the last phase:** re-read AGENTS.md's new paragraphs
against the code and confirm each describes something that exists. Three separate reviews on this
feature family have found prose outliving its mechanism (`buildAnthropicBody`, `errorMapper.ts`, the
boilerplate count). This phase adds a lot of prose.
