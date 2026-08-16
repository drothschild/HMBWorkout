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
lacked since #203. Third, **the Hevy path imports workout *history*, and derives a routine from a
past workout as a separate, explicitly-labelled act** — because that is the only shape the
available data supports, and pretending otherwise would ship a feature that silently invents the
plan it claims to have imported.

## Findings

Lead finding, stated plainly: **an account-level export from Hevy produces completed workout
history, not routines.**

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
whether a routines export has appeared since these guides were written.** That is Open Decision 1.

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

### Hevy's routine model, grounded against the real API

The Hevy MCP server connected to this session is the authenticated API, not the file export, so it
answers a different question — but it answers it definitively, and it is the right reference for
any future field mapping. A read-only `get-routine` against the user's own "Legs" routine returns
per-set records shaped like this (abridged, real values):

- `title`, `index`, `exercise_template_id`, `notes`, `rest_seconds`, optional `supersets_id`
- `sets[]`, each with `index`, `type` (`"warmup"` | `"normal"`), and optional `weight_kg`,
  `reps`, `rep_range: { start, end }`, `distance_meters`, `duration_seconds`

Four structural facts follow that matter for any mapping. Hevy stores **weight in kg** as a float
(`13.607787283069193` — a 30 lb dumbbell round-tripped), so the API and the CSV disagree about
units. Hevy plans **rep ranges**, not rep targets. Hevy's supersets are an **integer group id on
the exercise**, and in the sampled routine the groups are contiguous runs (indices 2–3 share
`supersets_id: 4`; indices 6–8 share `supersets_id: 3`) but the ids themselves are unordered.
And a Hevy routine holds **one record per planned set**, where our `routine_exercises` row holds
one aggregate plan per exercise.

The API route also has a hard gate: API access requires a **Hevy Pro** subscription, and the key
is minted at `hevy.com/settings?developer`. That is a real alternative to file import and it is
Open Decision 2, but it is not free.

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
5. **A Hevy workout CSV is parsed, and the user is told exactly what it did and did not contain.**
   The import surfaces that the file holds workout history and no routines, and offers to derive a
   routine from one selected past workout as a distinct, labelled action.
6. **`npx tsc --noEmit` is clean, `npm test` is green, and `npm run lint` passes** at every phase
   boundary.

**Out of scope:** the Hevy `/v1/routines` API and any Hevy API key storage; importing Hevy body
measurements; importing session *history* into `session_sets` (only routine derivation is in
scope — see Open Decision 2); a manual routine builder; re-importing our own session-history
markdown; Strong, Fitbod or any other app's format; iCloud or any cloud destination.

## Acceptance Criteria

### routine-import-export.AC1: The grammar carries a prescribed weight, symmetrically

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

### routine-import-export.AC5: A Hevy CSV is read honestly

- **routine-import-export.AC5.1 Success:** the pure Hevy CSV parser, given the published header row
  and the published sample row verbatim (both quoted in Findings), returns one workout titled
  `Thursday- Upper Reps` containing one exercise `Band Pullaparts` with one `normal` set carrying
  `reps: 20`, no weight, and no RPE — i.e. the fixture *is* the real published row, not a
  hand-written approximation. Note that this row has an empty `weight_lbs` and a `duration_seconds`
  of `0`, so it also pins that an absent weight is `undefined` rather than `0`.
- **routine-import-export.AC5.2 Edge:** the parser resolves weight from `weight_kg` when that column
  is present and populated, and from `weight_lbs` via `lbsToKg` when it is not. Fixtures for both
  header shapes.
  *Discrimination: this is the unresolved units discrepancy in Findings. A single-header fixture
  cannot fail a mutant that hardcodes either column.*
- **routine-import-export.AC5.3 Failure:** a CSV with no recognised weight column at all yields a
  named error, not a silent zero.
- **routine-import-export.AC5.4 Success:** the parser reports, as structured data, that the file
  contained N workouts and **zero routines**. The screen renders that count.
- **routine-import-export.AC5.5 Success:** deriving a routine from one parsed workout produces
  `RoutineExerciseEntry[]` where `warmupSets` is the count of that exercise's `warmup` sets,
  `targetSets` is the count of its `normal` sets, and `targetReps` is the modal `reps` across its
  normal sets.
- **routine-import-export.AC5.6 Edge:** a Hevy exercise whose sets carry differing weights derives a
  single `targetWeightKg` from the heaviest normal set, and the derivation is reported as lossy in
  the returned summary.
- **routine-import-export.AC5.7 Edge:** a `superset_id` group whose rows are non-contiguous in the
  CSV is dropped to standalone entries rather than emitted as a broken group, and reported.
- **routine-import-export.AC5.8 Edge:** two Hevy exercises whose titles slugify to the same id
  collapse to one entry, and the collision is named in the returned summary.
