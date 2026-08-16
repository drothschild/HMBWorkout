# Routine Import/Export Design

Issue: [#267](https://github.com/drothschild/HMBWorkout/issues/267). Picks up the grammar
extension deferred by
[`2026-08-11-coach-prescribed-weights.md`](./2026-08-11-coach-prescribed-weights.md) under the
trigger that plan itself named, and re-opens one accepted consequence of
[`2026-08-07-remove-vault-sync.md`](./2026-08-07-remove-vault-sync.md) without re-opening its
decision.

## Summary

The card reads "New Feature: export/import routines. It should be able to import what hevy
exports." Research establishes that the second sentence, read literally, is not satisfiable:
**Hevy's file export contains completed workout history and body measurements. It does not
contain routines.** A Hevy routine leaves the platform only as a `hevy.com` share link or
through the authenticated `/v1/routines` API, which requires a Hevy Pro subscription. The
Findings section below carries the sources. Everything downstream of that fact is what this
design has to reorganise around, and it is why the phase order puts our own format first and
Hevy last.

The approach is four independently-mergeable phases, each leaving `npx tsc --noEmit` clean and
`npm test` green. Three decisions carry most of the design weight. First, **export ships before
import** — the serializer is already written and tested, export reads only our own data, and a
bad export is a bad file rather than a corrupted database. Second, **the wire format is the
existing vault markdown grammar**, extended by exactly one new flag key (`target_weight=`) rather
than replaced by JSON; `parse.ts` is the maintained half of a symmetric pair that has been kept
alive for precisely this, and a routine importer finally gives it the production consumer it has
lacked since #203. Third, **the Hevy path reads the authenticated
`/v1/routines` API rather than the file export** — a user decision taken after the research below,
and the right one, because the API returns the actual routine while the CSV would only support
guessing a plan from past performance.

**Revision, 2026-08-16.** The user settled the open decisions: Phase 4 imports from the Hevy API,
all four phases proceed, and the entry point is Settings → Data. API access is **confirmed, not
assumed** — a read-only `get-routines` against the real account returns three routines (Legs,
Pull, Push) and `get-routine` returns full detail, so the Hevy Pro prerequisite is satisfied and
is not a risk. Phase 4 was rewritten against the real "Push" payload. Phases 1–3 are unchanged
except for one grammar defect the regrounding exposed (see "The `@hint` flag cannot hold a
sentence"). The CSV material in Findings is retained as background for a path not taken.

## Findings

Lead finding, stated plainly: **an account-level export from Hevy produces completed workout
history, not routines.** This is what moved Phase 4 off the file export and onto the API. The
first four subsections below record the file-export research; they remain accurate but describe
**a path not taken**, and are kept because they are the evidence for that choice. The live Phase 4
contract is the API subsection at the end, and the mapping table in Architecture is built from a
real API payload, not from the CSV.

### The CSV path (background — not the implementation route)

### What the export produces

The export lives at Profile → Settings → **Export & Import Data**, and offers **Export Workouts**
and a separate measurements export. `openweight.dev`'s migration guide gives the path as `"Go to
Profile → Settings"` then `"Tap Export & Import Data"`
([openweight.dev/migrate/hevy.html](https://openweight.dev/migrate/hevy.html)); Ryot's importer
documentation independently instructs the user to `"Login to your Hevy account on the app and go
to the 'Profile' page"` and `"click on the button that says 'Export Workouts'"`
([docs.ryot.io/importing/hevy](https://docs.ryot.io/importing/hevy)). The product is a CSV.

**Could not determine from Hevy's own documentation.** Hevy's help-centre article "How to Import
Strong App CSV Files and Export Your Data in Hevy" is the primary source and it is unreadable by
automation: it returns HTTP 403 to both WebFetch and the Defuddle CLI, and a real browser session
is redirected to the help-centre root with an empty body. Everything above therefore rests on
three independent third-party migration guides that agree with each other, not on Hevy's own
words. **Someone with the app in hand should confirm the exact menu labels and, critically,
whether a routines export has appeared since these guides were written.** This was Open Decision 1
and is now **moot** — Phase 4 reads the API — but it is the reason Phase 4 reads the API, so the
gap is recorded rather than erased.

### That the export is workouts-only, from three independent directions

1. Every migration guide describes only workouts. openweight.dev: `"Hevy exports everything —
   workouts, exercises, sets, supersets, and notes"` — a list that conspicuously omits routines.
2. Arvo's import guide states the consequence directly for its own importer: `"Templates and
   programs from Hevy or Strong are *not* imported"`
   ([arvo.guru](https://arvo.guru/blog/hevy-to-arvo-csv-import)).
3. Hevy's own marketing page for routine sharing offers a share link and OS-level share sheet and
   nothing else: users can `"generate a link you can paste *anywhere*"`, and the only
   file-shaped affordance anywhere on the page is saving a *folder* as an image
   ([hevyapp.com/features/share-folders-routines](https://www.hevyapp.com/features/share-folders-routines/)).

Confidence: high that no routine export existed as of these sources. Not certain that none exists
today, for the reason in the previous section.

### The workout CSV, concretely

A real header row and sample row, from a developer who performed the export and published it
([blog.ayjc.net](https://blog.ayjc.net/posts/migrate-strong-hevy-app/)):

```
"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
"Thursday- Upper Reps","28 Mar 2025, 17:29","28 Mar 2025, 18:52","","Band Pullaparts",,"",0,"normal",,20,,0,
```

One row per set. Workout identity is carried by the repeated `title` + `start_time` pair; there is
no workout id column, and no routine id column, which is a second and independent confirmation
that the plan behind a workout does not travel with it.

**An unresolved discrepancy about units.** The 2025 sample above carries only `weight_lbs` and
`distance_miles`. openweight.dev's converter documentation instead lists **both**
`weight_kg`/`weight_lbs` and `distance_km`/`distance_miles`, and describes auto-detection —
`"Uses weight_kg when available (stores as kg); Falls back to weight_lbs"`. These cannot both
describe the same file. Either the schema changed between the two sources' dates, or the columns
follow the account's unit preference. **Could not determine which.** The design handles this by
detecting columns present rather than assuming a fixed header (AC5.2), which is correct under
either explanation, but the ambiguity is real and is recorded rather than smoothed over.

`set_type` values, per openweight.dev's mapping table: `normal`, `warmup`, `dropset`, `failure`,
also appearing as the integers `1`–`4`. Not independently corroborated.

### The API path — the live Phase 4 contract

**Access is confirmed, not assumed.** A read-only `get-routines` against the user's real account
returns three routines (Legs, Pull, Push); `get-routine` returns full detail for each. The **Hevy
Pro** prerequisite is therefore already satisfied for this user and is *not* a risk this plan needs
to flag. The key is minted at `hevy.com/settings?developer`.

Transport, from two independent sources — Serval's integration docs state the key is "sent in the
`api-key` HTTP header" ([docs.serval.com](https://docs.serval.com/sections/integrations/hevy)),
corroborated by published client usage (`curl -H "api-key: $HEVY_API_KEY"`). Base host
`api.hevyapp.com`; `GET /v1/routines` lists and `GET /v1/routines/{routineId}` fetches one.

**Could not determine: the exact pagination parameter names and their maximum page size.** Hevy's
Swagger UI at `api.hevyapp.com/docs/` is a JavaScript SPA — WebFetch retrieves only the string
"Swagger UI", and `swagger.json` under that path returns the same shell. Published examples show
both `?page=1&pageSize=5` and a `page_size` spelling, and I could not establish which is
authoritative or what the ceiling is. **Phase 4's implementer must read the spec in a real browser
before writing the client**; it is a five-minute task and getting it wrong is a 400, not a silent
error.

The shape, taken from a real `get-routine` on the "Push" routine
(`760bdf23-0a80-4df3-a36d-4af1d55f370b`, 12 exercises), re-fetched for this revision rather than
summarised second-hand:

- **exercise**: `title`, `index`, `exercise_template_id`, `notes`, `rest_seconds`, optional
  `supersets_id`
- **set**: `index`, `type` (`"warmup"` | `"normal"`), and optional `weight_kg`, `reps`,
  `rep_range: { start, end }`, `distance_meters`, `duration_seconds`

Five structural facts, each of which drives a mapping decision in Architecture:

1. **`weight_kg` is a float carrying an exact pound value.** This account logs in lbs and Hevy
   converts: `22.67964547178199` is 50 lb and `13.607787283069193` is 30 lb, to the exact
   `0.45359237` factor. Good for us — kg is canonical — but see the rounding analysis below,
   because the app's own `LBS_PER_KG` is the *truncated* `2.20462`.
2. **Rep plans come in three shapes, and all three occur in one routine.** `rep_range` alone
   (Bench Press normal sets, `{8,10}`); plain `reps` alone (Russian Twist, `reps: 20`, no range);
   and **both at once** (Dead Bug, `reps: 12` *and* `rep_range {12,12}`). Any mapping needs a rule
   for all three.
3. **Set types map cleanly, and this is the cleanest part of the mapping.** Counting `type` per
   exercise gives our fields directly: Bench Press has 3 `warmup` + 4 `normal` → `warmupSets: 3,
   targetSets: 4`. The corollary is a real loss: Hevy's warmup sets carry **per-set ascending
   weights** (9.07 → 11.34 → 18.14 kg) and our model stores only a count. That ramp is
   unrecoverable.
4. **`supersets_id` is an arbitrary integer and its ordering is not sorted.** In Push the runs are
   indices 2–3 → id 5, 4–5 → id 6, 6–7 → id 7, 8–10 → id 4. Every run is **contiguous**, which is
   exactly what engine convention 9 requires. But the ids ascend out of position order, so
   **sorting by `supersets_id` would reorder the routine.** Highest-risk item in the phase.
5. **`weight_kg: 0` occurs** (Cycling's warmup set) and must map to *absent*, not to a stored zero —
   `computeSetPrefill` treats a non-positive weight as absent, so a stored 0 is a value nothing
   honours.

## Definition of Done

1. **The markdown grammar can express a prescribed weight.** `format.ts` gains a
   `target_weight=` flag key — distinct from `weight=`, which already means logged kg on a session
   line — carried symmetrically through `knownFlags`, `ParsedFlags`, `WorkoutLine`, `formatFlags`,
   `parse.ts` and `serializeRoutine`.
2. **`weight=` is rejected on a routine line.** The three comments in `format.ts` claiming the flag
   is session-only become a rule enforced by `parse.ts`'s existing `context` parameter, rather than
   a comment a real importer would walk straight past.
3. **The user can get a file out of the app.** A Settings → Data screen exports one routine as
   markdown and the full session history as markdown, through the iOS share sheet. A non-empty
   `SessionHistoryExport.failures` is rendered to the user, never dropped.
4. **A markdown routine file can be read back in.** A file picked from the Files app is parsed by
   `parseRoutine` and written through `upsertRoutine`, creating missing exercises and never
   mutating existing ones. Export → import round-trips a routine.
5. **A Hevy routine is imported from the API.** The user stores a Hevy API key, picks from their
   real routine list, and the selected routine lands as a native routine with every lossy
   conversion named in a summary shown before anything is written.
6. **`npx tsc --noEmit` is clean, `npm test` is green, and `npm run lint` passes** at every phase
   boundary.
7. **A routine's per-exercise notes survive a markdown round-trip.** Today they do not — see
   "The `@hint` flag cannot hold a sentence".

**Out of scope:** the Hevy workout CSV (superseded by the API — the research is retained in
Findings as the reasoning); importing Hevy body measurements; importing Hevy *workout history*
into `session_sets`; writing anything back to Hevy (no `create-*`/`update-*` call is ever made);
Hevy routine *folders*; a manual routine builder; re-importing our own session-history markdown;
Strong, Fitbod or any other app's format; iCloud or any cloud destination.

## Acceptance Criteria

### routine-import-export.AC1: The grammar carries a routine's plan, symmetrically

- **routine-import-export.AC1.1 Success:** `parseFlags('target_weight=61.23')` returns
  `{ targetWeightKg: 61.23 }`, and `formatFlags({ targetWeightKg: 61.23 })` returns
  `'target_weight=61.23'`.
- **routine-import-export.AC1.2 Success:** `serializeRoutine` given a routine exercise with
  `targetWeightKg: 61.23` emits `target_weight=61.23` on that line; given the same row with the
  field absent it emits no `target_weight=` token at all.
  *Discrimination: asserting only the present case passes a mutant that emits `target_weight=null`
  for an unset column — the exact `!= null` vs `!== undefined` hazard AGENTS.md documents for
  every other optional column. The fixture must set the field to literal `null`, as WatermelonDB
  does, not `undefined`.*
- **routine-import-export.AC1.3 Edge:** `parseFlags('target_weight=0')` throws `ContractError`.
  Zero is rejected on the way in because `computeSetPrefill`'s weight guards read `> 0` and would
  silently discard it — the same argument `coach-prescribed-weights` used to reject 0 at the
  validator.
- **routine-import-export.AC1.4 Failure:** `parseFlags('target_weight=-5')` and
  `parseFlags('target_weight=abc')` each throw `ContractError`.
- **routine-import-export.AC1.5 Success:** a routine serialized with a prescribed weight and parsed
  back yields the same value, asserted in `roundtrip.test.ts` alongside the existing `reps: 0`
  case.
- **routine-import-export.AC1.6 Structural:** `serializeRoutine`'s routine-exercise parameter is
  the shared `RoutineExerciseRow` type, not the inline object literal it declares today
  (`serialize.ts:261-272`). This is the drift hazard `coach-prescribed-weights` logged and left.
- **routine-import-export.AC1.7 Failure:** a routine exercise whose `notes` is the real Hevy
  sentence `"↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8"` survives `serializeRoutine` →
  `parseRoutine` **intact**. Today it does not: `formatFlags` emits `@<notes>` and `parseFlags`
  splits the flag string on `/\s+/`, so the hint becomes `"↑"` and every remaining word is
  silently discarded as an unknown non-flag token (`format.ts:225-241`).
  *Discrimination: the fixture note must contain a space. Every existing hint fixture in the suite
  is single-token, which is exactly why this has never failed — a single-word fixture passes
  against both the broken and the fixed implementation.*
- **routine-import-export.AC1.8 Failure:** a routine exercise whose `notes` contains an `=`
  (`"3x12 = the goal"`) also round-trips intact. Today it throws `ContractError: Unknown flag key`,
  because the tokeniser reaches `the` … `=` … and treats the fragment as a malformed flag.
  *Discrimination: AC1.7's fixture alone cannot catch this — a space-only note fails by truncation,
  an `=`-bearing note fails by exception. Different failure modes, different fixtures.*
- **routine-import-export.AC1.9 Edge:** a routine exercise with no notes emits no `@` token, and a
  note that is only whitespace is treated as absent rather than emitting a bare `@`.

### routine-import-export.AC2: A routine line cannot carry a logged weight

- **routine-import-export.AC2.1 Failure:** `parseRoutine` on a document whose workout line contains
  `weight=60` throws `ContractError`. Today it parses cleanly and yields `weight: 60`
  (`format.ts:203-207`, `parse.ts:171` being the sole `context` consultation).
- **routine-import-export.AC2.2 Success:** `parseSession` on a session line containing `weight=60`
  still succeeds and yields `weight: 60`.
  *Discrimination: AC2.1 alone passes a mutant that removes `weight` from `knownFlags` outright,
  which would break every session export. The pair is what pins the rule to the routine context.*
- **routine-import-export.AC2.3 Failure:** `parseSession` on a session line containing
  `target_weight=61.23` throws `ContractError` — the new flag is routine-only, by the same
  mechanism and in the same direction.

### routine-import-export.AC3: The user can get a file out of the app

- **routine-import-export.AC3.1 Success:** `getRoutineExportName` and `getSessionHistoryExportName`
  (`exportPresenter.ts:11,23`) each produce a filename that survives being written to disk —
  non-empty, `.md`-suffixed, and containing no `/` or `:`.
- **routine-import-export.AC3.2 Failure:** given an `exportSessionHistory` result whose `failures`
  array is non-empty, the pure presenter that builds the export outcome returns a user-facing
  message naming the failure count. A presenter returning only `markdown` fails.
  *Discrimination: the decision must live in a pure `src/state` or `src/export` function so a
  fixture can assert it. Asserting it on the screen is impossible — `src/app` has no jest project —
  and a screen-only implementation would pass every test while silently reinstating the #212 bug.*
- **routine-import-export.AC3.3 Edge:** an export whose `failures` array is empty produces a
  message that does not mention failures.
- **routine-import-export.AC3.4 Structural:** the Settings → Data screen passes `failures` into
  that presenter and renders its output. Verified by reading `src/app/(tabs)/settings/data.tsx`;
  no automated test can reach it.
- **routine-import-export.AC3.5:** *(human-only)* In the simulator, Settings → Data → Export
  Routine opens the iOS share sheet, and "Save to Files" writes a `.md` file whose contents open
  as readable markdown.
- **routine-import-export.AC3.6 Edge:** `Sharing.isAvailableAsync()` returning `false` produces a
  user-visible message rather than a silent no-op; asserted against the pure presenter with an
  injected availability flag.

### routine-import-export.AC4: A markdown routine file round-trips

- **routine-import-export.AC4.1 Success:** the pure import function, given the exact markdown
  `serializeRoutine` emits for a three-exercise routine including one superset pair and one
  prescribed weight, returns `RoutineExerciseEntry[]` whose `exerciseId`, `order`,
  `supersetGroup`, `warmupSets`, `targetSets`, `targetReps`, `restSeconds` and `targetWeightKg`
  match the source routine field for field.
- **routine-import-export.AC4.2 Success:** running that result through `upsertRoutine` against an
  in-memory database and reading the rows back reproduces the original routine, with a new routine
  id.
- **routine-import-export.AC4.3 Edge:** importing a file naming an exercise that does not exist in
  the database creates it, with `id === slugifyTitle(title)`.
- **routine-import-export.AC4.4 Edge:** importing a file naming an exercise that *does* exist, with
  a different `kind`, leaves the stored exercise's `kind`, `title` and `description` unchanged.
  *Discrimination: the fixture must pre-seed the exercise with a differing kind and assert the
  stored row after import. A fixture that seeds a matching exercise cannot fail a mutant that drops
  the create-only guard, because the write would be a no-op — this is the AGENTS.md Boundaries rule
  that "the AI accept path may create exercises but must never mutate existing ones", and the
  importer inherits it.*
- **routine-import-export.AC4.5 Edge:** importing a file whose routine name matches an existing
  routine creates a **second** routine with a fresh `routine-<epoch>` id; the existing routine's
  rows are untouched, including its `routine_exercises` row ids.
  *Discrimination: asserting only "two routines exist" passes a mutant that deletes and recreates
  the first. The row-id assertion is what pins it, and row-id stability is what
  `session_sets.routine_exercise_id` depends on.*
- **routine-import-export.AC4.6 Failure:** importing a malformed document (unknown flag key,
  unparseable `<sets>x<reps>`, missing frontmatter) writes **nothing** to the database and returns
  a named error. Asserted by counting `routines` and `routine_exercises` rows before and after.
- **routine-import-export.AC4.7 Edge:** importing a document whose every entry totals zero planned
  sets is rejected with a distinct error, matching `startSessionFromRoutine`'s existing refusal —
  a routine that cannot be started must not be creatable by import either.
- **routine-import-export.AC4.8 Success:** a document whose superset labels appear on
  non-contiguous lines is rejected. `h.group_end_idx` defines a group as a *contiguous* run, so a
  non-contiguous label is a routine the engine would silently mis-group.
- **routine-import-export.AC4.9:** *(human-only)* In the simulator, Settings → Data → Import
  Routine opens the Files picker, and selecting a previously exported `.md` file produces a routine
  visible and startable on the Routines tab.

### routine-import-export.AC5: A Hevy API routine maps faithfully, and names what it loses

The fixture for AC5.1–AC5.8 is **the real "Push" payload**, checked in verbatim as JSON
(`src/interop/__tests__/fixtures/hevy-push-routine.json`). Using the real payload rather than a
hand-written approximation is what makes several of these discriminating at all — three of the
shapes below were discovered *in* it and would not have appeared in a synthetic fixture.

- **routine-import-export.AC5.1 Success:** mapping the Push payload yields 12 entries whose `order`
  is `0…11` **in Hevy's `index` order**, not sorted by `supersets_id`.
  *Discrimination: Push's superset ids run 5, 6, 7, 4 down the routine, so a mutant that sorts by
  `supersets_id` reorders the last group to the front and this assertion fails. A fixture whose
  group ids happened to ascend could not detect it — this is Findings fact 4, and it is the reason
  the real payload is the fixture.*
- **routine-import-export.AC5.2 Success:** Bench Press maps to `warmupSets: 3, targetSets: 4` —
  counted from `type`, not from `sets.length`.
  *Discrimination: an exercise with both types is required. Every all-`normal` exercise in the
  routine (Chest Fly, Plank, …) passes against a mutant that returns `sets.length` as `targetSets`
  and `0` as `warmupSets`. Bench Press is the only entry in Push that distinguishes them.*
- **routine-import-export.AC5.3 Success:** the three rep shapes each map by the stated rule —
  Bench Press (`rep_range {8,10}`, no `reps`) → `targetReps: 8`; Russian Twist (`reps: 20`, no
  range) → `targetReps: 20`; Dead Bug (`reps: 12` **and** `rep_range {12,12}`) → `targetReps: 12`.
  *Discrimination: Dead Bug alone cannot discriminate the precedence rule, because its two sources
  agree. A fourth synthetic case where they disagree (`reps: 12`, `rep_range {8,10}`) is required
  and is asserted to follow the documented precedence.*
- **routine-import-export.AC5.4 Success:** weights normalise to two-decimal kg —
  `22.67964547178199 → 22.68` — and `formatWeightLbs` renders that as `50lbs`.
  *Discrimination: assert the rendered lbs string, not just the kg. A mutant storing the raw float
  also renders `50lbs`, so the kg assertion is the one that catches it; a mutant that normalises
  via `lbsToKg(kgToLbs(kg))` also gives `22.68` here — that path is separated by AC5.5.*
- **routine-import-export.AC5.5 Edge:** a metric-native input (`weight_kg: 20`) normalises to
  `20`, not `19.96`.
  *Discrimination: this is the only assertion that separates "round kg to 2dp" from "round-trip
  through lbs". Every imperial-native value in Push gives an identical answer under both rules, so
  without a metric fixture the choice is untested. Computed: `lbsToKg(kgToLbs(20)) === 19.96`.*
- **routine-import-export.AC5.6 Edge:** Cycling's `weight_kg: 0` maps to `targetWeightKg:
  undefined`, and the written row's `target_weight_kg` is `null`.
  *Discrimination: asserting `!== 0` passes a mutant emitting `undefined` for every weight. Assert
  Cycling is absent **and** Bench Press is `22.68` in the same test.*
- **routine-import-export.AC5.7 Success:** Push's four superset runs produce `supersetGroup` labels
  that are contiguous in the emitted entry order, and the three distinct groups plus the standalone
  entries are labelled such that `h.group_end_idx`'s contiguity assumption holds.
- **routine-import-export.AC5.8 Failure:** a synthetic payload whose `supersets_id` run is
  **non-contiguous** in `index` order is **rejected** with a named error, and nothing is written.
  *Discrimination: Push contains no such case, so this AC requires a hand-built payload — which is
  the point. Our engine cannot represent a non-contiguous group, so leaving this undefined is how a
  silently mis-grouped routine ships.*
- **routine-import-export.AC5.9 Success:** the mapper returns a structured lossiness report naming,
  for the Push payload: the discarded warmup weight ramp, the collapsed rep ranges, Cycling's
  dropped `distance_meters`, and the dropped `exercise_template_id`s. Asserted by content, not by
  count.
- **routine-import-export.AC5.10 Success:** the Hevy client sends the key in an `api-key` header,
  never in a query string or a URL path, and a non-200 response produces a distinct
  `HevyHttpError` while a thrown `fetch` produces `HevyUnreachable`. Asserted with an injected
  `fetchFn`, mirroring `anthropicClient.ts`.
- **routine-import-export.AC5.11 Failure:** no test, log line, or error message contains the API
  key. A regression test asserts this against a client constructed with a sentinel key, mirroring
  the secret-leak tests in `contextBuilder.test.ts`.
- **routine-import-export.AC5.12:** *(human-only)* In the simulator, entering a real Hevy key lists
  the three real routines, and importing "Push" produces a startable 12-exercise routine whose
  superset grouping matches Hevy's.

### routine-import-export.AC6: Cross-cutting gates

- **routine-import-export.AC6.1:** `npx tsc --noEmit` reports no errors at every phase boundary.
- **routine-import-export.AC6.2:** `npm test` is green at every phase boundary.
- **routine-import-export.AC6.3:** `npm run lint` passes at every phase boundary.
- **routine-import-export.AC6.4 Structural:** AGENTS.md's "The vault markdown contract" section no
  longer says `parse.ts` has no production caller, and its `serializeRoutine`-omits-`target_weight_kg`
  paragraph is rewritten. Both statements become false in Phase 1 and Phase 3 respectively.
- **routine-import-export.AC6.5 Structural:** AGENTS.md's `src/export` entry no longer says "Not
  yet wired to any screen".
- **routine-import-export.AC6.6:** *(human-only)* After the native dependencies land,
  `grep -c ExpoDocumentPicker ios/Podfile.lock` and `grep -c ExpoSharing ios/Podfile.lock` are both
  non-zero, and the app launches on device without `Cannot find native module`.

## Glossary

- **Hevy workout vs. Hevy routine**: a *workout* is a completed session with logged sets; a
  *routine* is a reusable template. The file export contains only the former; the API serves both.
  The whole shape of this design follows from that distinction, and the ticket's wording conflates
  them — it is why Phase 4 reads the API.
- **`@hint` truncation**: `serializeRoutine` writes a routine exercise's `notes` into the hint flag,
  and `parseFlags` tokenises the flag string on whitespace, so a hint is one token. Multi-word notes
  lose everything after the first word; notes containing `=` throw. Fixed in Phase 1 (AC1.7–AC1.9).
- **`target_weight=`**: the new routine-line flag key, carrying kg. Deliberately *not* `weight=`,
  which already means logged kg on a session line — reusing it would create the same overload
  hazard the `<sets>x<reps>` slot already documents, and would be unresolvable by a parser that
  has to read both contexts.
- **`weight=` context leak**: `parseFlags` keeps one global `knownFlags` allowlist for both
  contexts (`format.ts:247`) and `parse.ts` consults its `context` parameter exactly once
  (line 171, the zero-reps rule). A routine line carrying `weight=60` therefore parses today. It
  has never mattered because nothing in production calls `parseRoutine`. Phase 3 makes something
  call it, which converts a documented latent bug into a live one.
- **`RoutineExerciseEntry`** (`repository.ts:1159`): the shape `upsertRoutine` consumes. Both
  importers target this type, and `acceptDraft` (`src/ai/acceptDraft.ts`) is the reference
  implementation of how to reach it safely — create-only exercises, `slugifyTitle` identity, mode
  owning the routine id.
- **`SessionHistoryExport`** (`exportService.ts:90`): `{ markdown, failures }`. Its docstring states
  that a caller writing `markdown` and dropping `failures` "reinstates the bug". Phase 2 is the
  first caller, so Phase 2 is where that sentence is either honoured or falsified.
- **Continuous Native Generation**: `ios/` is generated and gitignored. All three packages this
  design adds are native modules and all land in Phases 2–3 (Phase 4 adds none), and per AGENTS.md
  the failure mode of skipping `npx expo prebuild -p ios --clean` is a crash at launch, not a build
  error.

## Architecture

The hard part of this feature is not file I/O. It is that the app has a complete, tested, symmetric
markdown serializer with **zero production callers**, and this ticket is the event that gives it
callers in both directions at once. Every latent defect in `src/interop` that has been safe to
document and leave becomes reachable in the same change. The phase order is chosen to make those
defects fail loudly in a phase whose only job is the grammar, before any screen depends on them.

### Why markdown, not JSON

Three arguments, in decreasing order of weight.

The serializer already exists and is tested. `serialize.ts`, `parse.ts` and `format.ts` are ~32KB
of code with 59 interop tests, of which 42 involve parsing. A JSON format would be a new
serializer, a new parser, a new symmetry obligation, and a second document format in a repo that
already maintains one.

`parse.ts` was kept alive for exactly this. `remove-vault-sync` states that `src/interop` and
`src/export` survive "so a future Excel-based backup path can build on them without redoing the
parsing and serialization work", and pins `parseRoutine` as a must-survive export by acceptance
criterion (`remove-vault-sync.AC4.2`). #262 then re-confirmed the module as "a maintained
contract, not dead code". Choosing JSON now would mean that two deliberate preservation decisions
bought nothing.

Markdown is the format a human can fix. The realistic failure mode of an import is a file that is
90% right, and a user can open a markdown routine in any text editor and correct the line that
broke. This matters more here than in most apps because the app is local-first and there is no
server-side repair path.

The counter-argument, stated so it is not mistaken for an oversight: markdown carries a real
authoring hazard, because `serialize.ts` and `parse.ts` must be kept symmetric by hand and
`format.ts` is, per `coach-prescribed-weights`, "the most drift-prone file pair in the repo". The
mitigation is that Phase 1 does nothing but move both halves together, and AC1.5 adds the
round-trip assertion in the same phase.

### One new flag key, and why it cannot be `weight=`

`coach-prescribed-weights` enumerated the two options and declined both because nothing executed
the code. Its recorded trigger for revisiting: **"If an export path is ever wired to a screen, the
prescription must be added to the grammar at that time."** This is that time, and the plan already
chose between the options — a distinct key, not an overload — so Phase 1 is executing a decision
rather than making one.

The full symmetric surface, so none of it is missed: `knownFlags` and `parseSingleFlag`
(`format.ts:154-217, 247`), `ParsedFlags` (`format.ts:102`), `WorkoutLine` (`format.ts:30`),
`formatFlags` (`format.ts:269`), the routine-line builder in `serializeRoutine`, and `parse.ts`'s
flag-to-`WorkoutLine` projection.

Units are kg, matching `weight=` and matching storage. This is load-bearing against a rule AGENTS.md
states sharply: there is exactly one write-side lbs→kg conversion, `lbsToKg` in `acceptDraft`, and
"a second conversion site is how a value gets converted twice". A markdown importer reading kg and
writing kg adds no conversion site at all. **The Hevy API path adds none either** — Hevy serves
`weight_kg`, so Phase 4 normalises kg to two decimals (Rule B below) and never converts units. The
CSV path would have needed `lbsToKg`; dropping it removed a conversion site the rule would have had
to accommodate.

### Closing the `weight=` leak is a prerequisite, not a cleanup

Once `parseRoutine` has a production caller, a routine line carrying `weight=60` produces a
`WorkoutLine` with a populated `weight` field that the import mapper must either use or discard.
Using it would write a logged-set weight into a plan column; discarding it silently would drop
data a user reasonably believed was meaningful, since nothing told them the flag was invalid
there. Rejecting it at parse time is the only option that is honest in both directions, and the
mechanism already exists — `parse.ts` takes a `context` parameter and consults it once. This is a
second consultation of the same parameter, not new machinery.

The mirror rule (AC2.3) matters equally: `target_weight=` must be rejected on session lines, or
the two contexts drift apart in the opposite direction and the next reader has to guess which
flags belong where.

### The `@hint` flag cannot hold a sentence

Found while regrounding Phase 4, and it is a live data-loss bug in the round-trip that both Phase 3
and Phase 4 depend on.

`serializeRoutine` puts a routine exercise's `notes` into the hint flag (`serialize.ts:329-331`),
`formatFlags` emits it as `@${hint}` (`format.ts:312-314`), and `parseFlags` tokenises the flag
string by splitting on `/\s+/` (`format.ts:225`). A hint is therefore **one whitespace-delimited
token**. Given the real Hevy note `"↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8"`, the round trip
returns `"↑"`, and every remaining word is dropped on the floor — tokens without an `=` hit the
`continue` at `format.ts:239-241` and vanish silently. Worse, a note containing an `=` throws
`ContractError: Unknown flag key`, because such a token *does* reach the allowlist check.

This has never mattered for the same reason every other `src/interop` defect has never mattered:
nothing in production calls either half. Phase 3 makes `parseRoutine` live and Phase 4 feeds it
prose written by a human in another app, so it has to be fixed in Phase 1 with the rest of the
grammar work. AC1.7–AC1.9 are the criteria, and the discrimination notes there explain why the
existing single-token hint fixtures cannot catch it.

The fix belongs in the grammar, not in the importer. The two workable shapes are moving the hint to
a trailing rest-of-line position (it is already emitted last by `formatFlags`) or quoting it. The
trailing form is simpler and matches what `formatFlags` already does; the implementer should
confirm no other flag can follow it before committing to that.

### Per-exercise notes have a home, and it is not `exercises.description`

Worth stating explicitly because the natural assumption is wrong in a way that would cause real
damage. `routine_exercises` **has its own `notes` column** — `schema.ts:44`,
`{ name: 'notes', type: 'string', isOptional: true }` — carried by `RoutineExerciseEntry.notes`
(`repository.ts:1175`) and written by `upsertRoutine` (`repository.ts:1253`). Hevy's rich
per-exercise notes map straight onto it, one row per row, with no loss.

What must **not** happen is routing them into `exercises.description`. That record is **global and
shared by every routine**, and AGENTS.md's Boundaries make the accept path create-only precisely
so an import cannot rewrite an exercise out from under other routines. Importing Push's Bench Press
note into the shared `bench-press-dumbbell` description would rewrite it for every other routine
using that exercise, and re-importing a second Hevy routine would overwrite it again. The
per-row column avoids the question entirely, and is also the column that already round-trips
through the grammar — once AC1.7 makes that round trip actually work.

### The import write path is `acceptDraft`, restated

`src/ai/acceptDraft.ts` is 63 lines and it is the exact template. It slugifies titles to exercise
ids, queries before creating so an existing exercise is never mutated, mints
`routine-${Date.now()}` in create mode, maps to `RoutineExerciseEntry[]`, and calls `upsertRoutine`
once. A markdown importer differs in precisely one place — the source of the entries — and the Hevy
importer differs in two, adding a mapping step between the API payload and `RoutineExerciseEntry[]`.

Both importers must inherit its create-only exercise rule, which is an AGENTS.md Boundary and not
a stylistic preference: exercises are global and shared by every routine, so an imported file that
re-kinds "Plank" from strength to cardio would silently change every other routine that uses it.
AC4.4 is the criterion, and its discrimination note explains why the obvious fixture cannot detect
the mutant.

Neither importer may use edit mode. An import always mints a new routine id, so a duplicate name
produces a second routine rather than overwriting the first (AC4.5). Overwrite-on-name-match is
the kind of default that is convenient nine times and catastrophic the tenth, and the app has no
undo.

### Weight normalisation: round kg, do not round-trip through pounds

Hevy hands us `22.67964547178199` kg. Storing that float verbatim is wrong — it lands in the DB and
in exported markdown as `target_weight=22.67964547178199`, against an existing convention that
`lbsToKg` rounds to two decimals "so vault markdown keeps readable values"
(`weightUnits.ts:14-22`). So it must be normalised, and there are two candidate rules. They are not
equivalent, and the difference was computed rather than reasoned about:

| Hevy `weight_kg` | A: `lbsToKg(kgToLbs(kg))` | B: round kg to 2dp | Displayed |
|---|---|---|---|
| `22.67964547178199` (50 lb) | `22.68` | `22.68` | `50lbs` |
| `13.607787283069193` (30 lb) | `13.61` | `13.61` | `30lbs` |
| `20` (a metric account) | **`19.96`** | **`20`** | `44lbs` |
| `17.5` (a metric account) | **`17.46`** | **`17.5`** | `38.5lbs` |

**Rule B.** Identical to A for every value in the real payload, and strictly better for a
metric-native Hevy account, where A introduces a silent ~0.05 kg drift for no display benefit —
both render the same pounds. B is one line and has no such failure mode. AC5.5 is the criterion,
and it is the *only* assertion that separates the two, which is why it needs a metric fixture that
the real Push payload does not supply.

Two related notes. The app's `LBS_PER_KG` is the truncated `2.20462`, not the exact
`1/0.45359237`, so Hevy's exact-pound values compute as `50.000059` lb before rounding; the 0.5 lb
rounding step in `kgToLbs` absorbs that entirely, but the mismatch is real and worth knowing about
before anyone tightens the rounding. And **`validateRoutineDraft`'s positive-multiple-of-0.5-lbs
bound does not apply on this path at all**: `validateHalfStepWeight` (`draftSchema.ts:197-209`)
validates `targetWeightLbs` on an *AI draft*, and the importer writes `targetWeightKg` straight
into `RoutineExerciseEntry` → `upsertRoutine`, which enforces no bound. The bound is also
unreachable-by-construction downstream, since `kgToLbs` rounds to the 0.5 grid by definition, so
any stored kg displays on it. The importer should still reject a non-finite or negative
`weight_kg` explicitly rather than relying on that.

### Hevy: what Phase 4 builds

The user chose the API over the CSV, which changes the phase from *deriving a plausible plan out of
past performance* to *reading the actual plan*. That is a substantially better feature and a
slightly smaller one: no CSV tokeniser, no workout-picking UI, no "this is a derivation" caveat.
What it adds is an API key in settings and a network client.

The client follows `src/ai`'s established shape exactly, and that precedent is load-bearing rather
than stylistic: hand-rolled `fetch`, **no SDK**, an injectable `fetchFn` so it tests in the node
jest project, and distinct `HevyUnreachable` vs `HevyHttpError` types for network versus HTTP
failure. The API key joins the existing `bridge_settings` blob alongside `anthropicKey` and
`openaiKey` — **the storage key must not be renamed**, per AGENTS.md, since it holds every user's
existing keys and onboarding state.

Unlike every AI failure in this app, an import failure **must not be swallowed**. The "swallow
everything" rule exists because a workout must never depend on the AI; an import is a deliberate
user action whose only output is the thing that failed, so silence would leave the user staring at
nothing. This matches `exportRoutine`'s reasoning for propagating rather than catching.

Read-only, always: Phase 4 calls `GET /v1/routines` and `GET /v1/routines/{id}` and nothing else.
No `create-*` or `update-*` endpoint is ever called, so an import cannot modify the user's Hevy
account.

### Field mapping, Hevy API → this app

Built from the real Push payload. The CSV columns are gone from this table; that path was not taken.

| Hevy API | This app | Rule | Lossy? |
|---|---|---|---|
| `routine.title` | `routines.name` | Direct | No |
| `exercise.title` | `exercises.id` via `slugifyTitle`, `exercises.title` | Create-only; an existing exercise wins | **Yes** — distinct titles can collide on one slug |
| `exercise_template_id` | *(dropped)* | No column to hold it | **Yes** — a re-import cannot match by Hevy identity, only by slug |
| `exercise.index` | `routine_exercises.order` | Direct. **Never sort by `supersets_id`** | No |
| `supersets_id` | `routine_exercises.superset_group` | Integer stringified; contiguity **verified**, non-contiguous rejected (AC5.8) | No, when accepted |
| `sets[].type == 'warmup'` (count) | `warmup_sets` | Count, not `sets.length` | No |
| `sets[].type == 'normal'` (count) | `target_sets` | Count | No |
| warmup `weight_kg` per set | *(dropped)* | We store a count, Hevy stores a ramp (9.07 → 11.34 → 18.14) | **Yes** — the ramp is unrecoverable |
| `rep_range {start,end}` | `target_reps` | `start`, unless a plain `reps` is also present | **Yes** — the range is destroyed (Open Decision 5) |
| `reps` (no range) | `target_reps` | Direct | No |
| `reps` **and** `rep_range` | `target_reps` | `reps` wins | **Yes** if they disagree; they agree in the real payload |
| normal-set `weight_kg` | `target_weight_kg` | Heaviest normal set, rounded to 2dp (Rule B); `0` → absent | **Yes** — per-set variation collapses |
| `duration_seconds` | `target_duration_seconds` | Direct | No |
| `distance_meters` | *(dropped)* | **Confirmed against `schema.ts:28-45`: `routine_exercises` has no distance column.** Cycling's `2000` is lost | **Yes** |
| `rest_seconds` | `routine_exercises.rest_seconds` | Direct | No |
| `exercise.notes` | `routine_exercises.notes` | Direct — the column exists (`schema.ts:44`). **Not** `exercises.description` | No |
| `routine.created_at` / `updated_at` | *(dropped)* | Our rows get their own timestamps | **Yes**, correctly |
| — | `exercises.kind` | `distance_meters` present → `cardio`; else `strength` | **Yes** — `stretch` is never inferred, so "Stretching" imports as strength-with-duration |

**Exercise identity checks out.** All twelve Push titles slugify cleanly with no intra-routine
collisions — `Bench Press (Dumbbell)` → `bench-press-dumbbell`, `Russian Twist (Weighted)` →
`russian-twist-weighted`; parentheses collapse to hyphens and trailing hyphens are stripped
(`draftSchema.ts:127-133`). Cross-routine sharing works correctly and by design: `Plank` appears in
both Legs and Push under the same template id and produces the same slug, so importing both
routines shares one exercise record. The create-only rule then means the second import will not
overwrite the first's description — correct, and the reason notes must go to the per-row column.

The residual risk is the reverse direction: two *different* Hevy exercises whose titles differ only
in punctuation (`Bench Press - Dumbbell` vs `Bench Press (Dumbbell)`) collapse onto one slug. Not
present in this account, and the create-only rule makes the consequence a shared record rather
than a corrupted one, so it is recorded rather than defended against.

### Native dependencies, and the crash this design is trying not to ship

Three of the four packages are native modules under Expo SDK 57, verified against the versioned
docs:

| Package | Version | Native? | Notes |
|---|---|---|---|
| `expo-file-system` | `~57.0.2` | Yes | v57's primary API is the SDK 54 object API — `File`, `Directory`, `Paths` — not `readAsStringAsync`. The old API survives at `expo-file-system/legacy`. |
| `expo-sharing` | `~57.0.11` | Yes | `shareAsync(url, options)` requires a **local file URI**. |
| `expo-document-picker` | `~57.0.1` | Yes | `getDocumentAsync()` returns `{ canceled: false, assets: DocumentPickerAsset[] }` with `uri`, `name`, `lastModified`, optional `mimeType`/`size`. |
| React Native `Share` | built in | No | Shares a `message` or `url`; the documented surface does not cover local file URIs. |

([document-picker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/),
[filesystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/),
[sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/))

Two corrections to what a reader might expect. **`expo-sharing`'s config plugin is not required to
present a share sheet.** Its `ios.enabled: true` option is documented as adding "a share extension
target to the project" — that is for *receiving* shares into the app, which this design does not
do. The plugin block is omitted. And **`expo-document-picker`'s config plugin is optional**, needed
only for the iCloud container entitlement; a plain Files-app picker needs no `app.json` entry.

**Phase 4 adds no native dependency at all.** Moving it from the CSV to the API removed the only
candidate — a CSV tokeniser was going to be hand-rolled anyway, and the API client uses the
built-in `fetch`, exactly as `src/ai` does. So the prebuild obligation is entirely Phase 2's and
Phase 3's.

The AGENTS.md hazard applies in full and is the reason AC6.6 exists: `ios/` is gitignored and is
not refreshed by `npm run ios`, so these pods will be absent from `Podfile.lock` until
`npx expo prebuild -p ios --clean` runs, and the symptom is `Cannot find native module` at launch —
invisible to `npm test`, `tsc` and `lint`. This is exactly the `expo-audio` incident AGENTS.md
documents.

### Whether this re-litigates #203

It does not, and the distinction is worth stating precisely rather than asserting.

`remove-vault-sync` removed a *transport*: `src/sync/bridgeClient.ts` (HTTP over Tailscale to a
Mac-side Node service), `src/sync/syncService.ts` (an offline queue with `sync_status` flipping),
`settings/bridge.tsx`, and the `baseUrl`/`token` settings fields. Its glossary defines the bridge
as "a separate Mac-side Node/vitest HTTP service, reached over Tailscale". The `importRoutines`
function that died was a method *on that HTTP client* — it pulled from the bridge's `_sync/`
folder. None of that is present here: no external service, no network, no queue, no background
sync, no `sync_status`, no credentials. A user-initiated file picker is a different mechanism
entirely.

More than merely compatible, it is the use the removal anticipated. That plan kept `src/interop`
explicitly — "it is the reusable piece the sync layer was built on top of, not the sync layer
itself" — and pinned `parseRoutine` as a surviving export by acceptance criterion.

**What this design does supersede** — stated so the next reader does not think it was missed. That
plan recorded, as an accepted consequence, that "the AI Coach becomes the sole way to create
routines". Phase 3 ends that. The framing is that the narrowing was a *consequence* of deleting a
transport, not a finding that import is undesirable; nothing in its reasoning argues against
import as such. Two of its acceptance criteria are narrowed with it: `remove-vault-sync.AC2.6`
(the Today tab empty state naming the AI Coach as the only way to create a routine) and
`remove-vault-sync.AC2.7` (no user-visible string in `src/app`/`src/components` contains "vault",
"sync" or "bridge"). AC2.7 survives intact provided this feature's copy says "markdown file" and
never "vault" — which it should anyway, since the vault is gone and the word would mean nothing to
a user. AC2.6's copy is updated in Phase 3.

## Existing Patterns

This design follows patterns already established in the codebase:

- **Pure core, screen holds nothing.** `aiProviderSettings.ts` exists because `src/app` has no jest
  coverage, so the decisions live in testable pure functions and the screen only calls them. Every
  import/export decision here — the failure message, the parse, the Hevy mapping — lives
  in `src/export`, `src/interop`, `src/state` or `src/hevy`, and the screens call in.
- **Resilient but never silent.** `exportSessionHistory` returns `{ markdown, failures }` (#212)
  rather than either throwing on the first bad session or swallowing it. The Hevy import takes the
  same shape: a summary object naming every dropped and lossy field, not a boolean.
- **All-or-nothing where partial is meaningless.** `exportRoutine` propagates rather than catching,
  because a single-item export has no partial to salvage. A single-routine import is the same
  shape, so AC4.6 requires zero writes on a malformed document.
- **Create-only exercise writes.** `acceptDraft.ts:34-38` queries before creating. Both importers
  copy it exactly.
- **Additive symmetric grammar change.** `coach-prescribed-weights` enumerated precisely what a new
  flag key costs across `format.ts`, `serialize.ts` and `parse.ts`; Phase 1 executes that list.
- **A new native module means a prebuild.** The `expo-audio` incident in AGENTS.md is the template
  for AC6.6.

**Divergence:** one, argued above — this design reverses an accepted consequence of
`remove-vault-sync` (the AI Coach as sole routine-authoring path) and narrows two of its acceptance
criteria. It does not reverse that plan's actual decision, and the module it builds on was kept
alive by that same plan for this class of work.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Make the grammar say what a routine means

**Goal:** `target_weight=` exists and round-trips; `weight=` is refused on a routine line and
`target_weight=` on a session line. No screen and no new dependency. `src/interop` and `src/export`
still have no production caller when this phase lands, so nothing outside their own tests can
break.

**Components:**
- `src/interop/format.ts` — add `target_weight` to `knownFlags` (line 247) and a case to
  `parseSingleFlag` rejecting `<= 0` and non-numeric; add `targetWeightKg` to `ParsedFlags` and
  `WorkoutLine`; emit it from `formatFlags`. **The `formatFlags` guard must be `!= null`, not
  `!== undefined`** — WatermelonDB hands unset optional columns to the serializer as `null`, and
  every other optional field in this path already carries that comment.
- `src/interop/parse.ts` — project the flag onto `WorkoutLine`; add the two context rules. This is
  the *second* and *third* consultation of the `context` parameter, which until now is read once
  (line 171).
- `src/interop/serialize.ts` — emit `target_weight=` from `serializeRoutine`, and replace its
  inline routine-exercise parameter shape (lines 261-272) with the shared `RoutineExerciseRow`.
- `src/interop/format.ts` (second change) — **fix the `@hint` tokeniser** so a note can hold a
  sentence. `formatFlags` already emits the hint last, so a trailing rest-of-line form is the
  natural fix; confirm no flag can follow it before committing to that. This is the AC1.7–AC1.9
  work, and it is in Phase 1 rather than Phase 3 because it is a grammar defect, and because
  Phase 4 feeds it multi-sentence prose written in another app.
- `src/export/exportService.ts` — pass `targetWeightKg` through the row-to-serializer mapping,
  normalising `null` to `undefined` as it already does for every other optional column.
- `src/interop/__tests__/roundtrip.test.ts` — the round-trip assertion, next to the existing
  `reps: 0` case.
- `AGENTS.md` — rewrite the paragraph stating that `serializeRoutine` does not emit
  `target_weight_kg` and that extending the grammar needs a distinct flag key. It now does, and it
  is `target_weight=`.

**Dependencies:** None.

**Covers:** `routine-import-export.AC1.1` – `routine-import-export.AC1.9`,
`routine-import-export.AC2.1` – `routine-import-export.AC2.3`

**Done when:** the twelve criteria above pass in `npm test`; `grep -n "target_weight" src/interop/*.ts`
shows the key in `format.ts`, `parse.ts` and `serialize.ts`; a routine note containing spaces **and**
an `=` round-trips intact; `tsc`, `jest` and `lint` are green.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Get a file out

**Goal:** Settings gains a Data screen that exports one routine and the whole session history to
the iOS share sheet. `src/export` gets its first production caller, and `SessionHistoryExport.failures`
gets its first reader.

**Components:**
- `package.json` / `ios/` — add `expo-file-system@~57.0.2` and `expo-sharing@~57.0.11` via
  `npx expo install`, then `npx expo prebuild -p ios --clean`. No `app.json` plugin block for
  `expo-sharing`: its `ios.enabled` option adds a share *extension* for receiving shares, which
  this app does not do.
- `src/export/exportOutcome.ts` (new) — the pure presenter. Takes `{ failures, sharingAvailable }`,
  returns the user-facing message. **This file is the whole reason AC3.2 is testable**; putting the
  branch in the screen would pass every test while reinstating #212.
- `src/app/(tabs)/settings/data.tsx` (new) — writes markdown to `Paths.cache` with `expo-file-system`'s
  object API (`new File(...).write(...)`, not the legacy `writeAsStringAsync`), then
  `Sharing.shareAsync(file.uri)`. Renders `exportOutcome`'s message.
- `src/app/(tabs)/settings/index.tsx` — a third `SectionRow`. **`SectionRow.href` is a union of
  route literals (line 12) and must be widened in this phase**, or the file does not compile. This
  is the phase-greenness trap in this design.
- `src/app/(tabs)/settings/_layout.tsx` — register the route.
- `AGENTS.md` — `src/export` is no longer "Not yet wired to any screen".

**Dependencies:** Phase 1 (the export must emit `target_weight=` before a user can save a file that
omits it and later re-import an incomplete routine).

**Covers:** `routine-import-export.AC3.1` – `routine-import-export.AC3.6`,
`routine-import-export.AC6.5`, `routine-import-export.AC6.6`

**Done when:** AC3.1–AC3.3 and AC3.6 pass in `npm test`; AC3.4 is read and recorded; AC3.5 is
walked in the simulator; `grep -c ExpoSharing ios/Podfile.lock` is non-zero; `tsc`, `jest` and
`lint` are green.

**Note on `tsc`:** adding `/settings/data` will produce a false-positive route error until Metro
regenerates `.expo/types/router.d.ts`. Per AGENTS.md, run the dev server once before treating a
route-shaped `tsc` error as real.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Read our own file back

**Goal:** A markdown routine file picked from the Files app becomes a routine. Export → import
round-trips, and `parse.ts` has a production caller for the first time since #203.

**Components:**
- `package.json` / `ios/` — add `expo-document-picker@~57.0.1`; prebuild again. No config plugin
  (its `app.json` block is only for the iCloud container entitlement).
- `src/interop/importRoutine.ts` (new, pure) — markdown → `{ name, entries: RoutineExerciseEntry[], notes? }`
  or a named error. Owns the contiguity check (AC4.8) and the zero-total check (AC4.7). No DB, no
  file system — it takes a string.
- `src/state/applyRoutineImport.ts` (new) — the DB half: create-only exercises via `slugifyTitle`,
  mint `routine-${Date.now()}`, one `upsertRoutine`. Structurally `acceptDraft` with a different
  entry source. Lives in `src/state` so the node jest project covers it.
- `src/app/(tabs)/settings/data.tsx` — an Import Routine action:
  `DocumentPicker.getDocumentAsync({ type: 'text/markdown', copyToCacheDirectory: true })`, read
  the asset `uri` with `expo-file-system`, call the two functions above.
- `src/app/(tabs)/index.tsx` — the Today tab's no-routines empty state currently names the AI Coach
  as the only way to create a routine (`remove-vault-sync.AC2.6`). It now names two. **Copy must
  not use the word "vault"**, which would break `remove-vault-sync.AC2.7`'s grep.
- `AGENTS.md` — the "no production caller" statement about `parse.ts` (and #262's whole framing of
  it as a contract without callers) becomes false and must be rewritten.

**Dependencies:** Phase 2 (there is nothing to import until the app can export, and both actions
share one screen).

**Covers:** `routine-import-export.AC4.1` – `routine-import-export.AC4.9`,
`routine-import-export.AC6.4`

**Done when:** AC4.1–AC4.8 pass in `npm test`; AC4.9 is walked in the simulator; a routine exported
in Phase 2 and re-imported produces an equal routine; `tsc`, `jest` and `lint` are green.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Import a routine from the Hevy API

**Goal:** The user stores a Hevy API key, sees their real routine list, picks one, reviews a
lossiness summary, and gets a native routine. Read-only against Hevy throughout.

**Components:**
- `src/state/settings.ts` — add `hevyApiKey` to the existing `BridgeSettings` blob. **Do not rename
  the `'bridge_settings'` storage key**; it holds every user's existing API keys and onboarding
  state.
- `src/ai/provider/`-style client at `src/hevy/hevyClient.ts` (new) — `fetch` against
  `api.hevyapp.com` with the key in an **`api-key` header**, injectable `fetchFn`, distinct
  `HevyUnreachable` / `HevyHttpError`. No SDK. **Read the pagination parameter names off the
  Swagger UI in a browser first** — this design could not determine them (see Findings).
- `src/hevy/hevyRoutineMap.ts` (new, pure) — Hevy routine JSON → `{ entries: RoutineExerciseEntry[],
  name, lossiness }`. Owns rep-shape precedence, set-type counting, Rule B weight normalisation,
  the `weight_kg: 0` → absent rule, and the **contiguity check that rejects a non-contiguous
  superset run**. Never sorts by `supersets_id`.
- `jest.config.js` — **add `hevy` to `testMatch`**, or the new directory gets no coverage at all.
  This is the AGENTS.md rule that a new `src/` domain is invisible until it is listed. Alternatively
  place both files under `src/interop/`, which is already covered; the plan prefers the explicit
  `testMatch` edit so the domain boundary stays honest.
- `src/app/(tabs)/settings/data.tsx` — key entry, routine list, lossiness summary shown **before**
  the write, then `upsertRoutine` via Phase 3's `applyRoutineImport`.
- `src/interop/__tests__/fixtures/hevy-push-routine.json` — the real payload, verbatim.

**Dependencies:** Phase 3 (`applyRoutineImport` and the Data screen). Not dependent on Phase 2's
share/file machinery — this phase touches no file system, which is why it adds no native module.

**Leaves `main` green on its own:** it adds a new directory, one settings field (optional, so no
existing construction site breaks), and one screen section. It widens no shared type and changes no
existing signature.

**Covers:** `routine-import-export.AC5.1` – `routine-import-export.AC5.12`

**Done when:** AC5.1–AC5.11 pass in `npm test`; AC5.12 is walked in the simulator against the real
account; `tsc`, `jest` and `lint` are green.
<!-- END_PHASE_4 -->

### AC × phase matrix

| AC | Phase | Evidence |
|---|---|---|
| AC1.1 – AC1.5 | 1 | automated (`src/interop`) |
| AC1.6 | 1 | structural (read `serialize.ts`'s signature) |
| AC1.7 – AC1.9 | 1 | automated (`src/interop`) — the `@hint` fix |
| AC2.1 – AC2.3 | 1 | automated (`src/interop`) |
| AC3.1 – AC3.3, AC3.6 | 2 | automated (`src/export`) |
| AC3.4 | 2 | structural (read `data.tsx`) |
| AC3.5 | 2 | **human — simulator** |
| AC4.1 – AC4.8 | 3 | automated (`src/interop`, `src/state`) |
| AC4.9 | 3 | **human — simulator** |
| AC5.1 – AC5.11 | 4 | automated (`src/hevy`, once added to `testMatch`) |
| AC5.12 | 4 | **human — simulator, real Hevy account** |
| AC6.1 – AC6.3 | **gate on every phase** | automated (`tsc`, `jest`, `lint`) |
| AC6.4 | 3 | structural (read AGENTS.md) |
| AC6.5, AC6.6 | 2 | AC6.5 structural; AC6.6 **human — device/simulator** |

**Totals: 45 criteria — 37 automated, 4 structural, 4 human.** (AC1: 9, AC2: 3, AC3: 6, AC4: 9,
AC5: 12, AC6: 6.)

The human count did not rise when Phase 4 grew from 9 criteria to 12: moving to the API replaced a
file-shaped feature with a data-shaped one, and pure mapping code is fixture-testable in a way that
CSV-file handling was not.

Every AC belongs to exactly one phase's *Covers* list, with one deliberate exception: AC6.1–AC6.3
are per-phase **gates**, not deliverables of any single phase, so they appear in every phase's
*Done when* rather than in one *Covers*. A phase that leaves `tsc` broken is not done, whichever
phase it is.

**Consequence sweep.** Three pieces of work are consequences of one phase but land in another
phase's files, and are assigned deliberately:

- **Widening `SectionRow.href`** (`settings/index.tsx:12`) is a consequence of Phase 2 adding a
  route and lands in a file Phase 2 does not otherwise own. Assigned to **Phase 2**, because the
  union is a closed literal type and the new screen does not compile without it — splitting them
  leaves `main` red.
- **The Today-tab empty-state copy** (`src/app/(tabs)/index.tsx`) is a consequence of Phase 3
  making import real, and lands in a screen otherwise untouched by this design. Assigned to
  **Phase 3**, because between Phase 3 landing and the copy changing, the app would tell the user a
  falsehood about its own capabilities.
- **`exportService.ts`'s `targetWeightKg` pass-through** is a consequence of Phase 1's grammar
  change but lands in `src/export`, which is otherwise Phase 2's territory. Assigned to **Phase 1**,
  because `serializeRoutine`'s parameter type widens in Phase 1 and its only caller must widen with
  it or `tsc` fails.
- **`jest.config.js`'s `testMatch`** must gain `hevy` in **Phase 4**, in the same commit that
  creates `src/hevy/`. A new `src/` domain is invisible to the runner until it is listed, so
  splitting these would land eleven passing-in-principle tests that never execute — the worst
  possible failure mode, because the suite stays green.

## Additional Considerations

**The ticket's premise did not survive research, and the resolution was to change the mechanism,
not the goal.** "It should be able to import what hevy exports" assumed the export includes
routines. It does not. Rather than ship a routine *derived* from past workouts and call it an
import, Phase 4 now reads the API, which returns the actual plan. The user's goal — "get my Hevy
routines onto my phone without retyping them" — is met more completely than the literal ticket
would have managed.

**One consequence of that switch worth stating plainly:** Phase 4 now requires a live Hevy Pro
subscription to be useful at all. That is fine for this user (access is confirmed) but it means the
feature is not exercisable by anyone else, including a future contributor without a Hevy account.
The checked-in real payload fixture is what keeps Phase 4 maintainable regardless — it is the only
artifact that lets someone without Hevy Pro modify the mapper with confidence.

**Three native modules land across two phases, and none of them can fail in CI.** `ios/` is
gitignored, `npm test` runs in node, and there is no CI job running `tsc`. The entire defence
against the `Cannot find native module` crash is AC6.6 and the discipline of prebuilding. Anyone
picking up Phase 2 or Phase 4 from a fresh checkout must prebuild before running, not after the
app dies at launch.

**`src/interop` stops being safe to leave alone.** Today its defects are documented and harmless
because nothing executes it. After Phase 3, `parse.ts` is on the path from a user-chosen file to
`upsertRoutine`, and every parser bug is a data bug. Two AGENTS.md paragraphs — #262's "maintained
contract, not dead code" framing and the `serializeRoutine`-omits-`target_weight_kg` note — become
false and are rewritten in the phases that falsify them (AC6.4). A third statement, that the
"session sets only" restriction on `weight=` is "a comment, not a rule", becomes false in Phase 1.

**Test coverage is genuinely good for this feature, and that is unusual here.** Everything
load-bearing is pure: parsing, serializing, mapping and the failure-message decision all live in
`src/interop`, `src/export`, `src/state` and (once listed) `src/hevy`. Only four of forty-five
criteria need a human. That is a deliberate consequence of putting the `exportOutcome` presenter in
`src/export` rather than in the screen — the single design choice that moves AC3.2 from
unverifiable to automated.

**A precision note on what "no coverage" means here.** AGENTS.md says layout in
`src/components`/`src/app` "is invisible to every suite". The conclusion is right and the stated
reason is not: `jest.config.js:12` *does* list `components` in `testMatch`. The actual constraint is
narrower — the pattern is `**/*.test.ts`, not `.test.tsx`, so JSX components cannot be tested there
at all, and in practice only two non-JSX files are covered (`src/components/restAlert.test.ts`,
`timerSoundPlayer.test.ts`). `src/app` is genuinely absent from the list. Nothing in this design
depends on the difference, but a reader planning where to put testable logic should know that
adding a `src/components` helper *is* coverable if it is plain TS.

**What the four human criteria cost.** AC5.12 needs the real Hevy account, but the risk it carries
is much lower than in the previous revision: access is confirmed, and the mapping is pinned by the
real payload as a checked-in fixture, so the simulator pass is confirming integration rather than
discovering the data model. The one genuinely unresolved item Phase 4 must settle before writing
code is the pagination parameter naming (Findings), which needs a browser and five minutes.

## Open decisions

### Resolved

**1. ~~Which weight columns does the Hevy CSV export contain?~~ — resolved by obsolescence.**
Retained rather than deleted, because the reasoning still matters. The question was whether the CSV
carries `weight_lbs`, `weight_kg`, or both, since a real 2025 sample showed only imperial columns
while a converter's docs claimed both with auto-detection. It also asked whether a routines export
had appeared since those sources. **Both are now moot: Phase 4 reads the API, not the file.** The
API is unambiguous — `weight_kg` only, as a float. Had decision 2 gone the other way, this would
have been a blocking prerequisite, and Findings keeps the evidence so a future CSV path does not
have to redo it.

**2. CSV, API, or workout history? — resolved: the API.** Phase 4 reads `GET /v1/routines`. Access
is confirmed against the real account, so the Hevy Pro prerequisite is satisfied and is not a
project risk. The two rejected options: deriving a routine from a past workout would have shipped a
guess dressed as an import, and importing history into `session_sets` remains a genuinely large
separate project (every imported set needs a `routine_exercise_id` referencing a row no foreign
workout has) whose value is mostly charts the app does not yet draw. Neither should block routine
import; both can be their own card later.

**3. Separate PRs? — resolved: all four phases, as planned.**

**4. Entry point? — resolved: Settings → Data**, for both export and import. A per-routine export
button on the routine detail screen stays available as a later additive change.

### Still open

**5. When Hevy gives a rep *range*, which end becomes our single `targetReps`?**
This is the one genuinely lossy mapping decision left, and it is user-visible on every imported
strength exercise. Push's real ranges are `{8,10}`, `{10,12}`, `{12,15}` — so the choice changes
what the session screen shows as the target on most sets. Three input shapes occur in one routine
and the rule must cover all of them: `rep_range` alone, plain `reps` alone (Russian Twist: 20), and
both together (Dead Bug: `reps: 12` with `rep_range {12,12}`, which agree).
*Options:* (a) **`rep_range.start`** — the floor; "8" for a `{8,10}` range. Conservative: the
number you have committed to hitting on every set; (b) **`rep_range.end`** — the ceiling; "10".
Aspirational: the number that triggers a load increase in most progression schemes; (c) **the
midpoint, rounded** — "9". Splits the difference and matches neither end of how anyone actually
programs.
**Recommendation: (a) `rep_range.start`, with `reps` taking precedence when both are present.**
The floor is the commitment, and undershooting a target reads as a miss while overshooting reads as
a good day — better to render the number you must hit. It also degrades more gracefully: the
SetLogger prefills reps from history anyway, so `targetReps` is mostly a display target, and a low
one is less likely to be quietly wrong. (c) is not recommended — it invents a number that appears
nowhere in the source. Whichever you pick, AC5.3 pins it with a fixture where the two sources
disagree, so changing your mind later is a one-line change with a failing test to guide it.

**6. What should a non-contiguous Hevy superset do?**
Our engine requires a superset group to be a **contiguous** run of entries (convention 9;
`h.group_end_idx` depends on it). Every group in the real Push routine is contiguous, so this may
never fire — but leaving it undefined is how a silently mis-grouped routine ships, and this is the
highest-risk item in Phase 4.
*Options:* (a) **reject the whole import** with a named error; (b) **drop the offending group to
standalone entries** and report it; (c) **reorder** the entries to make the group contiguous.
**Recommendation: (a) reject.** It is what AC5.8 specifies. (c) silently rewrites the user's
routine order, which is exactly the class of surprise the export/import path should never produce.
(b) is defensible and is the natural fallback if (a) ever proves annoying in practice — but since
the case is not known to occur at all, failing loudly the first time it does is worth more than
guessing correctly. Easy to soften to (b) later; hard to notice if (b) is wrong from the start.
