# Multi-Provider Settings — Test Requirements

Maps every acceptance criterion in `docs/design-plans/2026-08-12-multi-provider-settings.md` to an
automated test, a structural read, or a documented human verification.

**Generated:** 2026-08-12. **Design:** `multi-provider-settings`. **Phases:** 6. **Issues:** #122
(this phase), #234 (closed by Phase 1), #128 (the prior phase whose reviews shaped this).

---

## Read this first: four facts that shape everything below

### 1. The baseline is green, and it was measured on this branch

```
npx tsc --noEmit   → exit 0
npx jest           → 90 suites, 1680 tests, all passing (13.8s)
npm run lint       → 0 errors, 51 warnings
```

Every gate below is plain, unqualified green. A failure in any suite is yours.

⚠ **Phase 1 changes the suite and test counts** by deleting `errorMapper.test.ts`. Report what you
measure; do not restate 90/1680.

### 2. The coverage boundary is where this feature lives, and that is the whole problem

`jest.config.js` runs **one `node` project**. Its `testMatch` globs
`src/{engine,db,interop,state,health,helpers,ai,theme,watch,components,export}`.

- **`src/app/` is not in the glob at all.** The settings screen, the coach screen, the session
  screen — none are loadable by any suite.
- **`src/components/` is in the glob but has no RN environment**, so nothing renders. This change
  touches no component.

The design's response is to make every *decision* a pure function in `src/state` or
`src/ai/provider`, leaving the screen as a renderer. That is why **46 of 65 criteria are automated**
on a change whose headline deliverable is a settings screen.

⚠ **That move leaves the same seam the coach-prescribed-weights plan hit with `routineRevision`:
pushing a mechanism into a covered module covers the mechanism, not its use.** An implementation can
pass every AC2 case with a screen that calls none of those functions. **The eight structural reads —
AC3.1, AC3.2, AC3.3, AC4.9, AC5.10, AC6.1, AC6.2 and AC6.6 — span that seam**, and they are the only
things that do.

### 3. Two things are pinned by value and break as expected work

`tsc` staying clean is not the whole greenness story.

| Assertion | Breaks in | Remedy |
|---|---|---|
| **12 × `toEqual({ kind: … })` in `src/state/aiChatStore.test.ts`** (`:203, 218, 232, 244, 466, 690, 701, 724, 1032, 1059`, +2) | **Phase 4** | Add the `provider` field to each expected object. ⚠ **Do NOT relax to `toMatchObject`** — the exactness is what makes AC4.6–AC4.8 discriminating. |
| The accepted-but-ignored `aiModel` pinning test in `src/ai/provider/factory.test.ts` | **Phase 5** | **Replace** it with real routing assertions. Deleting it silently is the pattern #128 round 1 flagged. |

**Sweep result for everything else:** two inline snapshots exist in the repo (`AI_TURN_SCHEMA`,
`ALTERNATES_SCHEMA`), neither touched; no test enumerates `BridgeSettings`' keys; no test asserts a
`ProviderConfig` by identity outside the four store tests this change updates deliberately. Each
phase's task list nonetheless says: grep for value pins on anything it edits.

### 4. This change makes an untested path reachable, so coverage comes first

#234's own conclusion: *"Wiring a UI to an untested path is the risk this card exists to prevent."*
Phase 1 therefore ships **first and alone**, with no user-visible change, and its exit condition is
a hand-written mutant table — not a green suite, which #234 documents as insufficient (the suite was
green at 50% kill rate).

---

## Automated coverage

