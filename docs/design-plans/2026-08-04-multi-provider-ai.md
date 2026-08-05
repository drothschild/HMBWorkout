# Multi-Provider AI Coach Design Plan

**Date:** August 4, 2026  
**Status:** Design phase (no implementation)

## Problem Statement

Currently, HMBWorkout supports only Anthropic's Claude API for the AI Coach feature. Users who prefer or have credits with OpenAI must abandon the AI features entirely. This design plan extends the AI Coach to support both Anthropic and OpenAI while maintaining the existing hand-rolled `fetch` approach, testability in the node jest project, and the three-declaration contract model (schema, validators, prose).

## Decision Roadmap

This document makes the following design decisions:

1. **Provider seam location:** Single abstraction at the client-factory level, with provider-aware logic isolated to a new `src/ai/provider` module
2. **Structured output handling:** Two parallel schema checks—one for Anthropic's subset, one for OpenAI's subset
3. **Key and provider storage:** Separate storage for each provider key; provider selection inferred from which key is set, with manual override via settings
4. **Testing:** Fully testable in node jest via `fetchFn` injection; UI provider-selection element unverified by tests (acceptable)
5. **Model selection:** Provider-specific model defaults; user-configurable via settings

## Why Not: Declined Alternatives

**Dropdown-only provider selection:**  
The user requested a design pass rather than a quick UI picker. Inferring provider from key prefix alone is insufficient (both might be valid strings), but storage segregation enables a middle ground: storage implicitly selects if both keys exist, with a visible toggle for rare override.

**SDK dependency:**  
AGENTS.md is explicit: "Adding `@anthropic-ai/sdk` is not an upgrade." The same constraint applies to OpenAI's SDK—the client must stay RN-bundle-safe and `fetchFn`-injectable for node jest. Hand-rolled fetch for both providers is consistent with that principle.

## Key Findings

### Current Anthropic Implementation

**Request Structure:**
```json
{
  "model": "claude-sonnet-5",
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": { /* JSON Schema */ }
    }
  },
  "system": "...",
  "messages": [...]
}
```

**Unsupported Keywords, as this app enforces them:**  
`minItems`, `maxItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minProperties`, `maxProperties`

**⚠️ Correction (2026-08-04): this is *our* list, not Anthropic's.** `structuredOutputSubset.ts` says so in its own docstring — it is "deliberately a little wider than the documented list", because `pattern`, `uniqueItems`, `minProperties` and `maxProperties` are named by Anthropic as neither supported *nor* rejected, and the guard treats silence as rejection on purpose ("a schema that needs one should prove it works against the live endpoint and then be removed from this list, rather than shipping on the assumption that silence means support").

That matters here more than it looks, because the section below frames OpenAI's subset as "the opposite of Anthropic". Inverting a **deliberately conservative superset** does not yield the other provider's real subset — at minimum `pattern`, `uniqueItems`, `minProperties` and `maxProperties` sit in a three-way state (rejected by our guard, unknown at Anthropic, claimed-or-inferred at OpenAI) and cannot be reasoned about by inversion at all. Derive each provider's list from that provider's own documentation, and keep our conservative-by-default posture in both.

**Behavior:**  
If an unsupported keyword is present, the endpoint rejects the entire request with HTTP 400 before the model runs. The official SDKs strip these keywords; this app does not, so `expectStructuredOutputSafe` (in `src/ai/structuredOutputSubset.ts`) walks every schema before sending.

**Four Clients (all hardcoded to claude-sonnet-5):**
1. `createAnthropicClient` — chat with `AI_TURN_SCHEMA` (structured)
2. `createRestCommentaryClient` — prose output for rest timer (prose, `effort: low`)
3. `createExerciseQuestionClient` — prose output for "?" button
4. `createExerciseAlternatesClient` — alternates with `ALTERNATES_SCHEMA` (structured)

**Error Types:**  
`AnthropicUnreachable` (network) vs `AnthropicHttpError` (HTTP status)

### OpenAI's Structured Outputs via Responses API (Effective August 2026)

**Request Structure:**
```json
{
  "model": "gpt-5.6-sol",
  "max_output_tokens": 4096,
  "input": [
    { "role": "developer", "content": "system instructions" },
    { "role": "user", "content": "user message" }
  ],
  "text": {
    "format": {
      "type": "json_schema",
      "name": "ai_turn",
      "strict": true,
      "schema": { /* JSON Schema */ }
    }
  },
  "reasoning": { "effort": "low" }
}
```

