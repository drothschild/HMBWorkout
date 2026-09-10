# Exercise Images Design

## Summary

This feature gives every exercise an automatically chosen image, sourced from
`free-exercise-db`, a public-domain library of ~876 exercise photos. A trimmed
catalog ships inside the app bundle so matching works offline; the photo files
themselves are downloaded once and kept on disk. Picking the right catalog
entry for an exercise title is a two-tier decision: a fuzzy-search shortlist
narrows the catalog to 8 candidates, then — if the user has an AI key
configured — the AI picks the best of those 8 or declares none acceptable.
Without a key, the app accepts the top shortlisted match only if its score
clears a threshold. Either way, the AI only ever chooses among a fixed list of
ids; it never supplies an image URL.

Resolution happens in the background and never blocks a user action. A single
resolver runs a pass at app launch, whenever the `exercises` table changes (any
of the several paths that create exercises), and when a screen opens an
exercise with no image. Each pass works through eligible rows one at a time and
writes its result with a compare-and-set, so a slow pass can never overwrite an
image the user just pasted. The cached file's path rides on the exercise record
itself, so every screen that shows an exercise — detail, session, routine rows,
routine cards — reads the same field and stays correct through a Replace swap.
Users can override the automatic pick by pasting an image URL. The image is
display data only: it never touches the session engine, the markdown export, or
any AI schema.

## Definition of Done

Board issue #335.

- **Every exercise gets one image, chosen automatically from free-exercise-db**
  (public domain, ~876 exercises, nearly all with photos). When an AI key is
  configured, the AI picks the best entry for the exercise's title from a
  shortlist; installs with no AI key use a code-only name match; no acceptable
  match leaves a placeholder. The AI never supplies a free-form image URL.
- **Fetched in the background when an exercise is created** — coach draft,
  markdown import, Hevy import, Replace — and retried on first view if that
  attempt failed. Exercises already in the database are backfilled once after
  the update ships.
- **The image file is stored on-device permanently and displays offline.** It
  appears on the exercise detail screen, the session screen, as thumbnails on
  the routine detail rows, and as a thumbnail strip on each Routines tab card.
- **The image belongs to the exercise record**, so a Replace swap shows the new
  exercise's image with no extra logic. The exercise detail screen offers a
  paste-an-image-URL override.
- **Out of scope:** an exercise rename feature (none exists; the exercise id is
  `slugifyTitle(title)`, so a new title is a new exercise), images in the
  markdown export, image licensing. The session engine is untouched — images are
  display data only.

## Acceptance Criteria

### exercise-images.AC1: An image is chosen automatically

- **exercise-images.AC1.1 Success:** With an AI key configured, an `ask` reply
  that equals one shortlist id after trimming records `image_source =
  catalog:<id>` and downloads that entry's first image.
- **exercise-images.AC1.2 Success:** With an AI key configured, a reply of
  `NONE` records `image_source = none`, writes no `image_path`, and downloads
  nothing.
- **exercise-images.AC1.3 Failure:** With an AI key configured, a reply that is
  not exactly one shortlist id — an id absent from the shortlist, an id wrapped
  in prose, an empty string — is not trusted; the exercise is decided by the
  no-key rule instead.
- **exercise-images.AC1.4 Success:** With no AI key, a top shortlist hit that
  clears the score threshold records `catalog:<id>`.
- **exercise-images.AC1.5 Failure:** With no AI key, a top hit that misses the
  threshold records `none:nokey`.
- **exercise-images.AC1.6 Edge:** An empty shortlist records `none` and makes
  no `ask` call.
- **exercise-images.AC1.7 Success:** Shortlist recall on real titles: "Romanian
  Deadlift" ranks `Romanian_Deadlift` first; "Back Squat" shortlists
  `Barbell_Squat`; "Farmer's Carry" shortlists `Farmers_Walk`; "Cable Face
  Pull" shortlists `Face_Pull`; "Treadmill Incline Walk" shortlists
  `Walking_Treadmill`.
- **exercise-images.AC1.8 Edge:** With no AI key, "Couch Stretch" (no catalog
  counterpart) records `none:nokey`, not a wrong image.
- **exercise-images.AC1.9 Success:** The catalog-pick prompt places the
  `coachDirectives` immutable directives last, passes the title and candidate
  names through `neutralizeForPrompt`, and never contains `anthropicKey`,
  `openaiKey`, or `hevyApiKey` values.