### AC1 — The OpenAI path is covered before it is reachable (Phase 1)

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC1.1** | unit ×4 | the four store test files | Each store driven from `{ anthropicKey: '', openaiKey: 'sk-openai-123' }`, asserting the forwarded `ProviderConfig` with `toEqual`. ⚠ **`anthropicKey` MUST be empty** — with both keys set, the mutants that drop `openaiKey` (`S06`, `E04`, `R04`, `X04`) still resolve a provider and still fire the surface. That is the criterion's entire content. ⚠ **`toEqual`, not `objectContaining`** — a partial match passes a builder that drops a field. Also add the both-keys-empty negative, or `S05` survives. Phase 1 Task 2. |
| **AC1.2** | static + unit | the three store test doubles | `! grep -rq "|| 'test-key'" src/` and a test asserting the **exact** forwarded key so `E06`/`R05` fail. ⚠ Do not substitute another default. Phase 1 Task 1. |
| **AC1.3** | unit | `aiChatStore.test.ts` | `OpenaiHttpError(401)` → `unauthorized`; `OpenaiHttpError(500)` → `{ http, 500 }`; `OpenaiUnreachable` → `network`. ⚠ **The 500 case is required** — with only 401 the `else if (httpError.status)` arm is unexercised. Phase 1 Task 3. |
| **AC1.4** | unit ×2 | `factory.test.ts` | All eight wrappers forward `system`→`system` and `message`/`messages` to their own field, via `toHaveBeenCalledWith` on an exact object. ⚠ **The `system` and `message` sentinels must differ and neither may be empty.** With `system: ''` or `SYS === MSG` the `F23`/`F24` channel swap is invisible — and that swap puts user free text where `IMMUTABLE_DIRECTIVES` ride, which `requestBuilder.ts:94-100` documents as a *channel* guarantee. ⚠ `messages` non-empty, or `F20`/`F21` survive. Phase 1 Task 4. |
| **AC1.5** | unit | `coachOnboarding.test.ts` | OpenAI-only + `unseen` → `true`; **no key at all** → `false`. ⚠ The positive **must** be OpenAI-only or it passes today; the negative is required or the mutant `return settings.onboardingState === 'unseen'` survives both. Phase 1 Task 5. |
| **AC1.6** | unit | `postWorkoutDebrief.test.ts` | Same two cases against `planPostWorkoutDebrief`. Same discrimination. Phase 1 Task 6. |
| **AC1.7** | static + `tsc` | — | `! grep -rq "hasAnthropicKey" src/`; `src/app/session.tsx` imports `hasApiKey`; `tsc` exit 0. ⚠ Collapse with the existing module-private `hasApiKey` at `exerciseQuestionStore.ts:129` rather than creating two exported names. Phase 1 Task 7. |
| **AC1.8** | static + `tsc` | — | `! grep -rq "errorMapper\|ProviderUnreachable\|ProviderHttpError" src/`. Phase 1 Task 8. |
| **AC1.9** | mutation | — | All 17 #234 mutants written by hand, each verified to have changed the file and passed `tsc` before its run, each confirmed to fail a **named** test. Table + **anchor-miss count** in the PR. ⚠ A mis-anchored mutant is indistinguishable from a real gap; report the count even when it is zero. Phase 1 Task 9. |
| **AC1.10** | static | — | `git diff origin/main...HEAD -- src/app src/components` shows the rename only. Phase 1 Task 9. |

### AC2 — The provider decision layer (Phase 2)

All in `src/state/aiProviderSettings.test.ts`, all pure unit tests. This is the best-covered part of
the change and it carries the settings screen's entire behaviour.

