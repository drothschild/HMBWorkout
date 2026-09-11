# Exercise Images (#335) — Human Test Plan

- **Branch:** `feat/335-exercise-images` (PR #339)
- **Design:** `docs/design-plans/2026-09-10-exercise-images.md`
- **Test requirements:** `docs/implementation-plans/2026-09-10-exercise-images/test-requirements.md`
- **Automated coverage:** PASS. All 34 automatable criteria are covered (32 automated-only, plus the automated halves of AC3.7 and AC4.1).
- **Human-only criteria:** AC3.8, AC3.9, AC3.10. **Hybrid (automated plus a human half):** AC3.7, AC4.1.

Results recorded on 2026-09-10 come from PR #339: iPhone 17 simulator (iOS 26.5) and
iPhone 15 Pro Release build, both on the user's real database.

**Where this plan differs from test-requirements.md:** the session screen's image
is not a thumbnail beside the title. At the user's request during Phase 5 it
became a full-width 3:2 picture under the title row, and it shrinks (keeping
3:2) when the column is crowded. This plan describes what is implemented.

## Prerequisites

1. These suites pass. Run them by name, never the whole suite:

       npx jest src/state/exerciseImageResolver.test.ts src/state/exerciseImageMatch.test.ts \
         src/ai/catalogPickPrompt.test.ts src/ai/neutralizeForPrompt.test.ts \
         src/state/exerciseImageState.test.ts src/state/exerciseImageWiring.static.test.ts \
         src/state/exerciseImageResolverRegistry.test.ts src/state/exerciseImageResolverWiring.static.test.ts \
         src/db/migrationV8ToV9.test.ts src/db/migrations.test.ts \
         src/state/routineDetailPresenter.test.ts src/state/routineListPresenter.test.ts \
         src/state/sessionPresenter.test.ts src/db/exerciseImageWrites.test.ts \
         src/state/exerciseImageOverride.test.ts src/export/exerciseImageExportBoundary.test.ts \
         src/engine/exerciseImageEngineBoundary.test.ts src/ai/exerciseImageAiBoundary.test.ts \
         src/ai/provider/models.test.ts src/state/imageSignature.test.ts \
         src/state/exerciseImageDownloadGuard.static.test.ts src/state/exerciseCatalog.test.ts

   Expected result: all 22 suites pass. `src/ai/catalogPickPrompt.live.test.ts`
   reports 2 skipped when `HMB_LIVE_ANTHROPIC_KEY` and `HMB_LIVE_OPENAI_KEY` are
   unset. Run it with your own keys, in your own terminal, to prove the catalog
   pick against the real providers.
2. `node scripts/build-exercise-catalog.mjs --check` prints
   `OK: committed catalog matches a fresh build (876 entries)`. The exported
   on-device library contains all 876 entries; the image matcher filters that
   data to the 873 entries with an image.
3. #335 adds no native module; its only new dependency, fuse.js, is pure JS. But
   if your `ios/` predates native modules that landed on main earlier
   (expo-sharing and expo-document-picker), regenerate it:
   `LANG=en_US.UTF-8 npx expo prebuild -p ios --clean`. Then build the dev client
   (simulator) or a Release build (device), following AGENTS.md "Building and installing".
4. Simulator driving follows `.claude/skills/running-in-simulator/SKILL.md`: run your
   own Metro on port 8082+, navigate with deep links
   (`xcrun simctl openurl <udid> "hmbworkout://<path>"`), and enter text through
   `xcrun simctl pbcopy <udid>` followed by paste.
5. SQLite ground truth. Set the variable once:
   `c=$(xcrun simctl get_app_container <udid> com.davidr.hmbworkout data)`.
   Source breakdown:

       sqlite3 "$c/Documents/hmbworkout.db" "select case when image_source like 'catalog:%' then 'catalog:' when image_source like 'url:%' then 'url:' else coalesce(image_source,'NULL') end, count(*) from exercises group by 1;"

   Files: `ls "$c/Documents/exercise-images/"`.
   **Edit SQLite only while the app is terminated.** WatermelonDB's record cache
   does not see outside edits made while the app is running.
6. **Seed routine "Image Check"** containing Romanian Deadlift (well matched), Couch
   Stretch (no catalog match), and "Single-Arm Half-Kneeling Landmine Press With
   Rotation Hold" (long title). Add one timed exercise, such as Plank. Leave both
   image columns null on every exercise.

## Phase 2: Schema v9 upgrade

| Step | Action | Expected | Result 2026-09-10 |
|---|---|---|---|
| 2.1 | Pull the phone DB (`.db`, `-wal`, `-shm`, one file at a time), checkpoint it, and confirm `PRAGMA user_version` is 8. Record the row counts of routines, exercises, routine_exercises, routine_sets, sessions and session_sets. | Baseline recorded. | v8; 4 / 110 / 225 / 217 / 3 / 81 |
| 2.2 | Put that DB in the simulator container and launch this branch. | The Metro log shows `Migrating from version 8 to 9... Migration successful`. `user_version` is 9, and `pragma table_info(exercises)` lists `image_path` and `image_source`. | Pass |
| 2.3 | Recount the six tables. | Identical to step 2.1 (AC3.1). | Pass (simulator and iPhone) |

## Phase 4: Background resolution

| Step | Action | Expected | Result 2026-09-10 |
|---|---|---|---|
| 4.1 | With **no AI key**, launch on the seeded DB and tap nothing. Within about 10 s, run the source breakdown. | Every row is non-NULL: RDL, Plank and Goblet Squat are `catalog:…`, and Couch Stretch and the long title are `none:nokey` (AC2.1, AC1.4, AC1.5, AC1.8). | Pass: 5 of 5. On real data, 32 `catalog:` / 78 `none:nokey` of 110. |
| 4.2 | List `image_path` values and `ls` the files in `Documents/exercise-images/`. | Every path looks like `exercise-images/<id>-<suffix>.jpg`. None starts with `/` or `file://`, and every path has a file on disk (AC3.3). | Pass: 32 files, 0 missing |
| 4.3 | Open Settings → AI Provider (`hmbworkout://settings/ai-provider`) and paste an Anthropic key. Then open exercise detail for a `none:nokey` exercise (`hmbworkout://exercise/<id>`). Rerun the breakdown every 20 s. | `none:nokey` falls to 0 and those rows move to `catalog:` or `none`. The pass stops and does not loop (AC2.4, AC2.7, AC2.9). The detail screen's placeholder turns into the photo without leaving the screen. | Pass: 70 `catalog:` / 40 `none` / 0 nokey |
| 4.4 | First launch of the Release build on the iPhone, with the phone's own key. | All rows decided, 0 `none:nokey`. | Pass: 65 / 45 / 0 |

## Phase 5: Display

| Step | Action | Expected | Result 2026-09-10 |
|---|---|---|---|
| 5.1 | Open exercise detail for Romanian Deadlift, then for Couch Stretch. | RDL shows a full-width 3:2 photo under the title. Couch Stretch shows a grey placeholder at the same size (AC3.8). | Pass |
| 5.2 | Open routine detail (`hmbworkout://routine/<id>`). | Each row shows a small thumbnail, and unmatched rows show the placeholder (AC3.8, AC3.4). | Pass |
| 5.3 | Open the Routines tab. | Each card shows a strip of up to 4 thumbnails in routine order. Unmatched exercises are skipped, and a routine with no images shows no strip (AC3.8, AC3.5). | Pass |
| 5.4 | Start "Image Check" from the start button on routine detail. | The session screen shows the current exercise's image as a 3:2 picture under the title row, or the placeholder when there is none (AC3.8, AC3.6). | Pass |
| 5.5 | With an AI key set, advance to the long-title exercise in a session. | The title wraps. The `?` (Ask about this exercise) button stays on screen, and tapping it expands the answer (AC3.10). The `?` only renders when a key is set. | Pass (iPhone) |
| 5.6 | Open the most crowded screen: Push Day → Stationary Bike (six-line routine notes plus the timer card), and Forearm Plank with Replace visible. | The image shrinks, keeps 3:2 with no crop, and is centred. Finish Session / Abandon never overlap Log Set / Skip Set or Replace. At least two logged-set rows stay visible. | Pass (iPhone) |
| 5.7 | On the same screens, tap into Reps or Duration so the keyboard rises. | The hero disappears, Finish Session / Abandon and "Replace exercise" are hidden, the routine notes clamp to 2 lines, and the focused field plus Log Set / Skip Set stay above the keyboard. When the keyboard closes, everything returns. | Pass (iPhone) |

## Phase 6: Paste-URL override (exercise detail)

| Step | Action | Expected | Result 2026-09-10 |
|---|---|---|---|
| 6.1 | On exercise detail, before typing anything, check the "Use this image" button. Focus the empty "Image URL" field and press return. | The button is disabled. Pressing return does nothing and shows no error. | Pass |
| 6.2 | Paste a direct `https://` JPEG URL and tap "Use this image". | The button reads "Saving…", then the hero changes and "Image updated." appears. SQLite shows `url:<url>` and a new `image_path`, and the previous file is gone from `exercise-images/` (AC4.2). | Pass |
| 6.3 | Paste `https://example.invalid/nope.jpg` and tap the button. | "Couldn't download that image. Use a direct https:// link to the image file." appears. The hero and the SQLite row are unchanged, and the old file is still on disk (AC4.4). | Pass |
| 6.4 | Paste a web page URL (an image-search result or product page). | The same download error appears and the old image is kept, because a non-image response is rejected by magic number. | Pass (iPhone) |
| 6.5 | Paste `file:///etc/hosts`. | "Enter an image URL that starts with http:// or https://." appears. Nothing is downloaded and the row is unchanged (AC4.3). | Pass |
| 6.6 | With the keyboard up on the Image URL field and then on Description. | The screen scrolls so the focused field stays above the keyboard. | Pass (iPhone) |

## End-to-end: Replace mid-workout shows the new image (AC4.1)

Purpose: this checks the full chain in a real session. The engine's `ReplaceExercise`
Ok feeds the `exerciseId`-keyed image map on the session screen, and the routine row
is re-pointed.

1. Set an AI key. Start a routine whose first exercise has an image, and log no sets on it.
2. Tap "Replace exercise", wait for the alternatives, and pick one that is a different movement.
3. Expected: the session image switches to the new exercise's image, or to the
   placeholder, and then resolves to a photo once the background pass finishes.
4. Finish or abandon the session, then open that routine's detail screen. Expected:
   the swapped row shows the new exercise's image.

Result 2026-09-10: Pass (iPhone).

## End-to-end: offline rendering (AC3.9)

Purpose: images are served from `Documents/`, not the network.

1. Confirm images have been resolved (the phase 4 breakdown shows `catalog:` rows).
2. iPhone: turn on airplane mode, force-quit the app, and reopen it. On the simulator
   instead, run `networksetup -setairportpower en0 off`, kill the app and relaunch it;
   localhost Metro keeps serving.
3. Visit exercise detail, routine detail, the Routines tab and a session. Expected:
   every image renders.
4. Turn networking back on.

Result 2026-09-10: Pass (iPhone Release).

## End-to-end: an image resolved mid-workout appears in place (AC3.7 human half)

**Status: not observed. Recorded as an explicit deviation in PR #339.** The structural gate
and its killed mutants stand in for it. The only live observation was on exercise detail,
which uses a different mechanism (`exercise.observe()`). Suggested procedure if someone
wants to close the gap:

1. Terminate the app. In SQLite, set `image_path = NULL, image_source = NULL` on the
   first exercise of a test routine, and leave every other row resolved.
2. Throttle the Mac's network so a roughly 50 KB download takes more than 15 s (for
   example, Network Link Conditioner with a custom profile of about 20 Kbps downlink).
   Localhost Metro is unaffected.