**Note on API Shape:**
OpenAI's Responses API uses `input` (message array with role `developer` for system content)
rather than Chat Completions' top-level `system` parameter. This preserves the
IMMUTABLE_DIRECTIVES channel precedence as a role-tagged entry.

**Supported Keywords (enforced at generation time):**  
Opposite of Anthropic: OpenAI **does** support `minItems`, `maxItems`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `pattern`.

OpenAI **does not** support: `minLength`, `maxLength`, `minProperties`, `maxProperties` (inferred).

**⚠️ Unverified — confirm before Phase 1 (2026-08-04).** The agent that wrote this plan was correctly barred from calling either API, so everything in this subsection is documentation-derived at best and, where marked "(inferred)", not sourced at all. **The per-provider keyword subsets are the single load-bearing technical claim in this design** — the dual-check mechanism is built entirely on them — so treat them as a hypothesis to verify, not a finding. The same caution applies to the model id `gpt-5.6` used throughout: a wrong model id is a 404 on all four AI surfaces at once. Verify both against current OpenAI documentation and pin the results before any code is written.

**Behavior:**  
OpenAI's structured output uses Context-Free Grammar (CFG) to guarantee schema adherence at the token level. The request includes `"strict": true` and a required `name` field on the schema root.

**Critical Differences:**
1. Field name: **`text.format`** (not `output_config`). *Corrected — an earlier draft said `response_format`, which is the older Chat Completions shape; this design targets the Responses API.*
2. Nested structure: `json_schema` object contains `strict`, `name`, and `schema` (not flat)
3. Supported keyword set: different from Anthropic
4. `strict: true` is mandatory
5. Schema root requires a `name` field (Anthropic does not have this)
6. All properties must be `required` at the root level (Anthropic does not have this requirement)
7. `additionalProperties: false` is mandatory (Anthropic requires this too)

**Error Handling:**  
OpenAI returns 400 for invalid schemas; 401 for auth failure; 429 for rate limits. Similar to Anthropic, but status codes may differ.

## Design Decisions

### 1. Provider Seam: Client Factory Layer

**Decision:**  
Place the provider abstraction at the client-factory level. Create a new `src/ai/provider` module with:
- `type ProviderConfig = { provider: 'anthropic' | 'openai'; apiKey: string; model?: string }`
- `createProviderClient(config: ProviderConfig)` — factory that returns a uniform client interface

**Why:**
- Four separate client functions (`createAnthropicClient`, `createRestCommentaryClient`, `createExerciseQuestionClient`, `createExerciseAlternatesClient`) already exist
- A provider-aware wrapper avoids duplicating the four factories; instead, it delegates to the appropriate one
- Zustand stores already inject `createClient` as a dependency, so swapping the factory is already a tested pattern
- The uniform interface hides provider differences from consumers

**Interface:**
```typescript
export interface AiClient {
  chat(request: { system: string; messages: AiChatMessage[] }): Promise<AiTurn>;
  comment(request: { system: string; message: string }): Promise<string>;
  ask(request: { system: string; message: string }): Promise<string>;
  suggest(request: { system: string; message: string }): Promise<ExerciseAlternates>;
}
```

**Consequence:**  
This requires each provider to implement all four methods, even if the method signature (request shape) is identical. The wrapper handles the translation from uniform request → provider-specific POST body.

### 2. Structured Output Handling: Dual Subset Checks

**Decision:**  
Maintain `expectStructuredOutputSafe` for Anthropic schemas. Add `expectStructuredOutputSafeForOpenAI` for OpenAI schemas. Each schema used by the app gets tested by both guards.

**Why:**
- `AI_TURN_SCHEMA` and `ALTERNATES_SCHEMA` are provider-agnostic data contracts
- Both providers must accept them, but their keyword subsets differ
- Testing both ensures a schema either works on both providers or is explicitly marked as provider-specific
- The guards live in test files only (not in the bundle), so both guards are zero-cost in production

**Implementation:**
```typescript
// src/ai/structuredOutputSubset.ts
export function expectStructuredOutputSafeForOpenAI(schema: unknown): void {
  const unsupported = findUnsupportedKeywordsForOpenAI(schema);
  expect(unsupported).toEqual([]);
}

// src/ai/alternatesSchema.test.ts
expectStructuredOutputSafe(ALTERNATES_SCHEMA); // Anthropic
expectStructuredOutputSafeForOpenAI(ALTERNATES_SCHEMA); // OpenAI
```