| AC | Type | What it must verify |
|---|---|---|
| **AC2.1** | unit | `{ aiProvider: 'openai', anthropicKey: 'sk-ant-x', openaiKey: '' }` → `'openai'`. ⚠ **The explicit provider and the present key must disagree.** When they agree, "explicit wins" and "derived from keys" return the same value and the fixture cannot tell them apart. |
| **AC2.2** | unit | Anthropic-only → `'anthropic'`; OpenAI-only → `'openai'`. |
| **AC2.3** | unit | Nothing configured → `'anthropic'` (the display default; `resolveAiProvider` returns `null` here and a picker must show something). |
| **AC2.4** | unit | `{ anthropicKey: '   ', openaiKey: 'sk-o' }` → `'openai'`. ⚠ **`'   '`, not `''`.** Only a truthy-but-empty-after-trim value distinguishes `.trim().length > 0` from a bare truthiness check — the weakness #128 round 2 classified as `F05`/`F06`. |
| **AC2.5** | unit | `providerSwitchPlan(anthropicInstall, 'openai').patch` **`toEqual`** `{ aiProvider: 'openai', anthropicKey: '', aiModel: undefined }`. ⚠ **`toEqual`, never `toMatchObject`.** A partial match passes a patch that omits `anthropicKey` — which clears nothing, silently, permanently. The criterion is "present with value `''`", not "absent". ⚠ `toEqual` treats explicit and absent `undefined` alike; add `expect('aiModel' in patch).toBe(true)` to pin that half. Mirror-image test for the other direction. |
| **AC2.6** | unit ×3 | `needsConfirmation`: outgoing `'sk-ant-x'` → `true`; `''` → `false`; **`'   '` → `false`**. ⚠ The whitespace case is the legal-adjacent value; without it, "confirms when there is something to lose" and "confirms whenever the field is truthy" are indistinguishable. |
| **AC2.7** | unit | `providerSwitchPlan(settings, currentProvider)` → `needsConfirmation: false`, patch `toEqual { aiProvider: current }`, and `patch.anthropicKey` undefined. ⚠ **The only fixture that separates "clears the provider that is not `next`" from "clears `next`'s own key".** Every other case passes both, so an implementation that wipes the key the user is actively using ships green without this. |
| **AC2.8** | unit | `apiKeyPatch('anthropic', '  sk-ant-x\n')` → `{ anthropicKey: 'sk-ant-x' }`. ⚠ **The input must carry whitespace and the assertion must be on the patch.** `factory.ts:76,116` already trims at the wire, so the mutant `return { [field]: raw }` survives every end-to-end check, every simulator run, and any assertion on what reaches the client. **This test is the only thing in the repo that can see an untrimmed store** — and the previous phase of this work shipped exactly that regression. |
| **AC2.9** | unit | `Object.keys(apiKeyPatch('openai', 'sk-x'))` `toEqual` `['openaiKey']`. |
| **AC2.10** | unit ×7 | Warns: `('openai', 'sk-ant-CANARY123')`. Does **not** warn: `('openai', 'sk-CANARY123')`, `('openai', 'sk-proj-CANARY123')`, `('anthropic', 'sk-proj-CANARY123')`, `('anthropic', 'sk-ant-CANARY123')`, `(either, '')`. ⚠ **`('openai', 'sk-CANARY123')` is the value that kills a naive `startsWith('sk-')`** — `sk-` is a legal OpenAI prefix *and* a prefix of the Anthropic marker. ⚠ **`('anthropic', 'sk-proj-CANARY123')` is the value that kills a per-provider allowlist**, which would warn on every OpenAI key shape the app does not enumerate. A suite of matches plus `'not-a-key'` proves nothing. |
| **AC2.11** | unit | `('openai', '  sk-ant-CANARY123  ')` warns. |
| **AC2.12** | unit | The warning `not.toContain('CANARY')`. ⚠ The distinctive tail is what makes this able to fail. |

### AC3 — The provider screen (Phase 3)

**Nothing here is automated.** Five structural reads and six simulator scenarios — see the two
sections below.

