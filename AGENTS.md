# HMB Workout

Last verified: 2026-07-30

Local-first React Native (Expo SDK 57, iOS) workout logger. Data lives on-device
(WatermelonDB); the Obsidian vault is the sync target via a Mac-side bridge. The
session flow is driven by a pure functional Rill-lang state machine. Routines can
also be authored conversationally against the Anthropic API with a user-supplied
key (`src/ai`).

## Expo version discipline

Expo SDK 57 changed APIs from prior majors. Read the exact versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing Expo/RN code. Do not rely
on memory of older Expo/Router/Reanimated APIs.

## Tech stack

- Expo SDK ~57, React Native 0.86, React 19, expo-router (file-based, `src/app/`)
- WatermelonDB 0.28 (SQLite on device; LokiJS on web) — data layer
- rill-lang 1.1.1 (`file:../rill-lang/rill-lang-1.1.1.tgz`, packed tarball) — pure
  functional session engine. Its lib entry is platform-neutral as of 1.1.1; the
  Node-only `createFsResolver` lives behind the `rill-lang/fs-resolver` subpath
- Zustand 5 — active-session store (imperative shell)
- @kingstinct/react-native-healthkit — write-only workout export
- Anthropic Messages API — called over plain `fetch`, **no SDK dependency** (see AI
  Coach below)
- Jest + ts-jest (node env) — tests

## Commands

- `npm test` — Jest (node project only; see Testing gotchas below)
- `npm run ios` / `npm start` — run the app (requires dev client; WatermelonDB is native)
- `npm run lint` — expo lint

## Two-repo split

- **This repo** = the iOS app.
- **`../workout-bridge`** = Mac-side HTTP bridge (Node/vitest) that reads/writes the
  vault's `_sync/` folder over Tailscale. Its own README documents endpoints.
- The markdown contract is shared code, **copied** into both repos
  (`src/interop/format.ts` here → `src/contract.ts` there). There is no shared
  package: if you change the markdown grammar, update **both** copies or the bridge
  will reject valid sessions.

## Architecture: Functional Core / Imperative Shell (FCIS)

This is the load-bearing invariant. All session-flow logic lives in the pure core;
everything else only shapes payloads and runs side effects.

- **Core (`src/engine`)** — pure. The bundled `.lv` rules are the *only* place that
  decides phase transitions, advancement, validation, and which effects fire. A Rill
  `transition(state, event) → Result({state, effects})` is the single contract.
- **Shell (`src/state`, `src/components`, `src/app`, `src/ai`)** — imperative. The
  Zustand store owns injected effect executors and persistence; presenters derive view
  data from engine state. **No session-flow decisions belong in components or the
  store** — if you find yourself branching on `phase` to decide what happens next, it
  belongs in a `.lv` rule, not TS.
- The AI slice is shell-only and deliberately does not touch the engine: it authors
  *routines* (data), never session flow. A routine produced by the AI is
  indistinguishable from a hand-built one by the time the engine sees it.

### Non-obvious engine conventions (will bite you)

These exist to work around Rill's type system and have no analog in ordinary TS:

1. **Uniform-record effects.** Rill's checker cannot unify a heterogeneous list, so
   the engine emits every effect as the *same* record shape
   `{ kind: String, deadline_ms: Int, message: String }`. The host
   (`engine/index.ts` `mapUniformEffect`) enriches each uniform record into the typed
   `Effect` union, pulling payloads from state. Adding an effect = add a `kind` string
   in `transition.lv` **and** a case in `mapUniformEffect`; never widen the Rill record.

2. **Host-appended `loggedSets`.** Rill has no list-append. The `LogSet` rule writes a
   single `lastLoggedSet` onto the returned state; the host appends it to
   `loggedSets` when it sees a `persist_set` effect. Do not expect the core to grow
   the list — that is the shell's job, and it is the reason `lastLoggedSet` exists.

3. **`idx` is 0-based order, host-assigned.** Rill indexed list access uses head/tail
   recursion, so entries must carry an explicit `idx`. The host pre-indexes
   `routine.entries` (`idx = array position`) inside `dispatch` before handing the
   event to Rill. Callers pass routines *without* `idx`; never author `idx` by hand.