**Note:**  
If either guard fails, the schema must be revised (more likely: remove an unsupported keyword and enforce it in the validator instead).

### 3. Storage and Provider Selection

**Decision:**  
Store `anthropicKey` and `openaiKey` as separate fields in the `bridge_settings` blob. Provider selection follows this precedence:
1. If only one key is set, use it (implicit selection)
2. If both are set, use the most-recently-set one (tracks user intent)
3. If neither is set, disable AI features (existing behavior)
4. Add an optional `aiProvider` field to override (rare, for testing or key rotation)

**Why:**
- Doesn't break existing installs with `anthropicKey` already populated
- Doesn't force users with both keys to make an explicit choice every time
- Settings upgrades are transparent (read old `anthropicKey`, write both if missing)
- Tests can set both keys and use `aiProvider` override to switch between them

**Data Contract Update:**
```typescript
interface BridgeSettings {
  baseUrl: string;
  token: string;
  anthropicKey: string; // kept for backward compatibility
  openaiKey: string;    // new field
  aiProvider?: 'anthropic' | 'openai'; // optional override
  aiGoals: string;
  aiEquipment: string;
  aiPersonality: string;
  aiModel?: string; // optional override for model selection
}
```

**Migration Logic (in `loadSettings`):**
If `anthropicKey` is set and `openaiKey` is not, infer `aiProvider: 'anthropic'`. On the first time the user sets `openaiKey`, do not change `aiProvider`—they must opt in explicitly if they want to switch.

### 4. Prompt Builders and Directives

**Decision:**  
No changes to prompt builders or directives. Both providers see identical prose, system prompts, and immutable directives.

**Why:**
- The immutable directives must stay at the end of every system prompt to preserve precedence (both providers, same rule)
- The "overridable" and "immutable" tiers both hold across providers
- The three-declaration rule (schema, validators, prose) is unchanged; prose is provider-agnostic
- This minimizes the blast radius of the multi-provider change

**Caveat:**  
If future experience suggests OpenAI's model family needs different directives (e.g., different default tone), those can be added later as provider-specific overrides in the system prompt builder.

### 5. Request Translation Layer

**Decision:**  
Create a new `src/ai/provider/requestBuilder.ts` module that translates a uniform request shape into provider-specific POST bodies.

**Why:**
- Anthropic and OpenAI differ in: field names (`output_config` vs **`text.format`**), the message channel (`messages` + `system` vs `input` with a role-tagged `developer` entry), token budget (`max_tokens` vs `max_output_tokens`), reasoning effort (`output_config.effort` vs `reasoning: { effort }`), nesting depth, and required fields (`strict`, `name`)
- Separating this translation from the client logic makes the provider abstraction testable
- The translation is stateless and deterministic (same input → same output for each provider)

**Shape:**
```typescript
type AiRequest = {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  schema?: Record<string, unknown>; // optional, for structured outputs
  maxTokens: number;
  effort?: 'low' | 'default';
};

function buildAnthropicBody(req: AiRequest): unknown { }
function buildOpenAiBody(req: AiRequest): unknown { }
```

### 6. Schema Name Field (OpenAI)

**Decision:**  
For OpenAI requests, derive a `name` field for the schema root from the schema type (e.g., `AI_TURN_SCHEMA.name = "ai_turn"`). This field is required by OpenAI's API.

**How:**
- Add an optional `$name` property to each schema (Anthropic ignores it)
- Prefer explicit naming: `{ type: 'object', $name: 'ai_turn', properties: { ... } }`
- Fallback: if `$name` is absent, derive a safe name from the schema's path or context (e.g., `ALTERNATES_SCHEMA` → `"exercise_alternates"`)

**Why:**
- Makes the three-declaration contract explicit: the schema itself states its name
- Doesn't pollute the actual JSON Schema vocabulary (OpenAI's `name` is separate from `$name` in the JSON Schema universe)
- Keeps tests maintainable (one source of truth for the name)

### 7. Testing Strategy

**No New Test Framework:**  
All AI tests continue to run in the node jest project via `fetchFn` injection. Clients are factory functions, so tests swap in a mock `fetchFn`.

**Test Coverage:**
- Unit tests for both request builders (Anthropic and OpenAI)
- Unit tests for `findUnsupportedKeywordsForOpenAI` (mirrors existing Anthropic test)
- Integration test: same `AiTurn` payload is parsed identically whether the provider is Anthropic or OpenAI
- Error mapping tests for both providers (401 → unauthorized, etc.)

