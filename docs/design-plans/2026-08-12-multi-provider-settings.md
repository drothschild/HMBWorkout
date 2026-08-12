# Multi-Provider AI — Settings UI and Per-Surface Model Config Design

Issue: [#122](https://github.com/drothschild/HMBWorkout/issues/122) (Phase 4). Depends on Phase 3
([#128](https://github.com/drothschild/HMBWorkout/issues/128), merged at `11f53ed`). Closes
[#234](https://github.com/drothschild/HMBWorkout/issues/234).

## Summary

Phase 3 built a complete multi-provider AI layer — a factory, eight clients, four provider-aware
stores — and shipped it behind no door. `src/app/(tabs)/settings/ai.tsx` still edits `anthropicKey`
and nothing else, so no user can reach the OpenAI half, and `src/ai/provider/factory.ts:57` carries an
explicit comment that `config.aiModel` is deliberately not read. This design builds the door and
wires the field.

Six independently-mergeable phases. The first adds **no user-visible behaviour at all**: it closes
#234's 17 mutation survivors, plus two Anthropic-only gates in `src/state` that #234 never swept, so
the OpenAI path is tested *before* it becomes reachable. Phases 2 and 3 split the settings work along
the coverage boundary — every provider/key decision becomes a pure function in `src/state`, and the
screen becomes a renderer with no logic of its own. Phase 4 attributes chat errors to a provider,
with the copy itself moved out of `src/app/ai-coach.tsx` and into a tested module. Phases 5 and 6 do
the same split for model config: resolution and plumbing first, then the picker.

Three decisions carry most of the weight. First, **switching provider clears the other provider's
key** (settled with the user), which keeps `ProviderConfig`'s "only one key is set per install"
docstring true rather than invalidating it — and makes the clear a *destructive* action that has to
be confirmed, persisted, and provably persisted. Second, **the model choice is a constrained list,
never free text**, because every AI failure in this app is swallowed, so a typo'd model id produces
four silently dead features and no error anywhere. Third, **`aiProvider` is written only when the
user operates the picker** — never on mount — so the existing implicit "whichever key is present"
fallback keeps working for the installs that never open the screen.

## Definition of Done

1. **The OpenAI path is covered before it is reachable.** All 17 mutation survivors named in #234
   are killed by named tests, `errorMapper.ts` is resolved, and the two Anthropic-only gates in
   `src/state` that #234 did not sweep (`shouldShowOnboardingCard`, `planPostWorkoutDebrief`) accept
   either key.

2. **A user can choose a provider and enter its key.** A new settings section, separate from the
   coach settings, offers a two-option provider picker followed by a key field belonging to the
   selected provider, with a provider-dependent placeholder.

3. **Only one key is ever stored.** Switching provider clears the outgoing provider's key *in
   persisted storage*, after a confirmation the user only sees when there is actually something to
   lose.

4. **Opening the screen writes nothing.** An install with `aiProvider` undefined and only
   `anthropicKey` set shows Anthropic pre-selected, and backing out without touching the picker
   leaves `aiProvider` undefined and the implicit fallback intact.

5. **The key is trimmed at exactly one boundary on the way in.** `apiKeyPatch` in `src/state` is the
   only place a raw input value becomes a stored key. The factory's existing trim stays as a second
   layer.

6. **Chat errors name the failing provider**, from a pure copy function in `src/state` that
   structurally cannot receive key material.

7. **`config.aiModel` is read.** `factory.ts` resolves per-surface models, all eight clients accept
   one, all four stores forward the setting, and a stored id the selected provider does not offer
   falls back to that provider's default without rewriting the setting.

8. **`npx tsc --noEmit` clean, `npm test` green, `npm run lint` at 0 errors, at every phase
   boundary.** Baseline verified on this branch at `11f53ed`: **90 suites, 1680 tests, `tsc` exit 0,
   lint 0 errors / 52 warnings.**

**Out of scope:** surfacing AI errors on the three one-shot surfaces (rest commentary, Question,
Replace) — they swallow every failure by design and AGENTS.md is explicit that a workout must never
depend on the AI; a third provider; per-surface *provider* selection (one provider serves all four
surfaces); live key validation against the provider's API; migrating `aiModel` to a provider-keyed
shape; hoisting the eight copies of the POST/parse boilerplate (tracked separately); wiring the
Anthropic clients through the still-dead `buildAnthropicBody`.

## Acceptance Criteria

### multi-provider-settings.AC1: The OpenAI path is covered before it is reachable

- **AC1.1 Success:** Each of the four stores (`aiChatStore`, `restCommentaryStore`,
  `exerciseQuestionStore`, `exerciseReplaceStore`) has a test that drives its surface to a successful
  response from a settings blob carrying **`openaiKey` and an empty `anthropicKey`**, asserting the
  injected `createClient` received a `ProviderConfig` whose `openaiKey` is the configured value.
  *Discrimination: a fixture that sets both keys cannot fail the mutant that drops `openaiKey` from
  `providerConfig` — the Anthropic key still resolves the provider and the surface still fires. The
  Anthropic key must be absent or empty.*
- **AC1.2 Success:** The `|| 'test-key'` fallback is gone from all three store test doubles
  (`restCommentaryStore.test.ts`, `exerciseQuestionStore.test.ts`, `exerciseReplaceStore.test.ts`),
  and each has a test asserting the **exact** forwarded key, so blanking `anthropicKey` in the
  store's `providerConfig` fails (#234's `E06`, `R05`).
- **AC1.3 Success:** `mapError` maps `OpenaiHttpError(401)` → `unauthorized`, `OpenaiHttpError(500)`
  → `{ kind: 'http', status: 500 }`, and `OpenaiUnreachable` → `network` (#234's `S01`, `S02`).
  *Discrimination: 401 alone cannot distinguish the `unauthorized` arm from the `else if
  (httpError.status)` arm. Both statuses are required.*
- **AC1.4 Success:** Each of the **eight** factory surface wrappers (4 surfaces × 2 providers) has a
  test asserting it forwards `system` to its client's `system` field and `message`/`messages` to its
  own field, using `toHaveBeenCalledWith` against an exact object. This is #234's `F23`/`F24` — the
  security-relevant one — plus `F19b`, `F20`, `F21`.
  *Discrimination: the fixture's `system` and `message` strings must be **distinct and both
  non-empty**. A fixture with `system: ''`, or with the two strings equal, cannot detect the swap
  that puts user free text where `IMMUTABLE_DIRECTIVES` ride. `messages` must be non-empty to detect
  `F20`/`F21`.*
- **AC1.5 Success:** `shouldShowOnboardingCard` (`src/state/coachOnboarding.ts:28`) returns `true`
  for an **OpenAI-only** blob with `onboardingState: 'unseen'`, and `false` for a blob with no key at
  all.
  *Discrimination: the positive case must be OpenAI-only, or it passes today. The no-key negative is
  required, or the mutant `return settings.onboardingState === 'unseen'` survives both.*
- **AC1.6 Success:** `planPostWorkoutDebrief` (`src/state/postWorkoutDebrief.ts:33`) returns a
  `DebriefMode` for an **OpenAI-only** blob, and `null` with no key. Same discrimination as AC1.5.
- **AC1.7 Success:** `exerciseQuestionStore`'s exported predicate is renamed `hasApiKey`,
  `src/app/session.tsx:24,407` imports and calls that name, and `grep -rn "hasAnthropicKey" src/`
  returns nothing. *(#234's `M9`: the name is a live misnomer that this phase makes actively
  misleading.)*
- **AC1.8 Success:** `src/ai/provider/errorMapper.ts`, `errorMapper.test.ts`, and
  `ProviderUnreachable`/`ProviderHttpError` in `types.ts` are deleted; `grep -rn
  "errorMapper\|ProviderUnreachable\|ProviderHttpError" src/` returns nothing.
- **AC1.9 Structural:** Every one of the 17 mutants tabulated in #234 is written by hand, verified to
  have changed the file and to pass `tsc`, run against the full suite, and confirmed to fail at least
  one **named** test. The mutant → test table is recorded in the PR. An anchor-miss count is
  reported.
  *This is the card's own definition of done. A survivor count taken on faith is the failure mode the
  card exists to record.*
- **AC1.10 Success:** No user-visible behaviour changes in this phase. `git diff
  origin/main...HEAD -- src/app src/components` shows only the `hasAnthropicKey` → `hasApiKey`
  rename.

### multi-provider-settings.AC2: The provider decision layer

All in `src/state/aiProviderSettings.ts`, pure, no storage access.

- **AC2.1 Success:** `initialProviderSelection` returns the explicit `aiProvider` even when the
  *other* provider's key is the one present: `{ aiProvider: 'openai', anthropicKey: 'sk-ant-x',
  openaiKey: '' }` → `'openai'`.
  *Discrimination: a fixture where the explicit provider agrees with the key present cannot
  distinguish "explicit wins" from "derived from keys". The two must disagree.*
- **AC2.2 Success:** With `aiProvider` absent: only `anthropicKey` → `'anthropic'`; only `openaiKey`
  → `'openai'`.
- **AC2.3 Edge:** With `aiProvider` absent and neither key set → `'anthropic'`, the display default.
- **AC2.4 Edge:** `{ anthropicKey: '   ', openaiKey: 'sk-o' }` → `'openai'`.
  *Discrimination: `'   '` is truthy but empty after trim. A fixture using `''` cannot distinguish
  `.trim().length > 0` from a bare truthiness check — the same weakness #128 round 2 classified as
  `F05`/`F06`.*
- **AC2.5 Success:** `providerSwitchPlan(settings, 'openai')` from an Anthropic install returns
  `patch` deep-equal to `{ aiProvider: 'openai', anthropicKey: '', aiModel: undefined }`.
  *Discrimination: assert with `toEqual` on the whole patch, so the key is asserted **present with
  value `''`**. A `toMatchObject` or an `objectContaining` passes a patch that omits the key
  entirely — which clears nothing.*
- **AC2.6 Success:** `needsConfirmation` is `true` only when the outgoing provider's stored key is
  non-empty after trim. Three fixtures: outgoing `'sk-ant-x'` → `true`; outgoing `''` → `false`;
  outgoing `'   '` → **`false`**.
  *Discrimination: the whitespace-only case is the legal-adjacent value. Without it, "confirms when
  there is something to lose" and "confirms whenever the field is truthy" are indistinguishable.*
- **AC2.7 Edge:** `providerSwitchPlan(settings, currentProvider)` — re-selecting the provider already
  active — returns `needsConfirmation: false` and a patch that clears **no** key.
  *Discrimination: this is the only case that separates "clears the provider that is not `next`" from
  "clears `next`'s own key". Every other fixture passes both implementations.*
- **AC2.8 Success:** `apiKeyPatch('anthropic', '  sk-ant-x\n')` returns `{ anthropicKey: 'sk-ant-x'
  }`.
  *Discrimination: the input **must** carry whitespace, and the assertion **must** be on the patch,
  not on what reaches the client. Because `factory.ts:76,116` already trims, every wire-level
  assertion passes against an untrimmed store — the mutant `return { [field]: raw }` survives any
  end-to-end check. This is the single-boundary requirement from Phase 3's shipped-untrimmed-key
  regression, and it is only observable here.*
- **AC2.9 Success:** `apiKeyPatch` writes only the selected provider's field — the patch has exactly
  one key.
- **AC2.10 Success:** `crossProviderKeyWarning` returns a non-null string for `('openai',
  'sk-ant-abc123')` and `null` for **all** of `('openai', 'sk-abc123')`, `('openai',
  'sk-proj-abc123')`, `('anthropic', 'sk-proj-abc123')`, `('anthropic', 'sk-ant-abc123')`, and
  `(either, '')`.
  *Discrimination: `'sk-abc123'` under OpenAI is the legal-adjacent value that kills a naive
  `startsWith('sk-')` — `sk-` is a prefix of `sk-ant-`. `'sk-proj-abc123'` under Anthropic is the
  legal-adjacent value that kills a per-provider allowlist implementation, which would warn on every
  OpenAI key shape the app does not happen to enumerate.*
- **AC2.11 Success:** The warning is computed on the trimmed value: `('openai', '  sk-ant-abc123  ')`
  is non-null.
- **AC2.12 Success:** The returned warning string contains no substring of the key: with the key
  `'sk-ant-CANARY123'`, `expect(warning).not.toContain('CANARY')`.
  *Discrimination: the fixture key must carry a distinctive tail, or a message that echoed the key
  would go unnoticed.*

### multi-provider-settings.AC3: The provider screen

`src/app` has zero jest coverage. Every criterion here is either a **structural read** recorded in
the PR or a **human-QA** step.

- **AC3.1 Structural:** `src/app/(tabs)/settings/ai-provider.tsx` exists and holds no provider/key
  decision logic. Concretely: `grep -n "sk-\|\.trim()\|aiProvider ===" ` on that file returns nothing
  outside the rendering of which row is selected, and every decision comes from
  `@/state/aiProviderSettings`.
  *This is what stops the warning rule, the trim, and the placeholder from acquiring a second,
  divergent copy in an untestable file.*
- **AC3.2 Structural:** The screen has **no** mount or focus effect that writes `aiProvider`.
  `aiProvider` appears in exactly one write, inside the picker's confirmed-selection handler.
  *This is the only check on "opening the screen writes nothing", and it cannot be a test: an
  automated fixture reading `getSettings()` after a mount cannot distinguish "no write" from "wrote
  the same value `initialProviderSelection` derives", because those are equal by construction. Only
  a storage-backend call-count assertion could — and no suite can mount the screen.*
- **AC3.3 Structural:** `setSettings` is **not** called directly anywhere in `ai-provider.tsx`. The
  only writer is the screen's `flush()`, and the provider-switch handler reaches it via
  `queueSave(plan.patch)` followed by `flush()`.
  *This is the fix for the debounce race described in Architecture. A bare `setSettings(plan.patch)`
  leaves a live 500 ms timer holding `{ anthropicKey: '<the key just typed>' }`, which fires
  afterwards and **restores the key the user just destroyed**.*
- **AC3.4 Structural:** `src/app/(tabs)/settings/ai.tsx` no longer contains `anthropicKey`; its title
  and the `AiSettingsPatch` type carry only goals / equipment / personality / age / experience.
- **AC3.5 Structural:** `settings/index.tsx` lists two rows, `SectionRow.href` is a union of both
  routes, and the AI Coach row's description no longer mentions an API key.
- **AC3.6 Human:** On a **fresh** install: pick OpenAI, paste a key, force-quit, relaunch, reopen the
  screen — OpenAI is still selected and the key field is populated.
- **AC3.7 Human:** With an Anthropic key configured: switch to OpenAI, confirm the dialog,
  **force-quit and relaunch**, then switch back to Anthropic — the Anthropic field is **empty**.
  *Discrimination: the relaunch is the whole criterion. Without it, "cleared on screen", "cleared in
  the in-memory cache" and "cleared in persisted storage" are indistinguishable, and the middle one
  is precisely the "believes they removed it and hasn't" failure.*
- **AC3.8 Human:** With **no** Anthropic key stored, switching to OpenAI shows **no** confirmation
  dialog. *(The screen half of AC2.6. A step run only with a key present cannot fail.)*
- **AC3.9 Human:** Type a key, then switch provider **within 500 ms** — before the debounce fires.
  Wait five seconds, force-quit, relaunch: the key is gone.
  *Discrimination: a step that switches after waiting for the debounce cannot fail, because there is
  no pending patch left to resurrect the key. The timing is the test.*
- **AC3.10 Human:** An **upgraded** (not fresh) Anthropic-only install opens the new screen: Anthropic
  is pre-selected, the key is intact, and the AI coach works without touching anything.
- **AC3.11 Human:** Tapping the picker opens a list of exactly two options with the current one
  marked, and dismissing it without choosing changes nothing.

### multi-provider-settings.AC4: Chat errors name the failing provider

- **AC4.1 Success:** `aiChatErrorMessage({ kind: 'unauthorized', provider: 'openai' })` names OpenAI;
  the same with `provider: 'anthropic'` names Anthropic; the two strings **differ**.
  *Discrimination: asserting only the OpenAI case cannot distinguish "names the provider" from
  "hardcodes OpenAI". Both cases and the inequality are required.*
- **AC4.2 Success:** `{ kind: 'missing_key', provider: 'openai' }` tells the user to add an **OpenAI**
  API key.
- **AC4.3 Edge:** `{ kind: 'missing_key', provider: null }` is provider-neutral and names neither
  provider.
- **AC4.4 Success:** No string `aiChatErrorMessage` can return contains `sk-`, and its parameter type
  is the `AiChatError` union, which carries no key field — so a leak is impossible by construction,
  not by filtering. Asserted over every `kind` × `provider` combination.
- **AC4.5 Success:** `mapError(new OpenaiHttpError(401, '…'))` → `{ kind: 'unauthorized', provider:
  'openai' }`; `mapError(new AnthropicHttpError(401, '…'))` → `provider: 'anthropic'`. Same for the
  two unreachable classes. *Discrimination: both providers, asserted to differ.*
- **AC4.6 Success:** With an **OpenAI-only** settings blob and a client that throws
  `OpenaiHttpError(401)`, `aiChatStore.send` leaves `error.provider === 'openai'`.
- **AC4.7 Success:** With `aiProvider: 'openai'` and **both keys empty**, `startTurn` sets `{ kind:
  'missing_key', provider: 'openai' }`.
- **AC4.8 Edge:** With `aiProvider` **absent** and both keys empty, `missing_key` carries `provider:
  null` — the store does not guess a provider the user never chose.
  *Discrimination: AC4.7 alone passes an implementation that derives the provider through
  `initialProviderSelection`, which defaults to `'anthropic'`. AC4.8 is what forbids that.*
- **AC4.9 Structural:** `src/app/ai-coach.tsx` calls `aiChatErrorMessage(error)` and holds no error
  copy of its own — `grep -n "API key\|Couldn't reach\|unreadable" src/app/ai-coach.tsx` returns
  nothing but the call site.
- **AC4.10 Success:** `src/ai/contextBuilder.test.ts` is unmodified — `git diff origin/main...HEAD --
  src/ai/contextBuilder.test.ts` returns nothing. The prompt secret-leak regression tests stay green
  untouched; they are about the prompt, not about error copy, and are not in this phase's scope.

### multi-provider-settings.AC5: Model resolution and plumbing

- **AC5.1 Success:** `resolveModels('anthropic', undefined)` returns `claude-sonnet-5` for both
  `chat` and `oneShot` — the ids already hardcoded in the four Anthropic clients, so an install with
  no model configuration produces byte-identical request bodies to today.
- **AC5.2 Success:** `resolveModels('openai', undefined)` returns `gpt-5.6-sol` for both.
- **AC5.3 Success:** A listed non-default id for the selected provider is returned as chosen.
- **AC5.4 Edge:** `resolveModels('anthropic', { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' })`
  returns the **Anthropic** defaults.
  *Discrimination: this is the "stored id the provider later rejects" criterion, and a cross-provider
  id is the value a real stale blob carries — it is exactly what a pre-clear install or a hand-edited
  blob would hold, and exactly what would 400. A nonsense id like `'not-a-model'` also passes a
  membership check but is not the reachable case.*
- **AC5.5 Edge:** `resolveModels(p, { chat: '<unlisted>', oneShot: '<listed non-default>' })` falls
  back for `chat` **only** and keeps the chosen `oneShot`.
  *Discrimination: per-field fallback. A fixture where both fields are unlisted cannot distinguish
  per-field from whole-object fallback.*
- **AC5.6 Success:** `resolveModels` never writes settings — a rejected id is ignored, not corrected.
  A model removed from the app's list in one release and restored in a later one restores the user's
  choice with no migration.
- **AC5.7 Success:** Each of the eight client factories accepts `{ apiKey, model? }`, places `model`
  in its request body, and **falls back to its existing constant when `model` is omitted**.
  *Discrimination: the omitted case must be asserted, or the mutant that writes `model:
  config.model` (undefined) into the body passes every new test while breaking every existing one
  only at runtime.*
- **AC5.8 Success:** `factory.ts` passes `models.chat` to the chat client and `models.oneShot` to the
  comment / suggest / ask clients, on **both** providers — eight assertions.
  *Discrimination: the fixture must configure **different** `chat` and `oneShot` ids. With them
  equal, the mutant that passes `models.chat` to all four surfaces survives every assertion.*
- **AC5.9 Success:** All four stores' `providerConfig` builders forward `settings.aiModel`, asserted
  with `toEqual` on the whole `ProviderConfig`.
  *Discrimination: `objectContaining` passes a builder that drops `aiModel`. This matters because the
  four builders currently forward only `{ anthropicKey, openaiKey, aiProvider }` — wiring the factory
  alone changes nothing.*
- **AC5.10 Structural:** `factory.ts`'s "`config.aiModel` is deliberately NOT read here" comment is
  gone and `config.aiModel` is read. The pinning test in `factory.test.ts` that asserted the
  accepted-but-ignored behaviour is replaced, not deleted silently.
- **AC5.11 Structural:** `getTokenBudget` is unchanged and still keyed on surface alone —
  `git diff origin/main...HEAD -- src/ai/provider/requestBuilder.ts` shows no change to the budgets
  or to `reasoning: { effort: 'none' }`. Per-surface *model* choice does not move a budget; the
  interaction between the two is handled by the constrained list, per Architecture.

### multi-provider-settings.AC6: Model picker, live verification, docs

- **AC6.1 Structural:** The provider screen renders two model pickers (chat, one-shot) over
  `AI_MODEL_CHOICES[selectedProvider]`, and `grep -n "claude-\|gpt-" src/app/` returns nothing — no
  model id literal lives in an untestable file.
- **AC6.2 Structural:** The provider-switch handler applies `providerSwitchPlan`'s **whole `patch`
  object** rather than a hand-built subset, so clearing `aiModel` cannot be forgotten independently
  of clearing the key.
- **AC6.3 Human:** Choose a non-default chat model, force-quit, relaunch — it is still selected.
- **AC6.4 Human:** **One live call per surface per provider — eight calls** — each producing visible
  output in the app, with the model id confirmed.
  *Discrimination: rest commentary at a 256-token budget is the surface that returns `status:
  'incomplete'` with **zero text and a bill** when the fixed `reasoning: { effort: 'none' }` contract
  does not hold for the chosen model, and every AI failure here is swallowed. A "did not crash" check
  passes that. The evidence must be the rendered text.*
- **AC6.5 Human:** With a non-default model selected, switch provider, confirm, relaunch — the model
  resets to the new provider's default and all four surfaces still work.
- **AC6.6 Success:** `AGENTS.md` records: the settings split and both routes; the one-key-per-install
  rule and the three layers that enforce it; the single trim boundary; the constrained model list and
  the fixed-contract constraint that governs its membership; the provider-attributed error copy
  module. `Last verified` bumped.
- **AC6.7 Structural:** `ProviderConfig`'s "Only one key is set per install" docstring is
  **unchanged**, and AGENTS.md states that the switch-clears rule is what keeps it true — so a future
  reader knows the sentence is load-bearing rather than incidental.
- **AC6.8 Human:** A routine drafted by the coach under an **OpenAI** key accepts and starts
  normally, and the same routine's post-workout debrief opens. *(The end-to-end proof that the
  OpenAI path is not merely reachable but complete.)*

### multi-provider-settings.AC7: Cross-cutting gates

- **AC7.1:** `npx tsc --noEmit` exit 0 at every phase boundary.
- **AC7.2:** `npm test` green — all suites, no carve-out — at every phase boundary. Baseline
  90 suites / 1680 tests.
- **AC7.3:** `npm run lint` at **0 errors** at every phase boundary; warning count reported per phase
  against the 52 baseline, with any increase attributed to a named line.

## Glossary

- **Surface**: One of the four places this app calls a model — `chat` (coach conversation, drafting,
  debrief, onboarding), `comment` (rest commentary), `suggest` (Replace alternates), `ask` (exercise
  Question). `AiClient` declares exactly these four methods.
- **Provider**: `'anthropic' | 'openai'`. One provider serves all four surfaces; there is no
  per-surface provider choice.
- **`ProviderConfig`**: The record `createAiClient` takes — `{ anthropicKey?, openaiKey?,
  aiProvider?, aiModel? }`. Built by each of the four stores from `BridgeSettings`.
- **`AiModelConfig`**: `{ chat: string; oneShot: string }` on `BridgeSettings.aiModel`. Declared in
  Phase 2 of the multi-provider work and read by nothing until this design's Phase 5. `oneShot`
  covers the three non-chat surfaces.
- **Implicit vs explicit provider resolution**: `factory.ts:resolveProvider` and
  `settings.ts:resolveAiProvider` both say "explicit `aiProvider` wins, else whichever key is present,
  else no choice". Installs predating this phase have `aiProvider` undefined and resolve implicitly.
- **`BridgeSettings` / `'bridge_settings'`**: The whole settings blob and its storage key. The name is
  a documented misnomer; the key must never be renamed — it holds every user's API key.
- **`queueSave` / `flush` / `pendingRef`**: The settings screens' 500 ms debounced autosave.
  `queueSave` merges a patch into `pendingRef` and re-arms a timer; `flush` writes `pendingRef`
  through `setSettings` and clears it. `flush` also runs on unmount and on focus.
- **The coverage boundary**: `jest.config.js` runs one `node` project whose `testMatch` covers
  `engine/db/interop/state/health/helpers/ai/theme/watch/components/export`. **`src/app` is not in
  it.** A green suite proves nothing about any screen.
- **Structural criterion**: A read-and-record check on source, used where nothing can be tested.
  Recorded in the PR description. The precedent is `coach-prescribed-weights.AC6.9`.
- **`getTokenBudget(surface)`**: The unexported per-surface output ceiling in `requestBuilder.ts` —
  chat 4096, alternates 1024, exerciseQuestion 512, restCommentary 256.
- **`reasoning: { effort: 'none' }`**: Sent unconditionally by `buildOpenAiBody` on every OpenAI
  request. Omitting it means `medium` on GPT-5.6, whose reasoning tokens bill as output tokens and
  count against `max_output_tokens`.
- **Mutation survivor**: A deliberate single-edit defect that the suite fails to fail on. #234's 17
  survivors are the coverage debt this design's Phase 1 closes.

## Architecture

### The shape of the problem is a coverage boundary, not a feature

Everything this phase adds is either a decision (which provider, which key, which model, what to say
when it breaks) or a rendering of that decision. Decisions are testable; rendering is not. `src/app`
is outside `jest.config.js`'s `testMatch`, so a screen change is invisible to all 1680 tests.

So the organising rule is: **every decision this feature makes lands in `src/state` or
`src/ai/provider` as a pure function, and the screen becomes a renderer with no branch of its own.**
That is what made `exerciseReplaceStore` the only fully-covered file in Phase 3's PR, and it is the
explicit instruction the coach-prescribed-weights plan derived from its own AC6.9 seam.

Three new pure modules carry the whole feature:

| Module | Owns | Phase |
|---|---|---|
| `src/state/aiProviderSettings.ts` | initial selection, switch plan, key patch, key warning, labels, placeholders | 2 |
| `src/state/aiChatErrorCopy.ts` | every user-visible chat error string | 4 |
| `src/ai/provider/models.ts` | the choice list, defaults, and per-field resolution | 5 |

The screens then contain: a `useState`, a `Pressable`, a `Modal`, and calls into those three. AC3.1,
AC3.2, AC3.3, AC4.9, AC6.1 and AC6.2 are the structural criteria that keep it that way, because
nothing else can.

### Coverage before reachability

#234's own conclusion is that its findings are "latent until the phase that exposes it", and that
"wiring a UI to an untested path is the risk this card exists to prevent". Phase 1 therefore ships
**first and alone**, with no user-visible change, and its exit condition is the mutant table, not a
green suite — a green suite is what #234 documents as insufficient.

Two gates #234 never swept turned up while reading, and both are live defects the moment the door
opens. Both are in `src/state`, so both are fully testable:

- **`src/state/coachOnboarding.ts:28`** — `shouldShowOnboardingCard` gates on `anthropicKey` only.
  Its own docstring says *"The key check must match what `aiChatStore.startTurn` enforces, or the
  card can open a conversation that immediately fails with `missing_key`"*. `startTurn` was widened in
  Phase 3 to accept either key; this was not. An OpenAI-only user gets no onboarding card, silently.
- **`src/state/postWorkoutDebrief.ts:33`** — `planPostWorkoutDebrief` gates on `anthropicKey` only.
  An OpenAI-only user finishes a workout and gets no debrief, silently.

These are not in #234's per-file table because that sweep covered the seven files Phase 3 *changed*.
The class is wider than the sweep: the search is `grep -rn "anthropicKey" src/state src/components
src/app | grep -v test`, and it must be re-run at the end of Phase 1, not assumed complete from a
prior list.

The two screen-level gates Phase 3's round-2 review flagged as `C3` (`ReplaceExercise.tsx:37`,
`ai-coach.tsx:96,124`) **were fixed before merge** — `ReplaceExercise.tsx:37` now calls
`canOfferReplace(sessionState, getSettings())` and `ai-coach.tsx:97,125` call `hasAiKey(settings)`.
They are not in this plan's scope.

### The settings split

Today: one row, "AI Coach" → `/settings/ai`, holding key + goals + equipment + personality + age +
experience + a Start/Redo button.

After:

| Route | Title | Holds |
|---|---|---|
| `/settings/ai-provider` | **AI Provider** | provider picker, key field, two model pickers |
| `/settings/ai` | AI Coach | goals, equipment, coaching style, age, experience, Start/Redo |

`SectionRow.href` in `settings/index.tsx` is currently the single-member literal type
`'/settings/ai'` and widens to a two-member union — a one-line change with one consumer.

**A verified trap for this phase:** Expo Router's typed routes come from `.expo/types/router.d.ts`,
which is gitignored and regenerated per-machine by Metro. The main checkout's copy (dated today)
enumerates exactly `/settings` and `/settings/ai` as literals. So `router.push('/settings/ai-provider')`
will fail `tsc` in **any checkout that has not run Metro since the route landed** — including a
reviewer's. AGENTS.md documents this hazard for *dynamic* routes; this is the static case, which the
existing note does not cover. Remedy: run the dev server once, or copy a fresh `router.d.ts`, before
concluding the push is wrong. *(This worktree has no `.expo/types` at all, which is why its `tsc` run
is clean — `expo-router` falls back to `string`. That fallback is itself a reason not to treat a
green `tsc` here as proof.)*

### The picker control

The user asked for a pull-down menu. Two ways to build one:

**`@expo/ui`'s SwiftUI `Picker` / `Menu`.** `@expo/ui@57.0.4` is already in `package.json` and ships
both. It is also imported **nowhere in `src/`** — `grep -rn "@expo/ui" src/` returns nothing. Its
first use in this app would be the first native SwiftUI view in the tree, requiring a `Host` wrapper,
and AGENTS.md is emphatic that a native module's failure mode is a **runtime crash at launch, not a
build error**, with `ios/` gitignored so the checkout's linkage state cannot be established from a
plan. Verifying it means `grep -c ExpoUI ios/Podfile.lock` after a prebuild.

**A `Pressable` trigger opening a `Modal` list.** The app already ships exactly this twice —
`ReplaceExercise.tsx` (`Modal` + `animationType="slide"` + backdrop + sheet) and `SetLogger.tsx`. It
is pure RN, needs no prebuild, and there are two options to display.

**Decision: the `Modal` sheet, following `ReplaceExercise.tsx`.** The `@expo/ui` path is a better
long-term control and is explicitly *deferred, not overlooked* — introducing the first native view in
the app inside a phase whose real content is settings plumbing puts a launch-crash risk on the
critical path of a change nothing can test. If it is adopted later, the decision layer built in Phase
2 is unchanged; only the renderer swaps.

### Storage: one key, cleared on switch

**Settled with the user: switching provider clears the other provider's key.** Only one key is ever
stored.

This was chosen partly to preserve an existing invariant rather than invalidate it.
`ProviderConfig`'s docstring says *"Only one key is set per install"* (`types.ts:33`). Under a
both-keys-stored design that sentence becomes false and has to be rewritten — the "stale prose
outliving its mechanism" pattern this repo has hit three times (`buildAnthropicBody`,
`errorMapper.ts`, the boilerplate count). Under this design it stays true, and **AGENTS.md records
that the switch-clears rule is what makes it true**, so a future reader treats the sentence as
load-bearing rather than incidental (AC6.7).

Three consequences, each a design commitment:

**1. The switch is confirmed — but only when there is something to lose.**

The field is `secureTextEntry`. The user cannot read back what they are about to destroy, may have it
nowhere else, and the picker is the *first* control on the screen, so an exploratory tap is a
plausible first interaction with no undo. So: `Alert.alert` with a destructive confirm.

But an unconditional confirmation is worse than none. On a fresh install, or when the outgoing
provider has no key, the dialog announces the loss of nothing and trains the user to dismiss it — at
which point the one dialog that matters gets dismissed too. `providerSwitchPlan` therefore returns
`needsConfirmation`, `true` only when the outgoing key is non-empty **after trim**.

The trimmed check is the discriminating detail: a whitespace-only stored key is not a key by every
other predicate in the codebase (`resolveAiProvider`, `resolveProvider`, `hasAiKey`, `hasApiKey` all
use `.trim()`), and confirming its loss would be a dialog about nothing. AC2.6's three fixtures pin
it.

**2. The clear is a real deletion, and clears to `''` rather than `undefined`.**

`queueSave` → `flush` → `setSettings` writes cache **and** persists. The switch goes through that
same path, so the cleared value reaches `expo-secure-store`, not just the on-screen field.

The cleared *value* is `''`, not `undefined`, for three reasons:

- **`JSON.stringify` drops `undefined` keys.** `setSettings` serialises the whole cache, so an
  `undefined` clear leaves **no positive evidence in the persisted blob** — "cleared" and "never set"
  become indistinguishable, to a test and to a human reading the blob. `''` is written.
- **`loadSettings` merges `{ ...cache, ...parsed }` over `DEFAULT_SETTINGS`.** An absent key
  rehydrates to the default, which is `undefined` today — correct by coincidence, and only for as
  long as the default stays `undefined`. `''` does not depend on that.
- **`''` is already the codebase's spelling of "no key".** `anthropicKey`'s own default is `''`, and
  every reader treats it as absent.

**A trap worth naming, because the codebase contains its exact inverse.** `buildSettingsPatch`
(`aiChatStore.ts:92`) deliberately **omits** `undefined` fields, and AGENTS.md documents why:
spreading an explicit `undefined` from a normalized OpenAI response would blank the other settings.
The provider-switch patch has the **opposite** requirement — it must carry an explicit blanking
value. Two patch builders in the same slice with opposite rules. An implementer who copies
`buildSettingsPatch`'s shape produces a switch that clears nothing, and AC2.5's `toEqual` (rather
than `toMatchObject`) is what catches it.

**3. The debounce can resurrect a cleared key, and the fix is one line in the right place.**

This is not hypothetical; it falls straight out of the existing autosave. Sequence:

1. User types an Anthropic key. `queueSave({ anthropicKey: 'sk-ant-x' })` sets `pendingRef` and arms
   a 500 ms timer.
2. Within 500 ms the user switches to OpenAI. If the handler calls `setSettings(plan.patch)`
   **directly**, the cleared value is written — and `pendingRef` still holds `{ anthropicKey:
   'sk-ant-x' }` with a live timer.
3. The timer fires. `flush()` writes `{ anthropicKey: 'sk-ant-x' }` back. **The key the user just
   destroyed is restored, persisted, and invisible** — the field on screen is empty.

The fix is to route the switch through the *same* mechanism as everything else:
`queueSave(plan.patch)` then `flush()`. `queueSave` merges `{ ...pendingRef.current, ...patch }`, so
the patch's `anthropicKey: ''` overwrites the pending `'sk-ant-x'` **before** anything is written,
and the immediate `flush()` clears the timer. One line, and it is correct by the merge order rather
than by a separate discard step.

AC3.3 is the structural criterion (`setSettings` never called directly in that file) and AC3.9 the
human one — **switch within 500 ms**, because a step that waits for the debounce first cannot fail.

### `aiProvider` stays unwritten until the user chooses

The requirement is exact: the picker shows the right initial value for legacy installs *without*
writing a setting they never chose, and the implicit fallback keeps working for anyone who never
opens the screen.

`initialProviderSelection(settings)` is display-only:

1. explicit `settings.aiProvider`, if set;
2. else whichever key is non-empty after trim;
3. else `'anthropic'`.

Steps 1–2 are `settings.ts:resolveAiProvider`'s rule. That function currently has **zero production
callers** — six tests and nothing else, the same dead-code shape as `errorMapper.ts` and
`buildAnthropicBody`. Building `initialProviderSelection` on top of it makes it live, which is
strictly better than deleting it or writing a fourth copy of the rule. Step 3 is the addition:
`resolveAiProvider` returns `null` for "neither or both", and a picker has to show something.

`aiProvider` is written **only** from the picker's confirmed-selection handler. Mounting the screen,
scrolling it, editing the key, backing out — none of them write it.

**This is the criterion nothing can test, and it is worth saying why rather than routing it to
human-QA and moving on.** An automated fixture that mounts the screen and reads `getSettings()`
cannot distinguish "no write" from "wrote exactly the value `initialProviderSelection` derives" —
those are equal by construction, for every fixture. Only an assertion on the *storage backend's call
count* discriminates, and no jest project can mount the screen to make one. A human step fares no
better: `expo-secure-store` is not queryable the way SQLite is, and nothing user-visible differs.
So AC3.2 is a structural read, and it is honest about being the only cover.

### Key-format validation: warn, never block, and only in the one detectable direction

The provider is known before the key is typed, so a cross-provider paste is detectable. Two questions:
whether to block, and what rule.

**Never block.** Every AI failure in this app is swallowed. A false-positive prefix check that
refuses to save a valid key produces an app with four dead AI features and no error anywhere — a
failure mode strictly worse than the paste it was preventing, and indistinguishable from a bug. The
field is `secureTextEntry`, so the user cannot even inspect what was rejected. AGENTS.md's standing
rule that AI failures must never break a workout points the same way. So: a non-blocking hint below
the field.

**The rule is asymmetric, and the asymmetry is the design.** Warn only on a *positive cross-provider
marker*:

- Anthropic keys carry an unmistakable `sk-ant-` prefix. `sk-ant-…` under an OpenAI selection can
  only be a mistake. **Warn.**
- OpenAI has no unmistakable marker — it has shipped `sk-`, `sk-proj-`, `sk-svcacct-` and org-scoped
  variants, and critically **`sk-` is a prefix of `sk-ant-`**. There is no rule that flags an OpenAI
  key under an Anthropic selection without also flagging future Anthropic-side shapes or firing on a
  half-pasted key. **Do not warn.**

The two legal-adjacent values that make AC2.10 discriminating fall straight out: `'sk-abc'` under
OpenAI (kills a naive `startsWith('sk-')`, since it is a legal OpenAI key *and* a prefix-match on the
Anthropic marker's own prefix) and `'sk-proj-abc'` under Anthropic (kills a per-provider allowlist,
which would warn on every OpenAI shape the app does not enumerate). Both must return `null`.

The check runs on the **trimmed** value (AC2.11), and the message never echoes the key (AC2.12) —
which is trivially true of a constant string and is asserted anyway, because the cheap version of this
feature is `` `That looks like an Anthropic key: ${key}` ``.

### Trimming: one boundary in, one boundary at the wire

Phase 3 shipped an untrimmed key to all four Anthropic surfaces because `factory.ts` trimmed only for
its emptiness check. That is fixed at `factory.ts:76,116`. But the **screen still persists raw** —
`ai.tsx:147` does `queueSave({ anthropicKey: value })` — so a key pasted with a trailing newline is
*stored* padded and trimmed only on its way to the wire.

`apiKeyPatch(provider, raw)` becomes the single named boundary on the way **in**, and the factory's
trim stays as a second layer. Keeping both mirrors the codebase's existing double-normalisation habit
(AGENTS.md: *"`exportService.ts` normalizes the same hazard a second time at the shell boundary …
**keep both layers**"*).

**The consequence for testing is sharp and easy to get wrong.** Because the factory trims, an
untrimmed *store* is invisible to every wire-level assertion — the mutant `apiKeyPatch` returning
`raw` instead of `raw.trim()` survives any end-to-end check, any simulator run, and any test that
asserts what reaches the client. **The only observation that discriminates is the patch itself**, and
the fixture must carry whitespace. AC2.8 says both. A human-QA step of the form "paste a padded key
and confirm the coach works" is exactly trap 8 — a scenario whose setup guarantees the failure cannot
occur — and is deliberately **not** in this plan.

One implementation note: only the *patch* is trimmed. The `useState` value stays raw, or the cursor
jumps while typing.

### Provider-attributed errors, and an honest correction to the rationale

The only user-visible AI error surface in the app is `ai-coach.tsx`'s banner; the three one-shot
surfaces swallow everything by design and stay that way.

`AiChatError` gains a `provider: AiProvider | null` field on every variant. Attribution comes from
two places, both already discriminated:

- `mapError` reads it off the error class — `AnthropicHttpError` / `AnthropicUnreachable` vs the
  `name`-tagged `Openai*` classes.
- `startTurn`'s `missing_key` reads `settings.aiProvider ?? null`. Explicitly **not**
  `initialProviderSelection`, which defaults to `'anthropic'` and would tell a user who picked OpenAI
  and left the key blank to go find an Anthropic key. AC4.8 forbids it.

**The secret-leak guarantee is structural.** `provider` is a two-member union, and
`aiChatErrorMessage` takes only the `AiChatError` union — no key field exists on its parameter type.
A leak is impossible by construction rather than by filtering. AC4.4 asserts it anyway across every
`kind` × `provider` combination, because "impossible by construction" is a claim about the type today.

`contextBuilder.test.ts`'s prompt secret-leak regression tests are untouched and stay green; they are
about the system prompt, not error copy. AC4.10 pins that as a `git diff` with no removed lines, so
the phase cannot be mistaken for having relaxed them.

**A verified blast-radius fact, and a correction to my own scope estimate.** Widening the union was
probed with `tsc` on this branch: it produces **exactly 6 errors, all construction sites, all inside
`src/state/aiChatStore.ts`**. `src/app/ai-coach.tsx` does not break — it reads `error.kind` and
`error.status` and never constructs. But `src/state/aiChatStore.test.ts` contains **12
`toEqual({ kind: … })` assertions** that break, because `toEqual` is exact. Those 12 are named work
inside Phase 4, in the same way the coach-prescribed-weights plan named its three value pins. **The
remedy is to add the `provider` field to each expected object, never to relax them to
`toMatchObject`** — the exactness is what makes AC4.6 and AC4.7 discriminating.

**One thing in the issue's reasoning no longer holds, and it should be recorded rather than quietly
inherited.** #122 justifies provider-named errors with: *"this phase is precisely what lets a user
hold two [keys], at which point 'API key rejected' does not tell them which key to fix."* With the
switch-clears decision, **this phase does not let a user hold two keys** — exactly one is ever stored,
so "API key rejected" is already unambiguous about *which key*. The original rationale is gone.

The feature is still worth building, on a different rationale: the user's mental model has two
providers, the settings screen shows a provider name, and *"OpenAI rejected your API key"* tells them
which **console, account and billing page** to go check — which is real information that "API key
rejected" does not carry. And `missing_key` naming the selected provider tells a user who picked
OpenAI which key to go get. The scope is unchanged; the justification is restated so a future reader
does not find the card's argument and discover it does not apply.

### Per-surface model config, and what it actually interacts with

`AiModelConfig` is `{ chat, oneShot }`. The mapping to surfaces is fixed: `chat` → the chat surface;
`oneShot` → comment, suggest, ask. All eight client factories currently hardcode a `MODEL` constant
(`claude-sonnet-5` ×4, `gpt-5.6-sol` ×4).

Wiring is three layers, and **all three are required or nothing changes**:

1. Each factory accepts `{ apiKey, model? }`, defaulting to its existing constant. Additive, so every
   existing test stays green.
2. `factory.ts` computes `resolveModels(provider, config.aiModel)` and passes `chat` / `oneShot` to
   the right clients.
3. **All four stores forward `settings.aiModel`.** They currently build `{ anthropicKey, openaiKey,
   aiProvider }` and stop (`aiChatStore.ts:137-139` and the three siblings). Wiring the factory alone
   is a no-op — the field never arrives.

Layer 3 is the one an implementer skips, because layers 1 and 2 look like the whole job and the tests
for them pass. AC5.9's `toEqual`-on-the-whole-`ProviderConfig` is what catches it.

**Constrained list, not free text.** A typo'd model id is a 400 or 404 on every request. Every AI
failure here is swallowed. So a free-text field converts one typo into four silently dead features
with no error anywhere and no way for the user to tell configuration from breakage. A list cannot be
typo'd.

**A stored id the provider later rejects.** Three layers, in order:

1. The list prevents it at entry.
2. `resolveModels` ignores any id not on the selected provider's current list and returns that
   provider's default for **that field only** (AC5.5). It does **not** rewrite the setting — a model
   pulled from the app's list in one release and restored in a later one restores the user's choice
   with no migration and no silent settings mutation. The reachable stale value is a **cross-provider
   id** (AC5.4): the one a blob written before the switch-clear rule, or hand-edited, would carry, and
   the one that would 400.
3. A model the *provider* deprecates while the app still lists it returns HTTP 400/404. On chat that
   surfaces as `{ kind: 'http', status, provider }` with provider-named copy. On the three one-shot
   surfaces it is swallowed — unchanged, by design, and an accepted consequence rather than an
   oversight.

**Does per-surface model choice interact with `getTokenBudget` and `reasoning: { effort }`?** The
triage asked directly. The answer is *yes, but not where it looks*:

- `getTokenBudget(surface)` is keyed on **surface alone**, is not exported, and is untouched by model
  choice. Budgets stay 4096 / 1024 / 512 / 256 whatever model is selected (AC5.11).
- The real coupling is that `buildOpenAiBody` sends `reasoning: { effort: 'none' }`
  **unconditionally**, and the four Anthropic clients send `thinking: { type: 'disabled' }`
  unconditionally — with `createRestCommentaryClient` additionally sending `output_config: { effort:
  'low' }`. These are a **fixed request contract**, not per-model negotiation. A model that rejects
  the `reasoning` parameter 400s the whole request. A reasoning-only model whose minimum effort is
  above `none` burns the 256-token rest-commentary budget on reasoning tokens and returns `status:
  'incomplete'` with **zero text and a bill** — the exact failure `requestBuilder.ts:145-161`
  documents, and one that ships silently because the surface swallows it.

So the interaction is real and it is discharged **through the list's membership**: the list may only
contain models for which the fixed contract and the fixed budgets are known-good. That makes adding a
model a change requiring a live call per surface, not a config edit — which is why Phase 6's first
task is to populate the list from a live `GET /v1/models` on both providers and probe each candidate
across all four surfaces, and why AC6.4 requires **rendered text** as evidence rather than "did not
crash". The list ships with the two ids already in the tree as its floor, so a provider whose probe
yields no second viable model still gets a working default rather than an invented id.

This constraint goes in AGENTS.md (AC6.6), because it is exactly the sort of rule that a later
"just add the new model" PR would violate without knowing it existed.

## Existing Patterns

- **Pure decisions in `src/state`, screens as renderers.** `coachOnboarding.ts` already does this
  explicitly — `dismissOnboardingPatch`'s docstring says it is a function precisely because *"the
  screens that call it live in `src/app`, which jest does not cover, so inlining … would put the
  decision permanently out of reach of any suite."* The three new modules are the same move.
- **`Modal` sheets for choosers.** `ReplaceExercise.tsx` and `SetLogger.tsx`.
- **Debounced autosave with unmount + focus flush.** `settings/ai.tsx:40-75`, reused unchanged on the
  new screen, with the one addition that the switch goes through `queueSave` rather than around it.
- **Additive optional parameters keep phases green.** The `model` argument on eight client factories,
  the same argument the coach-prescribed-weights plan made for its optional columns and fields.
- **Defense in depth at boundaries.** `apiKeyPatch` trims on write, `factory.ts` trims at the wire —
  the `exportService.ts` "keep both layers" pattern.
- **Structural criteria where nothing can be tested.** `coach-prescribed-weights.AC6.9`.
- **Value-pinning assertions break as expected work.** `aiChatStore.test.ts`'s 12 `toEqual` error
  assertions are this change's equivalent of `migrations.test.ts:11`.

**Divergences:** two, both argued above. (1) The provider-switch patch carries an **explicit**
blanking value, the exact inverse of `buildSettingsPatch`'s documented omit-undefined rule — the two
live in the same slice and the contrast is a trap. (2) `settings.ts:resolveAiProvider` gains its first
production caller, changing it from dead code to a live dependency; its behaviour is not modified.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Close #234 — cover the OpenAI path before it has a door

**Goal:** Every OpenAI code path Phase 3 shipped is exercised by a test, including the two
Anthropic-only gates #234's sweep did not reach. No user-visible change.

**Components:**
- `src/state/aiChatStore.test.ts`, `restCommentaryStore.test.ts`, `exerciseQuestionStore.test.ts`,
  `exerciseReplaceStore.test.ts` — one OpenAI-only settings blob per store; drop the `|| 'test-key'`
  fallback from the three doubles; `mapError` OpenAI arms.
- `src/ai/provider/factory.test.ts` — payload-channel assertions for all eight wrappers (`F23`/`F24`
  first).
- `src/state/coachOnboarding.ts` + test — `shouldShowOnboardingCard` accepts either key.
- `src/state/postWorkoutDebrief.ts` + test — `planPostWorkoutDebrief` accepts either key.
- `src/state/exerciseQuestionStore.ts`, `src/app/session.tsx` — rename `hasAnthropicKey` →
  `hasApiKey`. **The `src/app` consumer is in this phase**, because the rename breaks it.
- Delete `src/ai/provider/errorMapper.ts`, `errorMapper.test.ts`, and `ProviderUnreachable` /
  `ProviderHttpError` from `types.ts`.
- Re-run `grep -rn "anthropicKey" src/state src/components src/app | grep -v test` and record the
  result — the two gates above were found this way, and the list is not assumed complete.

**Dependencies:** None.

**Covers:** `AC1.1` – `AC1.10`

**Done when:** all 17 #234 mutants fail a named test, with the table and an anchor-miss count in the
PR; `npm test` green; `tsc` clean; lint 0 errors (this phase should *reduce* the warning count by one
if `ALTERNATES_MAX_TOKENS` is still unused).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: The provider decision layer

**Goal:** Every provider/key decision the screen will need exists as a tested pure function, so the
screen can contain none of them.

**Components:**
- `src/state/aiProviderSettings.ts` (new) — `initialProviderSelection`, `providerSwitchPlan`,
  `apiKeyPatch`, `crossProviderKeyWarning`, `PROVIDER_LABEL`, `keyPlaceholder`, `AI_PROVIDERS`.
  `initialProviderSelection` builds on `settings.ts:resolveAiProvider`, giving that function its
  first production caller.
- `src/state/aiProviderSettings.test.ts` (new) — the full matrix, including every legal-adjacent
  value AC2 names.

**Dependencies:** None. Ships before its consumer deliberately — see Additional Considerations.

**Covers:** `AC2.1` – `AC2.12`

**Done when:** `npm test` green; `tsc` clean; lint 0 errors. `providerSwitchPlan` clears `aiModel`
from this phase onward even though nothing reads it until Phase 5 — see the consequence sweep.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: The AI Provider screen and the settings split

**Goal:** A user can choose a provider and enter its key, and the coach settings keep their own
section.

**Components:**
- `src/app/(tabs)/settings/ai-provider.tsx` (new) — provider picker (`Pressable` + `Modal`, following
  `ReplaceExercise.tsx`), confirmation `Alert` gated on `plan.needsConfirmation`, key field with
  provider-dependent placeholder and the non-blocking cross-provider hint. Reuses `ai.tsx`'s
  `queueSave`/`flush` autosave verbatim. **The switch handler calls `queueSave(plan.patch)` then
  `flush()` — never `setSettings` directly.**
- `src/app/(tabs)/settings/ai.tsx` — remove the key field, its `useState`, its focus re-sync line and
  its `AiSettingsPatch` member.
- `src/app/(tabs)/settings/index.tsx` — second `SectionRow`; widen `href`; reword the AI Coach
  description.

**Dependencies:** Phase 2.

**Covers:** `AC3.1` – `AC3.11`

**Done when:** `tsc` clean **after regenerating `.expo/types/router.d.ts`** (see the typed-routes trap
— a stale file rejects the new static route); `npm test` green (unchanged — nothing here is
testable); lint 0 errors; the five structural reads recorded in the PR; the six simulator scenarios
pass with screenshots.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Chat errors name the failing provider

**Goal:** An OpenAI user whose key is rejected is told OpenAI rejected it, from a module that can be
tested.

**Components:**
- `src/state/aiChatErrorCopy.ts` (new) — `aiChatErrorMessage(error): string`, the sole home of every
  user-visible chat error string.
- `src/state/aiChatStore.ts` — `AiChatError` gains `provider: AiProvider | null` on all six variants;
  `mapError` attributes from the error class; `startTurn`'s `missing_key` uses `settings.aiProvider ??
  null`. **Verified blast radius: 6 `tsc` errors, all in this file.**
- `src/state/aiChatStore.test.ts` — **12 `toEqual({ kind: … })` assertions gain a `provider` field.**
  Expected work. Do **not** relax them to `toMatchObject`.
- `src/state/aiChatErrorCopy.test.ts` (new), plus OpenAI-only store cases for AC4.6–AC4.8.
- `src/app/ai-coach.tsx` — the `switch` at `:724-749` is replaced by one call to
  `aiChatErrorMessage(error)`.

**Dependencies:** Phase 1 (the OpenAI store fixtures this phase reuses), Phase 3 (so the errors are
reachable). Between Phases 3 and 4 an OpenAI user sees today's unattributed copy — the current
behaviour, stated rather than silent.

**Covers:** `AC4.1` – `AC4.10`

**Done when:** `npm test` green with the 12 assertions updated rather than weakened; `tsc` clean;
lint 0 errors; `git diff origin/main...HEAD -- src/ai/contextBuilder.test.ts` empty.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Model resolution and plumbing

**Goal:** `config.aiModel` is read, end to end, with no UI yet — so the whole mechanism is covered
before the untestable half arrives.

**Components:**
- `src/ai/provider/models.ts` (new) — `AI_MODEL_CHOICES`, `DEFAULT_MODELS`, `resolveModels`, seeded
  with `claude-sonnet-5` and `gpt-5.6-sol`.
- Eight client factories (`anthropicClient.ts` ×2, `alternatesClient.ts`, `exerciseQuestionClient.ts`,
  `openaiClient.ts` ×2, `openaiAlternatesClient.ts`, `openaiExerciseQuestionClient.ts`) — accept
  `{ apiKey, model? }`, default to the existing constant.
- `src/ai/provider/factory.ts` — read `config.aiModel`; delete the "deliberately NOT read" comment;
  pass `chat` / `oneShot`.
- `src/state/aiChatStore.ts`, `restCommentaryStore.ts`, `exerciseQuestionStore.ts`,
  `exerciseReplaceStore.ts` — forward `settings.aiModel` in `providerConfig`. **Required; the other
  two layers are a no-op without it.**
- `src/ai/provider/models.test.ts` (new), `factory.test.ts` (the eight model-routing assertions, with
  **different** chat and oneShot ids), the four store `toEqual` config assertions, and per-client
  model-in-body tests.

**Dependencies:** Phase 2 (`providerSwitchPlan` already clears `aiModel`).

**Covers:** `AC5.1` – `AC5.11`

**Done when:** `npm test` green; `tsc` clean; lint 0 errors; the `factory.test.ts` pinning test for
the accepted-but-ignored `aiModel` is *replaced* by real assertions, not deleted.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Model picker, live verification, docs

**Goal:** The user can pick models, the list contains only ids the fixed request contract is
known-good for, and AGENTS.md describes what exists.

**Components:**
- **Task 1, before any code:** `GET /v1/models` on both providers; for each candidate, one live call
  per surface through the app's actual bodies (fixed budget, `reasoning: { effort: 'none' }` /
  `thinking: { type: 'disabled' }`, and `output_config: { effort: 'low' }` on Anthropic rest
  commentary). Keep only ids that return **rendered text** on all four. Populate
  `AI_MODEL_CHOICES` from the survivors. This task exists so no model id is authored from memory.
- `src/app/(tabs)/settings/ai-provider.tsx` — two model pickers over
  `AI_MODEL_CHOICES[selectedProvider]`, same `Modal` control as the provider picker; the switch
  handler applies `providerSwitchPlan`'s whole `patch`.
- `src/state/aiProviderSettings.ts` — `modelSelectionPatch(current, field, id)`, so the screen still
  holds no decision.
- `AGENTS.md` — the settings split and both routes; the one-key-per-install rule and its three
  enforcement layers; the single trim boundary; the constrained list and the fixed-contract rule
  governing its membership; the error-copy module; `Last verified` bumped. **`ProviderConfig`'s
  docstring is left unchanged**, with AGENTS.md stating why it is still true.

**Dependencies:** Phases 3 and 5.

**Covers:** `AC6.1` – `AC6.8`

**Done when:** eight live calls evidenced by rendered output; `npm test` green; `tsc` clean; lint 0
errors; AGENTS.md describes only code that exists.
<!-- END_PHASE_6 -->

### AC × phase matrix

Three kinds of evidence, and the line is drawn on *what a reviewer has to do*: **automated** = a
jest assertion or a deterministic command (`grep`, `git diff`, `tsc`, `lint`); **structural** = read
the source and judge; **human** = run the app or carry out a manual procedure.

| AC | Phase | Evidence |
|---|---|---|
| AC1.1 - AC1.6 | 1 | automated (jest: `src/state`, `src/ai/provider`) |
| AC1.7, AC1.8 | 1 | automated (`grep` + `tsc`) |
| AC1.9 | 1 | **human** - the mutation sweep and the gate grep are procedures, not commands |
| AC1.10 | 1 | automated (three-dot `git diff`) |
| AC2.1 - AC2.12 | 2 | automated (jest: `src/state`) |
| AC3.1 - AC3.3 | 3 | **structural reads on `src/app`** |
| AC3.4, AC3.5 | 3 | automated (`grep`) |
| AC3.6 - AC3.11 | 3 | **human - simulator** |
| AC4.1 - AC4.8 | 4 | automated (jest: `src/state`) |
| AC4.9 | 4 | **structural read on `src/app`** |
| AC4.10 | 4 | automated (three-dot `git diff`) |
| AC5.1 - AC5.9 | 5 | automated (jest: `src/ai`, `src/state`) |
| AC5.10 | 5 | **structural read** |
| AC5.11 | 5 | automated (three-dot `git diff`) |
| AC6.1, AC6.2, AC6.6 | 6 | **structural reads** (`src/app`, `AGENTS.md`) |
| AC6.7 | 6 | automated (`git diff` on `types.ts`) |
| AC6.3 - AC6.5, AC6.8 | 6 | **human - simulator** |
| AC7.1 - AC7.3 | **gate on every phase** | automated (`tsc`, `jest`, `lint`) |

**Totals: 65 criteria - 46 automated, 8 structural, 11 human.**
Per group: AC1 9/0/1 - AC2 12/0/0 - AC3 2/3/6 - AC4 9/1/0 - AC5 10/1/0 - AC6 1/3/4 - AC7 3/0/0.

The eight structural reads are counted apart from the eleven human ones because they are a different
kind of evidence: a structural read is repeatable by a reviewer from the branch alone, where a
simulator step needs a device. Both are non-automated; only one is checkable without one.

Every AC belongs to exactly one phase's *Covers* list, with the single deliberate exception of
AC7.1–AC7.3, which are per-phase **gates** and appear in every phase's *Done when* rather than in one
*Covers*. Recording them against one phase would be false: a phase that leaves `tsc` broken is not
done, whichever phase it is. This is the same carve-out the coach-prescribed-weights plan made, and
the same reason.

The eight structural reads are counted separately from the nine human ones because they are a
different kind of evidence: a structural read is deterministic and repeatable by a reviewer with
`grep`, where a simulator step is not. Both are non-automated; only one is checkable from the branch.

**Consequence sweep.** Five pieces of work are consequences of one phase but land in another phase's
files, and each is assigned deliberately:

- **The `hasAnthropicKey` → `hasApiKey` rename** touches `src/app/session.tsx`, which no other phase
  edits. Assigned to **Phase 1**, because the rename is what breaks the consumer and a phase must not
  leave `tsc` broken for a later one to fix.
- **`providerSwitchPlan` clearing `aiModel`** is a consequence of Phase 5's model config but is
  written in **Phase 2**. The field already exists on `BridgeSettings`, so clearing it is legal and
  correct before anything reads it, and deferring it would mean editing the switch plan again in
  Phase 5 — where an implementer focused on model *resolution* would plausibly not think to. The gap
  between Phase 2 and Phase 5 is real and harmless: nothing reads `aiModel` in it.
- **The 12 `toEqual` assertions in `aiChatStore.test.ts`** break as a consequence of Phase 4's union
  widening and are named in Phase 4. Nothing else in the suite pins `AiChatError`'s shape — verified
  by grep.
- **The typed-routes regeneration** is a consequence of Phase 3's new static route but manifests as a
  `tsc` failure in *any* stale checkout, including a reviewer's. It is in Phase 3's *Done when* and
  in the PR description, because a reviewer who hits it will otherwise change correct code.
- **The four stores' `providerConfig` builders** are a consequence of Phase 5's factory wiring but
  live in `src/state`. Assigned to **Phase 5**, in the same phase as the factory read, because the
  factory read is a no-op without them and splitting them would produce a phase that looks done and
  changes nothing.

## Additional Considerations

**Phase 2 ships a module with no consumer, for one phase.** That is deliberate, and it is the one
place this plan diverges from the coach-prescribed-weights precedent (which folded `routineRevision`
into the phase that consumed it, on the grounds that "a counter nothing depends on is dead code").
The difference is size: `routineRevision` was five lines, and `aiProviderSettings.ts` is the entire
decision layer of the feature. Merging Phases 2 and 3 would put the whole decision layer *and* an
untestable screen in one PR — and the review history on #128 is that when a covered mechanism and an
untestable consumer land together, the review's attention goes to the covered half and the consumer
ships half-wired (that is `C3` exactly). Splitting them makes Phase 3 a pure structural-and-simulator
review with nothing else competing for attention. Lint will not flag the interim dead code; exported
functions are not unused-warned.

**`npm test` green is a weaker gate for this change than for most.** Phases 3 and 6 are almost
entirely `src/app`. A green suite at those boundaries proves the *rest* of the app still works and
says nothing about the feature. The real gates there are the structural reads and the simulator, and
the *Done when* clauses say so explicitly rather than leaning on AC7.2.

**The worktree's `tsc` is more permissive than the main checkout's.** This branch has no
`.expo/types/router.d.ts`, so `expo-router`'s route types fall back to `string` and every
`router.push` type-checks. The main checkout has a generated file enumerating exactly `/settings` and
`/settings/ai`. A `tsc` run in a worktree therefore **cannot** catch the new-route problem, and a
`tsc` run in a stale main checkout will report it falsely. Both directions are wrong; the fix is to
regenerate before believing either.

**Three dead-code items were found while reading, and each is resolved rather than left.**
`errorMapper.ts` is deleted (Phase 1) — keeping a second, unused error mapper beside a mapper that is
about to grow a provider field is the pattern this repo keeps re-learning. `resolveAiProvider` becomes
live (Phase 2). `buildAnthropicBody` stays dead and stays out of scope — routing the four Anthropic
clients through it would change four wire bodies and would have to absorb `output_config: { effort:
'low' }` and per-surface schemas, which is a refactor, not a phase of this feature. AGENTS.md already
describes it correctly ("Anthropic clients build their own request bodies") after #128's `I7` fix, so
no prose is left stale by leaving it.

**The three one-shot surfaces stay silent on failure, and that is not an oversight.** A model id the
provider rejects, a network failure, an exhausted budget — all of them produce nothing on the Replace
button, the Question button and the rest screen, because every AI failure there is swallowed so a
workout never depends on the AI. Making them speak is a separate change with its own design
questions, and this plan explicitly does not start it. The consequence is stated so a later reader
does not read the silence as a bug this phase introduced.

**One live-call obligation this plan will not let a phase skip.** #128's PR body flagged the OpenAI
surfaces as *"UNVALIDATED (no live calls made)"*, and `C2` — a Chat Completions body posted to the
Responses endpoint — is exactly the defect that admission predicted. Phase 6's AC6.4 requires eight
live calls with **rendered text** as evidence, and Phase 6 Task 1 requires them again for every model
id before it enters the list. A model that returns `status: 'incomplete'` with an empty body looks
identical to a working one from every angle except the screen.

**Two live gaps found while planning that are not #234's and are fixed here:**
`shouldShowOnboardingCard` and `planPostWorkoutDebrief` both gate on `anthropicKey` alone, in
`src/state`, where they are fully testable. The first contradicts its own docstring's stated contract
with `aiChatStore.startTurn`. Neither appears in #234's per-file table, because that sweep covered the
files Phase 3 *changed*, and neither of these was changed. **The lesson for the sweep, recorded in
Phase 1's task list: the search is a grep across `src/state`, `src/components` and `src/app`, re-run
at the end of the phase — not a re-read of a prior finding list.**