4. **Rules are inlined, not module-loaded.** `.lv` files are imported as strings
   (babel inline-import). Metro's transform cache keys on the *importing* TS file,
   not the `.lv` content — after editing any `.lv` file, restart Metro with
   `npx expo start --clear` or modules that inline the same rules can end up with
   mixed old/new copies (e.g. `loadRules.ts` validating different sources than
   `engine/index.ts` executes). `loadRules.ts` splices `validate_set`/`rest_duration` helper
   bodies into `transition` as let-bindings to build `transitionCompositeSource`.
   `loadRules()` (type-check gate) must run from the boot effect in `_layout.tsx`,
   **not** at module-init — a module-init throw crashes before the RuleErrorScreen can
   render. Keep it that way.

5. **State is fully JSON-serializable** (no Dates/functions) so it can be persisted and
   rehydrated after an app kill. `entries` is stored *in* the state for this reason.

## The vault markdown contract (`src/interop`)

`format.ts` is the single source of truth for the grammar; `serialize.ts` and
`parse.ts` must stay symmetric (roundtrip tests enforce it). One overload to know:
the `<sets>x<reps>` slot means **target** sets×reps in a routine, but in a logged
session it is emitted as `1x<logged-reps>` (one logged set). Session lines therefore
expose honest aliases (`loggedReps`, `loggedDurationSeconds`) — read those, not the
`target*` fields, when consuming a parsed session. Contract violations throw
`ContractError`.

## Sync (`src/sync`)

Offline-first queue. Sessions are written locally with `sync_status='local'` and flip
to `'synced'` only after a successful POST; `health()` gates all posting (unreachable
bridge = no-op, not an error). Posting is idempotent by session id. Network vs HTTP
failures are distinct types (`BridgeUnreachable` vs `BridgeHttpError`).

## HealthKit (`src/health`)

Write-only. All HealthKit errors are logged and swallowed — a Health failure must
never affect DB or sync state. Dependencies are injected (`HealthKitSaveDeps`) so the
save path is testable in the node jest project.

## AI Coach (`src/ai`)

Conversational routine authoring. The user brings their own Anthropic key; requests go
straight to the API (never via the bridge) and the chat is never persisted. The three
settings fields (`anthropicKey`, `aiGoals`, `aiEquipment`) live in the existing
`bridge_settings` blob, so `BridgeSettings` in `src/state/settings.ts` is now a
misnomer — AI settings are in there too.

- **No SDK, on purpose.** `anthropicClient.ts` is a hand-rolled `fetch` POST to
  `/v1/messages` — non-streaming, `thinking: disabled`, structured output via
  `output_config.format.json_schema`. Adding `@anthropic-ai/sdk` is not an upgrade:
  the client must stay RN-bundle-safe and `fetchFn`-injectable so it tests in the node
  jest project. Network vs HTTP failures are distinct types (`AnthropicUnreachable` vs
  `AnthropicHttpError`), matching the sync convention.
- **One turn shape, three declarations.** The `{ reply, draft? }` contract is stated in
  `AI_TURN_SCHEMA` (what the API enforces), in the `AiTurn`/`RoutineDraft` types plus
  `validateRoutineDraft` (what the app enforces), and in `personaSection()` prose in
  `contextBuilder.ts` (what the model reads). Changing the draft shape means changing
  all three — same hazard class as the copied markdown contract.
- **The persona restates the validator's rules, not just its shape.** `personaSection()`
  spells out the bounds `validateRoutineDraft` enforces (non-empty name, ≥1 exercise,
  title must slugify to something non-empty, `targetSets`/`targetReps` ≥ 1, and
  `warmupSets`/`targetDurationSeconds`/`restSeconds` ≥ 0), so a rejected draft reads as
  a model mistake rather than a surprise. `contextBuilder.test.ts` asserts those
  sentences as *exact strings*: loosening or tightening a bound in `draftSchema.ts`
  without rewording the prose fails those tests rather than silently drifting.
- **Validate twice; structured output is not a guarantee.** `parseAiTurn` validates on
  receipt and `acceptDraft` validates again before writing. Keep both.
