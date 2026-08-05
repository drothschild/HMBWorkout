# Coach Onboarding (Opening Conversation) Design

## Summary

Add a fourth AI Coach conversation mode — onboarding — that runs as a short interview the first
time a user has an Anthropic key configured. The coach speaks first (reusing the same
hidden-opening-turn trick as the existing post-workout debrief), asks through six profile fields
(goals, equipment, personality, age, gender, experience) in natural dialogue, and writes each
answer to settings immediately, with no approval card — the one place in the app where the coach is
allowed to change settings without the user confirming a proposed diff first.

The implementation deliberately avoids new machinery wherever an existing pattern already fits.
Rather than add a second payload type for profile data, the existing `SettingsProposal` contract
widens from three fields to six, and the existing `approveSettingsProposal` function stays the
only code path that writes model-supplied settings — onboarding just calls it automatically instead
of leaving the proposal pending for a card, gated strictly by a mode check. Because `buildSystem`
already renders current settings values into every system prompt, the coach naturally sees which
fields it has already recorded without any new tracking state — write, then let the next prompt
reflect it. A refusal ("prefer not to say") is stored as real text rather than a sentinel, so an
empty string keeps meaning "never asked." Entry is a dismissible card on the Today tab,
deliberately kept orthogonal to the existing exhaustive `todayViewState` so it can coexist with the
resume button, error banner, and loading state rather than replacing any of them; the same
conversation is also reachable anytime from the AI settings screen, and mid-conversation the user
can bail into filling the fields in manually. The interview ends by offering to draft a first
routine through the same accept path as any other coach-authored draft.

## Definition of Done