### AC4 — Chat errors name the failing provider (Phase 4)

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC4.1** | unit | `aiChatErrorCopy.test.ts` | `unauthorized` with `'anthropic'` contains "Anthropic", with `'openai'` contains "OpenAI", **and the two strings differ**. ⚠ **Asserting only the OpenAI case cannot distinguish "names the provider" from "hardcodes OpenAI"** — the single most likely way to get this wrong. Phase 4 Task 3. |
| **AC4.2** | unit | `aiChatErrorCopy.test.ts` | `missing_key` + `'openai'` contains "OpenAI API key". |
| **AC4.3** | unit | `aiChatErrorCopy.test.ts` | `missing_key` + `null` names **neither** provider. |
| **AC4.4** | unit ×18 | `aiChatErrorCopy.test.ts` | Every `kind` × `provider` combination returns a non-empty string containing no `sk-`. ⚠ **Enumerate all 18.** A spot check leaves arms unexercised, and an unexercised arm is where a `${JSON.stringify(error)}` debug line lives. The stronger guarantee is structural — the parameter type has no key field — but "impossible by construction" is a claim about today's type. |
| **AC4.5** | unit ×4 | `aiChatStore.test.ts` | `mapError` attributes both HTTP classes and both unreachable classes to the right provider, asserted to differ. ⚠ Keep `instanceof` for Anthropic and `error.name` for OpenAI; **`constructor.name` breaks under Metro's Release minifier** (#128 `I1`) and jest cannot see it. Phase 4 Task 4. |
| **AC4.6** | unit | `aiChatStore.test.ts` | OpenAI-only blob + `OpenaiHttpError(401)` → `{ kind: 'unauthorized', provider: 'openai' }`. |
| **AC4.7** | unit | `aiChatStore.test.ts` | `aiProvider: 'openai'`, both keys empty → `{ kind: 'missing_key', provider: 'openai' }`. |
| **AC4.8** | unit | `aiChatStore.test.ts` | `aiProvider` **absent**, both keys empty → `provider: null`. ⚠ **AC4.7 and AC4.8 are a pair.** AC4.7 alone passes an implementation deriving the provider through `initialProviderSelection`, which defaults to `'anthropic'` and would tell an OpenAI user to find an Anthropic key. AC4.8 is what forbids it; neither is sufficient alone. |
| **AC4.9** | structural | — (`src/app/ai-coach.tsx`) | `grep -n "API key\|Couldn't reach\|unreadable\|Something went wrong" src/app/ai-coach.tsx` → empty, and the render path calls `aiChatErrorMessage(error)`. Recorded in the PR. |
| **AC4.10** | static | — | `git diff origin/main...HEAD -- src/ai/contextBuilder.test.ts` → empty. Those are the **prompt** secret-leak tests; this phase neither modifies them nor leans on them. Three-dot. |

### AC5 — Model resolution and plumbing (Phase 5)

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC5.1** | unit | `models.test.ts` | `resolveModels('anthropic', undefined)` `toEqual` `{ chat: 'claude-sonnet-5', oneShot: 'claude-sonnet-5' }`. ⚠ **Hard-code the ids.** `toEqual(DEFAULT_MODELS.anthropic)` is a tautology that passes if the constant is wrong. |
| **AC5.2** | unit | `models.test.ts` | Same for `'openai'` / `gpt-5.6-sol`. |
| **AC5.3** | unit | `models.test.ts` | A listed non-default id is returned unchanged. |
| **AC5.4** | unit | `models.test.ts` | `resolveModels('anthropic', { chat: 'gpt-5.6-sol', oneShot: 'gpt-5.6-sol' })` → the Anthropic defaults. ⚠ **A cross-provider id, not `'not-a-model'`.** Both pass a membership check, but the cross-provider id is the value a real stale blob carries and the one that would 400 — this criterion is about the reachable case. |
| **AC5.5** | unit | `models.test.ts` | One unlisted field + one listed field → fallback on the unlisted **only**. ⚠ **With both fields bad, per-field and whole-object fallback are indistinguishable.** If Phase 6's list has not yet grown a second id, write this against a temporary constant rather than skipping it. |
| **AC5.6** | unit | `models.test.ts` | The input object is not mutated and no settings write occurs. |
| **AC5.7** | unit ×16 | the eight client test files | Each factory: `{ apiKey, model: 'x' }` → `body.model === 'x'`, **and** `{ apiKey }` → `body.model === <the constant>`. ⚠ **The omitted case is required**, or the mutant `const model = config.model` (undefined in every body) passes every new test. |
| **AC5.8** | unit ×2 | `factory.test.ts` | Per provider: chat client gets `models.chat`; comment/suggest/ask get `models.oneShot`. ⚠ **The fixture's `chat` and `oneShot` ids must DIFFER.** With them equal, the mutant passing `models.chat` to all four surfaces survives every assertion — and being able to differ is the entire point of `AiModelConfig`. |
| **AC5.9** | unit ×4 | the four store test files | The forwarded `ProviderConfig` includes `aiModel`, with a fixture whose `aiModel` is a **non-undefined value** (`{ chat: string, oneShot: string }`), asserted by value in an exact-match `toHaveBeenCalledWith`. ⚠ **Jest's `toEqual` ignores properties whose value is `undefined`**, so a store hardcoding `aiModel: undefined` passes an exact-match fixture that carries no `aiModel` — this is Trap 2. Layers 1 and 2 without layer 3 is a no-op that tests green. For the absent case use `Object.keys(receivedConfig).includes('aiModel')` to pin the inversion. |
| **AC5.10** | structural | — | `! grep -n "deliberately NOT read" src/ai/provider/factory.ts`; the pinning test **replaced**, not deleted. |
| **AC5.11** | static | — | `git diff origin/main...HEAD -- src/ai/provider/requestBuilder.ts` → empty. `getTokenBudget` stays surface-keyed; the model/budget coupling is discharged through the list's membership, not here. |

