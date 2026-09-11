# Exercise Images Implementation Plan — Phase 7: Live and on-device verification

**Goal:** Prove what the jest suite cannot — that real models answer the catalog-pick prompt in a parseable shape, and that images render on a device, offline, through a backfill of a real database and a Replace swap — and pin the feature's boundaries with tests. Record the new conventions in AGENTS.md.

**Architecture:** Boundary tests (export byte-identity, engine untouched, AI surface unchanged); an env-gated live test that is skipped in normal runs; a scripted simulator pass; an AGENTS.md update.

**Tech Stack:** Jest, the real `createAiClient` over `fetch` (live test only), iOS Simulator, WatermelonDB/SQLite.

**Scope:** Phase 7 of 7 from `docs/design-plans/2026-09-10-exercise-images.md`. Depends on Phase 6.

**Codebase verified:** 2026-09-10

---

## Context the executor needs

- Memory/AGENTS.md rule: **prompt-wording can only be proven by a live run** — tests pin wording against drift, never prove a model follows it. The AI failure mode here is silent (every AI failure is swallowed, and an untrusted reply quietly falls back to the score rule), so a model that always wraps its answer would degrade the feature to no-key quality with no error anywhere. The live test is the only detector.
- `createAiClient(config: ProviderConfig)` is in `src/ai/provider/factory.ts`; `ProviderConfig` is `{ anthropicKey?, openaiKey?, aiProvider?, aiModel? }` (`src/ai/provider/types.ts`). Clients use `fetch` (Node 18+ global in jest). The `AiClient` interface (`src/ai/provider/types.ts`) has methods `chat`, `comment`, `suggest`, `ask`; `AI_MODEL_CHOICES` is pinned by `src/ai/provider/models.test.ts:86-100` with `toStrictEqual`.
- Export path (`src/export/exportService.ts` → `src/interop/serialize.ts`) reads `title` and `kind` from exercise rows and nothing else relevant; `src/export/exportService.test.ts:46-79` shows the setup (`upsertExercise` + `upsertRoutine`).
- Rill rules are `src/engine/rules/{types,helpers,transition}.lv`; the TS mirror of `RoutineEntry`/state is `src/engine/types.ts`.
- On-device DB copy: AGENTS.md "Physical device" section (`xcrun devicectl device copy from ... --source Documents`) and the memory note that `hmbworkout.db` must be pulled **with its `-wal` and `-shm`** files (the `.db` alone is a stale snapshot). The simulator app container is found with `xcrun simctl get_app_container <UDID> com.davidr.hmbworkout data`.

## Acceptance Criteria Coverage

### exercise-images.AC3: Storage and display
- **exercise-images.AC3.8 Success (manual):** All four sites render the image, and a placeholder where there's none.
- **exercise-images.AC3.9 Success (manual):** Images still render with the device in airplane mode after they were resolved.
- **exercise-images.AC3.10 Edge (manual):** With a long exercise name, the session header's controls stay on screen and tappable.

### exercise-images.AC4: Identity and manual override
- **exercise-images.AC4.1 Success:** After a Replace swap, the session and routine detail screens show the new exercise's image, because image paths are keyed on `exerciseId` (presenter test plus simulator).

### exercise-images.AC5: Boundaries held
- **exercise-images.AC5.1:** `exportRoutine` and `exportSessionHistory` output is byte-identical for a routine whose exercises have images.
- **exercise-images.AC5.2:** The Rill `RoutineEntry` and engine state carry no image field; no `.lv` file changes.
- **exercise-images.AC5.3:** The `AiClient` interface and `AI_MODEL_CHOICES` are unchanged — the feature adds a prompt builder, not an AI surface.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Boundary tests

**Verifies:** exercise-images.AC5.1, exercise-images.AC5.2, exercise-images.AC5.3

