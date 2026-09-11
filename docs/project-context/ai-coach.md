> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## AI Coach (`src/ai`)

Conversational routine authoring. The user brings their own API key (Anthropic or OpenAI);
requests go straight from the device to the chosen provider's API, and the chat is
never persisted. Provider selection is determined by `createAiClient` (`src/ai/provider/factory.ts`),
which reads `anthropicKey`, `openaiKey`, and `aiProvider` to resolve the active provider,
and route all four surfaces (chat, rest commentary, exercise question, alternates) to
the corresponding client factory.

The AI settings fields (`anthropicKey`, `openaiKey`, `aiProvider`, `aiModel`, `aiGoals`,
`aiEquipment`, `aiPersonality`) are persisted under the storage key `'bridge_settings'`,
alongside the profile and onboarding fields **and `hevyApiKey`** (#267 Phase 3) — do not
rename this key, as it holds every one of the user's API keys and their onboarding state,
and renaming it orphans existing users. `BridgeSettings`
in `src/state/settings.ts` is a misnomer — the blob holds AI, Hevy, profile, and onboarding
settings, and no bridge settings at all — kept because renaming the *type* is churn and
renaming the *key* is forbidden.

**The settings split.** `/settings/ai-provider` (provider, key, models) and `/settings/ai`
(goals, equipment, coaching style, age, experience). The provider/key/model decisions live
in `src/state/aiProviderSettings.ts` and the screen holds none of them, because `src/app`
has no jest coverage — the patch/selection builders are `initialProviderSelection`,
`providerSwitchPlan`, `apiKeyPatch` and `modelSelectionPatch`.

**Model selection IS exposed, as two pickers over four surfaces.** `modelSelectionPatch`
has a production caller — `applyModelSelection` in `ai-provider.tsx` — and the screen
renders **Coach Model** and **Quick Replies Model**. (This paragraph previously said the
opposite, and stayed wrong for the whole of #246's life; the wiring landed in PR #251.)

The asymmetry is deliberate and is why the picker count does not match the surface count:
`AiModelConfig` has exactly two fields, `chat` and `oneShot`, so `applyModelSelection`'s
field union is `'chat' | 'oneShot'`. `chat` drives the conversation and routine drafting;
`oneShot` drives all **four** one-shot uses from a single choice: alternates (`suggest`),
exercise question (`ask`), rest commentary (`comment`) and, since #335, the exercise-image
catalog pick. The catalog pick calls the same `ask` through `createExerciseImageResolverDeps`
(`src/state/exerciseImageFiles.ts`, `createAiClient(getSettings()).ask`), so it uses the
exercise-question client, model and budget. **The Quick Replies Model picker therefore
also picks the image-matching model.** Adding a third picker means widening
`AiModelConfig` and `resolveModels`, not just adding UI.

**One key per install.** Switching provider clears the outgoing provider's key, to `''`
rather than `undefined` because `setSettings` persists through `JSON.stringify`, which drops
`undefined` and would leave no evidence of the clear in the blob. This is what keeps
`ProviderConfig`'s "Only one key is set per install" docstring true — the sentence is
load-bearing, not incidental, and must not be edited without changing the rule it describes.
The switch is confirmed only when the outgoing key is non-empty after trim. The write goes
through the screen's `queueSave` + `flush`, never a bare `setSettings`: a bare write leaves
a pending 500 ms autosave patch alive that fires afterwards and restores the key the user
just destroyed.

**`aiProvider` is written only from the picker.** Mounting the screen derives the displayed
value through `initialProviderSelection` and writes nothing, so installs that predate the
picker keep resolving implicitly in `factory.ts`. Nothing can test this — `src/app` is
uncovered and an automated fixture cannot distinguish "no write" from "wrote the derived
value" — so it rests on a structural criterion.

**The key is trimmed at one boundary on the way in**, `apiKeyPatch`; `factory.ts:61,65,101,105`
trims again at the wire (two guard sites and two forwarding sites, one pair per provider). **Keep both layers.** Note that the factory's trim makes an
untrimmed *store* invisible to every wire-level assertion, so `apiKeyPatch`'s own test is
the only cover.

**Key-format validation warns, never blocks**, and is one-directional: `sk-ant-` under an
OpenAI selection is flagged; nothing is flagged under Anthropic, because OpenAI has no
unmistakable marker and `sk-` is a prefix of `sk-ant-`.

**Chat error copy lives in `src/state/aiChatErrorCopy.ts`**, not in the screen, and names
the failing provider. The provider is a two-member union, so key material cannot reach the
banner by construction.

**The model list is constrained and its membership is governed by the fixed request contract.**
Every client sends a fixed request contract — `reasoning: { effort: 'none' }` on OpenAI,
`thinking: { type: 'disabled' }` on Anthropic, `output_config: { effort: 'low' }` on Anthropic
rest commentary — against fixed budgets (chat 4096, alternates 1024, exerciseQuestion 512,
restCommentary 256). A model that rejects those, or whose minimum reasoning effort exceeds
`none`, either 400s or returns `status: 'incomplete'` with no text and a bill — and every AI
failure here is swallowed, so the symptom is every surface silently dead, and the catalog
pick with them. **Adding an id therefore requires one live call per surface returning
rendered text; it is not a config edit.** **It also requires
`src/ai/catalogPickPrompt.live.test.ts` to pass against that id** (`HMB_LIVE_MODEL=<id>`
plus that provider's key). Every listed id can be chosen as `oneShot`, and for the catalog
pick rendered text is not enough. `parseCatalogPick` trusts only a bare shortlist id or
`NONE`, so a model that wraps its answer in quotes, backticks or prose passes the
per-surface probe and still turns every pick into `untrusted`. That falls back to no-key
quality silently, with no error. Put the id on the list before running it:
`resolveModels` ignores an off-list id, and the live test fails rather than probe the
default in its place. The `AI_MODEL_CHOICES` value-pinning test in `models.test.ts` is the only guard on
membership in the repo — its `toStrictEqual` is load-bearing, since a loose matcher
(`arrayContaining`) silently readmits unprobed ids. `resolveModels` ignores an id not on the selected provider's list and falls
back per field, without rewriting the setting.

The selection rule exists in three implementations: `settings.ts:148-170` (`resolveAiProvider`,
still zero production callers), `factory.ts:23-44` (`resolveProvider`), and
`aiProviderSettings.ts:63-72` (`initialProviderSelection`). All three are named in
AGENTS.md so a future reader recognizes the rule when editing one of them.

- **No SDK, on purpose.** `anthropicClient.ts` is a hand-rolled `fetch` POST to
  `/v1/messages` — non-streaming, `thinking: disabled`, structured output via
  `output_config.format.json_schema`. Adding `@anthropic-ai/sdk` is not an upgrade:
  the client must stay RN-bundle-safe and `fetchFn`-injectable so it tests in the node
  jest project. Network vs HTTP failures are distinct types (`AnthropicUnreachable` vs
  `AnthropicHttpError`). The cost: no SDK means nothing
  strips a `json_schema` of keywords the structured-output endpoint's subset doesn't
  support (array/string/number bounds) — one in `ALTERNATES_SCHEMA` made the Replace
  button 400 on every tap until it was caught (PR #71). Every schema handed to
  `output_config.format` must pass `expectStructuredOutputSafe`
  (`src/ai/structuredOutputSubset.ts`); put bounds in the validator instead, which is
  where the SDKs put the keywords they strip.
- **One turn shape, FOUR declarations** (it was three until #276 Phase 4). The
  `{ reply, draft?, settingsProposal? }`
  contract is stated in `AI_TURN_SCHEMA` (what the API enforces), in the
  `AiTurn`/`RoutineDraft`/`SettingsProposal` types plus `validateRoutineDraft` and
  `validateSettingsProposal` (what the app enforces), in `personaSection()` prose in
  `contextBuilder.ts` (what the model reads), and now in **`setPlanFormat.ts`**, which
  renders a set list back to the model and to the draft card — four importers, across
  `contextBuilder`, `alternatesPrompt`, `restCommentaryPrompt` and `ai-coach.tsx`.
  Changing the payload shape means changing all four — same hazard class as the copied
  markdown contract.
- **Nothing in this repo can detect a schema the API rejects on grammar
  complexity, and three assertions actively look like they can.**
  `findUnsupportedKeywords` is a *keyword* walk; `draftSchema.test.ts`'s
  `optionalCount`, the walker field count in `subset.test.ts`, and the inline
  snapshot are *counts and shapes*. None of them models nesting depth.
  `AI_TURN_SCHEMA`'s max depth is now **6**, and since Phase 4 it carries its first
  array-of-objects-inside-an-array-of-objects (`exercises[].sets[]`). **No assertion
  here would move if Anthropic refused it.** The only detector is a live call, and
  the symptom is a 400 *before the model runs*, naming a compile/grammar error rather
  than a keyword. Read the count as a keyword budget, not as headroom.
  The OpenAI half of that risk IS closed and was verified post-transform:
  `transformSchemaForOpenAI` descends through both levels of `items`, so `strict:
  true`'s "every property in `required`, optionals widened to nullable" holds for all
  five set fields.
- **The persona restates the validator's rules, not just its shape.** `personaSection()`
  spells out the bounds `validateRoutineDraft` enforces (non-empty name, ≥1 exercise,
  title must slugify to something non-empty, **≥1 set per exercise**, a set's `reps`
  and `repsMax` ≥ 1 with `repsMax` ≥ `reps` and never present without it,
  `durationSeconds`/`restSeconds` ≥ 0, and `weightLbs` a positive multiple of 0.5),
  so a rejected draft reads as
  a model mistake rather than a surprise. `contextBuilder.test.ts` asserts those
  sentences as *exact strings*: loosening or tightening a bound in `draftSchema.ts`
  without rewording the prose fails those tests rather than silently drifting. Not
  every pinned sentence is a bound restatement: the guidance to give a duration-based
  exercise a **single set in the list** has no validator counterpart — it steers the
  model away from the zero-planned-set drafts that force the display guards in
  Boundaries — so don't delete it as unenforced. (It read `targetSets: 1` until #276
  Phase 4; the rule survived the rewording, the field did not.)
- **Validate twice; structured output is not a guarantee.** `parseAiTurn` validates on
  receipt and `acceptDraft` validates again before writing. Keep both.
- **Exercise identity is `slugifyTitle(title)`, and the accept path is create-only.**
  Exercises are global and shared by every routine, so `acceptDraft` creates a missing
  exercise but never updates an existing one's title, kind, or description — a draft
  must not rename or re-kind an exercise out from under other routines. Title reuse
  therefore maps to the same record, which is why the persona pushes the model toward
  existing titles.
- **Drafts are whole routines, never diffs.** `upsertRoutine` reconciles
  `routine_exercises` in place, not delete-and-recreate: entries claim existing
  rows by `exerciseId` (oldest `order` first, so duplicated exercises match
  deterministically) and survivors keep their row ids. That stability is
  load-bearing: `session_sets.routine_exercise_id` references those rows and
  `getExerciseWorkingSetHistory` joins by row id for pre-v3 sets (see the
  Boundaries stamp rule — stamped sets carry their own identity), so editing a
  routine never orphans logged history. An exercise the draft omits *is* deleted,
  which is why the persona demands the full exercise list; that row's
  still-unstamped sets are stamped with its outgoing `exercise_id` first, in the
  same transaction, so dropping an exercise from the *plan* never erases what was
  already *done*.
- **The conversation mode owns the routine id.** `acceptDraft(db, draft, mode)` mints
  `routine-<epoch>` in create mode and forces `mode.routineId` in edit *and debrief*
  mode; drafts carry no routine id. Accepting in either of those always overwrites the
  routine named by the route param.
- **A finished workout opens a debrief conversation.** The `debrief` mode carries the
  routine plus the session that was just performed, and the prompt gains a
  "Just-Finished Workout" section (every planned exercise against the sets actually
  logged, warmups included — unlike the history section). The coach speaks first:
  `aiChatStore.openDebrief` resets and sends `DEBRIEF_OPENING_MESSAGE` for the user,
  because the Messages API needs a user turn before a reply. The opening turn is
  flagged hidden and suppressed in the UI while staying byte-identical on the wire,
  so the user sees the coach's greeting as the first message. The hook is the *last*
  thing `onCompleteSession` does — after the session record is closed and the HealthKit
  write is under way — and every failure there is swallowed: finishing a
  workout must never depend on the chat. Effect executors are fire-and-forget, so a
  resolved `dispatch` does not mean the debrief has opened; tests must wait for it.
  `planPostWorkoutDebrief` (no key = no chat) and the route-param encoding live in
  `src/state/postWorkoutDebrief.ts` so they test in the node project;
  `debriefNavigation.ts` exists only to keep `expo-router` out of that file.
- **The prompt carries data, never secrets.** `buildSystem` composes goals, equipment,
  every routine, a `## Recent Workouts` section (the last `RECENT_WORKOUTS_IN_PROMPT`
  (10) completed sessions, one line each dated in UTC with weekday, preceded by a
  `Today:` anchor line so the model has a recency reference point), and working-set
  history (`HISTORY_SETS_PER_EXERCISE` most recent per exercise, warmups excluded,
  each set dated to the UTC day it was logged). `anthropicKey`/`token`/`baseUrl` must
  never appear — a regression test in `contextBuilder.test.ts` asserts this.
- **A `settingsProposal` is proposed, never applied.** The model may propose new
  `aiGoals`/`aiEquipment`/`aiPersonality` when the user asks, but
  `approveSettingsProposal` is the only path to `setSettings`, and it validates the
  proposal a second time first. Fields are full replacements, so the patch is built
  by checking each field's *value*, not its presence — only fields that are not
  `undefined` go into the patch. After normalization, OpenAI-style responses have
  all keys present but some as `undefined`, and spreading an explicit `undefined`
  would blank the other fields, so value checks guard the write (`if (goals !==
  undefined)`). Anthropic-style responses omit the keys entirely, which also works
  correctly. `declineSettingsProposal` writes nothing. The screen holds no approve/decline logic; it is not jest-covered.
- **`aiChatStore` is ephemeral, with two counters that are not interchangeable.**
  `generation` scopes the *conversation*: `reset(mode)` bumps it so a request resolving
  afterwards is discarded rather than appended. `systemEpoch` scopes the *prompt cache*
  alone and guards cache repopulation, so a `buildSystem` already in flight cannot write
  a stale prompt back. `reset` advances both; an approved settings write advances only
  `systemEpoch` — the cached prompt embeds goals, equipment, and coaching style and
  must be rebuilt, but the conversation continues and an in-flight response still
  lands. Collapsing the two back into one counter reintroduces exactly that bug. `acceptDraft` re-entry is latched
  in the store — a second same-frame call returns `null` instead of writing a duplicate
  routine; the screen's `accepting` state is cosmetic, so the latch also looks removable
  and is not. Deps are injected (`AiChatDeps`) so the whole turn path tests without
  network or DB.
- **Rest commentary has two remark shapes and the engine snapshot picks which.**
  `ScheduleRest` leaves `advance_after_set` from exactly two sites that differ in
  `setIndex`: the round-repeat rest writes `setIndex + 1` (always >= 1, position
  stays inside the superset group), the group-exhausted rest writes `0` and moves
  to a fresh landing. So during Resting, **`setIndex >= 1` means the rest landed
  inside an exercise/group and `setIndex === 0` means it landed between two** —
  a positional test, correct where an `exerciseId` comparison is not, since a
  routine may list the same exercise twice. `restCommentaryTarget` builds the
  `lastSet` shape from `lastLoggedSet` for the first and keeps the `upNext` shape
  for the second, and `buildRestCommentaryPrompt` carries the shape all the way
  through: the **whole system brief** is per-shape — `UP_NEXT_BRIEF` and
  `LAST_SET_BRIEF` differ in their opening sentence, their second paragraph and
  two of their rules — and the message heading switches with it (`## Last Set`
  vs `## Up Next`), because "comment on the exercise coming up" contradicts the
  data the `lastSet` message sends. The `lastSet` shape yields **silence** —
  never a fallback to `upNext` — on three guards: no `lastLoggedSet`, a
  `setType === 'warmup'` (the test must be `!== 'warmup'`, since transition.lv
  stamps the entry's own `kind` for cardio/stretch and an equality test kills the
  feature on every non-strength exercise), or a `lastLoggedSet` that does not
  belong to the entry the round just left. That last guard exists because
  `SetDone` ("Skip Set") never writes `lastLoggedSet`, so a rest reached by
  skipping still carries the previous set. It is **two layers, and both are
  needed**: the pure comparison against the performed entry catches the
  cross-member superset case, while the store's `claimLogIndex` latch (one remark
  per logged-set index, re-readable by the rest that owns it) catches the
  same-entry case, which no snapshot-only test can see. The cache key moved from
  `sessionId#entryIdx` to the rest's own position, `sessionId#exerciseIndex:setIndex`,
  so each working set gets its own remark — a deliberate ~4x call-count increase,
  accepted in #270. `restCommentaryKey` is exported and **`src/app/session.tsx`
  must call it** rather than rebuilding the key — **and** the screen's commentary
  effect must keep `commentaryKey` in its dep array, or the effect stops
  re-firing per working set and every set after the first silently re-serves the
  first one's remark. Those are two separate hazards and each has its own
  structural test in `restCommentaryStore.test.ts`: one asserts the screen calls
  the exported builder rather than a hand-rolled copy, the other asserts the
  dep-array entry is present. Both are structural reads of the source, the AC6.9
  precedent applied twice, because `src/app` is jest-invisible and nothing can
  load the screen to test either behaviourally.
- **Three one-shot AI features share the conversation slice's conventions without
  its store.** Rest commentary (`restCommentary*`), the exercise Question button
  (`exerciseQuestion*` — ephemeral per-entry cache keyed by
  `exerciseQuestionKey`, answer never persisted), and Replace-button alternates
  (`alternates*` + `acceptAlternate` — validate on receipt AND at swap; `kind`
  always from the entry, never the model; duplicate titles rejected at slug level)
  each have their own prompt builder, and their own client per provider. All follow the
  same rules: free text neutralized, immutable directives last, secret-leak regression
  tests, network-vs-HTTP failure types, every failure swallowed (a workout never depends
  on the AI), deps injected for the node jest project. `neutralizeForPrompt` is no
  longer duplicated: #335 hoisted the three private copies (alternates, exercise
  question, rest commentary) into the one shared `src/ai/neutralizeForPrompt.ts`,
  which the catalog-pick prompt also imports. `contextBuilder.ts`'s
  `neutralizeNotesForPrompt` is a **separate** function and was deliberately left
  alone — do not fold it in by name. Known accepted debt: the POST/parse boilerplate
  is duplicated across both
  `anthropicClient.ts` and `openaiClient.ts` (plus the one-shot alternates and question
  clients for each provider, totaling 8 copies) — hoisting it is a tracked follow-up;
  don't add another copy. `buildOpenAiBody` (`src/ai/provider/requestBuilder.ts`)
  centralizes the Responses API body format to reduce drift; Anthropic clients build
  their own request bodies and prompt builders are kept per-surface.
- **Immutable directives must remain the last section of every system prompt.** They are placed
  after every section built from user-controlled free text (goals, equipment, personality,
  routine notes, exercise titles) to preserve their precedence against injection attempts.
  The placement is enforced in five builders: `buildSystem` (`src/ai/contextBuilder.ts`),
  `buildRestCommentaryPrompt` (`src/ai/restCommentaryPrompt.ts`), `buildAlternatesPrompt`
  (`src/ai/alternatesPrompt.ts`), `buildExerciseQuestionPrompt` (`src/ai/exerciseQuestionPrompt.ts`),
  and `buildCatalogPickPrompt` (`src/ai/catalogPickPrompt.ts`, #335);
  the directive text itself lives in `src/ai/coachDirectives.ts`.

