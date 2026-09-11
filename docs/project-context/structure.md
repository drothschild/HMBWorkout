> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Structure

- `src/engine/` — pure Rill core + host dispatch/effect mapping (`rules/*.lv`)
- `src/domain/` — pure, dependency-free rules about the routine model that more
  than one layer needs and none of them owns. Currently one module:
  `supersetGrouping.ts`, the app-side implementation of the contiguous-run rule
  from engine conventions 9 and 10 (see Boundaries). Its importers today are
  `src/state` (×2) and `src/app` (×1); `src/db` imports it **zero** times, since
  deleting `getSupersetGroups` left that layer with no grouping reader at all.
  The directory still earns its place forward-looking: a db-side reader would
  need the same rule, and `db` must not import `state`, so `state` was never an
  option as the home. Anything landing in `src/domain/` must import nothing
- `src/db/` — WatermelonDB schema, models, repository; `adapter.ts`/`adapter.web.ts`
  select SQLite vs LokiJS per platform, and `adapterMigrations.ts` is the gate
  between them and `migrations.ts` (see Schema migrations below). A routine's plan
  lives in **`routine_sets`**, one row per prescribed set; `routine_exercises` holds
  identity, order, superset label, the entry-level rest default and notes, and
  carries no plan values at all since schema v7. A set may also carry its **own**
  nullable `rest_seconds` (schema v8, #281) that overrides the entry default —
  what makes a drop set (0 / 0 / full) expressible; null inherits the entry rest.
  `exercises` carries nullable `image_path`/`image_source` since schema v9 (#335),
  written only by `setExerciseImageIfSourceUnchanged` (resolver) and
  `setExerciseImage` (user override). `image_path` is read by
  `getExerciseImagePaths` (session screen), `routineDetailPresenter`,
  `routineListPresenter`'s `readThumbnailPaths` and the exercise detail screen;
  `image_source` is read by the resolver's `runImageResolutionPass` for
  `isImageResolutionEligible`. See Exercise images
- `src/interop/` — vault markdown serializer/parser, plus `importRoutine.ts`
  (#267 Phase 2): the pure markdown → `RoutineExerciseEntry[]` reader that gives
  `parseRoutine` its production caller. It owns the two refusals the engine's
  rules imply — a superset label split across a gap, and a routine that plans no
  sets at all — and touches no database
- `src/export/` — the only production consumer of `src/interop/serialize`; maps DB
  rows to the serializer, normalizing
  WatermelonDB's `null` to `undefined` at the boundary. **Wired to the Settings → Data
  screen** (`src/app/(tabs)/settings/data.tsx`, #267 Phase 1), which calls
  `exportRoutine`/`exportSessionHistory` and shares the markdown through the iOS share
  sheet. `exportOutcome.ts` is the pure presenter that turns a `SessionHistoryExport`
  (its `failures` list in particular) into the user-facing message — the first reader
  of `failures`, so a screen can never drop it silently (#212)
- `src/state/` — Zustand stores (session + AI chat), presenters, settings,
  session start/rehydrate; `aiProviderSettings.ts` (provider/key/model pure functions),
  `aiChatErrorCopy.ts` (error messages with provider attribution),
  `applyRoutineImport.ts` (#267 Phase 2 — the DB half of the file import:
  create-only exercises, a minted `routine-<epoch>` id, one `upsertRoutine`;
  structurally `acceptDraft` with a different entry source) and
  `routineImportOutcome.ts` (its banner copy, `exportOutcome`'s counterpart),
  and `hevySettings.ts` (#267 Phase 3 — `hevyApiKeyPatch`, the one boundary
  where a raw input becomes the stored Hevy key; clears to `''` and never
  `undefined`, because `JSON.stringify` drops `undefined` and would leave no
  evidence of the clear). Exercise images (#335): `exerciseCatalog.ts` +
  generated `exerciseCatalogData.ts` (the pinned catalog), `exerciseImageState.ts`
  (the `ImageSource` vocabulary and `isImageResolutionEligible`),
  `exerciseImageMatch.ts` (pure fuse.js shortlist and decisions),
  `exerciseImageResolver.ts` (the observer-driven background pass),
  `exerciseImageResolverRegistry.ts` (the one running resolver),
  `exerciseImageOverride.ts` (paste-a-URL), `imageSignature.ts` (pure
  magic-number check: `looksLikeImageBytes`, `IMAGE_SIGNATURE_BYTES`,
  `NotAnImageError`) and `exerciseImageFiles.ts` (the real I/O deps — never
  imported by a test)
- `src/hevy/` — read-only Hevy API import (#267 Phase 3). `hevyClient.ts` is a
  hand-rolled `fetch` with **no SDK**, the same decision `anthropicClient.ts`
  records and for the same reasons (RN-bundle-safe, `fetchFn`-injectable);
  `HevyUnreachable` vs `HevyHttpError` are distinct. The request contract was
  read from the published OpenAPI document, not guessed, because a wrong
  parameter name is a 400 rather than a compile error: `page` + **camelCase
  `pageSize`** (max 10), the key in an **`api-key` header** and nowhere else.
  `hevyRoutineMap.ts` is **pure** and owns the whole mapping table; it emits the
  same `ImportedRoutine` the markdown importer does, so `applyRoutineImport` is
  shared rather than duplicated. Three of its rules are easy to break: order is
  `exercise.index` and **never** `supersets_id`; weight is kg rounded to 2dp
  with **no round trip through lbs** (`lbsToKg` in `acceptDraft` is this app's
  only conversion site and this must not become a second); and a `0`
  measurement is **absent**, while a `rest_seconds` of `0` is a real "no rest"
  and is kept. A **non-contiguous superset is demoted to standalone and named in
  the lossiness summary, not rejected** (settled on #267, 2026-08-19) — and
  entries are never reordered to force contiguity. `hevyImportOutcome.ts` words
  the banner from the HTTP **status alone** and never interpolates
  `HevyHttpError.message`, which carries Hevy's raw response body; that is what
  makes "the key cannot reach the screen" structural
- `src/health/` — HealthKit write-only export
- `src/ai/` — AI coach: turn/draft schema + validators, system-prompt builders,
  coach directives, draft→repository accept path, plus the one-shot features
  (rest commentary, exercise question, replace alternates), the catalog-pick prompt
  (`catalogPickPrompt.ts`, #335 — a prompt over the existing `ask`, not a surface)
  and the one shared `neutralizeForPrompt.ts`
- `src/ai/provider/` — multi-provider abstraction: `createAiClient` factory routes to
  Anthropic or OpenAI based on configured keys; unified `AiClient` interface; `buildOpenAiBody`
  centralizes the OpenAI Responses API format (Anthropic clients build requests inline);
  `models.ts` holds the constrained model list and per-surface resolution logic
- `src/theme/` — design tokens: `ActionButtonColor` (the four action hues,
  each darkened to clear WCAG AA 4.5:1 text contrast against both white and
  black backgrounds; also used on non-button solid fills like the AI chat
  bubble and kind tag) and `StatusColor` (danger; currently just the session
  error banner). `BackgroundColors` (light/dark element, error bubble) and
  `ThemedBackgroundText` (text colors for those non-white backgrounds).
  `ProgressBarColors` (`progressColors.ts`) — the session-screen progress
  bar's fill/track colors, deliberately its own theme token
  (`progressTrack`) rather than reusing the general-purpose
  `backgroundSelected` (~16 unrelated consumers: input borders, list
  separators, etc.) even though the values happen to coincide. Every text
  color pair here is verified by the `contrastRatio` pure function against
  its target background at the 4.5:1 text bar; `ProgressBarColors`'s
  fill/track pairs are additionally checked at the lower 3:1 graphical bar
  under WCAG 1.4.11 — that 3:1 check does not extend to every non-text
  graphical fill in the app (e.g. slider `minimumTrackTintColor` values are
  unchecked), only to this module's own fill/track pairs
- `src/components/` — shared RN components; jest-invisible for rendering (see
  Testing gotchas), so wiring is gated by structural tests. `ExerciseImage.tsx`
  (#335) is the one component that turns a stored relative `image_path` into a
  URI, in four sizes (`hero`, `fit`, `row`, `strip`), with a same-size placeholder
  when there is no image. It also exports `EXERCISE_IMAGE_ASPECT_RATIO`, which
  `SetLogger`'s `exerciseHero` wrapper divides the measured column width by to
  get its full height (see Exercise images)
- `src/hooks/` — shared React hooks (theme, color scheme, and since #335
  `use-keyboard-visible.ts`, whose `useKeyboardVisible` hides the session hero,
  and in `session.tsx` the footer and Replace button, while the keyboard is open). **Outside jest's `testMatch`**, so a hook here is
  covered only by structural reads such as `exerciseImageWiring.static.test.ts`
- `src/app/` — expo-router screens

[Back to reference index](README.md)