### exercise-images.AC2: Background resolution, retry, and backfill

- **exercise-images.AC2.1 Success:** The pass started at app launch resolves
  every exercise whose `image_source` is null — this is the backfill for
  pre-existing exercises.
- **exercise-images.AC2.2 Success:** An exercise created through any path
  (`acceptDraft`, `applyRoutineImport`, `ensureAlternateExercise`) is resolved
  by a pass triggered from the `exercises` table change, with no call from the
  creating code.
- **exercise-images.AC2.3 Failure:** When `ask` rejects (unreachable or HTTP
  error) or the download fails, the row is left unchanged, and the next pass
  retries it.
- **exercise-images.AC2.4 Success:** A `none:nokey` row is re-resolved by the
  first pass that runs while an AI key is configured.
- **exercise-images.AC2.5 Failure:** A `none:nokey` row is not re-resolved
  while no key is configured; `none`, `catalog:`, and `url:` rows are never
  re-resolved by a pass.
- **exercise-images.AC2.6 Success:** At most one pass runs at a time; any number
  of requests arriving during a pass produce exactly one follow-up pass.
- **exercise-images.AC2.7 Edge:** The resolver's own row writes re-trigger the
  table observer, and the resulting passes terminate — the total pass count for
  one new exercise is bounded.
- **exercise-images.AC2.8 Failure:** No resolver or scheduler failure throws
  out of the scheduler; failures are logged and swallowed.
- **exercise-images.AC2.9 Success:** Opening the exercise detail screen or the
  session screen on an exercise that has no image requests a pass.
- **exercise-images.AC2.10 Success:** `_layout.tsx` starts the resolver
  (structural test on the source).

### exercise-images.AC3: Storage and display

- **exercise-images.AC3.1 Success:** Upgrading a v8 database to v9 keeps every
  existing row, and `image_path`/`image_source` read null on existing
  exercises.
- **exercise-images.AC3.2 Failure:** With the v9 migration step withheld, the
  upgrade resets the database — the harness observes both outcomes.
- **exercise-images.AC3.3 Success:** `image_path` is written relative to the
  documents directory; it never begins with `file://` or `/`.
- **exercise-images.AC3.4 Success:** `routineDetailPresenter` exposes
  `imagePath` on each `ExerciseDetail`, null when unresolved.
- **exercise-images.AC3.5 Success:** `routineListPresenter` exposes
  `thumbnailPaths`: at most 4, distinct by exercise, in routine order, skipping
  exercises without an image.
- **exercise-images.AC3.6 Success:** `createSessionPresenter` exposes
  `currentExerciseImagePath` from a caller-supplied `exerciseImagePaths` map,
  null when the exercise has none.
- **exercise-images.AC3.7 Success:** The session screen re-reads image paths
  when `exercises` changes, so an image resolved mid-workout appears without
  leaving the screen (structural test on the effect, plus simulator).
- **exercise-images.AC3.8 Success (manual):** All four sites render the image,
  and a placeholder where there's none.
- **exercise-images.AC3.9 Success (manual):** Images still render with the
  device in airplane mode after they were resolved.
- **exercise-images.AC3.10 Edge (manual):** With a long exercise name, the
  session header's controls stay on screen and tappable.

### exercise-images.AC4: Identity and manual override

- **exercise-images.AC4.1 Success:** After a Replace swap, the session and
  routine detail screens show the new exercise's image, because image paths
  are keyed on `exerciseId` (presenter test plus simulator).
- **exercise-images.AC4.2 Success:** Pasting an `http(s)` URL downloads it to a
  new file, writes `image_source = url:<url>` and the new `image_path`, then
  deletes the previous file — deletion strictly after the row write.
- **exercise-images.AC4.3 Failure:** `parseImageUrl` rejects anything but
  `http:`/`https:` (`file:`, `data:`, `javascript:`, bare text); nothing is
  downloaded.
- **exercise-images.AC4.4 Failure:** When the override download fails, the user
  sees an error, and the row and the previous file are untouched.
- **exercise-images.AC4.5 Edge:** A resolve pass that finishes after a URL was
  pasted mid-pass does not overwrite the pasted image (compare-and-set write;
  race test with a competing writer).

### exercise-images.AC5: Boundaries held

- **exercise-images.AC5.1:** `exportRoutine` and `exportSessionHistory` output
  is byte-identical for a routine whose exercises have images.