### AC6 — Model picker, live verification, docs (Phase 6)

| AC | Type | Test file | What it must verify |
|---|---|---|---|
| **AC6.1** | structural + unit | `aiProviderSettings.test.ts` | `! grep -rq "claude-\|gpt-" src/app/`. Plus `modelSelectionPatch` tests: changes **only** the named field (⚠ the two fields must hold *different* values, or per-field and whole-object are indistinguishable), and normalises an unlisted stored id before writing. |
| **AC6.2** | structural | — | The switch handler applies `plan.patch` as a whole object. `grep -n "plan.patch"` on the screen. ⚠ A hand-built `{ aiProvider, anthropicKey: '' }` clears the key and keeps a cross-provider model id — a config the new provider rejects on every request. |
| **AC6.6** | read | `AGENTS.md` | Every paragraph listed in Phase 6 Task 6 is present and describes code that exists. |
| **AC6.7** | read | `src/ai/provider/types.ts` | The `ProviderConfig` docstring is byte-unchanged, and AGENTS.md states that the clear-on-switch rule is what keeps it true. |
| **AC6.3, AC6.4, AC6.5, AC6.8** | — | — | **Human — H10, H11, H12, H13.** |

### AC7 — Cross-cutting gates

| AC | Command | When |
|---|---|---|
| **AC7.1** | `npx tsc --noEmit` | every phase boundary |
| **AC7.2** | `npm test` — plain green, every suite | every phase boundary (counts change after Phase 1) |
| **AC7.3** | `npm run lint` — **0 errors**; warning count reported against the 52 baseline | every phase boundary |

---

## Structural reads

Eight. Each is deterministic and re-runnable by a reviewer with `grep`, which is why they are counted
separately from the simulator steps. All are recorded in the relevant PR description.

