# HMB Workout

Last verified: 2026-07-31

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

## Native iOS project (`ios/`)

`ios/` is generated output (`expo prebuild`), gitignored, and **not** refreshed by
`npm run ios` once it exists on disk. After changing `app.json`, icon/splash assets,
or config plugins, regenerate it or builds keep shipping the stale native assets
(the old blue app icon outlived the icon swap in PR #30 this way):

    LANG=en_US.UTF-8 npx expo prebuild -p ios --clean

(CocoaPods needs the `LANG` override.) `--clean` is safe here: every native
customization — scene lifecycle, HealthKit entitlements, splash — comes from
`app.json` plugins and is re-applied. Hand edits under `ios/` do not survive a
regeneration; anything that must persist belongs in a config plugin (`plugins/`).

## Two-repo split

- **This repo** = the iOS app.
- **`../workout-bridge`** = Mac-side HTTP bridge (Node/vitest) that reads/writes the
  vault's `_sync/` folder over Tailscale. Its own README documents endpoints.
- The markdown contract is shared code, **copied** into both repos
  (`src/interop/format.ts` here → `src/contract.ts` there). There is no shared
  package, but the bridge copy is document-level only (frontmatter/block
  structure, plus `parseDuration` and `ContractError`): change those shared
  pieces in **both** repos or the bridge will reject valid sessions. Line-level
  flag grammar (rest, warmup, set_type, …) lives solely in this repo's
  `parseFlags` and needs no bridge mirror.

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
  *data* (routines, alternate exercises, descriptions), never session flow. A routine
  produced by the AI is indistinguishable from a hand-built one by the time the
  engine sees it. The one AI feature that changes a *running* session — the Replace
  button — still decides nothing shell-side: `exerciseReplaceStore` dispatches a
  `ReplaceExercise` event and the `.lv` rule alone decides whether the swap happens
  (see engine convention 7).

### Non-obvious engine conventions (will bite you)

These exist to work around Rill's type system and have no analog in ordinary TS:

1. **Typed effect variants, not a uniform record.** `Effect` is a tagged union
   declared in `types.lv` — `CreateSession`, `ScheduleRest`, `CancelRest`, `Notify`,
   `PersistSet`, `CompleteSession`, `DiscardSession` — mirrored by the TS `Effect`
   union in `engine/types.ts`. The host (`engine/index.ts`) maps each tag to a
   handler in the `rillExecutors` table, unpacking that variant's own payload and
   forwarding it to the matching `EffectExecutors` method inside a try/catch so one
   failing executor never crashes `dispatch`. Adding an effect means adding a variant
   to `types.lv` **and** `engine/types.ts`, plus a case in `rillExecutors` — there is
   no shared record shape left to widen. `DiscardSession` is its own variant rather
   than a case of `CompleteSession` on purpose: `CompleteSession` is what drives
   vault sync and the HealthKit export, so an abandoned session (`AbandonSession`)
   must emit `DiscardSession` so the session is deleted instead of synced or
   exported.

2. **`transition.lv` appends to `loggedSets` itself.** Rill does have a list-append
   builtin, and the `LogSet` rule uses it: `loggedSets: append(state.loggedSets,
   [theSet])` on the returned state, so the host never rebuilds the list. The same
   rule also writes `theSet` onto `lastLoggedSet`; `engine/index.ts` only carries
   that field across the sentinel boundary (rpe -1.0 ⇄ `undefined`, etc.) — nothing
   else in the codebase currently reads it.

3. **`idx` is 0-based order, host-assigned.** Rill indexed list access uses head/tail
   recursion, so entries must carry an explicit `idx`. Rill's own `RoutineEntry`
   alias (`types.lv`) has no `idx` field — `toRillRoutineEntry` strips it before an
   entry crosses into Rill — so the host supplies it on both sides of a `dispatch`
   call: `fromRillState` re-derives `idx` as array position after every transition
   returns (`entries.map((entry, idx) => ({ idx, ... }))`), and, going the other way,
   `startSessionFromRoutine.ts` assigns `idx: re._raw.order` — the DB's canonical
   0-based order, not a loop counter — when building a `StartSession` event's
   `routine.entries`, so it matches `routine_exercises.order` for `onPersistSet`'s
   later lookup. Callers pass routines *without* `idx`; never author `idx` by hand.

4. **Rules are inlined, not module-loaded.** `.lv` files are imported as strings
   (babel inline-import). Metro's transform cache keys on the *importing* TS file,
   not the `.lv` content — after editing any `.lv` file, restart Metro with
   `npx expo start --clear` or modules that inline the same rules can end up with
   mixed old/new copies (e.g. `loadRules.ts` validating different sources than
   `engine/index.ts` executes, since each file has its own `import ... from
   './rules/*.lv'` statements). `loadRules()` type-checks the bundled rules
   directly — `checkRuleSource(transitionSource, { resolve })`, where `resolve`
   serves the same inlined `types.lv`/`helpers.lv`/`transition.lv` sources
   `engine/index.ts` uses — it does not assemble or splice rule text together.
   `loadRules()` (the type-check gate) must run from the boot effect in
   `_layout.tsx`, **not** at module-init — a module-init throw crashes before the
   RuleErrorScreen can render. Keep it that way.

5. **State is fully JSON-serializable** (no Dates/functions) so it can be persisted and
   rehydrated after an app kill. `entries` is stored *in* the state for this reason.
   Rehydrating is a `hydrate` call, not a dispatch, and the boot path
   (`rehydrateActiveSession`, `src/state/sessionRehydrate.ts`) follows it with `Resume`
   **only when the saved phase is `paused` or `resting`** — the two phases where
   `transition.lv` defines a meaning for it. Paused resumes into a re-armed rest when
   one was frozen (`restRemainingMs`), otherwise back to `prePausePhase`. Resting is
   the kill-mid-rest case: a live deadline re-emits `ScheduleRest`, an expired one gets
   the same phase-from-position recovery `RestElapsed` would have made. That re-emit
   leans on a shell guarantee — rest alerts schedule under a fixed OS notification
   identifier (`REST_NOTIFICATION_ID` in `executors/restTimer.ts`), so the boot re-arm
   *replaces* the pre-kill alert rather than double-notifying, and `CancelRest` can
   silence an alert this process never scheduled. The pair is exhaustive by
   construction rather than enumeration: every rule writing `restDeadlineMs: Some(...)`
   also sets `phase: Resting`, and `PauseSession`/`StartStretching` clear it on the way
   out — no other phase can hold a deadline to reconcile. Every other phase returns
   `Err`, and rejections are never silent:
   any `Err` from `transition` surfaces as a thrown `TransitionError` that the store's
   `dispatch` catches into `lastError`, which `session.tsx` renders as an error banner.
   So an unconditional Resume at boot greets the user with a red banner rather than
   failing quietly — the same trap awaits any other event dispatched blind at rehydrate.
   The module sits outside `_layout.tsx` so the node jest project covers it (screens are
   not jest-covered), and it takes the store structurally rather than importing the
   global one, so tests can pass a `createActiveSessionStore` instance.
   The kill case is the only one the boot path owns. A warm foreground (backgrounded,
   not killed) past the deadline needs no `AppState` listener: `RestCountdown`
   (`src/components/RestCountdown.tsx`) derives remaining time from the wall clock
   (`deadlineMs - Date.now()`), ticks synchronously on mount and every 250ms while a
   rest is on screen, and dispatches `RestElapsed` on the first tick at or past the
   deadline. The session screen stays mounted across backgrounding, and a dismissed
   session modal re-ticks on remount, so every warm path reconciles as soon as a rest
   is visible again — and nothing outside the session screen reads the phase in the
   meantime. Do not "fix" the warm case with a foreground `Resume` dispatch:
   Resume-in-Paused would silently un-pause a deliberately paused workout on every
   app switch, and Resume in any other phase is the error-banner trap above.

   The *foreground* sibling of that boot path is `AppForegrounded`
   (`src/state/foregroundReconcile.ts`, wired to an AppState listener in
   `_layout.tsx`): an app backgrounded — not killed — past the rest deadline has no
   other reconcile path unless the session screen happens to be mounted. Unlike
   rehydrate, the shell dispatches it **blind** — no phase gate. The store's
   `sessionState` updates only after `dispatch`'s awaits, so a shell gate would read a
   stale phase and race the session screen's own dispatches; the engine applies
   transitions synchronously and is the only race-free authority. The event is
   therefore `Ok` in *every* phase: in `resting` it runs the same shared
   reconciliation as the boot Resume arm (`reconcile_resting_deadline` in
   `transition.lv`), everywhere else it is a no-op — in particular `paused` stays
   paused, because foregrounding the app is not the user asking to resume. The other
   half of that race: `RestCountdown` dispatches `RestElapsed` from a closure, so a
   straggler tick can land after the reconcile already recovered the phase —
   `RestElapsed` is benign (`Ok`, no effects) in `warmup`/`working`, the two phases
   recovery lands in, and still `Err`s everywhere else.

6. **Engine state carries ids, never display data.** The Rill `RoutineEntry` alias
   (`rules/types.lv`) is a closed record, and `toRillRoutineEntry`/`fromRillState`
   rebuild entries field-by-field in both directions — so an extra field such as
   `title` bolted onto the TS `RoutineEntry` survives until the first `dispatch` and
   then silently vanishes. Anything the UI needs beyond `exerciseId` must be resolved
   shell-side against the DB: `getExerciseTitles` (`src/db/repository.ts`) feeds the
   optional `exerciseTitles` map on `createSessionPresenter`, which exposes
   `currentExerciseTitle` and falls back to the raw id when an exercise is missing.

7. **`ReplaceExercise` swaps a running entry's identity, under engine guards.** The
   event carries `{ idx, exerciseId }`; the rule requires `idx == exerciseIndex`
   (a pick made after the workout moved on is rejected, not misapplied),
   `setIndex == 0` (an entry with any logged or skipped set is committed), and
   phase `Warmup | Working`. The rule rebuilds `entries` with a position-counting
   `fold` using functional record update (`{ entry | exerciseId: ... }`), so the
   closed-record field-loss hazard in convention 6 cannot occur. The shell's write
   ordering around the dispatch is load-bearing: ensure the exercise record exists →
   dispatch → only on `Ok` re-point the routine row — a rejected swap must never
   leave the routine pointing where the session isn't.

8. **The shell reads sentinels, not `Option`s.** `fromRillState` re-sentinelizes on the
   way out — `rpe: undefined → -1`, `restDeadlineMs`/`restRemainingMs` → `0`,
   `prePausePhase`/`supersetGroup` → `""` — so TS read sites can stay non-nullable.
   `SENTINEL_TO_OPTION_MAP` in `engine/index.ts` is the authoritative list. Presenters
   must treat those values as *absent*: a plain null check passes `-1` through and
   renders `RPE: -1`. `formatLoggedSetLine` in `sessionPresenter.ts` is where the
   session screen's logged-set formatting (and that filtering) lives. The hazard
   class is wider than the sentinel map: a `null` `target_sets` column also reaches
   the shell as a plain `0` that display code must treat as *no plan* — see the
   zero-planned-set rule in Boundaries.

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
straight to the API (never via the bridge) and the chat is never persisted. The four
settings fields (`anthropicKey`, `aiGoals`, `aiEquipment`, `aiPersonality`) live in
the existing `bridge_settings` blob, so `BridgeSettings` in `src/state/settings.ts`
is now a misnomer — AI settings are in there too.

- **No SDK, on purpose.** `anthropicClient.ts` is a hand-rolled `fetch` POST to
  `/v1/messages` — non-streaming, `thinking: disabled`, structured output via
  `output_config.format.json_schema`. Adding `@anthropic-ai/sdk` is not an upgrade:
  the client must stay RN-bundle-safe and `fetchFn`-injectable so it tests in the node
  jest project. Network vs HTTP failures are distinct types (`AnthropicUnreachable` vs
  `AnthropicHttpError`), matching the sync convention.
- **One turn shape, three declarations.** The `{ reply, draft?, settingsProposal? }`
  contract is stated in `AI_TURN_SCHEMA` (what the API enforces), in the
  `AiTurn`/`RoutineDraft`/`SettingsProposal` types plus `validateRoutineDraft` and
  `validateSettingsProposal` (what the app enforces), and in `personaSection()` prose in
  `contextBuilder.ts` (what the model reads). Changing either payload shape means
  changing all three — same hazard class as the copied markdown contract.
- **The persona restates the validator's rules, not just its shape.** `personaSection()`
  spells out the bounds `validateRoutineDraft` enforces (non-empty name, ≥1 exercise,
  title must slugify to something non-empty, `targetSets`/`targetReps` ≥ 1, and
  `warmupSets`/`targetDurationSeconds`/`restSeconds` ≥ 0), so a rejected draft reads as
  a model mistake rather than a surprise. `contextBuilder.test.ts` asserts those
  sentences as *exact strings*: loosening or tightening a bound in `draftSchema.ts`
  without rewording the prose fails those tests rather than silently drifting. Not
  every pinned sentence is a bound restatement: the `targetSets: 1` guidance for
  duration-based exercises has no validator counterpart — it steers the model away
  from the zero-planned-set drafts that force the display guards in Boundaries — so
  don't delete it as unenforced.
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
  which is why the persona demands the full exercise list.
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
  thing `onCompleteSession` does — after the session record is closed and sync and the
  HealthKit write are under way — and every failure there is swallowed: finishing a
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
  from *present* keys only — spreading an explicit `undefined` would blank the other
  field. `declineSettingsProposal` writes nothing. The screen holds no approve/decline logic; it is not jest-covered.
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
- **Three one-shot AI features share the conversation slice's conventions without
  its store.** Rest commentary (`restCommentary*`), the exercise Question button
  (`exerciseQuestion*` — ephemeral per-entry cache keyed by
  `exerciseQuestionKey`, answer never persisted), and Replace-button alternates
  (`alternates*` + `acceptAlternate` — validate on receipt AND at swap; `kind`
  always from the entry, never the model; duplicate titles rejected at slug level)
  each have their own prompt builder, and their own client except rest commentary,
  whose `createRestCommentaryClient` sits alongside the conversation client inside
  `anthropicClient.ts`. All follow the same rules: free text neutralized, immutable
  directives last, secret-leak regression tests, network-vs-HTTP failure types,
  every failure swallowed (a workout never depends on the AI), deps injected for
  the node jest project. Known accepted debt: `neutralizeForPrompt` exists in
  three copies and the POST/parse boilerplate in four (both `anthropicClient.ts`
  factories, plus the question and alternates clients) — hoisting them is a
  tracked follow-up; don't add another of either.
- **Immutable directives must remain the last section in `buildSystem`.** They are placed
  after every section built from user-controlled free text (goals, equipment, personality,
  routine notes, exercise titles) to preserve their precedence against injection attempts.
  The placement is enforced in `buildSystem` (`src/ai/contextBuilder.ts`); the directive
  text itself lives in `src/ai/coachDirectives.ts`.

## Testing gotchas

- Jest runs a **single `node` project** (`jest.config.js`), not jest-expo. Its
  `testMatch` covers `engine/db/interop/state/sync/health/helpers/ai` — all pure TS, no
  RN runtime. A new `src/` domain gets no test coverage until it is added to that list.
  The commented-out `rn` project is intentional future work; don't assume RN-env tests
  run — screens (including `ai-coach.tsx`) are therefore untested by `npm test`.
- Because of that boundary, **layout in `src/components`/`src/app` is invisible to
  every suite**: a green run proves nothing about it (PR #66 shipped a 2pt-collapsed
  ScrollView past 159 passing tests — `flex: 1` inside an auto-height parent).
  Verify layout changes in the simulator, or model the node tree with Yoga, before
  calling them done.
- `watchman: false` is required — watchman's crawl hangs jest startup on this machine.
- ts-jest transform pins `useDefineForClassFields: false` + `experimentalDecorators`/
  `emitDecoratorMetadata`. WatermelonDB models rely on legacy decorator semantics;
  class-fields-define would shadow the `@field`/`@relation` getters and silently break
  the models. Do not "modernize" these compiler options.
- `npx tsc --noEmit` can report a false-positive route error on a **brand-new dynamic
  route** — e.g. an "argument of type `/workout/${string}` is not assignable to
  parameter of type ... 52 more ..." on a correct ``router.push(`/workout/${id}`)``.
  Expo Router's typed routes come from `.expo/types/router.d.ts`, which is gitignored
  and regenerated per-machine by Metro only when it notices the `src/app` route tree
  change; a checkout that hasn't run `npm start`/`npm run ios` since a new `[id].tsx`
  route landed is still type-checking against the old route set, so a structurally
  correct template-literal push (the established pattern — see the existing
  `/routine/${id}` and `/exercise/${id}` pushes) gets rejected as if the route didn't
  exist. There is no CI job running `tsc`, so this only ever surfaces locally. Before
  changing code to chase a route-shaped tsc error, regenerate types (run the dev
  server once, or copy a fresh `.expo/types/router.d.ts` from a checkout that has) and
  re-run `tsc --noEmit` — a stale cache, not the route push, is the usual cause.

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
  system-prompt builder, coach directives, draft→repository accept path, plus the
  one-shot features (rest commentary, exercise question, replace alternates)
- `src/app/` — expo-router screens

## Boundaries

- Safe to edit: `src/`
- Session-flow logic changes go in `src/engine/rules/*.lv`, never in the store/components
- Markdown grammar changes to the shared pieces — document-level structure,
  `parseDuration`, `ContractError` — must be mirrored in
  `../workout-bridge/src/contract.ts`; line-level flag changes (`parseFlags`) are
  app-only
- A routine may list the same exercise more than once, so a routine *entry* is
  identified by its `routine_exercises` row id, never by `exercise_id` — React list
  keys, logged-set attribution (`session_sets.routine_exercise_id`), and
  `upsertRoutine`'s duplicate matching all depend on that row id. Presenters must
  therefore surface it (`ExerciseDetail.routineExerciseId`)
- **A set's performed exercise is its own `session_sets.exercise_id` (schema v3),
  not the row's.** The row's `exercise_id` is mutable (the Replace flow re-points
  it), so the row join is only the *legacy fallback* for pre-v3 sets whose stamp is
  null. `appendSet` stamps every new set from the engine entry (the value
  `onPersistSet` already verified), and every identity reader —
  `getExerciseWorkingSetHistory`, `getSessionExerciseLog`,
  `getRecentSessionSummaries`, the vault export — resolves stamp-first,
  join-fallback. `updateRoutineExerciseExerciseId` is the ONLY path allowed to
  re-point a row, and it must keep its layer-2 defense: inside the same
  `database.write`, stamp every attached null-stamped set with the row's outgoing
  identity *before* re-pointing. A new reader that resolves a set's exercise
  through the row alone reintroduces the PR #65 history-corruption bug. One
  rendering consequence: a swapped row's sets can span two performed identities,
  so session-detail entries key on the `(routineExerciseId, exerciseId)` pair
  (`sessionDetailPresenter` exposes both; `workout/[id].tsx` keys on the pair),
  not the row id alone
- A routine entry may plan zero sets — `target_sets` is nullable, the persona makes
  `targetSets` optional, and `startSessionFromRoutine` maps the `null` to 0 — so no
  display path may render "Set 1 of 0". `deriveSetPosition` (`sessionPresenter.ts`)
  feeds *two* independent label builders: `createSessionPresenter`'s
  `setPositionLabel`, and `setPosition` in `src/ai/restCommentaryPrompt.ts`, which
  reaches the derivation through `restCommentaryTarget` and never touches the
  presenter — so a guard on one does not cover the other. Both return `''` when
  `warmupSets + targetSets === 0`, and both consumers read that as *hide*
  (`SetLogger` skips the row; `buildRestCommentaryPrompt` drops the empty segment
  from its "Up Next" line). The sum is the exact condition, not a conservative one:
  `transition.lv` ends an entry at `allSetsForEntry = warmupSets + targetSets`, so
  only a zero total can reach a zero denominator. `sessionDetailPresenter` is the
  third label site and needs no guard — it renders `Set N` with no total
- AI turn payload shapes *and* validation bounds must be mirrored across
  `AI_TURN_SCHEMA`, the validators, and the persona prompt (all in `src/ai`)
- The AI accept path may create exercises but must never mutate existing ones
- An AI-proposed settings change must be approved by the user before it is written
- Do not touch generated Rill dist or the `../rill-lang` tarball dependency by hand