- **routine-import-export.AC5.9:** *(human-only)* Importing the user's own real Hevy export in the
  simulator completes without a crash, and the reported workout count matches what Hevy shows.

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
  *routine* is a reusable template. The file export contains only the former. The whole shape of
  this design follows from that distinction, and the ticket's wording conflates them.
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
- **Continuous Native Generation**: `ios/` is generated and gitignored. Three of the four packages
  this design adds are native modules, and per AGENTS.md the failure mode of skipping
  `npx expo prebuild -p ios --clean` is a crash at launch, not a build error.

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
writing kg adds no conversion site at all. The Hevy adapter in Phase 4 genuinely does need one,
because the CSV may speak lbs — it must call the same `lbsToKg` from `src/state/weightUnits`, not
reimplement it.

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

### The import write path is `acceptDraft`, restated

`src/ai/acceptDraft.ts` is 63 lines and it is the exact template. It slugifies titles to exercise
ids, queries before creating so an existing exercise is never mutated, mints
`routine-${Date.now()}` in create mode, maps to `RoutineExerciseEntry[]`, and calls `upsertRoutine`
once. A markdown importer differs in precisely one place — the source of the entries — and a Hevy
importer differs in two, adding a derivation step.

Both importers must inherit its create-only exercise rule, which is an AGENTS.md Boundary and not
a stylistic preference: exercises are global and shared by every routine, so an imported file that
re-kinds "Plank" from strength to cardio would silently change every other routine that uses it.
AC4.4 is the criterion, and its discrimination note explains why the obvious fixture cannot detect
the mutant.

Neither importer may use edit mode. An import always mints a new routine id, so a duplicate name
produces a second routine rather than overwriting the first (AC4.5). Overwrite-on-name-match is
the kind of default that is convenient nine times and catastrophic the tenth, and the app has no
undo.

### Hevy: what can actually be built

Given a CSV of completed workouts, three things are constructible, and they are not equally
honest.

**Import workout history into `session_sets`.** Faithful to the data, and the largest piece of work
in the design — it means synthesising `sessions` and `session_sets` rows for foreign workouts, and
every such set needs a `routine_exercise_id`, a column that references a row no imported workout
has. AGENTS.md's schema-v3 stamp rule means the *set's* identity is its own `exercise_id`, which
helps, but the row reference is not nullable in the current shape. This is out of scope for this
design and is Open Decision 2.

**Derive a routine from one past workout.** Constructible today, small, and directly serves what
the ticket-writer most plausibly wants — "get my Hevy plan into this app". It is honest provided
it is labelled as a derivation: the sets a user *performed* are strong evidence of the plan they
*intended*, but they are not that plan, and warmups, missed sets and improvisation all appear as
plan. This is what Phase 4 builds.

**Nothing at all, and tell the user to use the Hevy API.** The `/v1/routines` endpoint returns the
real routine, `rep_range` and all. It needs Hevy Pro and an API key in settings, which the app
already has a pattern for. Open Decision 2.

The derivation's lossiness is not incidental and must be surfaced rather than absorbed: Hevy plans
rep *ranges* and the app has a single `targetReps`; Hevy carries per-set weights and the app
carries one per entry; Hevy has no exercise `kind`. Each is a named row in the mapping table below
with a named rule, and each rule is reported back to the user in the import summary rather than
applied silently.

### Field mapping, Hevy → this app

Source column names are the CSV's; the API's equivalents are noted where they differ, since a
future API path would map from those instead.

| Hevy (CSV / API) | This app | Rule | Lossy? |
|---|---|---|---|
| `title` / `title` | `routines.name` | Direct | No |
| `exercise_title` / `title` | `exercises.id` via `slugifyTitle`, `exercises.title` | Create-only; existing exercise wins | **Yes** — two titles can collide on one slug (AC5.8) |
| — / `exercise_template_id` | *(dropped)* | No column to hold it | **Yes** — re-import cannot match by Hevy identity |
| row order | `routine_exercises.order` | First appearance of each exercise | No |
| `superset_id` / `supersets_id` | `routine_exercises.superset_group` | Integer stringified; non-contiguous groups dropped (AC5.7) | **Yes** in the non-contiguous case |
| `set_type == 'warmup'` | `warmup_sets` | Count of warmup rows | No |
| `set_type == 'normal'` | `target_sets` | Count of normal rows | No |
| `set_type == 'dropset' \| 'failure'` | *(dropped)* | No app concept | **Yes** — silently absent from the plan; reported |
| `reps` | `target_reps` | Modal reps across normal sets | **Yes** — variable reps collapse to one |
| — / `rep_range {start,end}` | `target_reps` | `start` (the number the set must reach) | **Yes** — the range is destroyed |
| `weight_lbs` / `weight_kg` | `target_weight_kg` | Heaviest normal set; `lbsToKg` if lbs (AC5.2) | **Yes** — per-set variation collapses |
| `duration_seconds` | `target_duration_seconds` | Direct | No |
| `distance_miles` / `distance_meters` | *(dropped)* | `routine_exercises` has no distance column | **Yes** — cardio distance targets are unrepresentable |
| `rpe` | *(dropped)* | RPE is a logged value; routines have no RPE column | **Yes**, correctly — not a plan field |
| `exercise_notes` / `notes` | `routine_exercises.notes` | Direct | No |
| `description` | `routines.notes` | Direct | No |
| `start_time`, `end_time` | *(dropped)* | Routine has no time | **Yes**, correctly |
| — | `exercises.kind` | `distance` present → `cardio`; else `strength` | **Yes** — `stretch` is never inferred |
| — / `rest_seconds` | `routine_exercises.rest_seconds` | Direct from API only | **Yes** — **the CSV has no rest column at all**; derived routines get no rest targets |