| ID | AC | Check | Why nothing else can cover it |
|---|---|---|---|
| **S1** | AC3.1 | `! grep -n "sk-\|\.trim()" src/app/(tabs)/settings/ai-provider.tsx` | Stops the warning rule, the trim and the placeholder acquiring a second, divergent copy in an untestable file — which is how the tested one drifts. |
| **S2** | AC3.2 | `aiProvider` written in exactly one place, and no mount/focus effect writes it | ⚠ **This one is worth reading twice.** An automated fixture that mounts the screen and reads `getSettings()` cannot distinguish "wrote nothing" from "wrote exactly the value `initialProviderSelection` derives" — those are equal **by construction, for every fixture**. Only a storage-backend call-count assertion discriminates, and no suite can mount the screen. A human step is no better: `expo-secure-store` is not queryable and nothing user-visible differs. This read is the only cover that exists. |
| **S3** | AC3.3 | `grep -n "setSettings" src/app/(tabs)/settings/ai-provider.tsx` shows import + exactly one call, inside `flush()` | A bare `setSettings(plan.patch)` leaves a live 500 ms autosave patch holding the key the user just typed; it fires afterwards and **restores the key they just destroyed**, persisted and invisible. H9 is the only other check, and it needs sub-second timing. |
| **S4** | AC3.4 | `! grep -n "anthropicKey" src/app/(tabs)/settings/ai.tsx` | — |
| **S5** | AC3.5 | `settings/index.tsx` has a two-member `href` union, two rows, and no "API key" in the AI Coach description | — |
| **S6** | AC4.9 | `! grep -n "API key\|Couldn't reach\|unreadable" src/app/ai-coach.tsx` | The copy is now tested; this proves the screen uses the tested copy rather than keeping its own. |
| **S7** | AC6.1 | `! grep -rq "claude-\|gpt-" src/app/` | A model id literal in an uncovered file is a 404 nothing can catch. |
| **S8** | AC6.2 | The switch handler applies `plan.patch` whole | See AC6.2's note. |

---

## Human verification

**Twelve procedures covering eleven criteria** (AC1.9 needs two: the mutant table and the gate
sweep). Each names *why* it cannot be automated and *what would make it vacuous*.

Numbering runs H1-H2 (Phase 1), H4-H9 (Phase 3), H10-H13 (Phase 6). **H3 is deliberately absent** -
it was AC1.10's `git diff`, which is a deterministic command and therefore counted as automated, not
human. The gap is left rather than renumbered so the IDs in the phase files stay stable.

### Phase 3 — the provider screen

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H4** | AC3.6 | **Fresh install.** Pick OpenAI → paste a key → **force-quit** → relaunch → reopen. OpenAI selected, key populated. | screenshots before/after relaunch |
| **H5** | AC3.7 | Anthropic key configured → switch to OpenAI → confirm → **force-quit and relaunch** → switch back to Anthropic. The field is **empty**. ⚠ **The relaunch is the entire criterion.** Without it, "cleared on screen", "cleared in the in-memory cache" and "cleared in persisted storage" are indistinguishable — and the middle one is exactly the "user believes they removed a key and hasn't" failure this design exists to prevent. | screenshots + an explicit note that the app was relaunched |
| **H6** | AC3.8 | With **no** Anthropic key stored, switch to OpenAI. **No dialog appears.** ⚠ A step run only with a key present cannot fail; this is the negative half of `needsConfirmation` and the reason the dialog is conditional at all. | screenshot of the immediate switch |
| **H7** | AC3.9 | Type a key, then switch provider **within 500 ms**. Wait 5s, force-quit, relaunch. The key is gone. ⚠ **The timing is the test.** Switching after the debounce has flushed cannot fail — there is nothing pending left to resurrect the key. This and S3 are the only checks on the `queueSave`-not-`setSettings` rule. | short screen recording (a still cannot show the timing) |
| **H8** | AC3.10 | **Upgraded, not fresh** install with only an Anthropic key: open the new screen. Anthropic pre-selected, key intact, coach works untouched. ⚠ **Do not uninstall first.** Uninstalling destroys the legacy blob and turns this into a fresh-install test, which structurally cannot exercise the `aiProvider: undefined` path this criterion is about. | screenshot + a note that the install was an upgrade |
| **H9** | AC3.11 | Tap the picker: exactly two options, current one marked. **Dismiss without choosing** → key intact, provider unchanged. | screenshots of both states |

⚠ **A step that is NOT in this plan, deliberately:** "paste a padded key and confirm the coach
works". It cannot fail. `factory.ts:76,116` trims at the wire, so a padded *stored* key still works
end to end. AC2.8's patch-level assertion is the only cover, and adding a vacuous manual step
alongside it would read as a second layer of protection that does not exist.

