> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Exercise images (#335)

Every exercise can carry one photo, resolved in the background from a bundled
catalog (or pasted by the user) and stored on-device so it renders offline. Like
the AI slice, this is **data, never session flow**: the Rill `RoutineEntry` and
engine state carry no image field, and `src/engine/exerciseImageEngineBoundary.test.ts`
pins that no `.lv` rule mentions one. Every display site reads the path
shell-side, off the `exercises` row, and there are five readers, not one: the
session screen through `getExerciseImagePaths` (`src/db/repository.ts`), whose
`exerciseId`-keyed map reaches `createSessionPresenter` as `exerciseImagePaths` —
the same shape as `exerciseTitles` in engine convention 6, which is why a Replace
swap shows the new exercise's image with no extra wiring; `routineDetailPresenter`,
which reads each exercise's raw `image_path`; `routineListPresenter`'s
`readThumbnailPaths`, which reads `Exercise.imagePath`; the exercise detail
screen (`src/app/exercise/[id].tsx`), which reads the row it loads and then
observes it (see the observers bullet below); and the Exercises tab through
`exerciseLibraryPresenter`, which reads each locally stored exercise's
`Exercise.imagePath`. The markdown export is byte-identical
with or without images (`src/export/exerciseImageExportBoundary.test.ts`).

- **Web fallback after a catalog miss (#354).** Production supplies
  `searchWebImages` to the resolver. After the catalog decision misses, Bing Images
  is searched for the normalized title plus "exercise"; up to five distinct HTTPS
  original-image URLs are attempted in result order. The first validated download
  is stored as `web:<url>`, using the existing fresh relative path and source
  compare-and-set. Failed candidates are cleaned up; an override racing a download
  wins. Search decisions are shared across sided names, but files belong to rows.
  Existing catalog images and explicit URL overrides are never replaced by web
  search. Old `none`/`none:nokey` rows are retried once through this fallback;
  an empty result writes `web:none` with a key or `web:none:nokey` without one.
  Only the latter retries on key addition. Search/HTTP/markup errors and exhaustion
  of unavailable downloads preserve the row for later retry. Bing HTML is not a
  supported API: format changes or challenges reject rather than falsely writing
  a terminal miss. Search requests time out after 15 seconds. The optional dep
  preserves the catalog-only resolver contract for callers without web search.
  `exerciseWebImages.test.ts` and `exerciseImageWebFallback.test.ts` cover this path.

- **The catalog is generated code pinned to one upstream commit.**
  `src/state/exerciseCatalogData.ts` is written by `scripts/build-exercise-catalog.mjs`
  from yuhonas/free-exercise-db at the script's `COMMIT`, which must equal
  `FREE_EXERCISE_DB_COMMIT` in `src/state/exerciseCatalog.ts`; `node
  scripts/build-exercise-catalog.mjs --check` exits 1 if the committed file differs
  from a fresh build. The pin is what keeps an already-resolved row's source URL
  from moving under it. Never hand-edit the data file.
- **Every pinned catalog entry is present in the on-device exercise library (#360).**
  `seedExerciseCatalog` runs at boot before the image resolver starts. It creates
  all 876 `exercises` rows with the upstream name, mapped kind, first primary
  muscle, equipment and newline-separated instructions, while preserving every
  field of an existing row. Seeded rows receive a terminal `catalog:<id>` source
  but no local image path, so boot does not turn the import into model calls or
  876 downloads. The existing resolver continues to handle unresolved
  user-created exercises; catalog seeding itself performs no network access.
- **Two nullable columns (schema v9) and `ImageSource` states.**
  `exercises.image_path` and `exercises.image_source`. The vocabulary lives in
  `src/state/exerciseImageState.ts`: `catalog:<id>`, `url:<url>`, `none` (no
  acceptable match — terminal) and `web:<url>` (downloaded web result), `web:none`/`web:none:nokey` (web misses),
  and `none:nokey` (the no-key name match missed;
  re-resolved once a key exists). `null` means never decided, or every attempt so
  far failed without writing. **`isImageResolutionEligible` governs ordinary
  resolution**: first-launch backfill, first-view retry and key-added retry share
  this predicate. #341 adds one narrow exception: `catalogImageCorrection` in
  `exerciseImageMatch.ts` admits only an exact normalized title paired with its
  known old `catalog:<id>` source, and only if the replacement exists in the
  bundled catalog. The three pairs are listed below. #340 also repairs terminal
  misses with a known exact alias or an unambiguous catalog sibling, as described
  below. URL overrides, unrelated catalog selections and unrecognised source
  values are left alone.
- **`image_path` is relative to `Paths.document`, never `file://` and never
  absolute.** iOS moves the app container on reinstall and restore, so an absolute
  path goes stale. `buildImageRelativePath` builds `exercise-images/<id>-<suffix>.jpg`;
  the suffix makes every download a NEW file, so an override never overwrites a
  file a render may be reading. `ExerciseImage` (`src/components/ExerciseImage.tsx`)
  is the only place a path becomes a URI (`new File(Paths.document, imagePath).uri`).
- **The AI pick reuses `AiClient.ask`; it is not a new AI surface.**
  `buildCatalogPickPrompt` asks the model to copy ONE candidate id from a fixed
  shortlist, or `NONE` — it never supplies a URL — and it rides the exercise-question
  surface's request contract and budget. `AiClient`'s member set and the model list
  are unchanged (`src/ai/exerciseImageAiBoundary.test.ts`). `ask` returns free text,
  so **`parseCatalogPick` is strict**: the trimmed reply must be exactly a shortlist
  id or exactly `NONE`, and anything else — an id wrapped in prose, backticks, an id
  outside the shortlist — is `untrusted` and falls back to the score rule. A model
  that habitually wraps its answer therefore degrades the feature to no-key quality
  *silently*; `src/ai/catalogPickPrompt.live.test.ts` (env-gated, skipped without
  `HMB_LIVE_ANTHROPIC_KEY`/`HMB_LIVE_OPENAI_KEY`) is the only detector. It probes
  each provider's default `oneShot` model unless `HMB_LIVE_MODEL` names another
  (see AI Coach for when that is required). Do not
  loosen the parser to make a reply pass — tighten the prompt, or add a deliberate,
  tested normalization.
- **With a key, a fallback miss is `none`, never `none:nokey`.** `decideByScore`
  takes `{ aiConsulted }` and `decideFromAiPick` passes `true`. This is not
  cosmetic: `none:nokey` with a key configured is *eligible*, so writing it would
  make the row's own write trigger the observer, the next pass re-resolve it, bill
  another `ask`, and write `none:nokey` again — forever. An empty shortlist is
  `none` in both modes, with no `ask`.
- **Two writers, two write shapes.** The resolver writes through
  `setExerciseImageIfSourceUnchanged`, a compare-and-set against the
  `image_source` read when the pass *began*, inside one `database.write` — so a URL
  the user pastes while a pass is downloading wins, and the pass deletes its now
  orphaned file. The user's override (`overrideExerciseImage`,
  `src/state/exerciseImageOverride.ts`) writes through `setExerciseImage`,
  **unconditionally**, because it is the user's explicit choice. Its order is
  load-bearing: download to a NEW file → write the row → delete the previous file
  only once the row no longer points at it (`setExerciseImage` returns the previous
  path for exactly this). **Failure cleanup, both writers:** if the row write
  rejects after a successful download, the just-downloaded file is deleted
  best-effort (logged, never thrown) and the ORIGINAL error is rethrown — in the
  override so the screen's catch-all reports it, in the resolver's `resolveOne` so
  the per-row catch logs it and the row stays eligible. The previous file is never
  touched on that path. A failed download changes nothing at all.
- **A 2xx is not proof of an image, so downloads are validated by magic number.**
  `File.downloadFileAsync` checks only the HTTP status (the iOS
  `FileSystemDownload.swift` accepts any 2xx) and never the content type. Before
  this check, a pasted *page* URL — an image-search result or a product page, the
  most common wrong paste — saved HTML as `<id>-<suffix>.jpg`, wrote the row,
  deleted the previous, working image and reported "Image updated.".
  `downloadExerciseImage` now reads the downloaded file's first
  `IMAGE_SIGNATURE_BYTES` bytes and, unless `looksLikeImageBytes`
  (`src/state/imageSignature.ts`) recognises JPEG, PNG, GIF, WebP or a HEIF/AVIF
  `ftyp` brand, deletes the file and rejects with `NotAnImageError`. That lands on
  the override's existing `download-failed` path (row and previous file untouched)
  and, for a catalog URL, on the resolver's untouched-and-retried row. SVG is
  deliberately not accepted, because it is text with no signature to tell it from
  an HTML page. A header that cannot be read at all takes the same exit — file
  deleted, the read's own error rethrown — and the delete is best-effort, so it
  never masks the rejection. `exerciseImageFiles.ts` cannot be imported by a test, so
  `exerciseImageDownloadGuard.static.test.ts` pins the call shape structurally.
  One input-side guard sits in front of all this: the exercise detail screen's
  `applyImageUrl` returns early on a blank field, because `onSubmitEditing`
  reaches the handler directly and the Apply button's `disabled` does not cover
  it. Without that, Return on an empty field ran the override and showed the red
  `invalid-url` error. `exerciseImageWiring.static.test.ts` pins the guard.
- **fuse.js token-search tuning is corpus-relative.** `createCatalogMatcher`
  (`src/state/exerciseImageMatch.ts`) uses `useTokenSearch`, whose scores are
  TF-IDF-weighted over the catalog — a catalog rebuild can move every score.
  `NO_KEY_ACCEPT_SCORE` is pinned by the margin fixture in
  `exerciseImageMatch.test.ts` (rows that must accept and rows that must reject).
  If a rebuild moves a row across the line, re-measure and re-pick the threshold
  deliberately; never loosen one row to make it pass.
- **No-key match quality on real data (informational, measured during #335).** On a
  real 110-exercise database the launch backfill with no key decided every row:
  32 `catalog:` / 78 `none:nokey`. About 2 of the 32 were the wrong *variant*
  although the right entry exists — "Dumbbell Lateral Raise" →
  `Dumbbell_Lying_Rear_Lateral_Raise` rather than `Side_Lateral_Raise`, and
  `dumbbell-row` → `Dumbbell_Incline_Row` rather than `One-Arm_Dumbbell_Row`. The
  measurement describes the pre-#341 matcher. #341 implements three exact aliases:
  `Dumbbell Lateral Raise` → `Side_Lateral_Raise`, `dumbbell-row` →
  `One-Arm_Dumbbell_Row`, and `Glute Bridge` → `Butt_Lift_Bridge` (previously
  `Barbell_Glute_Bridge`). Alias normalization accepts case, spacing, hyphens and
  existing abbreviations such as `DB`, but additional variant words still reach
  Fuse. An alias candidate is inserted at score 0, deduplicated and kept within
  the eight-entry shortlist; `NO_KEY_ACCEPT_SCORE` stays 0.15. The remaining
  `BB Row` ambiguity still reaches Fuse; it is not one of these aliases. The
  AI pick and paste-URL override remain available. **Do not loosen the margin
  fixture to chase further cases** — the threshold protects the other misses.
- **Repair prior wrong catalog selections only for those three title/source
  pairs (#341).** `runImageResolutionPass` checks `catalogImageCorrection` before
  ordinary eligibility. A correction bypasses `ask`, downloads a fresh file,
  and uses the existing source compare-and-set. It deletes the previous file
  only after the row successfully points at the replacement. A download failure
  preserves the row and old file; a racing URL override wins and the correction
  deletes only its newly downloaded orphan. Once corrected, the row matches
  neither the old-source exception nor ordinary eligibility, so a second pass
  does nothing. `exerciseImageAliases.test.ts` covers all three repairs,
  terminality, explicit variants, URL overrides, download failure and the race.
  These contracts were checked against the implementation and tests in
  [PR #348](https://github.com/drothschild/HMBWorkout/pull/348) on 2026-09-10.
- **Side labels share a decision, not a file (#340).**
  `imageDecisionTitle` in `exerciseImageDecisionIdentity.ts` strips trailing
  Left/Right and parenthesized side labels before normalization, shortlisting and
  the model request. A pass caches one decision promise per normalized title,
  including NONE and rejected requests. A rejected request retries on a later
  pass; it does not trigger another request for the same title during that pass.
  Each row still downloads its own file and keeps its source compare-and-set.
  Persisted catalog choices seed sided groups when the group has exactly one
  distinct catalog id that exists in the bundle. #341 corrections are projected
  into those seeds before processing any row, so a missing side cannot inherit
  the known wrong variant merely because it precedes its sibling in query order.
- **Repair a terminal miss only when a known decision exists (#340).**
  `none` and `none:nokey` may inherit the unambiguous catalog sibling above;
  the exact normalized `Dumbbell Chest Press` alias selects
  `Dumbbell_Bench_Press` directly. These repairs bypass the model even when a key
  exists. Without web search, other terminal NONEs stay terminal: two misses without a known match,
  unsided duplicate groups, and conflicting persisted catalog choices are not
  broadly retried by catalog repair. Production web fallback separately revisits
  these older misses as described above. URL overrides remain protected, and failed downloads preserve
  the old row for a later attempt. Side consistency does not establish picture
  accuracy: equipment-mismatched goblet squats and kettlebell Romanian deadlifts,
  side-plank and chest-stretch variants still require human image decisions.
  No catalog prompt wording or live model accuracy claim changed in #340.
- **New pattern: database observers. #335 added the app's first THREE, not one.**
  Before #335 nothing in `src` subscribed to a WatermelonDB observable. This bullet
  used to call the resolver "the app's first database observer". That was false
  when written, because the same feature also added two observers in `src/app`. It
  was copied word for word from the plan (`phase_07.md`), so a false claim
  arrived looking already approved — the faithfully-transcribed-AC hazard engine
  convention 8 describes. In WatermelonDB 0.28, `withChangesForTables` emits **once
  immediately on subscribe** and after **every** batch on the table, **including
  the subscriber's own writes and any writes it causes**. So each observer needs
  its own termination argument:
  - **The resolver.** `startExerciseImageResolver` subscribes to
    `database.withChangesForTables(['exercises'])`, which covers every
    exercise-creating path (`acceptDraft`, `applyRoutineImport`,
    `ensureAlternateExercise`) without any of them calling in; subscribing *is* the
    launch backfill. It terminates because of the eligibility predicates, not the
    observer: ordinary decisions are terminal except for the narrow known-match
    repairs. A repair writes the final catalog source, which does not qualify
    for another repair. No successful repair writes a retryable NONE marker. Passes run one at a time and requests during a pass
    coalesce into one follow-up.
  - **The session screen** (`src/app/session.tsx`, the exercise-image effect)
    subscribes to the same table and calls `requestExerciseImagePass()` from
    inside the subscription. It therefore feeds the resolver whose writes re-fire
    it. It terminates because of `requestedPass`, a latch local to each effect run:
    at most one request per run, however many resolver writes follow. A re-run
    (a new session, or a Replace changing `entryExerciseIdsKey`) resets it, so
    requests are bounded by user actions. `latestRead` is the other half: reads can
    resolve out of order, and only the newest may write the map, or a stale read
    could land last with no later emission to correct it.
    `exerciseImageWiring.static.test.ts` pins both, since the screen is
    jest-invisible.
  - **The exercise detail screen** (`src/app/exercise/[id].tsx`) observes its one
    row with `exercise.observe()`, and that observer only sets state
    (`setImagePath`): it neither writes nor requests. Its first-view request fires
    once, from the load effect keyed on `id` (`if (!found.imagePath)
    requestExerciseImagePass()`), never from the observer.
    `exerciseImageWiring.static.test.ts` pins that request and the observer hook's
    placement, but **not** that the observer body stays write-free. That part
    rests on review.

  **Anyone adding another observer must re-derive termination for it.** A
  long-lived one must also go through a registry like `ensureExerciseImageResolver`
  (`src/state/exerciseImageResolverRegistry.ts`), which stops a re-run boot effect
  (Fast Refresh) from starting a second subscription. The two screen subscriptions
  are per-mount and unsubscribe in their effect cleanups. The resolver is started
  from `_layout.tsx`'s boot effect, not awaited, and every failure in it is logged
  and swallowed: nothing about a workout waits on an image.
- **`src/state/exerciseImageFiles.ts` must never be imported by a test.** It holds
  the real deps (expo-file-system, `createAiClient`), and the jest project is plain
  ts-jest in node, where `expo-file-system` fails at import time because it
  requires its native module. Everything testable takes those as injected deps
  (`ExerciseImageResolverDeps`, `ExerciseImageOverrideDeps`).
  `exerciseImageResolverWiring.static.test.ts` enforces it by scanning every test
  file for an import or `require` of the module.
- **The session screen shows the image as a large 3:2 picture, not a thumbnail.**
  `SetLogger` (`src/components/SetLogger.tsx`) renders `<ExerciseImage size="fit">`
  inside the measured-height `styles.exerciseHero` wrapper, directly under the
  title row. When there is room it is full width at 3:2, the same size as the
  exercise detail screen's hero; when there isn't, it becomes a smaller 3:2 (see
  the next bullet). The plan called for a 48pt thumbnail in the title row; it
  changed on the user's request during Phase 5. The title row holds only
  the title and the `?` button, and the title's `flex: 1` (not `flexShrink: 1`) is
  what keeps a long exercise name from pushing `?` off screen.
- **The session hero is full width up to 3:2, and it is the first thing to give
  up height.** On an iPhone 15 Pro Release build with real routines, the fixed
  3:2 hero overflowed the session screen's fixed column. With a 6-line routine
  description and a timed exercise's stopwatch card, "Finish Session / Abandon"
  was drawn on top of "Log Set / Skip Set". With the Replace button present, the
  logged-sets list was squeezed to nothing. The column does not scroll (the user
  declined that), so by the user's decision the image is big when there is room
  and shrinks when there isn't, **keeping its 3:2 proportions** (a second user
  decision: the first version kept the image full width and clipped it to a
  centered banner, via a basis-`auto` wrapper with `overflow: 'hidden'`; the user
  rejected the crop, so that mechanism and its `EXERCISE_IMAGE_BORDER_RADIUS`
  export are gone). `onLayout` records the column width in a `useState(0)` hook,
  and the wrapper's full size is an explicit `height` of that width divided by
  `EXERCISE_IMAGE_ASPECT_RATIO` (exported from `ExerciseImage.tsx`).
  `flexShrink: 1` with `minHeight: 0` makes Yoga take the column's overflow out
  of the wrapper, down to zero. It is a `height` and not a `flexBasis` because
  Yoga uses a style height as the flex basis unconditionally, but honors an
  explicit `flexBasis` only when the parent's main size is definite. The image
  uses the `fit` size (`height: '100%'`, `maxWidth: '100%'`, `aspectRatio: 3 / 2`),
  so it takes its width from the wrapper's already-shrunk height, and the
  wrapper's `alignItems: 'center'` centers it. Nothing is clipped. There is no
  layout loop, because the wrapper's width comes from the column's stretch, never
  from the image. For the single frame before `onLayout` the width is 0, so the
  image is 0 tall. The width lives in `SetLogger`, so the image does not flash
  again when it reappears after the keyboard closes. The logged-sets list normally keeps a floor,
  `LOGGED_SETS_MIN_HEIGHT` in `SetLogger` (two rows, derived from `setRow`'s
  padding and border and `TypeRamp.default`'s line height), so the hero gives
  way before the list does. The floor applies only while the hero is shown and
  no exercise-description cue is present (`styles.loggedSetsFloor` under
  `!keyboardVisible && !presenter.exerciseDescriptionLine`). With the keyboard
  up, or with the fixed-height cue consuming that space, the scrollable history
  may shrink to zero before Log/Skip, Replace, or the fixed session footer can
  overlap. This priority was device-proven after a two-line cue plus Replace
  overlapped Finish/Abandon on an iPhone 15 Pro at PR #363's prior head.
  `ExerciseImage`'s own `hero` style is unchanged, so the exercise detail screen,
  which scrolls, keeps the fixed 3:2 hero. A column that still overflows with the
  hero at zero (extreme routine notes on a small screen) is out of scope.
  **Device-verified 2026-09-10** on an iPhone 15 Pro Release build with the
  user's real routines (commit c168604): no overlap, and the image keeps 3:2
  whether it is full width or shrunk.
- **The session hero hides while the keyboard is open; the exercise detail
  screen scrolls instead.** On an iPhone 15 Pro Release build the hero pushed the
  Reps/Weight/Duration inputs so far down that the keyboard covered the focused
  one. The session screen is deliberately a fixed column with no outer
  ScrollView, its buttons held above the keyboard by the `KeyboardAvoidingView`
  in `session.tsx`, so by the user's decision on #335 `SetLogger` renders the
  `styles.exerciseHero` wrapper only under `!keyboardVisible`. It renders
  nothing, not a thumbnail, so with the keyboard up the layout is the pre-#335
  one. **This sentence used to end "which fit", and a device test disproved
  it.** On the same build, hero already hidden, a timed exercise under a
  six-line routine description (Push Day → Stationary Bike) drew Finish Session
  / Abandon over the Duration input and pushed Log Set / Skip Set behind the
  decimal pad, and a timed exercise with no notes but an AI key (Forearm Plank)
  put the footer over the Replace button. Since the column was the pre-#335
  one, the overflow probably predates #335, and "which fit" was asserted rather
  than measured. The user's second decision: while typing, `session.tsx` itself
  drops more, reading its own `useKeyboardVisible()` (called once, above the
  `if (!sessionState)` early return). The whole footer block renders only under
  `!keyboardVisible`: Finish Session / Abandon, plus the phase-`done` Close,
  which no keyboard reaches in practice because `SetLogger` and its inputs are
  already gone by then. The Replace button is gated where the slot is decided,
  `belowButtonsSlot={!keyboardVisible && (<ReplaceExercise …/>)}`, which also
  unmounts its picker `Modal`. That is harmless, because the picker covers the
  inputs, so no keyboard can open under it. The routine notes take
  `numberOfLines={keyboardVisible ? 2 : undefined}`. The timer card, the
  focused input and Log Set / Skip Set stay. The column still does not scroll,
  and the `KeyboardAvoidingView` is unchanged. `keyboardVisible` comes from `useKeyboardVisible`
  (`src/hooks/use-keyboard-visible.ts`), which listens on `keyboardWillShow`/
  `keyboardWillHide` on iOS, so the hero collapses as the keyboard animates in
  rather than after it covers the field, and on `keyboardDidShow`/
  `keyboardDidHide` on Android, where the Will events never fire. The exercise
  detail screen already scrolls, so it takes the other route: its single
  `ScrollView` sets `automaticallyAdjustKeyboardInsets` (commit 9024f72,
  following `settings/ai.tsx` and `settings/ai-provider.tsx`).
  `exerciseImageWiring.static.test.ts` pins all of this structurally: the hero's
  `fit` size, measured height and placement, the keyboard condition, the hook call above any early
  return in `SetLogger`, the hook's per-platform events and subscription
  cleanup, and the detail `ScrollView`'s prop. It also pins the three
  `session.tsx` gates as exact strings (the footer, the Replace slot, and the
  notes clamp), `session.tsx`'s single hook call above its early return, and
  exactly four `keyboardVisible` occurrences in that file's code: the declaration
  and those three gates. The count runs on comment-stripped source, so a raw
  `grep` of the file finds more (the explanatory comments name it too). A fifth, wrapping `SetLogger` for instance, would hide the
  very inputs being typed in. Structural pins are the only
  option because the node jest project cannot load either `.tsx` file and
  `src/hooks` is outside its `testMatch`. **Every keyboard fix here (the hero,
  the detail screen's inset, and the session footer, Replace and notes) was
  device-verified on 2026-09-10** by the user, on an iPhone 15 Pro Release build
  (commit c168604), using the two failing screens above (Stationary Bike, Forearm
  Plank) and the exercise detail screen's Image URL and Description fields. The
  device is the only place these can be checked: the Xcode-beta simulator used
  here cannot raise a keyboard, so a simulator pass says nothing about them.
- **Accepted cost: a failing row is retried on every `exercises` write.** A row
  whose resolution keeps failing writes nothing, stays eligible, and is retried by
  the next pass — and a pass follows *any* write to the table: the exercise detail
  screen's description autosave (`AUTOSAVE_DELAY_MS`, 500 ms), a Replace, opening a
  screen that requests a first-view pass. With a key, each retry bills one `ask`
  call if the failure is at the download step (the pick happens before the
  download). The retry is required (AC2.3), the triggers are human-paced, and a
  persistent download failure means the pinned catalog URL itself is broken. **Do
  not add a cooldown without revisiting AC2.3.**
- **Known edge: both keys set, no provider.** `getAiKeyConfigured` uses the
  canonical `hasAiKey` (`src/state/hasAiKey.ts`), but `createAiClient` also needs a
  resolvable provider. With both keys set and no `aiProvider`, `hasAiKey` is true
  yet every `ask` throws, so rows stay `null` and retry. The one-key-per-install
  invariant (AI Coach, "One key per install") makes that state unreachable through
  the UI; it is documented in `exerciseImageFiles.ts` rather than special-cased.

[Back to reference index](README.md)