- **exercise-images.AC5.2:** The Rill `RoutineEntry` and engine state carry no
  image field; no `.lv` file changes.
- **exercise-images.AC5.3:** The `AiClient` interface and `AI_MODEL_CHOICES`
  are unchanged — the feature adds a prompt builder, not an AI surface.

## Glossary

- **free-exercise-db**: A public-domain dataset of exercises with names,
  metadata, and photos, hosted on GitHub (`yuhonas/free-exercise-db`). The
  image catalog is built from it.
- **Catalog**: The trimmed, bundled subset of free-exercise-db (id, name,
  category, equipment, primary muscles, first image path) shipped inside the
  app so matching works without a network call.
- **Shortlist**: The top 8 catalog entries returned by fuzzy-matching an
  exercise's title, before the AI or the no-key threshold rule picks one or
  none.
- **fuse.js**: A JavaScript fuzzy-search library, used to rank catalog entries
  against an exercise title.
- **`image_source`**: Column on `exercises` recording how the image was
  decided: `catalog:<id>` (auto-picked), `url:<url>` (user-pasted), `none` (no
  acceptable match; final), or `none:nokey` (the no-key name match missed the
  threshold; retried once an AI key is configured).
- **`image_path`**: Column on `exercises` holding the downloaded image's path
  relative to the app's documents directory — never absolute, because iOS can
  move the app container between installs.
- **Eligibility rule (`isImageResolutionEligible`)**: The pure function that
  decides whether a pass should (re)resolve a row — true when `image_source`
  is null, or when it's `none:nokey` and an AI key is now configured.
- **Resolver (`startExerciseImageResolver`)**: The scheduler that runs
  resolution passes — at launch, on `exercises` table changes, and on request
  from a screen — so exercise-creating code never has to call it.
- **Pass**: One run of the resolver over every currently eligible row,
  handling them sequentially.
- **Compare-and-set write**: A database write that applies only if the row's
  `image_source` still matches the value read when resolution began; it keeps a
  slow pass from overwriting an image the user just pasted.
- **Single-flight / coalescing**: At most one pass runs at a time; requests
  arriving during a pass collapse into exactly one follow-up pass.
- **Backfill**: Not a separate mechanism — the first launch pass after the
  update finds every pre-existing exercise with a null `image_source` and
  resolves it.
- **`withChangesForTables`**: WatermelonDB API that emits whenever the named
  tables change; the resolver subscribes to `exercises` with it.
- **expo-file-system `File`/`Paths`**: Expo SDK 57's file API, used to download
  images (`File.downloadFileAsync`) and address them relative to
  `Paths.document`, which iOS never evicts.
- **`expo-image`**: Expo's image component, used for display; its own disk
  cache is evictable, which is why the app stores its own file.
- **`AiClient.ask`**: The existing one-shot, free-text AI call (built for the
  exercise-question feature), reused here for the catalog pick instead of
  adding a new AI surface.
- **`coachDirectives` / directives-last rule**: The fixed instructions every
  prompt builder must place after all user-controlled text, so free text can't
  override them.
- **Structural test**: A test that reads source code and asserts on its shape
  (e.g. that `_layout.tsx` starts the resolver), used where the code lives in a
  screen or boot path no test runner can execute.

## Architecture

One image per exercise record, picked from a bundled catalog and cached as a
file in the app's documents directory. A single background resolver fills in
every exercise that needs one; four display sites read the cached file.

**Catalog.** `scripts/build-exercise-catalog.mjs` fetches free-exercise-db's
`dist/exercises.json` at a pinned commit and trims each of its 876 entries to
the fields matching needs. The output ships in the app bundle (~124 KB, versus
1.0 MB untrimmed), so matching works offline from first launch. Images are not
bundled; they're downloaded per exercise from
`https://raw.githubusercontent.com/yuhonas/free-exercise-db/<commit>/exercises/<image>`.
Sampled images are 850×567 JPEGs of 43–73 KB.

```typescript
// The bundled catalog's entry shape.
type CatalogEntry = {
  id: string;               // e.g. 'Barbell_Squat'
  name: string;             // e.g. 'Barbell Squat'
  category: string;         // 'strength' | 'stretching' | 'cardio' | ...
  equipment: string | null;
  primaryMuscles: string[];
  image: string;            // first image path, e.g. 'Barbell_Squat/0.jpg'
};
```