Implements GitHub issue [#170 — New feature: Opening Conversation](https://github.com/drothschild/HMBWorkout/issues/170).

1. **Profile settings.** `BridgeSettings` gains three free-text fields — age, gender, expertise — persisted in the existing `bridge_settings` blob (old blobs load unchanged; the spread merge in `loadSettings` already tolerates new keys). A declined answer is stored as the refusal itself (e.g. `"prefer not to say"`), so the prompt and the settings screen both show exactly what the coach was told, and nothing needs to distinguish "never asked" from "declined". A persisted flag records that onboarding is done-or-dismissed. All three fields appear on the manual AI settings screen alongside the existing three. The coach never asks for the user's name.

2. **An onboarding conversation mode.** A fourth `AiCoachMode`. The coach speaks first (reusing the debrief hidden-opening-turn pattern), interviews the user across all six profile fields in natural dialogue, and writes back for clarification when an answer isn't understood. Settings are applied after every turn with no approval card. **Auto-apply is gated strictly to this mode** and still routes through `approveSettingsProposal`, so the validate-twice defense survives; every other mode keeps the approval card.

3. **Entry and exit.** A dismissible card on the Today tab, shown only when an API key exists and the flag is unset; dismissing *or* completing the conversation sets the flag permanently. A button on the AI settings screen reopens the conversation at any time. The user may opt out mid-conversation into manual entry, keeping whatever was already written.

4. **Profile reaches all four AI surfaces.** `buildSystem` gains an About-the-User section; `restCommentaryPrompt`, `exerciseQuestionPrompt` and `alternatesPrompt` receive the new fields from their callers, each keeping its own secret-leak regression test.

5. **Ends by offering a first routine,** drafted inline in the same conversation; Accept persists through the existing path and navigates to the routine.

**Out of scope:** issue #168 (first-use API key prompt) — this feature only gates on a non-empty key, with no live key validation.

**Verification:** jest for the `state` and `ai` layers, with new guards mutation-tested; a simulator pass for the Today card and the conversation itself, since `src/app` has no jest coverage.

## Acceptance Criteria

### coach-onboarding.AC1: Profile settings persist
- **coach-onboarding.AC1.1 Success:** The three `profile*` fields and `onboardingState` save and survive an app restart
- **coach-onboarding.AC1.2 Success:** A stored blob written before this feature loads without error; the new fields default to `''` and `onboardingState` to `'unseen'`
- **coach-onboarding.AC1.3 Success:** A refusal is stored as its own text, so `''` still means "never asked" and the two are distinguishable by reading the value alone
- **coach-onboarding.AC1.4 Edge:** All three profile fields may be empty; every AI surface behaves normally with none of them set

### coach-onboarding.AC2: Widened settings-proposal contract
- **coach-onboarding.AC2.1 Success:** A proposal carrying only `age`, `gender`, or `experience` validates and round-trips
- **coach-onboarding.AC2.2 Success:** `expectStructuredOutputSafe(AI_TURN_SCHEMA)` passes with the three new properties present
- **coach-onboarding.AC2.3 Failure:** A proposal whose new field is an empty string, whitespace, a non-string, or longer than `SETTINGS_FIELD_MAX_LENGTH` is rejected with `DraftValidationError`
- **coach-onboarding.AC2.4 Edge:** A proposal with all six fields undefined is still rejected as empty, and `parseAiTurn` still drops it before validation

### coach-onboarding.AC3: The interview prompt
- **coach-onboarding.AC3.1 Success:** Onboarding mode's system prompt instructs the coach to ask in batches, to place age and gender after the other fields, to record a refusal verbatim and never re-ask it, and to ground every recorded value in something the user actually said
- **coach-onboarding.AC3.2 Success:** Onboarding mode's prompt instructs the coach to close by offering to draft a first routine
- **coach-onboarding.AC3.3 Success:** The existing sentence requiring user approval of a proposal is absent in onboarding mode and still present in create, edit, and debrief
- **coach-onboarding.AC3.4 Success:** Already-recorded profile values appear in the prompt, so a subsequent turn can see which fields are filled
- **coach-onboarding.AC3.5 Success:** `/ai-coach?onboarding=1` maps to the onboarding mode, and adding the param alongside a `routineId` still yields onboarding rather than edit
- **coach-onboarding.AC3.6 Failure:** No route-param combination yields onboarding unless the param is present — the existing create/edit/debrief mappings are unchanged
- **coach-onboarding.AC3.7 Failure:** The onboarding prompt does not ask for the user's name, and no schema field or settings field exists to record one. The coach may use a name the user volunteers within the conversation, but must never solicit it and has nowhere to persist it

### coach-onboarding.AC4: Auto-apply, gated to onboarding
- **coach-onboarding.AC4.1 Success:** An onboarding turn carrying a proposal writes it to settings and leaves `pendingSettingsProposal` null, so no approval card renders
- **coach-onboarding.AC4.2 Failure:** A create-mode turn carrying a proposal leaves it pending and writes nothing — this test must be observed failing with the mode condition removed
- **coach-onboarding.AC4.3 Failure:** A proposal that fails its second validation is swallowed: nothing is written, the conversation continues, and the turn still renders
- **coach-onboarding.AC4.4 Success:** Each write invalidates the cached system prompt without advancing `generation`, so an in-flight response still commits
- **coach-onboarding.AC4.5 Edge:** A turn that resolves after `reset()` is discarded and writes nothing, even in onboarding mode
- **coach-onboarding.AC4.6 Success:** The coach speaks first — `openOnboarding` sends a hidden user turn that reaches the wire but is not rendered

### coach-onboarding.AC5: Entry and exit
- **coach-onboarding.AC5.1 Success:** The card shows only when `onboardingState` is `'unseen'` and a key is present; it is hidden for `'dismissed'`, `'completed'`, or no key
- **coach-onboarding.AC5.2 Success:** Dismissing writes `'dismissed'` and the card does not return on a later launch
- **coach-onboarding.AC5.3 Success:** The first successful onboarding write sets `'completed'`; opening the conversation and leaving without answering anything does not
- **coach-onboarding.AC5.4 Success:** The card renders alongside the resume button, error banner, and loading state rather than replacing any of them
- **coach-onboarding.AC5.5 Success:** The settings screen persists all six fields through its existing autosave, and its Start/Redo control re-enters the conversation regardless of `onboardingState`
- **coach-onboarding.AC5.6 Success:** Opting out mid-conversation lands on the settings screen with everything already written still present

### coach-onboarding.AC6: Profile reaches all four AI surfaces
- **coach-onboarding.AC6.1 Success:** `buildSystem` renders the profile, and renders it before the immutable directives section
- **coach-onboarding.AC6.2 Success:** The rest-commentary prompt carries the profile, before its directives
- **coach-onboarding.AC6.3 Success:** The exercise-question prompt carries the profile, before its directives
- **coach-onboarding.AC6.4 Success:** The replace-alternates prompt carries the profile, before its directives
- **coach-onboarding.AC6.5 Failure:** No surface leaks `anthropicKey`, `openaiKey`, `token`, or `baseUrl` — the existing assertions still hold on all four
- **coach-onboarding.AC6.6 Edge:** A profile value beginning with `#` is neutralized on every surface and cannot read as prompt structure

### coach-onboarding.AC7: Cross-cutting
- **coach-onboarding.AC7.1 Success:** Accepting a draft from onboarding mode mints a new routine, the same as create mode, and navigates to it
- **coach-onboarding.AC7.2 Success:** No engine event is dispatched and no session or sync state changes anywhere in this feature
- **coach-onboarding.AC7.3 Failure:** With no key set, the card is absent; if the conversation is reached anyway, it shows the existing missing-key state rather than crashing

## Glossary

- **`BridgeSettings`**: The app's single persisted settings object — despite the name, it holds both bridge (sync) config and all AI Coach settings, including the three new profile fields this design adds.
- **`bridge_settings` blob**: The on-device storage key `BridgeSettings` is serialized into; loading it merges onto defaults so old blobs missing new fields don't error.
- **`AiCoachMode`**: A discriminated union identifying which kind of AI Coach conversation is active (`create`, `edit`, debrief, and now `onboarding`); it drives what the system prompt says and how the turn is handled.
- **`SettingsProposal`**: The shape of a settings change the model can return inside a turn. Normally it sits pending until the user approves it via a UI card; this design widens it from three fields to six.
- **`approveSettingsProposal`**: The single function that re-validates and actually writes a `SettingsProposal` to settings. Onboarding doesn't bypass it — it just calls it automatically instead of waiting for user approval.
- **`invalidateCachedSystem` / prompt caching**: The Anthropic API can cache a repeated system-prompt prefix to save cost/latency. `buildSystem`'s output is cached across turns; writing settings invalidates that cache so the next prompt reflects the change. The design notes this happens on every onboarding turn, which is acceptable only because a new user has little else in the prompt to rebuild.
- **Structured output / `output_config.format` (grammar budget)**: An Anthropic Messages API feature that constrains a response to a JSON schema. It has an empirical ~24-optional-parameter complexity ceiling before requests start failing, which is why this design widens one schema rather than adding a second.
- **`buildSystem`**: The function that assembles the system prompt sent with every AI Coach turn (goals, equipment, existing routines, recent history, and now user profile).
- **Debrief mode / hidden opening turn**: An existing `AiCoachMode` that opens right after a workout finishes. It pioneered "the coach speaks first" by sending a `hidden: true` user message — needed because the API requires a user turn before it will reply, but suppressed from the UI so it reads as the assistant speaking unprompted. Onboarding copies this mechanism.
- **`neutralizeForPrompt`**: A per-prompt-builder helper that strips leading `#` characters from user-supplied text so it can't be mistaken for prompt/markdown section headers once embedded in the system prompt.
- **Immutable directives**: The fixed instructional block that must always be the last section of a system prompt, placed after any user-controlled free text, so injected text earlier in the prompt can't override the model's core instructions.
- **`personaSection` / `contextBuilder.ts`**: The function/file that builds the natural-language persona instructions portion of the system prompt (as opposed to the data sections like goals or history).
- **One-shot AI surfaces (rest commentary, exercise Question, Replace alternates)**: Three small independent AI-backed features elsewhere in the app, each with its own prompt builder; this design threads the new profile fields into all of them alongside `buildSystem`.
- **`todayViewState`**: The exhaustive discriminated union computing what the Today tab's main content area should show (resume button, error banner, loading, etc.). The onboarding card is deliberately kept as a separate, orthogonal predicate rather than folded into this union.
- **Rill session engine**: The app's pure functional state machine that drives an active workout session. Noted explicitly as untouched by this feature — onboarding only writes settings/routine data, never session state.
- **`acceptDraft.ts`**: The shared code path that turns a model-authored routine draft into a persisted routine; it switches behavior by `AiCoachMode` (mint a new routine id vs. reuse an existing one), and onboarding must fall into the same branch as create mode.
- **`generation` counter (`aiChatStore`)**: A counter bumped on conversation reset so that a response which resolves after a reset is discarded rather than applied — relevant here because it must still discard a stale onboarding write.
- **`DraftValidationError` / `SETTINGS_FIELD_MAX_LENGTH` / `expectStructuredOutputSafe`**: The validation error type and length/shape checks a `SettingsProposal` (and the schema carrying it) must pass — used both when the model's structured output is first received and again right before writing.
- **Route params → mode mapping (`aiCoachModeFromParams`)**: The function that decides which `AiCoachMode` a screen opens in based on URL/query params (e.g. `routineId`, `debriefSessionId`); this design adds an `onboarding` param that must take priority over the others.

## Architecture

The feature is entirely imperative shell. It authors *data* (settings, and optionally a first
routine) and never touches the Rill session engine, the sync bridge, or the vault markdown
contract.

**The wire contract stays singular.** Rather than introduce a second payload for profile data,
the existing `SettingsProposal` widens from three fields to six. This was chosen over a
distinct `profileUpdate` field for two reasons. First, Anthropic's structured-output grammar has
an empirical complexity ceiling (~24 optional parameters across a schema before "compiled grammar
is too large"); a second parallel object spends roughly twice the budget of widening the one that
exists. Second, `output_config.format` is part of the prompt cache key, so a mode that swapped in
a different schema would invalidate caching for the whole conversation.

**The write path stays singular too.** `approveSettingsProposal` remains the only code that calls
`setSettings` with model-supplied values, and it still re-validates before writing. Onboarding
does not bypass it — `aiChatStore` simply *calls* it itself when `mode.kind === 'onboarding'`,
instead of leaving the proposal pending for a card. This preserves the validate-twice defense
documented in AGENTS.md and confines the ticket's "do not ask permission" instruction to a single
mode-gated branch rather than deleting an invariant.

That reuse also buys progress tracking for free. `approveSettingsProposal` calls
`invalidateCachedSystem()`, and `buildSystem` renders current settings values into the prompt, so
the coach's next turn sees exactly which fields it has already recorded. This is the documented
mitigation for the most common LLM-interview failure mode (re-asking answered questions) and it
requires no new state.

**Declining is data, not absence.** A refusal is stored as its own text (`"prefer not to say"`),
so `''` continues to mean "never asked". No sentinel, no per-field asked/answered record, and the
settings screen shows the user exactly what the coach was told.

**Entry is orthogonal to the Today screen's existing state.** `todayViewState` answers "what can
this user start right now" as an exhaustive discriminated union; whether to invite someone into
onboarding is a separate question. A new pure predicate answers it, and the card renders above
`renderContent()` so it coexists with the resume button, the error banner, and the loading state
rather than suppressing them.

Data flow for one interview turn:

```
user text → aiChatStore.send → buildSystem (embeds current profile)
          → Anthropic /v1/messages (AI_TURN_SCHEMA)
          → parseAiTurn → validateSettingsProposal
          → [onboarding only] approveSettingsProposal → setSettings + invalidateCachedSystem
          → next turn's system prompt reflects what was just written
```

### Contracts

Settings gains five fields (`src/state/settings.ts`):

```typescript
interface BridgeSettings {
  // ...existing fields unchanged...

  /** Free text: "41", "early 40s", "prefer not to say". '' = never asked. */
  profileAge: string;
  /** Free text, including self-described. '' = never asked. */
  profileGender: string;
  /** Free text: "beginner", "strong squat, terrible overhead". '' = never asked. */
  profileExperience: string;

  /** Lifecycle of the opening conversation. Defaults to 'unseen'. */
  onboardingState: 'unseen' | 'dismissed' | 'completed';
}
```

The turn payload widens (`src/ai/draftSchema.ts`) — every field optional, as today:

```typescript
interface SettingsProposal {
  goals?: string;
  equipment?: string;
  personality?: string;
  age?: string;
  gender?: string;
  experience?: string;
}
```

The conversation mode gains a fourth variant (`src/ai/contextBuilder.ts`):

```typescript
type AiCoachMode =
  | { kind: 'create' }
  | { kind: 'edit'; routineId: string }
  | DebriefMode
  | { kind: 'onboarding' };
```

New pure module `src/state/coachOnboarding.ts`:

```typescript
/** Sent as a hidden user turn so the coach speaks first. */
export const ONBOARDING_OPENING_MESSAGE: string;

/**
 * True when the Today tab should invite the user into the opening conversation.
 * The key check must match what aiChatStore.startTurn enforces, or the card can
 * open a conversation that immediately fails with `missing_key`.
 */
export function shouldShowOnboardingCard(settings: BridgeSettings): boolean;
```

## Existing Patterns

This design follows established patterns rather than introducing new ones.

**Coach-speaks-first** reuses the debrief mechanism verbatim: `aiChatStore.openDebrief`
(`src/state/aiChatStore.ts:197`) resets, then sends a `hidden: true` user message that is
byte-identical on the wire but suppressed in the UI. `openOnboarding` mirrors it exactly.

**Pure module beside the store** follows `src/state/postWorkoutDebrief.ts`, which exists
specifically so `DEBRIEF_OPENING_MESSAGE` and the route-param mapper land inside jest's `state`
glob while `expo-router` stays out (that import lives in `debriefNavigation.ts`).
`coachOnboarding.ts` is the same shape.

**Route params → mode** extends `aiCoachModeFromParams` (`src/state/postWorkoutDebrief.ts:68`),
which already maps `routineId`/`debriefSessionId` onto three modes.

**Injected dependencies** — all three one-shot stores already take `getSettings` as an injected
dep (`restCommentaryStore.ts:61`, `exerciseQuestionStore.ts:50`, `exerciseReplaceStore.ts:62`)
and hand values into a typed prompt-builder input object. Threading three more fields follows the
existing shape; no store starts reading settings a new way.

**Free-text neutralization** — every prompt builder already owns a private `neutralizeForPrompt`
that strips leading `#` runs so user text cannot masquerade as prompt structure. AGENTS.md records
the three copies as accepted debt with an explicit "don't add another". Each builder reuses its own
copy for the new fields; no fifth copy is created.

**Immutable directives last** — the new About-the-User section is built from user-controlled free
text, so it must sit *before* the immutable directives section in all four builders, per the
placement rule AGENTS.md documents.

**Persona-pins-validator-bounds** — `contextBuilder.test.ts` asserts persona sentences as exact
strings so a bound changed in `draftSchema.ts` without rewording the prose fails a test rather
than drifting. New onboarding prose is pinned the same way.

**Settings blob tolerance** — `loadSettings` merges with a spread (`src/state/settings.ts:88`), so
older stored blobs pick up defaults for new keys with no migration. `settings.test.ts:138` already
pins this for the previous round of added fields.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Profile settings and onboarding state
**Goal:** Persist the three profile fields and the onboarding lifecycle flag.

**Components:**
- `src/state/settings.ts` — three `profile*` fields plus `onboardingState` on `BridgeSettings`
  and `DEFAULT_SETTINGS`

**Dependencies:** None.

**Covers:** `coach-onboarding.AC1.1`, `.AC1.2`, `.AC1.3`, `.AC1.4`

**Done when:** New fields round-trip through storage; a legacy blob lacking them loads with
defaults and no error; `onboardingState` defaults to `'unseen'`.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Widened settings-proposal contract
**Goal:** Let a turn carry all six profile values, validated on receipt and again before write.

**Components:**
- `src/ai/draftSchema.ts` — `SettingsProposal` type, `AI_TURN_SCHEMA.settingsProposal`
  properties, `validateSettingsProposal`, `isEmptyProposal`

**Dependencies:** Phase 1.

**Covers:** `coach-onboarding.AC2.1`, `.AC2.2`, `.AC2.3`, `.AC2.4`

**Done when:** All six fields validate under the existing non-empty and
`SETTINGS_FIELD_MAX_LENGTH` rules; a proposal carrying only a new field is accepted; an
all-undefined proposal is still rejected; `expectStructuredOutputSafe(AI_TURN_SCHEMA)` passes.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Onboarding mode and persona
**Goal:** A fourth conversation mode whose system prompt runs the interview and shows the coach
what it has already recorded.

**Components:**
- `src/ai/contextBuilder.ts` — `AiCoachMode` variant, `personaSection` onboarding branch, an
  About-the-User section placed before the immutable directives
- `src/state/postWorkoutDebrief.ts` — `aiCoachModeFromParams` handles the new `onboarding` param
  ahead of the `routineId` branches
- `src/state/coachOnboarding.ts` (new) — `ONBOARDING_OPENING_MESSAGE`

**Dependencies:** Phase 2 (persona prose restates the widened bounds).

**Covers:** `coach-onboarding.AC3.1`, `.AC3.2`, `.AC3.3`, `.AC3.4`, `.AC3.5`, `.AC3.6`, `.AC3.7`, `.AC6.1`

**Done when:** The onboarding prompt instructs batching, sensitive-fields-late ordering,
verbatim recording of refusals, grounding every value in user text, and closing with an offer to
draft a routine; the mode-conditional approval sentence does not appear in onboarding mode and
still appears in the other three; profile values render in the prompt; the secret-leak assertion
still passes.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Store auto-apply and completion
**Goal:** Write settings after every onboarding turn with no approval card, and only in that mode.

**Components:**
- `src/state/aiChatStore.ts` — `openOnboarding`, widened `approveSettingsProposal` patch, the
  mode-gated auto-apply inside `runTurn`, and the `onboardingState: 'completed'` transition on
  first successful write
- `src/ai/acceptDraft.ts` — the mode switch currently mints `routine-<epoch>` in create mode and
  forces `mode.routineId` in edit and debrief. Onboarding carries no routine id, so it must take
  the create-mode branch; leaving it unhandled is how the first routine ends up with nowhere to
  land

**Dependencies:** Phase 3.

**Covers:** `coach-onboarding.AC4.1`, `.AC4.2`, `.AC4.3`, `.AC4.4`, `.AC4.5`, `.AC7.1`, `.AC7.2`

**Done when:** An onboarding turn's proposal is written and leaves `pendingSettingsProposal`
null; a `create`-mode turn's proposal stays pending and writes nothing (this test must be watched
failing with the mode condition removed); an invalid proposal is swallowed without ending the
conversation; the generation guard still discards a turn from a reset conversation.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Entry and exit surfaces
**Goal:** Invite the user in, let them leave, and let them come back.

**Components:**
- `src/state/coachOnboarding.ts` — `shouldShowOnboardingCard`
- `src/components/` — the dismissible card
- `src/app/(tabs)/index.tsx` — render the card above `renderContent()`
- `src/app/(tabs)/settings/ai.tsx` — three new inputs plus a Start/Redo control
- `src/app/ai-coach.tsx` — `HEADER_TITLES` entry and the "I'll fill this in myself" control

**Dependencies:** Phase 4.

**Covers:** `coach-onboarding.AC5.1`, `.AC5.2`, `.AC5.3`, `.AC5.4`, `.AC5.5`

**Done when:** The predicate returns true only for `'unseen'` with a key present; dismissing
writes `'dismissed'`; the card coexists with resume/error/loading rather than replacing them; the
settings screen persists all six fields through its existing autosave.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Profile in the one-shot surfaces
**Goal:** Rest commentary, the exercise Question button, and Replace alternates all coach against
the same profile.

**Components:**
- `src/state/restCommentaryStore.ts` → `src/ai/restCommentaryPrompt.ts`
- `src/state/exerciseQuestionStore.ts` → `src/ai/exerciseQuestionPrompt.ts`
- `src/state/exerciseReplaceStore.ts` → `src/ai/alternatesPrompt.ts`

**Dependencies:** Phase 1.

**Covers:** `coach-onboarding.AC6.2`, `.AC6.3`, `.AC6.4`

**Done when:** Each builder renders the profile before its immutable directives, neutralized by
that file's existing helper; each surface keeps its secret-leak assertions and gains a positive
assertion that profile text reaches the prompt.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Simulator verification
**Goal:** Verify what the node jest project structurally cannot see.

**Components:** None — verification only.

**Dependencies:** Phases 5 and 6.

**Done when:** The card appears on Today for a keyed, un-onboarded install and disappears after
dismissal; a real interview writes fields observable in settings and in SQLite; the opt-out lands
on the settings screen with partial answers intact; layout holds with a long profile value.
<!-- END_PHASE_7 -->

## Additional Considerations

**Every failure stays swallowed.** A `settingsProposal` that fails its second validation is caught
and dropped: the field goes unwritten, the coach sees it still empty next turn and re-asks. This is
self-healing and consistent with the project rule that no workout or conversation depends on the AI.

**No prompt caching during the interview.** Every write calls `invalidateCachedSystem()`, so each
turn rebuilds the system prompt — including `buildSystem`'s routine and history queries. That is
acceptable *because* the audience is a new user with no routines and no history; it would not be
acceptable for a re-run against a mature install, which is a known cost of the Start/Redo control.

**Grammar budget.** Widening `settingsProposal` spends three more optional parameters against an
undocumented, empirically-observed ceiling around 24. `AI_TURN_SCHEMA` is not close to it today,
but the number is worth recording because nothing in the codebase measures it and the failure mode
is a hard 400.

**Key check will move.** `shouldShowOnboardingCard` gates on a non-empty `anthropicKey` because
that is what `startTurn` enforces. Issue #128 (multi-provider Phase 3) will make
`resolveAiProvider()` the honest check; both sites must move together or an OpenAI-only install
gets a card that opens a conversation which immediately fails.

**Concurrent-branch overlap.** Issues #128 and #122 also target `aiChatStore.ts` and
`src/app/(tabs)/settings/ai.tsx`. Neither is dispatched yet; whichever lands first sets the merge
cost for the other.

**Sensitive attributes.** Age and gender enter every system prompt once recorded, so they are
asked last, refusal is a complete answer recorded verbatim, and both remain editable and clearable
from the settings screen.

**Out of scope, deliberately:** issue #168's first-use key prompt, and any live validation of the
key beyond non-empty.