**Files:**
- Test: `src/export/exerciseImageExportBoundary.test.ts` (integration, LokiJS)
- Test: `src/engine/exerciseImageEngineBoundary.test.ts` (structural)
- Test: `src/ai/exerciseImageAiBoundary.test.ts` (structural)

**Testing:**
- **AC5.1** — follow `exportService.test.ts`'s setup. Build the same routine twice in two fresh databases (or once, exporting before and after): two exercises, a superset or rest value, a finished session with logged sets. Export with `exportRoutine` and `exportSessionHistory`; then set images on both exercises (`setExerciseImage(db, id, { imagePath: 'exercise-images/x-a.jpg', imageSource: 'catalog:Barbell_Squat' })` and a `url:` one) and export again. Assert the routine markdown and the session-history `markdown` are `===` byte-identical before and after, and `failures` is empty both times. Also assert neither output contains `exercise-images/`, `catalog:` or `url:`.
- **AC5.2** — read `src/engine/rules/types.lv`, `helpers.lv`, `transition.lv` and `src/engine/types.ts` with `readFileSync`; assert none matches `/image/i`. (If an unrelated existing identifier ever contains "image", narrow the regex to `/imagePath|image_path|imageSource|image_source/`; check the current files first and pick the regex that passes today while still catching an image field.) Also assert `git`-independent evidence of "no `.lv` change": `src/engine/rules/*.lv` content hashes equal constants recorded when this test is written — compute them with `crypto.createHash('sha256')` at authoring time from `main`'s versions (`git show main:src/engine/rules/transition.lv | shasum -a 256`, etc.). If the hash pin is judged too brittle for unrelated future `.lv` work, keep only the regex assertion and say so in the test's comment — the regex alone is what AC5.2 names.
- **AC5.3** — (a) extract the `AiClient` type's member names from `src/ai/provider/types.ts` (read the source; find the `AiClient` declaration block; collect `name(` / `name:` members) and assert the **set** is exactly `{chat, comment, suggest, ask}` (planning confirmed these four); (b) `AI_MODEL_CHOICES` is already value-pinned by `models.test.ts`; do not duplicate it — assert instead, structurally, that `src/ai/catalogPickPrompt.ts` does not reference `AI_MODEL_CHOICES`, `resolveModels`, or `AiModelConfig`, and that `src/state/exerciseImageResolver.ts`'s `ask` dep type is the existing `ask` shape `(request: { system: string; message: string }) => Promise<string>` (no new surface). Compare after normalizing both sides: strip all whitespace and the `readonly` keyword (`s.replace(/\breadonly\b/g, '').replace(/\s+/g, '')`), so the pin survives reformatting and survives the dep being declared `readonly ask: …`.

**Verification:**
Run: `npx jest src/export/exerciseImageExportBoundary.test.ts src/engine/exerciseImageEngineBoundary.test.ts src/ai/exerciseImageAiBoundary.test.ts`
Expected: all pass. Also run `npx jest src/ai/provider/models.test.ts` — unchanged and passing.

**Commit:** `test(#335): pin export, engine and AI-surface boundaries for exercise images`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Live catalog-pick call, one per provider

**Verifies:** the design's Phase 7 "both live calls parse" (no AC id; it is the live proof behind AC1.1/AC1.2).

**Files:**
- Test: `src/ai/catalogPickPrompt.live.test.ts` (live, env-gated, **skipped by default**)

**Implementation:** For each provider, a test that runs only when its key env var is set:

```ts
const anthropicKey = process.env.HMB_LIVE_ANTHROPIC_KEY;
const openaiKey = process.env.HMB_LIVE_OPENAI_KEY;
const liveAnthropic = anthropicKey ? it : it.skip;
const liveOpenai = openaiKey ? it : it.skip;
```