- **Exercise identity is `slugifyTitle(title)`, and the accept path is create-only.**
  Exercises are global and shared by every routine, so `acceptDraft` creates a missing
  exercise but never updates an existing one's title or kind — a draft must not rename
  or re-kind an exercise out from under other routines. Title reuse therefore maps to
  the same record, which is why the persona pushes the model toward existing titles.
- **Drafts are whole routines, never diffs.** `upsertRoutine` reconciles
  `routine_exercises` in place, not delete-and-recreate: entries claim existing
  rows by `exerciseId` (oldest `order` first, so duplicated exercises match
  deterministically) and survivors keep their row ids. That stability is
  load-bearing: `session_sets.routine_exercise_id` references those rows and
  `getExerciseWorkingSetHistory` joins by row id, so editing a routine never
  orphans logged history. An exercise the draft omits *is* deleted, which is why
  the persona demands the full exercise list.
- **The conversation mode owns the routine id.** `acceptDraft(db, draft, mode)` mints
  `routine-<epoch>` in create mode and forces `mode.routineId` in edit mode; drafts
  carry no routine id. Accepting in edit mode always overwrites the routine named by
  the route param.
- **The prompt carries data, never secrets.** `buildSystem` composes goals, equipment,
  every routine, and working-set history (`HISTORY_SETS_PER_EXERCISE` most recent per
  exercise, warmups excluded). `anthropicKey`/`token`/`baseUrl` must never appear — a
  regression test in `contextBuilder.test.ts` asserts this.
- **`aiChatStore` is ephemeral with generation-counter invalidation.** `reset(mode)`
  clears the cached system prompt and bumps `generation`; a request that resolves after
  a reset is discarded rather than appended, and cannot repopulate the cache it just
  cleared. That counter looks removable and is not. `acceptDraft` re-entry is latched in
  the store — a second same-frame call returns `null` instead of writing a
  duplicate routine; the screen's `accepting` state is cosmetic, so the latch
  also looks removable and is not. Deps are injected (`AiChatDeps`) so
  the whole turn path tests without network or DB.

## Testing gotchas

- Jest runs a **single `node` project** (`jest.config.js`), not jest-expo. Its
  `testMatch` covers `engine/db/interop/state/sync/health/helpers/ai` — all pure TS, no
  RN runtime. A new `src/` domain gets no test coverage until it is added to that list.
  The commented-out `rn` project is intentional future work; don't assume RN-env tests
  run — screens (including `ai-coach.tsx`) are therefore untested by `npm test`.
- `watchman: false` is required — watchman's crawl hangs jest startup on this machine.
- ts-jest transform pins `useDefineForClassFields: false` + `experimentalDecorators`/
  `emitDecoratorMetadata`. WatermelonDB models rely on legacy decorator semantics;
  class-fields-define would shadow the `@field`/`@relation` getters and silently break
  the models. Do not "modernize" these compiler options.

## Structure

- `src/engine/` — pure Rill core + host dispatch/effect mapping (`rules/*.lv`)
- `src/db/` — WatermelonDB schema, models, repository; `adapter.ts`/`adapter.web.ts`
  select SQLite vs LokiJS per platform
- `src/interop/` — vault markdown serializer/parser (the shared contract)
- `src/state/` — Zustand stores (session + AI chat), presenters, settings,
  session start/rehydrate
- `src/sync/` — bridge HTTP client + offline sync queue
- `src/health/` — HealthKit write-only export
- `src/ai/` — AI coach: turn/draft schema + validators, Anthropic client,
  system-prompt builder, draft→repository accept path
- `src/app/` — expo-router screens

## Boundaries

- Safe to edit: `src/`
- Session-flow logic changes go in `src/engine/rules/*.lv`, never in the store/components
- Markdown grammar changes must be mirrored in `../workout-bridge/src/contract.ts`
- AI draft shape *and* validation bounds must be mirrored across `AI_TURN_SCHEMA`, the
  draft validators, and the persona prompt (all in `src/ai`)
- The AI accept path may create exercises but must never mutate existing ones
- Do not touch generated Rill dist or the `../rill-lang` tarball dependency by hand