3. Launch the app, then immediately go to `hmbworkout://routine/<id>` and start the session.
4. Expected: the session screen first shows the placeholder, and the photo replaces it
   without leaving the screen once the download finishes. Remove the throttle afterwards.

## Human verification required

| Criterion | Why manual | Steps |
|---|---|---|
| AC3.7 (human half) | Only a mounted session screen shows the re-render. jest cannot load `src/app`. | "Mid-workout" section above (deviation) |
| AC3.8 | Rendering at four sites and the placeholder is RN layout, which the node jest project cannot render. | 5.1–5.4 |
| AC3.9 | Needs a real network outage and real files under `Paths.document`. | "Offline rendering" section |
| AC3.10 | Flex layout of the title against the `?` button. | 5.5 |
| AC4.1 (screen half) | The real Replace flow, the AI alternates call, and the screen reload keys. | "Replace mid-workout" section |
| Keyboard and shrink layout (no AC; device-found regressions fixed in Phase 7) | Keyboard behaviour exists only on a device. The Xcode-beta simulator cannot raise a keyboard. | 5.6, 5.7, 6.6 |

## Traceability

| Acceptance criterion | Automated test | Manual step |
|---|---|---|
| AC1.1 | `exerciseImageResolver.test.ts`, `exerciseImageMatch.test.ts`, `catalogPickPrompt.test.ts` (+ live test, user-run) | 4.3 |
| AC1.2 | same | 4.3 |
| AC1.3 | same | none |
| AC1.4 | `exerciseImageMatch.test.ts`, `exerciseImageResolver.test.ts` | 4.1 |
| AC1.5 | same | 4.1 |
| AC1.6 | same | none |
| AC1.7 | `exerciseImageMatch.test.ts` | none |
| AC1.8 | `exerciseImageMatch.test.ts`, `exerciseImageResolver.test.ts` | 4.1 |
| AC1.9 | `catalogPickPrompt.test.ts`, `neutralizeForPrompt.test.ts` | none |
| AC2.1 | `exerciseImageResolver.test.ts` | 4.1, 4.4 |
| AC2.2 | `exerciseImageResolver.test.ts` | none |
| AC2.3 | `exerciseImageResolver.test.ts` | none |
| AC2.4 | `exerciseImageState.test.ts`, `exerciseImageResolver.test.ts` | 4.3 |
| AC2.5 | same | none |
| AC2.6 | `exerciseImageResolver.test.ts` | none |
| AC2.7 | `exerciseImageResolver.test.ts` | 4.3 |
| AC2.8 | `exerciseImageResolver.test.ts` | none |
| AC2.9 | `exerciseImageWiring.static.test.ts`, `exerciseImageResolverRegistry.test.ts` | 4.3 |
| AC2.10 | `exerciseImageResolverWiring.static.test.ts`, `exerciseImageResolverRegistry.test.ts` | 4.1 |
| AC3.1 | `migrationV8ToV9.test.ts`, `migrations.test.ts` | 2.1–2.3 |
| AC3.2 | `migrationV8ToV9.test.ts` | none |
| AC3.3 | `exerciseImageState.test.ts`, `exerciseImageResolver.test.ts` | 4.2 |
| AC3.4 | `routineDetailPresenter.test.ts` | 5.2 |
| AC3.5 | `routineListPresenter.test.ts` | 5.3 |
| AC3.6 | `sessionPresenter.test.ts`, `exerciseImageWrites.test.ts`, `exerciseImageWiring.static.test.ts` | 5.4 |
| AC3.7 | `exerciseImageWiring.static.test.ts` | "Mid-workout" section (deviation, not observed) |
| AC3.8 | supporting structural: `exerciseImageWiring.static.test.ts` | 5.1–5.4 |
| AC3.9 | none | "Offline rendering" section |
| AC3.10 | none | 5.5 |
| AC4.1 | `sessionPresenter.test.ts`, `routineDetailPresenter.test.ts` | "Replace mid-workout" section |
| AC4.2 | `exerciseImageOverride.test.ts`, `exerciseImageWiring.static.test.ts` | 6.2 |
| AC4.3 | `exerciseImageOverride.test.ts` | 6.5 |
| AC4.4 | `exerciseImageOverride.test.ts`, `exerciseImageWiring.static.test.ts`, `imageSignature.test.ts`, `exerciseImageDownloadGuard.static.test.ts` | 6.3, 6.4 |
| AC4.5 | `exerciseImageResolver.test.ts`, `exerciseImageWrites.test.ts` | none |
| AC5.1 | `exerciseImageExportBoundary.test.ts` | none |
| AC5.2 | `exerciseImageEngineBoundary.test.ts` | none |
| AC5.3 | `exerciseImageAiBoundary.test.ts`, `provider/models.test.ts` | none |