**Image state on the exercise row.** Schema v9 adds two nullable columns to
`exercises`:

| Column | Values |
|---|---|
| `image_path` | Path relative to `Paths.document`, e.g. `exercise-images/back-squat-3f9a.jpg`. Never an absolute `file://` URI: iOS moves the app container on reinstall and restore, so a stored absolute path goes stale. |
| `image_source` | `catalog:<id>`, `url:<pasted url>`, `none` (final), or `none:nokey` (retry once a key exists). |

```typescript
type ImageSource = `catalog:${string}` | `url:${string}` | 'none' | 'none:nokey';

// Whether a pass should (re)resolve this row. A pure function of the row
// and the key state at the moment the pass runs.
function isImageResolutionEligible(
  row: { imagePath: string | null; imageSource: ImageSource | null },
  hasAiKey: boolean,
): boolean;
```

Eligible means `image_source` is null, or it's `none:nokey` and a key is now
configured. A transient failure writes nothing, so it stays null and is retried.
This one predicate drives the backfill, first-view retry, and key-added retry.

**Resolving one exercise** (`src/state/exerciseImageResolver.ts`, pure core
behind injected deps):

1. **Shortlist.** `src/state/exerciseImageMatch.ts` runs fuse.js over catalog
   names, after normalizing abbreviations (`DB` → dumbbell, `BB` → barbell),
   and returns the top 8.
2. **Pick.** With a key, `buildCatalogPickPrompt` (`src/ai/catalogPickPrompt.ts`)
   sends the title and the 8 `id: name (equipment)` lines through the existing
   `AiClient.ask`. `parseCatalogPick` accepts the reply only if it trims to one
   listed id or to `NONE`. Anything else falls through to the no-key rule, so a
   confused model can't cause a retry on every launch. With no key, the top hit
   is accepted only if its fuse score clears a threshold.
3. **Download.** `File.downloadFileAsync(url, new File(Paths.document, path))`
   (expo-file-system SDK 57). The file name carries a short random suffix, so
   an override never overwrites the file a render may be reading.
4. **Write.** One `database.write` sets both columns, guarded compare-and-set:
   it applies only if the row's `image_source` still equals the value read when
   resolution began. A URL pasted mid-pass wins.

```typescript
type ExerciseImageResolverDeps = {
  database: Database;
  catalog: readonly CatalogEntry[];
  getAiKeyConfigured: () => boolean;
  ask: ((request: { system: string; message: string }) => Promise<string>) | null;
  download: (url: string, relativePath: string) => Promise<void>;
  deleteFile: (relativePath: string) => Promise<void>;
  log: (message: string, error?: unknown) => void;
};

type ExerciseImageResolver = {
  request(): void;   // Queue a pass; coalesces while one is running.
  stop(): void;      // Unsubscribe the table observer.
};

function startExerciseImageResolver(deps: ExerciseImageResolverDeps): ExerciseImageResolver;
```

**Triggers.** `startExerciseImageResolver` subscribes to
`database.withChangesForTables(['exercises'])` and requests a pass on every
change, which covers every creation path without touching them. `_layout.tsx`
starts it once in the boot effect, after session rehydrate, without awaiting.
The detail and session screens call `request()` on mount for an exercise with
no image. No trigger watches the AI key: eligibility reads the key when a pass
runs, so the next pass after a key is saved picks up `none:nokey` rows. Passes
run one at a time and resolve exercises sequentially; requests during a pass
collapse into one follow-up.

**Display.** `src/components/ExerciseImage.tsx` takes `{ imagePath: string |
null; size: 'hero' | 'row' | 'strip' }`, builds the URI at render
(`new File(Paths.document, imagePath).uri`), and renders `expo-image` with
`contentFit="cover"` and `recyclingKey={imagePath}`. Null or a load error shows
a neutral placeholder. Presenters carry relative paths only:

| Site | Data | Rendering |
|---|---|---|
| `src/app/exercise/[id].tsx` | reads the exercise row | 3:2 hero under the title, then the URL field |
| `src/app/session.tsx` → `SetLogger` | `getExerciseImagePaths(db, ids)` loaded beside `getExerciseTitles`, keyed the same way plus a re-read on `exercises` changes; `createSessionPresenter` gains an optional `exerciseImagePaths` map and exposes `currentExerciseImagePath` | ~48pt square leading `exerciseTitleRow`; the title keeps `flex` so long names wrap |
| `src/app/routine/[id].tsx` | `ExerciseDetail.imagePath` | ~40pt square leading each row |
| `src/app/(tabs)/routines.tsx` | `RoutineListItem.thumbnailPaths` (≤4, distinct, routine order, nulls skipped) | strip under the routine name |