Two rows in that table deserve emphasis because they are the ones a reader will assume work. The
CSV carries **no rest interval**, so a routine derived from a CSV has no rest timing — a
noticeable regression against the source app for a user who set rest per exercise. And Hevy's rep
*ranges* exist only in the API; the CSV has logged reps, which is a different thing again.

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
  import/export decision here — the failure message, the parse, the derivation, the mapping — lives
  in `src/export`, `src/interop` or `src/state`, and the screens call in.
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
- `src/export/exportService.ts` — pass `targetWeightKg` through the row-to-serializer mapping,
  normalising `null` to `undefined` as it already does for every other optional column.
- `src/interop/__tests__/roundtrip.test.ts` — the round-trip assertion, next to the existing
  `reps: 0` case.
- `AGENTS.md` — rewrite the paragraph stating that `serializeRoutine` does not emit
  `target_weight_kg` and that extending the grammar needs a distinct flag key. It now does, and it
  is `target_weight=`.

**Dependencies:** None.

**Covers:** `routine-import-export.AC1.1` – `routine-import-export.AC1.6`,
`routine-import-export.AC2.1` – `routine-import-export.AC2.3`

**Done when:** the nine criteria above pass in `npm test`; `grep -n "target_weight" src/interop/*.ts`
shows the key in `format.ts`, `parse.ts` and `serialize.ts`; `tsc`, `jest` and `lint` are green.
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
### Phase 4: Read Hevy's file, and say what it actually contained

**Goal:** A Hevy workout CSV is parsed, the user is told it holds N workouts and zero routines, and
one selected workout can be turned into a routine with every lossy conversion named.

**Gated on Open Decision 2.** If the answer is "use the Hevy API instead", this phase is replaced
rather than amended, and Phases 1–3 stand unchanged. That independence is why it is last.

**Components:**
- `src/interop/hevyCsv.ts` (new, pure) — CSV → `{ workouts, summary }`. Hand-rolled RFC 4180
  parsing (quoted fields containing commas are certain in `exercise_notes` and `description`); **no
  new CSV dependency**, matching the no-SDK precedent in `src/ai`. Detects which weight and
  distance columns are present rather than assuming a header (AC5.2) — the unresolved discrepancy
  in Findings makes a fixed header unsafe.
- `src/interop/hevyRoutine.ts` (new, pure) — one parsed workout → `RoutineExerciseEntry[]` plus a
  lossiness report. Calls `lbsToKg` from `src/state/weightUnits`; does not reimplement it.
- `src/app/(tabs)/settings/data.tsx` — an Import from Hevy action reusing Phase 3's picker with
  `type: 'text/csv'`, a workout list to choose from, and the summary rendered before anything is
  written.
- Test fixtures — the published header and sample row **verbatim** (AC5.1), plus a synthetic
  multi-workout file and a `weight_kg` variant.

**Dependencies:** Phase 3 (reuses the picker, the file read, and `applyRoutineImport`).

**Covers:** `routine-import-export.AC5.1` – `routine-import-export.AC5.9`

**Done when:** AC5.1–AC5.8 pass in `npm test`; AC5.9 is walked against the user's own real export;
`tsc`, `jest` and `lint` are green.
<!-- END_PHASE_4 -->

### AC × phase matrix