### Phase 6 — models and end-to-end

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H10** | AC6.3 | Choose a non-default chat model → force-quit → relaunch. Still selected. ⚠ If Phase 6 Task 1 yielded only one id for that provider, report **not applicable with the reason** — a claimed pass on an unrunnable scenario is worse than a gap. | screenshot |
| **H11** | AC6.4 | **Eight live calls — four surfaces × two providers.** Coach conversation, rest-screen commentary, the exercise Question button, the Replace button. ⚠ **The evidence is rendered text, not the absence of a crash.** Rest commentary at 256 tokens is the surface that returns `status: 'incomplete'` with zero output and a bill when the fixed `reasoning`/`thinking` contract does not hold for the chosen model — and it swallows the failure, so a "did not crash" check passes it. `requestBuilder.ts:145-161` records that this exact failure "would have shipped silently dead". | **eight screenshots**, each showing text on screen |
| **H12** | AC6.5 | With a non-default model selected: switch provider → confirm → relaunch. The model resets to the new provider's default and all four surfaces work. ⚠ The relaunch again: without it a cleared-in-cache-only implementation is indistinguishable. | screenshots + relaunch note |
| **H13** | AC6.8 | Under an **OpenAI** key: ask the coach for a routine → accept → start the session → finish it → the post-workout debrief opens. ⚠ The debrief half is the **only** user-visible check on `planPostWorkoutDebrief`'s Phase 1 widening. Do not stop at accepting the routine. | screenshots of the draft, the accepted routine, and the debrief's first coach message |

### Phase 1 — the mutation sweep

| ID | AC | Procedure | Evidence |
|---|---|---|---|
| **H1** | AC1.9 | All 17 #234 mutants, hand-written, each verified to have changed the file and passed `tsc` before its full-suite run. | mutant → killing-test table + anchor-miss count |
| **H2** | AC1.9 | The gate sweep re-run: `grep -rn "anthropicKey" src/state src/components src/app \| grep -v "\.test\."`. Every remaining hit justified. ⚠ **Do not substitute a re-read of a prior findings list.** Two live gates (`coachOnboarding.ts:28`, `postWorkoutDebrief.ts:33`) were missed by a professional mutation sweep *because the sweep was scoped to changed files*. | full grep output |

---

## Traps

Eighteen places where a check can pass while the thing it names is broken.

1. **An OpenAI fixture that also sets `anthropicKey`.** Passes against every mutant it exists to
   catch. The most likely single error in Phase 1.
2. **`objectContaining` on a forwarded `ProviderConfig`.** Passes a builder that drops a field — which
   is `S06`/`E04`/`R04`/`X04` in Phase 1, and the whole of layer 3 in Phase 5.
3. **Equal or empty sentinels in the factory payload test.** `system: ''` or `SYS === MSG` makes the
   `F23`/`F24` channel swap undetectable. This is the one finding with a stated security rationale;
   a vacuous test here is worse than none, because it reads as coverage.
4. **Only testing the 401 in `mapError`.** The `else if (httpError.status)` arm needs a non-401.
5. **Assuming the Anthropic-only-gate list is complete.** It came from a grep, and a mutation sweep
   scoped to changed files missed both entries. Re-run the grep.
6. **`toMatchObject` / `objectContaining` on the provider-switch patch.** Passes a patch that omits
   the key entirely — a switch that clears nothing, silently, forever.
7. **Clearing a key to `undefined` instead of `''`.** `setSettings` persists via `JSON.stringify`,
   which drops `undefined`, so the blob carries no evidence of the clear.
8. **Copying `buildSettingsPatch`'s omit-undefined shape.** It is two files away, it is the
   codebase's other settings-patch builder, AGENTS.md documents its rule — and its rule is the
   **inverse** of this one.
9. **Omitting the same-provider switch case.** The only fixture separating "clears the other
   provider's key" from "clears `next`'s own key".