**Manual override.** `parseImageUrl` (pure) admits `http:`/`https:` only.
`overrideExerciseImage(deps, exerciseId, url)` in
`src/state/exerciseImageOverride.ts` downloads to a new file, writes
`url:<url>` and the new path, then deletes the old file. Download failure
returns an outcome the screen renders as an error; nothing else changes.

## Existing Patterns

- **Display data resolved shell-side, never in engine state** (engine
  convention 6). `getExerciseImagePaths` and the optional
  `exerciseImagePaths` map on `createSessionPresenter` mirror
  `getExerciseTitles` and `exerciseTitles` exactly, including the reload key in
  `session.tsx` that covers a Replace swap.
- **Nullable column via `addColumns`**, following the v7→v8 `rest_seconds`
  step in `src/db/migrations.ts`. `migrationsForAdapter` stays a pass-through.
  The migration test follows `migrationV6ToV7.test.ts`: two opens over one
  `LokiMemoryAdapter`, asserting both the covered upgrade and the withheld-
  migration reset.
- **Injected deps for jest coverage**, as in `HealthKitSaveDeps`, `AiChatDeps`,
  and `ExerciseReplaceDeps`. Resolver, scheduler, and override are all
  node-testable; screens stay thin.
- **Every AI failure swallowed**, as in the three existing one-shot features.
  Nothing about a workout waits on this.
- **Prompt builders put `coachDirectives` last and neutralize free text.**
  `buildCatalogPickPrompt` becomes the fifth builder under that rule, reusing
  the existing `neutralizeForPrompt` rather than adding a copy.
- **Structural tests for code nothing can execute**, following
  `sessionPrefillWiring.static.test.ts` and
  `supersetGrouping.callSites.test.ts`: `_layout.tsx` starting the resolver,
  and the session screen's image effect subscribing to `exercises` changes.
- **Committed scripts for quantitative claims** (`scripts/`): the catalog
  build script is the source of the entry count and size figures.

**New patterns, with justification:**

- **First database observer in `src`.** Nothing uses
  `withChangesForTables` today. It's used here because the alternative — a
  resolver call at each of four creation sites, two of them in untested
  screens — requires every future creation path to remember it.
- **Reusing `AiClient.ask` for a non-prose reply.** `ask` returns raw text and
  was built for the exercise question. Reusing it keeps the fixed request
  contract (512-token budget, reasoning disabled) and the model allow-list
  untouched; the price is that the reply's shape is enforced by
  `parseCatalogPick`, not by structured output.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Bundled catalog

**Goal:** Ship the trimmed free-exercise-db catalog in the app.

**Components:**
- `scripts/build-exercise-catalog.mjs` — fetches `dist/exercises.json` at a
  pinned commit, trims to `CatalogEntry`, drops entries with no image, writes
  the JSON, and prints the entry count and byte size.
- The generated catalog JSON and a typed loader, `src/state/exerciseCatalog.ts`.

**Dependencies:** None.

**Done when:** The script reproduces the committed JSON byte-for-byte; a shape
test confirms every entry has a non-empty `id`, `name`, and `image`, and that
ids are unique.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Schema v9 and image state

**Goal:** Give `exercises` its image columns and the eligibility rule.

**Components:**
- `src/db/schema.ts` (version 9, two optional columns), `src/db/migrations.ts`
  (`toVersion: 9` `addColumns` step), `src/db/models/Exercise.ts` (`imagePath`,
  `imageSource` fields).
- `ImageSource` type and `isImageResolutionEligible` in
  `src/state/exerciseImageState.ts`.
- Migration test in `src/db/`.

**Dependencies:** None (parallel with Phase 1).

**Done when:** Tests pass for exercise-images.AC3.1, AC3.2, AC2.4 and AC2.5
(eligibility table: every source value, with and without a key).
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Matching and AI pick

**Goal:** Turn a title into a decision — catalog id, `none`, or `none:nokey` —
without I/O.

**Components:**
- `fuse.js` dependency.
- `src/state/exerciseImageMatch.ts` — normalization, shortlist, no-key
  threshold rule.