**UI Not Tested:**  
The provider-selection toggle (if it exists) is in `src/app` or `src/components` and has zero jest coverage. Verification must be manual in the simulator.

### 8. Model Selection

**Decision:**  
Default models are provider-specific and hardcoded (as they are now for Anthropic):
- Anthropic: `claude-sonnet-5`
- OpenAI: `gpt-5.6`

Add an optional `aiModel` field to `BridgeSettings` to allow users or tests to override.

**Why:**
- Keeps the implementation simple (no model discovery or fallback logic)
- Users who want a different model can add it via settings
- Tests can validate behavior against different model versions if needed

**Future Extension:**  
If we add a Settings screen for AI model selection, the `aiModel` override becomes a user-facing setting.

## Implementation Phases

### Phase 1: Provider Infrastructure (1 PR)

**Files to create:**
- `src/ai/provider/types.ts` — `ProviderConfig`, `AiClient` interface
- `src/ai/provider/requestBuilder.ts` — `buildAnthropicBody`, `buildOpenAiBody`
- `src/ai/provider/errorMapper.ts` — map HTTP status → `AiChatError` for both providers
- `src/ai/provider/subset.ts` — `findUnsupportedKeywordsForOpenAI` and `expectStructuredOutputSafeForOpenAI`

**Files to modify:**
- `src/ai/structuredOutputSubset.ts` — export guards for schema testing
- `src/ai/draftSchema.ts` — add `$name` field to `AI_TURN_SCHEMA`
- `src/ai/alternatesSchema.ts` — add `$name` field to `ALTERNATES_SCHEMA`
- `src/state/settings.ts` — add `openaiKey`, `aiProvider`, `aiModel` fields; migration logic in `loadSettings`

**Tests to add:**
- `src/ai/provider/requestBuilder.test.ts` — verify both builders produce valid structures
- `src/ai/provider/errorMapper.test.ts` — error type mapping for both providers
- `src/ai/provider/subset.test.ts` — `expectStructuredOutputSafeForOpenAI` against test schemas
- `src/state/settings.test.ts` — migration logic (anthropicKey → provider inference)

**No implementation of clients yet.** This phase is pure infrastructure.

### Phase 2: OpenAI Clients (1 PR)

**Files to create:**
- `src/ai/openaiClient.ts` — mirror of `anthropicClient.ts`, four factories (`createOpenAiClient`, `createOpenAiRestCommentaryClient`, `createOpenAiExerciseQuestionClient`, `createOpenAiExerciseAlternatesClient`)

**Files to modify:**
- `src/ai/provider/factory.ts` (new) — `createProviderClient(config)` that dispatches to the right implementation

**Tests to add:**
- `src/ai/openaiClient.test.ts` — mirrors tests for Anthropic, same assertions (error mapping, response parsing)

### Phase 3: Zustand Store Integration (1 PR)

**Files to modify:**
- `src/state/aiChatStore.ts` — read provider from settings; pass provider-aware `createClient` to store
- `src/state/restCommentaryStore.ts` — read provider; swap client factory
- `src/state/exerciseReplaceStore.ts` — read provider; swap client factory
- `src/state/exerciseQuestionStore.ts` — read provider; swap client factory

**Tests to modify:**
- All AI-related store tests — validate error handling against both `AnthropicUnreachable` and a new `OpenAiUnreachable` type (or unified type)

**No UI changes in this phase.** Stores default to the implicit provider (based on which key is set).

### Phase 4: Settings UI (1 PR)

**Files to create (or modify):**
- Settings screen in `src/app` or `src/components` — UI for entering OpenAI key
- Optional: provider-selection toggle (if `aiProvider` override is user-facing)

**UI Behavior:**
- If only `anthropicKey` is set, disable OpenAI key entry
- If both keys are set, show a radio or toggle to switch providers (optional; implicit selection is valid)
- Changing a key clears the other and updates the inferred provider

**Tests:**  
None by jest. Manual verification in the simulator.

## Contracts and Hazards

### Three-Declaration Invariant

Each payload shape is declared three times:
1. **Schema** — `AI_TURN_SCHEMA`, `ALTERNATES_SCHEMA`
2. **Validators** — `validateRoutineDraft`, `validateSettingsProposal`, `validateExerciseAlternates`
3. **Prose** — builder prompt sections, persona sections in `contextBuilder.ts`

