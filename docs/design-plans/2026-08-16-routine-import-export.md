# Routine Import/Export Design

Issue: [#267](https://github.com/drothschild/HMBWorkout/issues/267).

> **This is a rewrite (2026-08-18).** The previous version of this file (draft PR
> [#275](https://github.com/drothschild/HMBWorkout/pull/275), branch
> `design/routine-import-export`) was written against the **aggregate** routine model and is now
> stale. [#276](https://github.com/drothschild/HMBWorkout/issues/276) replaced that model with a
> **per-set** one and, in doing so, shipped most of what the old plan proposed as work: the
> `target_weight=` grammar flag, the `@hint`-sentence fix, and a per-set `serializeRoutine` /
> `parseRoutine`. The lossiness the old plan spent its Hevy mapping table cataloguing is **gone** —
> our routine model is now per-set, exactly like Hevy's. What is left is two pieces of glue. This
> rewrite records what already exists (with the file that proves each claim), re-derives the Hevy
> mapping as the near-1:1 it now is, and re-phases the remaining work.

## Summary

The card reads "New Feature: export/import routines. It should be able to import what hevy exports."
The [settled decisions on #267](https://github.com/drothschild/HMBWorkout/issues/267) stand and are
not reopened here: **import from the Hevy API, not the CSV file export** (the file export is
completed-workout history, not routines; the API serves real routines and access is confirmed);
**all phases proceed**; and the **entry point is Settings → Data**.

What changed underneath the card is the data model. When the old plan was written, a routine entry
was an aggregate — one `routine_exercises` row carrying `warmup_sets`, `target_sets`, `target_reps`,
one `target_weight_kg`. #276 replaced that with a `routine_sets` table: one row per prescribed set,
each carrying its own `set_type`, `target_reps`/`target_reps_max`, `target_weight_kg`,
`target_duration_seconds`, `target_distance_m` and (from #281) `rest_seconds`. The grammar, the
serializer and the parser all moved with it. The consequences for this feature are large and all in
the same direction:

1. **The old Phase 1 is done.** `target_weight=`, `reps_max=`, `target_distance=` and `set_rest=`
   are live routine-line flags; the `@hint` truncation is fixed; the `weight=`-leak is closed by a
   context-aware allowlist. `serializeRoutine`/`parseRoutine` exist and are per-set.
2. **The lossiness the old plan documented is gone.** Hevy's warmup ramp (9.07 → 11.34 → 18.14 kg)
   collapsed to a count under the aggregate model; now each set is a row and the ramp survives.
   Rep ranges flattened to one number; now `target_reps` + `target_reps_max` hold both ends.
   `distance_meters` had no column; now `target_distance_m` does. The Hevy → app mapping is
   **near-1:1**.
3. **The remaining work is two pieces of glue**, each of which turns a still-callerless engine into
   a wired feature: **(a)** a Settings → Data screen that calls the existing per-set
   `serializeRoutine`/`exportRoutine` and `parseRoutine`, and **(b)** a pure Hevy-API → per-set
   importer. That is it. There is no grammar phase, no serializer phase, no parser phase — those
   shipped in #276.

The approach is **three independently-mergeable phases**, each leaving `npx tsc --noEmit` clean and
`npm test` green on `main` alone: export a file, import our own file, import from Hevy. Export ships
first — it reads only our own data, and a bad export is a bad file rather than a corrupted database.

## What #276 already delivered

This is the crux of the refresh. For each phase of the old plan, here is its status **today on
`main`**, with the file that proves it.

| Old plan's work | Status | Proof on `main` |
|---|---|---|
| **Phase 1** — add `target_weight=` flag key | **DONE** | `src/interop/format.ts:641` (`target_weight` on `ROUTINE_ONLY_FLAGS`), emitted `serialize.ts:426-428`, parsed `format.ts:582-588` |
| Phase 1 — also needed: `reps_max=`, `target_distance=` | **DONE** (+#281 added `set_rest=`) | `format.ts:640-643` — all four keys on `ROUTINE_ONLY_FLAGS` |
| Phase 1 — the `@hint`-cannot-hold-a-sentence data-loss bug (old AC1.7–AC1.9) | **DONE** (#277/#282) | `quoteFlagValue` (`format.ts:368`), `tokenizeFlagString` (`format.ts:457`); a multi-word, `=`-bearing note round-trips |
| Phase 1 — close the `weight=`-on-a-routine-line leak (old AC2.1–AC2.3) | **DONE** (#276 Phase 5) | context-aware split: `weight=` is `SHARED_FLAG`, `target_weight=` is `ROUTINE_ONLY`; `parse.ts` consults `context` in four places (AGENTS.md "Parse context") |
| Phase 1 — old AC1.6: give `serializeRoutine` a shared row type | **Superseded** | `serialize.ts:308` now takes a per-set inline row type with `sets?: RoutineSetLine[]` and `notes?` — a different shape than the old aggregate literal |
| **Phase 2** — build the serializer / `exportRoutine` | **Serializer DONE, screen NOT** | `serializeRoutine` (`serialize.ts:308`, per-set), `exportRoutine`/`exportSessionHistory` (`exportService.ts`) exist and are lattice-covered; **no screen calls them** |
| **Phase 3** — build the parser / import path | **Parser DONE, screen+glue NOT** | `parseRoutine` (`parse.ts:607`) exists, folds per-set lines into entries (`groupRoutineSets`); **no production caller** (AGENTS.md:603) |
| **Phase 4** — Hevy API importer | **Still needed**, but now near-1:1 | no `src/hevy/` directory exists; mapping is trivial against the per-set model |
| Old Hevy mapping table's four documented losses (warmup ramp, per-set weight, rep range, distance) | **Gone** | per-set `routine_sets` (`schema.ts:65-89`) holds every one of them |

**Net:** the old Phase 1 is entirely delivered. The old Phases 2 and 3 have their engines
delivered and need only screen wiring plus (Phase 3) a small import glue function. The old Phase 4
survives but shrinks to a near-lossless mapping. The refreshed plan is therefore **three phases,
not four**, and none of them is a grammar phase.

## Findings

Every claim here was verified by reading `main` (files cited) or by a read-only Hevy API call.

### The grammar is per-set and complete — verified

`src/interop/format.ts` declares `ROUTINE_ONLY_FLAGS` = `reps_max`, `target_weight`,
`target_distance`, `set_rest` (`format.ts:638-644`), plus a shared allowlist that includes
`weight` and `superset`. A routine document now emits **one line per prescribed set** — the header
docstring's own worked example (`format.ts:16-21`):

```
- bench-press-db: 1x5 rest=2:00 set_type=warmup target_weight=9.07
- bench-press-db: 1x5 rest=2:00 set_type=warmup target_weight=11.34
- bench-press-db: 1x3 rest=2:00 set_type=warmup target_weight=18.14
- bench-press-db: 1x8 rest=2:00 reps_max=10 target_weight=22.68
```

This is the RAMP, in our own grammar, with all three warmup weights distinct — the shape the
aggregate model could not carry.

- **The `@hint` fix is real.** `serializeRoutine` routes `routine_exercises.notes` into the hint
  flag and `format.ts` quotes it via `quoteFlagValue`/`tokenizeFlagString` (`format.ts:368,457`).
  Blank-but-non-empty notes are treated as absent (`serialize.ts:387`, "#277"). A multi-word note
  with an `=` in it round-trips — the old plan's live data-loss bug is closed.
- **The `weight=` leak is closed.** `weight=` (logged kg) and `target_weight=` (prescribed kg) are
  on different allowlists (`format.ts:628-644`), so `parseRoutine` no longer accepts a logged
  weight on a plan line. This was old AC2.1–AC2.3.
- **The `sets=0` entry marker exists.** A prescribed set carrying only flags is byte-identical to a
  bare exercise line, so an entry with no sets emits `sets=0` (`serialize.ts:404-408`) and the
  parser folds set lines back into entries via `groupRoutineSets` (`parse.ts:590`). #267's importer
  inherits this — a detail the old plan predates.

### `serializeRoutine`/`parseRoutine` exist, are per-set, and have no production caller — verified

`serializeRoutine` (`serialize.ts:308`) takes a routine row plus per-entry `sets?: RoutineSetLine[]`
and emits per-set lines. `exportRoutine` (`exportService.ts:52`) assembles that shape from the DB:
it reads `routine_exercises.notes`, and each entry's sets via `getRoutineSets`
(`exportService.ts:47-79`). `parseRoutine` (`parse.ts:607`) parses with `context: 'routine'` and
folds set runs into entries.

**None of them is called from production.** `grep -rn parseRoutine src` outside `src/interop` and
tests returns nothing; `serializeRoutine`'s only caller is `exportService.ts`; and no screen imports
`src/export` (`grep` over `src/app` is empty). AGENTS.md still records this at two sites
(`AGENTS.md:603`, `AGENTS.md:978`). **Wiring these to a screen is exactly what phases 1–2 do, and
what makes those AGENTS.md statements false.** The manager's scoping is correct.

### The per-set columns that make the mapping near-1:1 — verified

`src/db/schema.ts` is at `version: 8`. `routine_exercises` (`schema.ts:27-46`) holds only
per-exercise fields: `superset_group`, `rest_seconds`, `notes`, `order` — the aggregate columns are
gone. `routine_sets` (`schema.ts:65-90`) holds `set_type`, `target_reps`, `target_reps_max`,
`target_weight_kg`, `target_duration_seconds`, `target_distance_m`, `rest_seconds`, `order`. Every
Hevy per-set field now has a column:

- `routine_exercises.notes` **exists** (`schema.ts:34`) — Hevy's rich per-exercise notes land here,
  not on the global shared `exercises.description`. The `RoutineExerciseEntry.notes` field carries
  it (`repository.ts:1109`).
- `target_reps_max` **exists** (`schema.ts:74`) — a rep range is no longer lossy.
- `target_distance_m` **exists** (`schema.ts:81`) — Cycling's `distance_meters: 2000` has a home.
- `routine_sets.rest_seconds` **exists** (`schema.ts:89`, #281) — but Hevy keeps rest per-exercise,
  so the import path uses the entry-level `rest_seconds` and leaves the per-set override for the
  coach (see mapping table).

The importer's target type is `RoutineExerciseEntry` (`repository.ts:1104`), whose `sets` field is
now **required** and is a `RoutineSetEntry[]` (`repository.ts:1129`, each carrying the per-set
fields above). `upsertRoutine` (`repository.ts:1212`) consumes it, reconciling `routine_exercises`
rows in place (preserving row ids that `session_sets.routine_exercise_id` depends on) and replacing
each entry's `routine_sets` wholesale (`replaceRoutineSets`, `repository.ts:1139`). This is the
exact same write path `acceptDraft` uses.

### The one lbs↔kg conversion is at the coach boundary and the import path does not touch it — verified

There is exactly one write-side unit conversion, `lbsToKg` in `acceptDraft.ts:66` (the coach speaks
lbs). Every other `lbsToKg`/`kgToLbs` site is read-side display (`sessionPresenter.ts`,
`setPlanFormat.ts`) or the coach draft schema. **The Hevy API serves `weight_kg` directly and our
column is `target_weight_kg`**, so the importer reads kg and writes kg and adds no conversion site —
it only normalises the float to two decimals (see Rule below). The markdown-import path likewise
reads kg from `target_weight=` and writes kg. This keeps AGENTS.md's "a second conversion site is
how a value gets converted twice" rule intact for free.

### The #295 round-trip lattice already guards serialize↔parse↔DB symmetry — verified

`src/interop/__tests__/routineLattice.test.ts` runs `upsertRoutine → WatermelonDB → exportRoutine →
parseRoutine` over a schema-generated set of storable `routine_sets` shapes, asserting zero throws
and zero mismatches, and **fails `tsc` when a new nullable `routine_sets` column or `ExerciseKind`
/ `RoutineSetType` member is added without registering it** (`routineLattice.test.ts:1-57`). Both
importers in this plan produce `RoutineExerciseEntry[]` for `upsertRoutine`, so the lattice already
covers the DB → export → parse leg for every shape they can produce. **This plan leans on the
lattice rather than re-deriving grammar coverage:** the new ACs assert the *import direction* and
the *screen glue*, and add exactly one round-trip fixture (RAMP) that exercises a real ascending
ramp end-to-end. It does not re-test the serialize/parse symmetry the lattice owns.

### The Hevy "Push" payload, re-fetched against the per-set model — verified live

A read-only `get-routine` on `760bdf23-0a80-4df3-a36d-4af1d55f370b` (12 exercises) returned the
payload below (abridged). Structure: each **exercise** has `title`, `index`, `exercise_template_id`,
`notes`, `rest_seconds`, optional `supersets_id`; each **set** has `index`, `type`
(`"warmup"`|`"normal"`) and optional `weight_kg`, `reps`, `rep_range: {start, end}`,
`distance_meters`, `duration_seconds`.

```json
{ "title": "Bench Press (Dumbbell)", "index": 1, "rest_seconds": 120,
  "notes": "↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8 …",
  "sets": [
    { "index": 0, "type": "warmup", "weight_kg": 9.071858188712795,  "reps": 5, "rep_range": {"start":5,"end":5} },
    { "index": 1, "type": "warmup", "weight_kg": 11.339822735890994, "reps": 5, "rep_range": {"start":5,"end":5} },
    { "index": 2, "type": "warmup", "weight_kg": 18.14371637742559,  "reps": 3, "rep_range": {"start":3,"end":3} },
    { "index": 3, "type": "normal", "weight_kg": 22.67964547178199,  "rep_range": {"start":8,"end":10} }, …×4 ] }
```

Five facts that drive the mapping, each now *cheaper* than under the aggregate model:

1. **`weight_kg` is a float carrying an exact pound value** (`22.67964547178199` = 50 lb to the
   exact `0.45359237` factor). Store rounded to 2dp; **no unit conversion** (kg → kg).
2. **Set `type` maps 1:1**, not by counting. Under the aggregate model the old plan *counted*
   `warmup`/`normal` into `warmupSets`/`targetSets`, discarding each warmup's own weight. Now
   `type: "warmup"` → `routine_sets.set_type = 'warmup'`, one row per set, weight preserved. The
   warmup ramp round-trips. **This is the headline.**
3. **`rep_range {start,end}` maps to two columns.** `{8,10}` → `target_reps: 8, target_reps_max:
   10`. `{5,5}` (a range that is not a range) → `target_reps: 5`, no max — matching the schema's own
   rule that "collapsing that to a bare target_reps is lossless" (`schema.ts:71-73`). Plain `reps`
   with no range (Russian Twist `20`) → `target_reps: 20`. `reps` **and** `rep_range` both present
   and agreeing (Dead Bug `12` + `{12,12}`) → `target_reps: 12`. No loss in any of the four shapes.
4. **`supersets_id` is an arbitrary integer, not ordered** — Push runs id 5, 6, 7, 4 down the
   routine. Every run is **contiguous in `index` order**, which is what engine convention 9 /
   `h.group_end_idx` requires — but **sorting by `supersets_id` would reorder the routine**, and a
   *non-contiguous* Hevy superset is not representable in our engine at all. Map `supersets_id: 5`
   to the string `"5"`; never sort by it; and — per the 2026-08-19 decision, which supersedes this
   paragraph's original "reject a non-contiguous run" — demote a non-contiguous label's members to
   standalone and name the demotion in the lossiness summary. Unchanged hazard from the original
   card; still the highest-risk item.
5. **`weight_kg: 0` and `reps: 0` occur** (Cycling's warmup set: `weight_kg:0, reps:0,
   distance_meters:2000, duration_seconds:300`) and must map to **absent**, not stored zero —
   `computeSetPrefill` treats a non-positive weight as absent, and a routine set with `reps:0` has
   no rep target. Cycling imports as a cardio warmup set carrying distance + duration only.

**Per-exercise `rest_seconds`.** Hevy attaches rest to the *exercise*, not the set (as we do at the
entry level). It maps to `routine_exercises.rest_seconds` directly. Hevy has **no** per-set rest, so
the import path never writes `routine_sets.rest_seconds` — that column stays for coach-authored drop
sets. Agreement, not divergence, but worth stating because #281 made per-set rest possible.

## Definition of Done

1. **The user can get a routine out of the app as a file.** A Settings → Data screen exports one
   routine as per-set markdown through the iOS share sheet, using the existing per-set
   `exportRoutine`. Session-history export is available on the same screen and a non-empty
   `SessionHistoryExport.failures` is rendered, never dropped.
2. **A markdown routine file can be read back in.** A file picked from the Files app is parsed by
   `parseRoutine` and written through `upsertRoutine`, creating missing exercises and never mutating
   existing ones. Export → import round-trips a routine **including a three-weight warmup ramp**.
3. **A Hevy routine is imported from the API**, per-set. The user stores a Hevy API key, picks from
   their real routine list, reviews a lossiness summary naming only the genuine residual losses, and
   gets a native routine whose every set weight, rep range, distance and duration matches Hevy.
4. **`npx tsc --noEmit` is clean, `npm test` is green, and `npm run lint` passes** at every phase
   boundary.
5. **AGENTS.md is corrected** where this feature falsifies it: `parse.ts`/`serializeRoutine`/
   `exportRoutine` no longer "have no production caller", and `src/export` is no longer "not yet
   wired to any screen".

**Out of scope (unchanged from the settled decisions):** the Hevy workout CSV; importing Hevy body
measurements or *workout history* into `session_sets`; writing anything back to Hevy (no `create-*`/
`update-*` call is ever made); Hevy routine *folders*; a manual routine builder; any other app's
format; cloud destinations. **Also out of scope because #276 already did it:** any grammar,
serializer or parser change — those are frozen contracts this feature consumes, not modifies.

## Acceptance Criteria

Fixtures referenced throughout:

- **RAMP** — Bench Press (Dumbbell) from the real Push payload: `warmup 5×9.07`, `warmup 5×11.34`,
  `warmup 3×18.14`, then four `normal 8–10×22.68` kg. *Discriminates because the aggregate model
  could not hold it*: any regression that collapses the three warmups to a count returns fewer than
  seven sets or a single repeated weight. This is the natural discriminator for the whole feature.
- **PUSH** — the full 12-exercise Push payload, checked in verbatim as
  `src/hevy/__tests__/fixtures/hevy-push-routine.json`. Several ACs are discriminating *only*
  against the real payload (its superset ids run 5,6,7,4; its rep shapes vary).
- **NONCONTIG** — a synthetic Hevy payload whose `supersets_id` run is non-contiguous in `index`
  order (`src/hevy/__tests__/fixtures/hevy-noncontiguous-superset.json`). Not present in any real
  routine, which is the point. It carries a second, legitimately contiguous label so the assertion
  can tell "demote the offending group" apart from "drop every superset".
- **DISAGREEING** — a synthetic payload with a set whose `reps` disagrees with its `rep_range`
  (`src/hevy/__tests__/fixtures/hevy-disagreeing-reps.json`). Required because PUSH's Dead Bug
  carries `reps: 12` next to `{12,12}` — the two AGREE, so no assertion on it can pin AC3.3's
  precedence rule. It also carries the metric-native `weight_kg: 20` that AC3.5 needs, since every
  imperial value in PUSH rounds identically under both candidate implementations.

### routine-import-export.AC1: The user can get a file out of the app

- **AC1.1 Success:** `exportRoutine` on a routine containing RAMP emits seven set lines whose
  `target_weight=` values are `9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68` and whose first three
  carry `set_type=warmup`. *Discrimination:* asserting one warmup weight passes a mutant that emits
  a per-exercise weight; the three distinct ascending values are what fail it. (This exercises the
  already-shipped exporter, pinned here because it is the feature's headline invariant.)
- **AC1.2 Success:** a new pure presenter `exportOutcome({ failures, sharingAvailable })`
  (`src/export/exportOutcome.ts`) returns a user-facing message naming the failure count when
  `failures` is non-empty. *Discrimination:* the decision must live in a pure `src/export` function;
  a screen-only implementation passes every test while silently reinstating the #212 bug. A
  presenter returning only `markdown` fails.
- **AC1.3 Edge:** `exportOutcome` with an empty `failures` array returns a message that does not
  mention failures; with `sharingAvailable: false` it returns a message rather than implying a
  silent no-op.
- **AC1.4 Success:** the export filename builder produces a name that survives being written to
  disk — non-empty, `.md`-suffixed, containing no `/` or `:`.
- **AC1.5 Structural:** `src/app/(tabs)/settings/data.tsx` passes `exportService`'s `failures` into
  `exportOutcome` and renders its output; and `settings/index.tsx`'s `SectionRow.href` union is
  widened to include the new route. Verified by reading source — `src/app` has no jest project.
- **AC1.6 Human (simulator):** Settings → Data → Export Routine opens the iOS share sheet, and
  "Save to Files" writes a `.md` file that opens as readable markdown showing per-set lines.

### routine-import-export.AC2: A markdown routine file round-trips

- **AC2.1 Success:** a new pure `importRoutine(markdown)` (`src/interop/importRoutine.ts`), given the
  exact markdown `exportRoutine` emits for RAMP, returns entries whose first entry has **seven**
  `RoutineSetEntry`s with `set_type` `['warmup','warmup','warmup','normal','normal','normal',
  'normal']` and `target_weight_kg` `[9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68]`.
  *Discrimination:* a per-exercise importer returns one weight; the seven distinct-then-repeating
  values fail it. This is the RAMP round-trip the manager flags as the natural discriminator.
- **AC2.2 Success:** running that result through `upsertRoutine` against an in-memory DB and reading
  it back with `getRoutineSets` reproduces RAMP's seven sets in order, with a new `routine-<epoch>`
  id.
- **AC2.3 Edge:** importing a file naming an exercise that does not exist creates it with
  `id === slugifyTitle(title)`; importing one that *does* exist with a different `kind` leaves the
  stored `kind`/`title`/`description` unchanged. *Discrimination:* the fixture must pre-seed the
  exercise with a differing kind and assert the stored row — a matching-kind seed cannot fail a
  mutant that drops the create-only guard, because the write is a no-op. (AGENTS.md Boundaries: the
  accept path may create exercises but never mutate them.)
- **AC2.4 Edge:** importing a document whose routine name matches an existing routine creates a
  **second** routine with a fresh id; the existing routine's `routine_exercises` row ids are
  untouched. *Discrimination:* row-id stability is what `session_sets.routine_exercise_id` depends
  on; "two routines exist" alone passes a delete-and-recreate mutant.
- **AC2.5 Failure:** importing a malformed document (unknown flag key, unparseable `1x<reps>`,
  missing frontmatter) writes **nothing** and returns a named error, asserted by counting
  `routines`/`routine_exercises` rows before and after.
- **AC2.6 Edge:** a document whose superset labels appear on non-contiguous lines is rejected —
  `h.group_end_idx` requires a contiguous run. A document whose every entry has `sets=0` (zero
  total planned) is rejected with the same refusal `startSessionFromRoutine` already makes.
- **AC2.7 Success:** `parseRoutine` gains its first production caller; AGENTS.md's "`parse.ts` has
  no production caller" (`AGENTS.md:603`) and the `AGENTS.md:978` statement are rewritten. Structural.
- **AC2.8 Human (simulator):** Settings → Data → Import Routine opens the Files picker; selecting a
  previously exported `.md` file produces a routine visible and startable on the Routines tab, with
  the warmup ramp intact.

### routine-import-export.AC3: A Hevy API routine maps per-set, faithfully

Fixture for AC3.1–AC3.10 is **PUSH**, checked in verbatim.

- **AC3.1 Success:** mapping PUSH yields 12 entries whose `order` is `0…11` in Hevy's `index` order,
  **never sorted by `supersets_id`**. *Discrimination:* Push's ids run 5,6,7,4, so a sort-by-id
  mutant reorders the last group to the front; a fixture whose ids ascended could not detect it —
  this is why PUSH is the fixture.
- **AC3.2 Success:** **Bench Press maps to seven `RoutineSetEntry`s**, three `set_type: 'warmup'`
  with `target_weight_kg` `[9.07, 11.34, 18.14]` and four `set_type: 'normal'` at `22.68`.
  *Discrimination:* this is the exact case the aggregate model destroyed. A mutant that counts types
  into a per-exercise shape yields one weight; the three distinct warmup weights fail it. RAMP again.
- **AC3.3 Success:** the four rep shapes each map by rule — `{8,10}` → `targetReps 8, targetRepsMax
  10`; `{5,5}` → `targetReps 5`, **no** `targetRepsMax`; plain `reps: 20` → `targetReps 20`; `reps:
  12` **and** `{12,12}` → `targetReps 12`. *Discrimination:* a synthetic set where the two disagree
  (`reps: 12`, `rep_range {8,10}`) is required to pin the precedence, since Dead Bug's two sources
  agree.
- **AC3.4 Edge:** Cycling's warmup set (`weight_kg: 0, reps: 0, distance_meters: 2000,
  duration_seconds: 300`) maps to one `warmup` set with `targetDistanceM: 2000, targetDurationSeconds:
  300` and **no** `targetWeightKg`, **no** `targetReps`. *Discrimination:* assert Cycling's weight
  absent **and** Bench Press's `22.68` present in one test — asserting `!== 0` passes a mutant that
  drops every weight.
- **AC3.5 Success:** weights normalise to 2-decimal kg with **no unit round-trip** —
  `22.67964547178199 → 22.68`, and a metric-native `weight_kg: 20 → 20` (not `19.96`).
  *Discrimination:* the metric case is the only one separating "round kg to 2dp" from "round-trip
  through lbs" (`lbsToKg(kgToLbs(20)) === 19.96`); every imperial value in PUSH agrees under both.
- **AC3.6 Success:** Push's four superset runs produce contiguous `supersetGroup` labels such that
  `h.group_end_idx`'s contiguity assumption holds. **NONCONTIG is IMPORTED, not rejected:** the
  offending label's members are demoted to standalone entries (no `supersetGroup`), every other
  group keeps its grouping, and the demotion is **named in the lossiness summary shown before the
  write**. Entries are **never reordered** to force contiguity. *Discrimination:* NONCONTIG must be
  hand-built because no real routine contains the case — our engine cannot represent a split label,
  so leaving it undefined ships a mis-grouped routine. The order assertion is what separates
  demotion from the forbidden repair: a mapper that reordered would also produce a runnable
  routine and would pass every grouping assertion on its own.

  > **Superseded text, kept so the change is legible.** This AC originally read "**NONCONTIG is
  > rejected** with a named error and nothing is written", and Open Decision 1 below recommended it.
  > **The user settled the decision on 2026-08-19 the other way** (see the issue comment), and the
  > text above is the settled behaviour. An implementer following the original wording would build
  > the wrong thing.
- **AC3.7 Success:** each exercise's `notes` maps to `routine_exercises.notes` (never
  `exercises.description`), each exercise's `rest_seconds` to `routine_exercises.rest_seconds`, and
  **no** `routine_sets.rest_seconds` is written (Hevy has no per-set rest). *Discrimination:* seed a
  shared exercise used by two routines and assert its `description` is unchanged after import.
- **AC3.8 Success:** `kind` is inferred — `distance_meters` present → `cardio`, else `strength`;
  `stretch` is never inferred, so "Stretching" imports as a duration-carrying strength exercise. The
  lossiness report names this and the dropped `exercise_template_id`s **by content, not count**.
- **AC3.9 Success:** the Hevy client sends the key in an `api-key` header, never in a URL/query, and
  a non-200 yields `HevyHttpError` while a thrown `fetch` yields `HevyUnreachable`, asserted with an
  injected `fetchFn` (mirroring `anthropicClient.ts`). No test, log or error contains the key.
- **AC3.10 Human (simulator, real account):** entering a real key lists the three real routines;
  importing "Push" produces a startable 12-exercise routine whose superset grouping and warmup ramp
  match Hevy's.

### routine-import-export.AC4: Cross-cutting gates

- **AC4.1** `npx tsc --noEmit` is clean at every phase boundary.
- **AC4.2** `npm test` is green at every phase boundary.
- **AC4.3** `npm run lint` passes at every phase boundary.
- **AC4.4 Human (device/simulator):** after the native modules land, `grep -c ExpoFileSystem`,
  `grep -c ExpoSharing` and `grep -c ExpoDocumentPicker` in `ios/Podfile.lock` are each non-zero and
  the app launches without `Cannot find native module` — the `expo-audio` incident in AGENTS.md is
  the template.

### AC × phase matrix

| AC | Phase | Evidence |
|---|---|---|
| AC1.1 – AC1.4 | 1 | automated (`src/export`) |
| AC1.5 | 1 | structural (read `data.tsx`, `settings/index.tsx`) |
| AC1.6 | 1 | **human — simulator** |
| AC2.1 – AC2.6 | 2 | automated (`src/interop`, `src/state`) |
| AC2.7 | 2 | structural (read AGENTS.md) |
| AC2.8 | 2 | **human — simulator** |
| AC3.1 – AC3.9 | 3 | automated (`src/hevy`, once on `testMatch`) |
| AC3.10 | 3 | **human — simulator, real Hevy account** |
| AC4.1 – AC4.3 | **gate on every phase** | automated (`tsc`, `jest`, `lint`) |
| AC4.4 | 1 & 2 | **human — device/simulator** (Phase 3 adds no native module) |

Every AC belongs to exactly one phase's *Covers* list, except the per-phase gates AC4.1–AC4.3
(which appear in every phase's *Done when*) and AC4.4 (which fires in the two phases that add native
modules). **Total: 21 criteria — 14 automated, 3 structural, 4 human.** The ratio is good for the
same reason as the old plan: everything load-bearing is pure and lands in jest-covered directories
(`src/interop`, `src/export`, `src/state`, and `src/hevy` once listed).

## Glossary

- **Aggregate model / per-set model** — the pre-#276 shape (one `routine_exercises` row of counts)
  vs. today's (`routine_sets`, one row per prescribed set). The whole reason this file is a rewrite.
- **RAMP** — the ascending warmup sequence (9.07 → 11.34 → 18.14 kg). The one shape the aggregate
  model could not store, and therefore the discriminating fixture throughout.
- **`target_weight=`** — the routine-line flag carrying prescribed kg. Distinct from `weight=`
  (logged kg on a session line). Both live today; the split is enforced by separate allowlists.
- **`RoutineExerciseEntry`** (`repository.ts:1104`) — what `upsertRoutine` consumes; its `sets`
  field is a required `RoutineSetEntry[]`. Both importers target this type.
- **`SessionHistoryExport`** (`exportService.ts`) — `{ markdown, failures }`; a caller that drops
  `failures` reinstates the #212 bug. Phase 1 is the first caller.
- **The lattice** — `routineLattice.test.ts` (#295), the executable serialize↔parse↔DB symmetry
  check this plan leans on instead of re-deriving grammar coverage.

## Architecture

### The feature is glue, because the engine already exists

The old plan's hard part — a symmetric markdown serializer/parser with zero callers — is now
*done*, per-set, and lattice-guarded. What remains is connecting it to a screen in both directions
and adding a mapper for a foreign payload. The phase order makes each connection its own mergeable
step.

### The import write path is `acceptDraft`, restated

`src/ai/acceptDraft.ts` is the reference: slugify titles to exercise ids, query before creating so
an existing exercise is never mutated (AGENTS.md Boundaries — exercises are global and shared), mint
`routine-${Date.now()}` in create mode, build `RoutineExerciseEntry[]` **with per-set `sets`**, call
`upsertRoutine` once. The markdown importer differs only in the source of the entries
(`parseRoutine` output); the Hevy importer differs in one more place (a mapping step). Neither may
use edit mode: an import always mints a new id, so a duplicate name produces a second routine rather
than overwriting (AC2.4). The app has no undo.

### Field mapping, Hevy API → this app (re-derived against the per-set model)

Built from the real PUSH payload. Compare this to the old plan's table, which was a catalogue of
losses; nearly every "Lossy? **Yes**" row is now "No".

| Hevy API | This app | Rule | Lossy? |
|---|---|---|---|
| `routine.title` | `routines.name` | Direct | No |
| `exercise.title` | `exercises.id` via `slugifyTitle`, `exercises.title` | Create-only; existing wins | Only on rare cross-title slug collision |
| `exercise_template_id` | *(dropped)* | No column | **Yes** — re-import matches by slug, not Hevy identity |
| `exercise.index` | `routine_exercises.order` | Direct. **Never sort by `supersets_id`** | No |
| `supersets_id` (int) | `routine_exercises.superset_group` (string) | Stringified; contiguity verified, a non-contiguous label's members demoted to standalone and reported (AC3.6, settled 2026-08-19) | Only for a split label, and named in the summary |
| `set.type` | `routine_sets.set_type` (per set) | `warmup`→`warmup`, `normal`→`normal`, 1:1 | **No** (was Yes — the ramp survives) |
| `set.weight_kg` | `routine_sets.target_weight_kg` (per set) | Round to 2dp; **no unit conversion**; `0` → absent | **No** (was Yes — per-set weights preserved) |
| `set.rep_range {start,end}` | `target_reps` + `target_reps_max` | `start`→reps, `end`→max; `start==end` → reps only | **No** (was Yes — range preserved) |
| `set.reps` (no range) | `target_reps` | Direct; `0` → absent | No |
| `set.reps` **and** `rep_range` | `target_reps` | `reps` wins (they agree in PUSH) | No |
| `set.duration_seconds` | `target_duration_seconds` (per set) | Direct | No |
| `set.distance_meters` | `target_distance_m` (per set) | Direct (`schema.ts:81`) | **No** (was Yes — column now exists) |
| `exercise.rest_seconds` | `routine_exercises.rest_seconds` | Direct (per-exercise, as Hevy stores it) | No |
| `exercise.notes` | `routine_exercises.notes` | Direct (`schema.ts:34`). **Not** `exercises.description` | No |
| `created_at`/`updated_at` | *(dropped)* | Our rows get their own timestamps | Correctly |
| — | `exercises.kind` | `distance_meters` present → `cardio`; else `strength` | Minor — `stretch` never inferred |

The residual losses are: the dropped `exercise_template_id` (re-import matches by slug), `kind`
inference not distinguishing stretch from strength, and the theoretical cross-title slug collision
(not present in this account). The lossiness summary shown before the write names all of them by
content (AC3.8). **Everything the old plan flagged as unrecoverable — the warmup ramp, per-set
weights, rep ranges, distance — now round-trips.**

### Weight normalisation: round kg, do not round-trip through pounds

Hevy hands us `22.67964547178199` kg; store `22.68`. Rounding kg to 2dp is identical to
`lbsToKg(kgToLbs(kg))` for every imperial value in PUSH but strictly better for a metric-native
account, where the round-trip introduces a silent ~0.05 kg drift for no display benefit (AC3.5).
The importer writes `targetWeightKg` straight into `RoutineSetEntry` → `upsertRoutine`, so
`validateRoutineDraft`'s 0.5-lb bound (an AI-draft-only check on `targetWeightLbs`) does not apply;
the importer should still reject a non-finite or negative `weight_kg` explicitly.

### Native dependencies and the crash this design is trying not to ship

`expo-file-system` (~57.0.2) and `expo-sharing` (~57.0.11) land in Phase 1; `expo-document-picker`
(~57.0.1) in Phase 2. **Phase 3 adds none** — the Hevy client uses built-in `fetch`, as `src/ai`
does. All three are native modules under Expo SDK 57 (versioned docs: expo.dev/versions/v57.0.0),
so `ios/` must be regenerated with `npx expo prebuild -p ios --clean` after each lands, or the app
crashes at launch with `Cannot find native module` — invisible to `npm test`/`tsc`/`lint`. AC4.4 is
the guard; the AGENTS.md `expo-audio` incident is the precedent. `expo-sharing`'s config plugin is
**not** needed (its `ios.enabled` adds a *receive* share extension, which this app does not do);
`expo-document-picker`'s plugin is optional (iCloud entitlement only).

### This does not re-litigate #203

#203 removed a *transport* (HTTP over Tailscale, offline queue, `sync_status`, `baseUrl`/`token`). A
user-initiated file picker and a read-only API client share none of it. #203 deliberately kept
`src/interop` "so a future backup path can build on it without redoing the parsing", and #262
re-confirmed `parse.ts` as "a maintained contract, not dead code" — this feature is the caller both
anticipated. It supersedes one recorded consequence ("the AI Coach becomes the sole way to create
routines") and narrows `remove-vault-sync.AC2.6`/`AC2.7`; Phase 2 updates the Today-tab empty-state
copy, keeping it free of the words "vault"/"sync"/"bridge".

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Get a routine out as a file

**Goal:** Settings gains a Data screen that exports one routine (and the session history) to the iOS
share sheet, calling the existing per-set `exportRoutine`. `src/export` gets its first production
caller and `SessionHistoryExport.failures` its first reader.

**Components:**
- `package.json` / `ios/` — `npx expo install expo-file-system expo-sharing`, then
  `npx expo prebuild -p ios --clean`. No `app.json` plugin block for `expo-sharing`.
- `src/export/exportOutcome.ts` (new, pure) — takes `{ failures, sharingAvailable }`, returns the
  user-facing message. The whole reason AC1.2 is testable; putting the branch in the screen would
  pass every test while reinstating #212.
- `src/app/(tabs)/settings/data.tsx` (new) — writes markdown to cache with `expo-file-system`'s
  object API, then `Sharing.shareAsync(uri)`. Renders `exportOutcome`'s message.
- `src/app/(tabs)/settings/index.tsx` — a new `SectionRow`; **widen `SectionRow.href`'s route-literal
  union** or the screen does not compile (the phase-greenness trap).
- `src/app/(tabs)/settings/_layout.tsx` — register the route.
- `AGENTS.md` — `src/export` is no longer "Not yet wired to any screen"; `serializeRoutine`/
  `exportRoutine` are no longer callerless (`parse.ts` still is until Phase 2).

**Dependencies:** none — the grammar, serializer and `exportRoutine` already exist.

**Covers:** AC1.1 – AC1.6, AC4.4 (file-system/sharing pods).

**Done when:** AC1.1–AC1.4 pass in `npm test`; AC1.5 is read and recorded; AC1.6 is walked in the
simulator; `grep -c ExpoSharing ios/Podfile.lock` is non-zero; `tsc`/`jest`/`lint` green. (Note: a
new static route produces a false-positive `tsc` route error until Metro regenerates
`.expo/types/router.d.ts` — per AGENTS.md, run the dev server once before treating it as real.)
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Read our own file back

**Goal:** a markdown routine picked from Files becomes a routine. Export → import round-trips,
**including RAMP**, and `parseRoutine` gets its first production caller since #203.

**Components:**
- `package.json` / `ios/` — `npx expo install expo-document-picker`; prebuild again. No config plugin.
- `src/interop/importRoutine.ts` (new, pure) — markdown → `{ name, notes?, entries:
  RoutineExerciseEntry[] }` or a named error. Converts `parseRoutine`'s per-set entries into
  `RoutineExerciseEntry` with a `sets: RoutineSetEntry[]`; owns the contiguity check and the
  zero-total refusal (AC2.6). No DB, no file system — takes a string.
- `src/state/applyRoutineImport.ts` (new) — the DB half: create-only exercises via `slugifyTitle`,
  mint `routine-${Date.now()}`, one `upsertRoutine`. Structurally `acceptDraft` with a different
  entry source. In `src/state` so the node jest project covers it.
- `src/app/(tabs)/settings/data.tsx` — an Import Routine action:
  `DocumentPicker.getDocumentAsync({ type: 'text/markdown' })`, read the asset with
  `expo-file-system`, call the two functions above.
- `src/app/(tabs)/index.tsx` — the Today-tab empty state now names two ways to create a routine.
  **Copy must not use "vault"** (`remove-vault-sync.AC2.7`).
- `AGENTS.md` — rewrite the "`parse.ts` has no production caller" framing (`:603`, `:978`).

**Dependencies:** Phase 1 (nothing to import until the app can export; both actions share one screen).

**Covers:** AC2.1 – AC2.8, AC4.4 (document-picker pod).

**Done when:** AC2.1–AC2.6 pass in `npm test`; AC2.7 is read and rewritten; AC2.8 is walked in the
simulator; a routine exported in Phase 1 and re-imported is equal, RAMP included; `tsc`/`jest`/`lint`
green.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Import a routine from the Hevy API

**Goal:** the user stores a Hevy API key, sees their real routine list, picks one, reviews a
lossiness summary, and gets a per-set native routine. Read-only against Hevy throughout.

**Components:**
- `src/state/settings.ts` — add `hevyApiKey` to the existing `bridge_settings` blob. **Do not rename
  the storage key** (AGENTS.md — it holds every user's keys and onboarding state).
- `src/hevy/hevyClient.ts` (new) — `fetch` against `api.hevyapp.com` with the key in an **`api-key`
  header**, injectable `fetchFn`, distinct `HevyUnreachable`/`HevyHttpError`, no SDK. **Confirm the
  pagination parameter names against the live spec before writing** — a 400 is the failure mode.
- `src/hevy/hevyRoutineMap.ts` (new, pure) — Hevy routine JSON → `{ name, entries:
  RoutineExerciseEntry[], lossiness }`. Owns the per-set mapping table above: 1:1 set types, 2dp kg
  (no unit conversion), rep-range → `targetReps`+`targetRepsMax`, `0` → absent, `distance_meters` →
  `targetDistanceM`, per-exercise rest → entry rest, `supersets_id` → string label (never sorted),
  and the **contiguity check that demotes a non-contiguous label's members to standalone and names
  the demotion in the lossiness summary** (settled 2026-08-19; never reorder to force contiguity).
- `jest.config.js` — **add `hevy` to `testMatch`** in the same commit that creates `src/hevy/`, or
  the new domain's tests never run (a green-but-uncovered trap). Alternatively place the two files
  under `src/interop/`, which is already covered; the explicit `testMatch` edit is preferred so the
  domain boundary stays honest.
- `src/app/(tabs)/settings/data.tsx` — key entry, routine list, lossiness summary shown **before**
  the write, then `applyRoutineImport` (Phase 2's DB half, reused).
- `src/hevy/__tests__/fixtures/hevy-push-routine.json` — the real payload, verbatim.

**Dependencies:** Phase 2 (`applyRoutineImport` and the Data screen). Adds **no** native module — it
touches no file system and uses built-in `fetch`.

**Leaves `main` green alone:** a new directory, one optional settings field, one screen section. It
widens no shared type and changes no existing signature.

**Covers:** AC3.1 – AC3.10.

**Done when:** AC3.1–AC3.9 pass in `npm test`; AC3.10 is walked in the simulator against the real
account; `tsc`/`jest`/`lint` green.
<!-- END_PHASE_3 -->

## Open decisions

### Resolved by the model change

- **Rep-range mapping (old Open Decision 5) — moot.** The old plan agonised over which end of a
  `rep_range` becomes our single `targetReps`. We now store **both** ends (`target_reps` +
  `target_reps_max`), so the range is preserved and there is no lossy choice to make. The only rule
  the mapper needs is mechanical: `start==end` collapses to a bare `target_reps` (an exact
  prescription, not a range), and a plain `reps` present alongside a range wins — both stated in
  AC3.3 and pinned by a synthetic disagreeing fixture. No decision required.
- **Which CSV weight columns / all-four-phases / entry point** — settled on the issue and unchanged.

### Resolved by the user

1. **What should a non-contiguous Hevy superset do? — SETTLED 2026-08-19: (b) demote and report.**
   Our engine requires a contiguous run (convention 9; `h.group_end_idx`). Every group in the real
   Push routine is contiguous, so this may never fire — but leaving it undefined ships a silently
   mis-grouped routine, and it was the highest-risk item in Phase 3.
   *Options were:* (a) reject the whole import with a named error; (b) drop the offending group to
   standalone entries and report it; (c) reorder entries to make the group contiguous.
   **The plan recommended (a). The user chose (b).** The import succeeds; the offending label's
   members become standalone entries; the demotion is named in the lossiness summary shown *before*
   the write; every other group keeps its grouping. Rationale: a refused import gives the user
   nothing and no path forward, whereas a demoted superset still yields a usable routine — and the
   lossiness summary is already the designed channel for exactly this kind of "we could not
   represent X" disclosure, consistent with AC3.8 naming dropped content by content rather than by
   count.
   **(c) stays rejected.** Silently rewriting the user's routine order is the one surprise an import
   path must never produce. AC3.6 above was rewritten to the settled behaviour and carries the
   superseded text so the change is legible; `hevyRoutineMap.ts` implements it and its suite asserts
   both halves — the demotion, and the unchanged order.

### Still open — needs the user

1. **Does the Settings → Data screen export session history as well as routines, or routines only?**
   The ticket is about routines. `exportSessionHistory` already exists and returns
   `{ markdown, failures }`, so adding a history-export button is nearly free and is the reason
   AC1.2/AC1.3 exist. But it is scope beyond the card's wording.
   **Recommendation: include it** — it costs one button and one call, it exercises the `failures`
   contract the design already has to honour, and a local-first app with no cloud backup benefits
   from a history export. If you'd rather keep Phase 1 strictly to routines, say so and AC1.2/AC1.3
   move to a later additive card (the `exportOutcome` presenter still ships, driven by the routine
   export's own failure surface).

## Existing Patterns

- **Pure core, screen holds nothing.** The failure message, the parse, the Hevy mapping all live in
  `src/export`/`src/interop`/`src/state`/`src/hevy`; the screen calls in. Mirrors
  `aiProviderSettings.ts`.
- **Resilient but never silent.** `exportSessionHistory` returns `{ markdown, failures }` (#212); the
  Hevy import returns a lossiness summary object, not a boolean.
- **All-or-nothing where partial is meaningless.** A single-routine import writes zero rows on a
  malformed document (AC2.5), matching `exportRoutine`'s propagate-don't-catch.
- **Create-only exercise writes.** `acceptDraft.ts` queries before creating; both importers copy it.
- **Lean on the lattice.** `routineLattice.test.ts` (#295) owns serialize↔parse↔DB symmetry; this
  plan adds the import direction and one RAMP round-trip, not a re-derivation of grammar coverage.

**Divergence:** one, argued above — this reverses an accepted consequence of `remove-vault-sync`
(the AI Coach as sole routine-authoring path) and narrows two of its ACs. It does not reverse that
plan's decision, and builds on the module that plan kept alive for exactly this.