Each test: build the real shortlist for `'Romanian Deadlift'` and for `'Couch Stretch'` with `createCatalogMatcher(EXERCISE_CATALOG)`, build `buildCatalogPickPrompt({ title, candidates, directives: IMMUTABLE_DIRECTIVES })`, call `createAiClient({ anthropicKey, aiProvider: 'anthropic' }).ask(prompt)` (resp. `{ openaiKey, aiProvider: 'openai' }`), and assert: Romanian Deadlift's reply parses (`parseCatalogPick`) to `{ kind: 'id', id: 'Romanian_Deadlift' }`; Couch Stretch's reply parses to anything **other than** `'untrusted'` (it should be `none`; an `id` is a wrong-image risk worth a note but not a parse failure). Log the raw replies (`console.log`) so the PR can quote them. Timeout 60 000 ms per test. Check `ProviderConfig` and `createAiClient` for the exact field names before writing the configs. Never write a key into the file.

**Run** (the human supplies keys at run time — ask the user; do not read them from the app's settings or anywhere on disk):
```bash
HMB_LIVE_ANTHROPIC_KEY=... HMB_LIVE_OPENAI_KEY=... npx jest src/ai/catalogPickPrompt.live.test.ts
```
Expected: 2 tests pass (4 calls). Without the env vars: `npx jest src/ai/catalogPickPrompt.live.test.ts` reports both skipped and exits 0 — confirm this too, since the file runs in every normal `npm test`.

**If a reply does not parse:** do not loosen `parseCatalogPick` silently. Record the raw reply, then decide with the user between (a) tightening the prompt wording and re-running live, or (b) a deliberate, tested normalization (e.g. stripping surrounding backticks) — and update Phase 3's AC1.3 tests to match whichever is chosen.

**Commit:** `test(#335): env-gated live catalog-pick call per provider` — and paste the raw replies into the PR description.
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Simulator pass — backfill, four sites, airplane mode, Replace

**Verifies:** exercise-images.AC3.8, exercise-images.AC3.9, exercise-images.AC3.10, exercise-images.AC4.1 (manual)

**Files:** none (verification only).

**Steps** — invoke the `running-in-simulator` skill first and follow it for build/Metro/navigation/SQLite access.
1. **Backfill against a copy of a real database.** Back up the phone's database first (AGENTS.md: `xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer --domain-identifier com.davidr.hmbworkout --source Documents --destination <dir>`), pulling `hmbworkout.db` **and** `hmbworkout.db-wal` / `-shm`; checkpoint it locally (`sqlite3 hmbworkout.db 'PRAGMA wal_checkpoint(TRUNCATE);'`). Confirm it is at schema v8 (`PRAGMA user_version;` or WatermelonDB's `local_storage` schema key — per the skill). No v8 build is needed: with the app not running, copy the checkpointed v8 file into the simulator app container's `Documents/` (replacing the simulator's own database — back that up first), then launch this branch's build, which upgrades it to v9 on open. Expect: no data loss (routine/session counts equal before and after — compare with `sqlite3` queries), both new columns present, and within a minute every exercise row has a non-null `image_source` (with a key configured: `catalog:` or `none`; without: `catalog:` or `none:nokey`). Report the counts per source value.
2. **AC3.8** — the four sites render images and placeholders (repeat Phase 5 Task 6's checklist on the real data).
3. **AC3.10** — the long-name check on the session screen, as in Phase 5 Task 6.
4. **AC3.9** — with images resolved, disable networking for the simulator (turn off the Mac's Wi-Fi / network, or use Network Link Conditioner's "100% Loss" profile), kill and relaunch the app, and confirm all four sites still render images. (A Debug build needs Metro for JS; keep Metro reachable on localhost — localhost traffic is unaffected by disabling external networking — or do this step on a Release build per AGENTS.md "Physical device for REAL-WORLD use".)
5. **AC4.1** — Replace an exercise mid-session; the session header and routine detail show the new exercise's image.
6. **AC2.4 spot-check** (not required by the design's Phase 7 Done-when, but cheap): start without a key, confirm some `none:nokey` rows; add a key in Settings; trigger a pass (open an exercise detail screen with no image); those rows move to `catalog:` or `none`.

Record per-AC pass/fail with screenshots in the PR description. Any failure is fixed before the phase is complete.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: AGENTS.md update

**Verifies:** None (documentation).

**Files:**
- Modify: `AGENTS.md`

Invoke the `ed3d-extending-claude:maintaining-project-context` skill (or `claude-md-management` conventions) and make these specific, verifiable edits — cite symbols, not line numbers (AGENTS.md itself records how line citations went stale):
- **Last verified** date → the date of this change.
- **AI Coach → "Immutable directives must remain the last section of every system prompt"**: "four builders" → five, adding `buildCatalogPickPrompt` (`src/ai/catalogPickPrompt.ts`).
- **AI Coach → "Three one-shot AI features…" known-debt sentence**: `neutralizeForPrompt` is no longer "in multiple copies" — it is hoisted to `src/ai/neutralizeForPrompt.ts` (contextBuilder's `neutralizeNotesForPrompt` is separate). Keep the POST/parse boilerplate debt sentence.
- **New subsection "Exercise images (#335)"** (near HealthKit/AI Coach): the catalog is a generated `.ts` module pinned to one free-exercise-db commit (`scripts/build-exercise-catalog.mjs --check`); the `image_path`/`image_source` columns (schema v9) and the four `ImageSource` states with `isImageResolutionEligible` as the single rule; `image_path` is relative to `Paths.document`, never `file://`; the catalog pick reuses `AiClient.ask` (not a new surface) and `parseCatalogPick` is strict; **with a key, a fallback miss is `none`, never `none:nokey` — the observer loop that would otherwise follow**; the CAS write (`setExerciseImageIfSourceUnchanged`) vs the user's unconditional override (`setExerciseImage`, delete-after-write); fuse token-search tuning is corpus-relative and pinned by the margin fixture in `exerciseImageMatch.test.ts`.
- **"New pattern": the first database observer.** `withChangesForTables` emits on subscribe and after every batch *including the subscriber's own*; termination is a property of the eligibility rule, not of the observer. Anyone adding a second observer must re-derive that.
- **`src/state/exerciseImageFiles.ts` must never be imported by a test** (plain ts-jest; `expo-file-system` is native) — enforced by `exerciseImageResolverWiring.static.test.ts`.
- **Structure**: add the new `src/state/exercise*` modules and `src/components/ExerciseImage.tsx` to the relevant bullets; note the migration section's schema is now v9 (the `migrationV8ToV9.test.ts` harness).
- **Schema migrations**: one sentence that v9 is a non-destructive `addColumns` bump like v8.
- **Tech stack**: add `fuse.js 7.5.0` (exact pin — `useTokenSearch` is new in 7.x and the tuning was measured on 7.5.0) and `expo-image` (display) / `expo-file-system` `File`/`Paths` (image storage).
- **Accepted cost, in the Exercise images subsection**: a row that keeps failing is retried on every `exercises` write (the detail screen's 500 ms description autosave, a Replace, opening a screen), and with a key each retry bills one `ask` call if the failure is at the download step. AC2.3 requires the retry; triggers are human-paced; a persistent download failure means the pinned catalog URL is broken. Do not add a cooldown without revisiting AC2.3.
- **Known edge, in the same subsection**: `getAiKeyConfigured` is the canonical `hasAiKey`, but `createAiClient` also needs a resolvable provider — with both keys set and no `aiProvider`, every `ask` throws and rows stay null. The one-key-per-install invariant makes that state unreachable through the UI (documented in `src/state/exerciseImageFiles.ts`).

**Verification:** re-read the edited sections; every file/symbol named exists (`grep -n` each one). No test run.

**Commit:** `docs(#335): record exercise-image conventions in AGENTS.md`
<!-- END_TASK_4 -->