10. **`''` instead of `'   '` in a trim fixture.** Three separate criteria (AC2.4, AC2.6, and the
    warning's trim) have a `.trim()` in them, and none is observable with `''`.
11. **A `crossProviderKeyWarning` suite of matches plus `'not-a-key'`.** The discriminating values are
    *legal keys for the other provider*: `'sk-…'` under OpenAI and `'sk-proj-…'` under Anthropic.
12. **A trim test asserted at the wire.** `factory.ts` trims too, so the untrimmed-store mutant
    survives every end-to-end assertion. Only the patch-level test can see it.
13. **A human step that pastes a padded key and checks the coach works.** Cannot fail, for trap 12's
    reason. Deliberately absent from this plan.
14. **Relaxing the 12 `toEqual({ kind: … })` assertions to `toMatchObject`.** Compiles the phase in
    one edit and destroys every discrimination AC4.6–AC4.8 depend on.
15. **Testing only the OpenAI error copy.** Cannot distinguish "names the provider" from "hardcodes
    OpenAI".
16. **Equal `chat` and `oneShot` ids in the factory routing test.** Makes the four-surface mutant
    undetectable, and it is the most natural fixture to write.
17. **A `resolveModels` fallback fixture with both fields bad.** Cannot distinguish per-field from
    whole-object fallback.
18. **Accepting `status: 'ok'` with an empty body as a passing live call.** That is precisely what an
    exhausted 256-token budget looks like on a surface that swallows failures.

---

## Coverage summary

Evidence kinds, as in the design's matrix: **automated** = a jest assertion or a deterministic
command (`grep`, `git diff`, `tsc`, `lint`); **structural** = read the source and judge; **human** =
run the app or carry out a manual procedure.

| Group | Criteria | Automated | Structural | Human |
|---|---|---|---|---|
| AC1 — OpenAI path covered first | 10 | 9 | 0 | 1 (AC1.9, via H1 + H2) |
| AC2 — provider decision layer | 12 | 12 | 0 | 0 |
| AC3 — the provider screen | 11 | 2 (AC3.4, AC3.5 greps) | 3 (S1–S3) | 6 (H4–H9) |
| AC4 — provider-named errors | 10 | 9 | 1 (S6) | 0 |
| AC5 — model resolution + plumbing | 11 | 10 | 1 (AC5.10) | 0 |
| AC6 — model UI, live calls, docs | 8 | 1 (AC6.7) | 3 (S7, S8, AC6.6) | 4 (H10–H13) |
| AC7 — cross-cutting gates | 3 | 3 | 0 | 0 |
| **Total** | **65** | **46** | **8** | **11** |

Every criterion is claimed by exactly one phase, with the deliberate exception of AC7.1–AC7.3, which
are per-phase gates and appear in every phase's *Done when*.

**Net automated coverage increases substantially over this change** — 46 criteria carried by
assertions, plus Phase 1 closing 17 pre-existing mutation survivors on code that already shipped.
That is possible on a feature whose headline is a settings screen only because the decisions were
deliberately placed where a suite can reach them.

**The eleven human criteria are the things a user would notice**: that a saved key survives a
relaunch; that a removed key is *really* removed; that no pointless dialog appears; that a fast
switch does not resurrect the key; that an existing install keeps working; that the picker behaves;
that a model choice sticks; that every surface actually returns text on both providers; and that an
OpenAI user can go from a coach conversation all the way to a post-workout debrief.

**The defect class this document is organised around, stated once.** Every ⚠ above is an instance of
the same thing: *a criterion naming a condition its prescribed fixture cannot discriminate.* A
both-keys fixture cannot test an OpenAI-only predicate. A `''` fixture cannot test a trim. A
no-whitespace key cannot test a trim boundary the wire also trims. Equal sentinels cannot test a
swap. A both-fields-bad fixture cannot test per-field fallback. A manual step run without a relaunch
cannot test persistence, and one run after the debounce cannot test the debounce. The question that
catches all of them is the same: **could this actually fail if the bug were present?**