- `src/ai/catalogPickPrompt.ts` — `buildCatalogPickPrompt` and
  `parseCatalogPick`.

**Dependencies:** Phase 1 (catalog).

**Done when:** Tests pass for exercise-images.AC1.3 (parse half), AC1.4, AC1.5,
AC1.6, AC1.7, AC1.8 and AC1.9, and the new builder joins the existing
directives-last and secret-leak tests.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Resolver and scheduler

**Goal:** Resolve eligible exercises in the background, from boot and from
table changes.

**Components:**
- `src/state/exerciseImageResolver.ts` — per-exercise pipeline (shortlist →
  pick → download → compare-and-set write) and `startExerciseImageResolver`
  (observer, single-flight, coalescing).
- Real deps: `download`/`deleteFile` over expo-file-system `File`/`Paths`,
  `ask` from `createAiClient(getSettings())`.
- `src/app/_layout.tsx` — one start call in the boot effect.
- Structural test for the `_layout.tsx` wiring.

**Dependencies:** Phases 2 and 3.

**Done when:** Tests pass for exercise-images.AC1.1, AC1.2, AC1.3
(fallback half), AC2.1, AC2.2, AC2.3, AC2.6, AC2.7, AC2.8, AC2.10, AC3.3 and
AC4.5. Images now populate on disk and in the database; nothing displays them
yet.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Display at four sites

**Goal:** Show the cached image wherever the exercise appears.

**Components:**
- `src/components/ExerciseImage.tsx`.
- `src/db/repository.ts` — `getExerciseImagePaths`.
- `src/state/routineDetailPresenter.ts` (`imagePath`),
  `src/state/routineListPresenter.ts` (`thumbnailPaths`),
  `src/state/sessionPresenter.ts` (`exerciseImagePaths`,
  `currentExerciseImagePath`).
- `src/app/exercise/[id].tsx`, `src/app/session.tsx`,
  `src/components/SetLogger.tsx`, `src/app/routine/[id].tsx`,
  `src/app/(tabs)/routines.tsx` — rendering, and the on-mount `request()` at the
  detail and session screens.
- Structural test for the session screen's `exercises` subscription.

**Dependencies:** Phase 4.

**Done when:** Tests pass for exercise-images.AC2.9 (structural), AC3.4, AC3.5,
AC3.6, AC3.7 (structural) and AC4.1 (presenter half); simulator check covers
AC3.8, AC3.10 and AC4.1.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Paste-URL override

**Goal:** Let the user replace a wrong image from the exercise detail screen.

**Components:**
- `src/state/exerciseImageOverride.ts` — `parseImageUrl` and
  `overrideExerciseImage`, with its outcome copy.
- `src/app/exercise/[id].tsx` — URL field and result message.

**Dependencies:** Phase 5.

**Done when:** Tests pass for exercise-images.AC4.2, AC4.3 and AC4.4.
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Live and on-device verification

**Goal:** Prove what the suite can't.

**Components:**
- One live `ask` call per provider with `buildCatalogPickPrompt`, confirming the
  reply parses under `parseCatalogPick`.
- Simulator pass: the four sites, a long exercise name, airplane mode, backfill
  against a copy of a real database, a Replace swap.
- AGENTS.md: the fifth directives-last builder, the image columns and
  `ImageSource` states, and the observer as a new pattern.
- Boundary tests for exercise-images.AC5.1, AC5.2 and AC5.3.

**Dependencies:** Phase 6.

**Done when:** Both live calls parse; AC3.8, AC3.9, AC3.10 and AC4.1 are
confirmed on the simulator; AC5 tests pass.
<!-- END_PHASE_7 -->

## Additional Considerations

**Coverage limits.** Only 14 of the catalog's 876 entries are cardio, and some
common stretches have no counterpart ("Couch Stretch" matches nothing).
Expect those to land on `none` or `none:nokey`; the paste-URL override is the
remedy.

**Cost.** A first-launch backfill of ~60 exercises makes ~60 `ask` calls on the
512-token budget. Later, only new exercises cost a call.

**Storage.** ~60 KB per image; 100 exercises is ~6 MB in `Paths.document`.
Nothing deletes an image when its exercise stops being used by any routine —
exercises themselves are never deleted today, so neither are their files.

**Web.** `File.downloadFileAsync` is unavailable on web (LokiJS builds); the
resolver's `download` dep fails there, rows stay null, and the placeholder
shows. iOS is the only supported target.