**Adding a new field to a payload:**
- Update the schema
- Update the validator
- Update the prose that describes it to the model
- Add a test that the schema is safe for both Anthropic and OpenAI
- Add a test in the validator that the new field is checked

**Example:** If we want `draft.targetDays?: number`:
```typescript
// draftSchema.ts
exercises: { type: 'array', items: { properties: { ..., targetDays: { type: 'integer' } } } }

// validateRoutineDraft
validateInteger('targetDays', exercise.targetDays, 0);

// contextBuilder.ts (in personaSection or similar)
"Each exercise may have a target frequency (`targetDays` field, e.g., 3 for 3x/week)"
```

### Schema Migration

If we remove a keyword that an old schema has, the old schema becomes invalid for the new provider. Example: if we added `minLength: 1` to a draft field and now need to remove it for OpenAI compatibility:

1. Remove the keyword from the schema
2. Add the check to the validator
3. Update the prose (if it mentioned the bound)
4. Tests will catch any schema that violates the new guard

No data migration needed; the change only affects new requests.

### Settings Upgrade

When `loadSettings` runs for the first time on an app that has `anthropicKey` but not `openaiKey`:
- Do NOT set `aiProvider` (leave undefined)
- When reading settings, if `aiProvider` is undefined, infer from which key is present
- Only set `aiProvider` explicitly when the user chooses to change it or tests override it

This preserves the "implicit selection" behavior and makes the upgrade transparent.

## Open Questions for User Input

1. **Should the provider toggle be visible in Settings, or stay implicit?**  
   Current design: implicit (provider follows most-recent key set). Visible toggle is Phase 4; absent in Phase 3.

2. **Should different providers have different default models?**  
   Current design: yes (claude-sonnet-5 for Anthropic, gpt-5.6 for OpenAI). Alternative: single model across both. User decision needed.

3. **Should we test AI Chat UI flows in the simulator against both providers?**  
   Current design: no (screens are unverified by jest). Alternative: manual sanity check on both providers before shipping. Not blocking; acceptable as Phase 5 exploratory work.

4. **Should error messages mention which provider failed?**  
   Current design: no (error types are generic). Alternative: include provider name in error context. Current design keeps error handling simple; provider name is diagnostic noise for end users.

5. **If a user has both keys and settings specify one provider, should we keep that choice or infer again?**  
   Current design: respect the explicit `aiProvider` setting; only infer if it's missing. This gives deterministic, reproducible behavior.

## Success Criteria

- [ ] No breaking changes to existing Anthropic-only installations
- [ ] Migrations from Anthropic to OpenAI (or vice versa) are transparent
- [ ] All four AI surfaces (chat, rest commentary, exercise question, alternates) work with both providers
- [ ] The same payload (e.g., `AI_TURN_SCHEMA`) works on both providers without modification
- [ ] No SDKs; hand-rolled fetch remains testable via `fetchFn` injection
- [ ] Jest node project coverage includes all provider logic (no untestable UI)
- [ ] Error handling is distinct (network vs HTTP) for both providers

## Known Debt and Future Work

1. **Deduplicate POST/parse boilerplate:** Four clients duplicate the HTTP request/response shape. AGENTS.md already flags this; implementing both providers makes it more obvious. Hoisting the shared shape (HTTP call, error handling, JSON parsing) into a utility is a quality-of-life improvement, not a blocker.

2. **Neutralize free text in four places:** `contextBuilder.ts` has `neutralizeNotesForPrompt`, `restCommentaryPrompt.ts` has `neutralizeForPrompt`, and `exerciseQuestionPrompt.ts` has the same function copied. These should be hoisted. Not a bug; already tracked in AGENTS.md.

3. **Model selection via Settings UI:** `aiModel` field is infrastructure-ready but has no UI entry path. Phase 4 can add it if users request it.

4. **Provider-specific prompt tuning:** Directives and persona sections are currently provider-agnostic. If testing reveals that OpenAI's model family benefits from different guidance, those can be added as provider-specific extensions without breaking the existing contract.

## References

- Current implementation: `src/ai/anthropicClient.ts`, `src/state/aiChatStore.ts`, `src/ai/contextBuilder.ts`
- AGENTS.md § "AI Coach" — existing constraints and conventions
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Anthropic Messages API: https://docs.anthropic.com/en/docs/about-claude/models/latest