| AC | Phase | Evidence |
|---|---|---|
| AC1.1 – AC1.5 | 1 | automated (`src/interop`) |
| AC1.6 | 1 | structural (read `serialize.ts`'s signature) |
| AC2.1 – AC2.3 | 1 | automated (`src/interop`) |
| AC3.1 – AC3.3, AC3.6 | 2 | automated (`src/export`) |
| AC3.4 | 2 | structural (read `data.tsx`) |
| AC3.5 | 2 | **human — simulator** |
| AC4.1 – AC4.8 | 3 | automated (`src/interop`, `src/state`) |
| AC4.9 | 3 | **human — simulator** |
| AC5.1 – AC5.8 | 4 | automated (`src/interop`) |
| AC5.9 | 4 | **human — needs the user's own Hevy export** |
| AC6.1 – AC6.3 | **gate on every phase** | automated (`tsc`, `jest`, `lint`) |
| AC6.4 | 3 | structural (read AGENTS.md) |
| AC6.5, AC6.6 | 2 | AC6.5 structural; AC6.6 **human — device/simulator** |

**Totals: 39 criteria — 31 automated, 4 structural, 4 human.** (AC1: 6, AC2: 3, AC3: 6, AC4: 9,
AC5: 9, AC6: 6.)

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

## Additional Considerations

**The ticket's premise does not survive research, and the plan says so rather than quietly
substituting.** "It should be able to import what hevy exports" was written on the reasonable
assumption that what Hevy exports includes routines. It does not. Phases 1–3 deliver routine
export and import in our own format — real value, and probably most of what was wanted — and Phase
4 delivers the honest version of the Hevy ask. If the author's actual need was "get my Hevy
routines onto my phone without retyping them", the API route in Open Decision 2 serves it better
than any file ever will, and that is worth settling before Phase 4 is built rather than after.

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
load-bearing is pure: parsing, serializing, mapping, deriving, and the failure-message decision all
live in `src/interop`, `src/export` and `src/state`, every one of which is in `jest.config.js`'s
`testMatch`. Only four criteria need a human. That is a deliberate consequence of putting the
`exportOutcome` presenter in `src/export` rather than in the screen — the single design choice that
moves AC3.2 from unverifiable to automated.

**What the four human criteria cost.** AC5.9 in particular cannot be satisfied by anyone but the
user: it needs a real Hevy export from a real account, and the units discrepancy in Findings means
that file is also the only way to settle which weight columns Hevy actually writes today. Obtaining
it early would de-risk Phase 4 substantially and could correct the Findings section before any code
is written.

## Open decisions

**1. Has Hevy shipped a routines export since these sources were written, and which weight columns
does your export actually contain?**
Hevy's own help-centre article is unreadable by automation (403 to WebFetch and Defuddle; a browser
session is redirected to the help-centre root), so every claim in Findings rests on third-party
migration guides that agree with each other but are not primary. Separately, one real 2025 sample
has only `weight_lbs`/`distance_miles` while a converter's docs claim both metric and imperial
columns exist.
*Options:* (a) run the export yourself and attach the header row plus one workout to the issue;
(b) proceed on the third-party sources and let Phase 4 discover the truth.
**Recommendation: (a), and before Phase 4 rather than during it.** It is a two-minute task that
either confirms the design's central finding or invalidates Phase 4 entirely, and it doubles as the
AC5.9 fixture. Phases 1–3 do not depend on the answer and can start immediately.

**2. For Hevy, do you want a routine derived from a past workout, real routines via the Hevy API,
or workout history imported as history?**
These are three different features and only the first is in this plan.
*Options:* (a) **derive a routine from one past workout** — what Phase 4 builds; works from the free
export; honest but lossy, and notably the CSV carries no rest intervals at all; (b) **Hevy API
`/v1/routines`** — returns the real routine including rep ranges and rest, but requires a Hevy Pro
subscription and an API key in settings; (c) **import workout history into `session_sets`** — the
most faithful to the file, and the largest piece of work, because every imported set needs a
`routine_exercise_id` referencing a row no foreign workout has.
**Recommendation: (a) now, and (b) later if you have Pro.** (a) is small, ships on the free tier,
and gets your Hevy plans into the app. (b) is strictly better data but is a different design and
should be its own card. (c) is a large project whose value is mostly historical charts the app does
not yet draw — it should not block routine import.

**3. Should export and import ship as separate PRs, or as one feature?**
*Options:* (a) four PRs as phased above; (b) export-only now, defer import.
**Recommendation: (a).** Each phase is independently mergeable and leaves `main` green, and Phase 2
alone is already useful — it is the first backup path the app has ever had. But (b) is a real
option if Open Decision 2 stalls: Phases 1–2 stand entirely on their own and answer the "export"
half of the ticket without touching Hevy at all.

**4. Where does the entry point live — Settings, or the Routines tab?**
This plan puts both actions on a new Settings → Data screen.
*Options:* (a) Settings → Data for both; (b) export on the routine detail screen where the routine
already is, import on the Routines tab.
**Recommendation: (a) for Phase 2, and add (b)'s per-routine export button later if you find
yourself exporting often.** Settings keeps the first version to one new screen and one new route,
and (b) is additive afterwards. This one is close to a judgement call rather than a real fork, so
it is listed last and no phase depends on the answer.
