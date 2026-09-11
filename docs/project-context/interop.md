> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## The vault markdown contract (`src/interop`)

`format.ts` is the single source of truth for the grammar; `serialize.ts` and
`parse.ts` must stay symmetric. Roundtrip tests enforce this for the value ranges they
exercise — e.g., the test in `roundtrip.test.ts` that serializes a `reps: 0` set
pins the PR #89 regression: a zero-reps guard once rejected the `1x0` lines
`serializeSession` correctly emits for a set logged with zero reps. That guard is
gone entirely (#276 Phase 5 — `1x0` means the same thing in both documents now), but
the regression it caused is still worth a fixture, because "zero is a real
measurement" is a rule the grammar has to keep and a future guard could break again.
Not every value is exercised by existing
fixtures, so test coverage is incomplete by construction; add targeted roundtrip tests
when you discover or fix a case the current suite misses.

**`parse.ts` HAS a production caller now (#267 Phase 2), and the argument that
kept it alive while it did not is worth keeping anyway.** The caller
is `parseRoutine`, reached through `src/interop/importRoutine.ts` from the
Settings → Data screen: a routine markdown file picked out of Files is parsed and
written by `applyRoutineImport`. #262 kept this module deliberately as "a
maintained contract, not dead code" after #203 removed vault import, on the
grounds that a future backup path would want it — this feature is that caller,
and the paragraph that used to open "has no production caller" is now false in
its first clause and still true in everything after it.

What has NOT changed is why the module has to stay in step with the grammar
whether or not anyone calls it. It is still the mechanism that enforces the
symmetry asserted in the paragraph above (delete it and `serialize` can drift
from the grammar with nothing to notice — most of the interop
suite involves parsing, and `parse.ts`'s own header docstring carries the current
count; **re-derive it rather than copying a number into prose, which is how the
figure that stood here — "42 of 59" — went stale unnoticed for a year**), and it is
still the test oracle for the export path, since `exportService.test.ts` verifies
`exportRoutine` by
parsing its output back rather than string-matching. The cost has simply stopped
being hypothetical: a change to `format.ts` or `serialize.ts` that leaves
`parse.ts` behind used to break a test, and now breaks an import.

`parseSession` and `parseFlags` are still callerless. Session *import* is not
part of #267 — the export direction is a backup, not a sync — so do not read
"`parse.ts` has a caller" as covering the whole module.

**That oracle now runs over GENERATED shapes, not chosen ones
(`__tests__/routineLattice.test.ts`, #295).** The same defect shipped four times here
— a fix reaching one of two symmetric paths, green because no fixture exercised the
other (#277/#282, #282 round 2, and both rounds of #276 Phase 5) — and every instance
was found by a reviewer hand-building a probe in a scratch directory. The lattice is
that probe, reduced to 45 shapes and committed: `upsertRoutine` → WatermelonDB →
`exportRoutine` → `parseRoutine`, asserting zero throws and zero mismatches over one
all-fields representative per (kind × set_type), every single-field-only shape, the
contentless set, and the zero-set entry. **Its field axis is read off `databaseSchema`
at run time and matched against the file's own column→value registry, so a new
nullable `routine_sets` column fails the membership test until someone registers it** —
joining coverage by default is the whole point, since each past round's fixtures
covered the fields that round was thinking about. The kind and set-type axes get the
same property from the type checker: both are `Record<Union, …>` literals, so widening
`ExerciseKind` or `RoutineSetType` fails `tsc` there. Two limits worth knowing before
trusting it: it covers the **routine** path only, and it runs through `exportRoutine`,
which normalizes WatermelonDB's nulls at the boundary — so it exercises **no** `!= null`
guard in `serialize.ts`. Those keep their own fixtures in `roundtrip.test.ts` (#289),
and the session path has no lattice at all.

**A line is one set, in both documents.** The `<sets>x<reps>` slot's first number is
always `1` — a routine line prescribes one set and a session line records one logged
set — and a routine entry is a *run of consecutive lines* naming the same exercise,
which `parseRoutine` folds into one entry whose `sets` is the ordered list. That is
what lets a warmup ramp survive the grammar: three warmups at three weights are three
lines, where the old `<target-sets>x<target-reps>` overload collapsed them to the
number 3 and lost the weights.

That overload is **gone** (#276 Phase 5), and with it the grammar's one
context-dependent validation rule. Session lines still expose honest aliases
(`loggedReps`, `loggedDurationSeconds`) — read those, not the `target*` fields, when
consuming a parsed session. The raw first number is `WorkoutLine.setsSlot`, named for
the slot rather than for a plan; it was `targetSets` until Phase 6, which was a lie in
both documents once there was no target set *count* anywhere in the model.
Contract violations throw `ContractError`.

**An entry that prescribes nothing says so, with `sets=0`.** This is the
load-bearing half of the per-set grammar and it is not optional decoration: without
the marker, an exercise line and a content-only set line are the same string, and the
parser has to guess — it threw on the first and silently dropped the second. All five
prescribed fields (reps, `reps_max`, `target_weight`, `duration`, `target_distance`)
are **independently optional** on a routine line, so `- back-squat:` with only a
`rest=` flag is a well-formed prescribed set carrying no numbers. `- back-squat:
sets=0` is the different thing: an entry the routine names and plans nothing for
(engine convention 10). A `sets=0` line may carry the entry-level flags — `rest`,
`superset`, `kind`, `@hint` — and must carry none of the set-level ones; both halves
throw if violated.

**The requirements that read like grammar rules are the SESSION's alone.** A
cardio or stretch *session* line may not carry a sets×reps slot, and a strength
*session* line must carry reps or a duration. Neither applies to a routine line,
where every field is independently optional — a coach may name an exercise and
prescribe no numbers at all. The cardio/stretch sets-slot prohibition in particular
is session-only, and a round-1 fix that stated it generally is the reason this
sentence is here.

### Quoted flag values (#277)

**A flag value may be double-quoted, and the line tokenizer is quote-aware.** Before
this, the whole spec after the colon was split on `/\s+/`, so a value was one
whitespace-delimited token by construction — a routine exercise's `notes`, carried in
the `@hint` flag, lost everything after its first word *silently* (unknown non-flag
tokens hit a `continue`), and a note containing `=` was worse: the stray token reached
the `knownFlags` allowlist and threw. Every hint fixture in the suite was a single
token, which is why 59 interop tests never noticed.

`tokenizeFlagString` (`format.ts`) is now the one tokenizer, and `parse.ts` calls it
for the *whole* line spec — before the `<sets>x<reps>` scan, not just for the flag
tail. **That ordering is the load-bearing part**: a note reading `@"3x12 = the goal"`
would otherwise have its `3x12` grabbed as the sets slot. Flags then parse from tokens
(`parseFlagTokens`) simply because the caller already has them — that is *not* a
correctness requirement, and an earlier version of this section said it was.
`tokenizeFlagString(tokens.join(' ')) === tokens` is an identity on tokenizer output
(measured twice: 3,300 inputs in review, 3,402 independently), so `parseFlags(string)`
would behave identically at that call site. `parseFlags` has no production caller; it
is retained as the wrapper that keeps the two entry points symmetric, and
`format.test.ts` exercises it so its body stays mutation-visible.

Four rules that must stay true together:

- **Quoting is emitted only when needed** (`quoteFlagValue`: whitespace, `"`, `\`, or
  empty). A value that used to serialize bare still serializes bare, byte for byte, and
  a hand-authored `@word` keeps its meaning. An unquoted `@progressive overload` still
  means `hint: "progressive"` — that is backward compatibility, not a residual bug.
- **A `"` is significant only in value-opening position** — directly after the `@` of a
  hint, or directly after the *first* `=` of a `key=value` flag. Everywhere else it is
  an ordinary character (`opensQuotedValue`). This is not a refinement, it is what makes
  the previous rule true: a tokenizer that toggled on *any* quote turned an inch mark —
  `@Go 2" deep`, `@Use the 45" band`, unremarkable in a lifting note — into
  `Unterminated quoted value` and made the whole document unparseable, where the old
  whitespace tokenizer had merely truncated at the first space. **The exception, stated
  exactly: a legacy value that itself BEGINS with `"` now reads as a quoted value** —
  differently if its quotes balance, rejected if they do not. That is the entire
  residual; it is pinned by tests in `parse.test.ts` rather than left to be rediscovered.
  Documents the *new* serializer writes cannot exercise any of this, which is why the
  suite could not catch it — the check is to re-serialize with the pre-#277 code and
  parse the result.
- **Escapes inside quotes are `\\` `\"` `\n` `\r`, and nothing else.** An unterminated
  quote or an unrecognized escape throws `ContractError` rather than degrading — both
  mean the serializer wrote something it never writes. Rejected twice, by
  `tokenizeFlagString` and again by `decodeFlagValue`; the layers are tested separately
  or each hides the other's absence.
- **Newlines round-trip; they are not normalized.** `\n` inside a quoted value keeps a
  multi-line note (Hevy has them) intact while guaranteeing no literal newline ever
  appears inside a workout line, so the document stays line-based. A note that is
  *only* whitespace is treated as absent by `serializeRoutine` and emits no `@` at all.

**Both documents are emitted by `formatFlags`, and that is what keeps `superset=`
quoted.** `superset_group` is the session line's only free-text value and had the
identical truncation hazard, but `buildSessionSetLine` used to hand-roll its flag list,
so the routine path's quoting never reached it — the two paths had no shared code to
teach, and `superset='Group One'` truncated to `Group` while silently eating the
`rest=` that followed. It now builds a `ParsedFlags` and hands it to the same
formatter. **Anything a session line needs that a routine line does not belongs in
`formatFlags`, not back in the caller** — `set_type` is the live example: it is emitted
whenever present, `working` included, because a session's set type is a measurement
rather than a plan default, and a routine line never sets the field at all.

Flag order on either line is `formatFlags`'s order as a result: **`sets`, `rest`,
`superset`, `kind`, `duration`, `set_type`, `reps_max`, `target_weight`,
`target_distance`, `rpe`, `weight`, `distance`**, with the `@hint` appended last by
`formatFlags` itself (`format.ts:762-766`, inside the function, before its
`return parts.join(' ')`) — the caller only puts `hint` on the `ParsedFlags` and
forwards the string untouched, which is what the paragraph above is saying when
it says nothing a line needs belongs back in the caller. (This sentence read
"appended by the caller" when it was written, in #276 Phase 6, and contradicted
its own paragraph two sentences earlier.) Parsing is order-insensitive, so the order is a byte-level fact only —
but it is a fact, and the list that stood here was wrong in two ways after #276
Phase 5: it led with `warmup`, **a flag that no longer exists in any allowlist and
that `formatFlags` never emits** (it was the aggregate warmup count, and a routine
line is one set now), and it omitted the four per-set keys entirely. `format.ts`'s
own `parseFlag` docstring still listed `warmup=<n>` too; both are corrected.

### Parse context and what it still decides

`parseWorkoutLine`, `parseFlagTokens` and the internal `parseDoc` take a context
parameter (`'routine' | 'session'`). It is deliberately not exposed on the public API:
`parseRoutine(markdown)` and `parseSession(markdown)` are single-argument wrappers that
each hardcode their own context, so no caller can parse a routine with session
strictness or vice versa.

**The zero-reps divergence it used to exist for is gone.** `3x0` was refused in a
routine ("three sets of nothing") while `1x0` was accepted in a session ("the athlete
performed zero reps"), and that was the single asymmetry the parameter carried. Since
#276 Phase 5 a routine line is one set, so there is no `3x0` to reject and `1x0` means
the same thing in both documents. Zero *sets* (`0x10`) is still refused everywhere —
`serializeSession` hardcodes the slot to literal `1` and can never emit `0x...`, and a
routine says "no sets" with the `sets=0` marker instead.

What the parameter decides today, four places (`parse.ts`, plus one forward):

- **An empty spec is a session error, not a routine one** — a routine line with no
  content after the colon is a prescribed set carrying no numbers.
- **A routine's sets slot must be exactly `1`.** This is the successor to the
  zero-reps rule and it is a routine-only rule for the opposite reason: a session
  line's slot is written by `serializeSession` and cannot be anything else, while a
  hand-authored routine could say `3x8` and mean the old overload.
- **The routine-only branch** that reads the per-set prescription (`reps_max`,
  `target_weight`, `target_distance`, `set_type`, the `sets=0` marker) off the line.
- **`parseDoc` folds consecutive same-exercise routine lines into entries**
  (`groupRoutineSets`); a session's lines stay one-per-logged-set.
- and it is forwarded to `parseFlagTokens`, which is the fifth site and a *flag
  allowlist* rather than a validation rule — see below.

**The flag allowlist is context-aware, and that closed a real leak.** `format.ts`
keeps `SHARED_FLAGS` (`rest`, `superset`, `kind`, `duration`, `set_type`) plus
`SESSION_ONLY_FLAGS` (`rpe`, `weight`, `distance`) and `ROUTINE_ONLY_FLAGS`
(`reps_max`, `target_weight`, `target_distance`, `set_rest`, `sets`), composed into
`KNOWN_FLAGS` per context. `set_rest=` (#281) is a routine set's OWN rest
override and is deliberately DISTINCT from the entry-level `rest=` (a
`SHARED_FLAG`), for the same reason `target_weight=` is not `weight=`: an
overriding set and an inheriting one must stay decidable on the wire. It parses
to `setRestSeconds` on the line and folds into the set's `restSeconds`; `rest=`
stays the entry default. Both round-trip through the #295 lattice, which a new
nullable `routine_sets` column joins automatically. The split is not cosmetic: `weight=` (logged kg) and
`target_weight=` (prescribed kg) are different quantities that were previously
interchangeable on the wire, so a routine line that acquired a `weight=` read as a
*measurement* to anything downstream. This paragraph used to record that leak as open
("the 'session sets only' restriction on `weight=` is a comment, not a rule … a
routine line carrying `weight=60` parses cleanly today"). It is closed; do not
re-derive it from the old wording.

`serializeSession` never emits a *partial* session: every logged set produces a line
or the call throws. That is stronger than it sounds, because the function is driven by
`routineExercises` and a set's row can be missing entirely — `upsertRoutine`'s drop
branch destroys the row when an exercise leaves a routine, while a finished session
keeps its sets. Those orphaned groups are emitted from the
`session_sets.exercise_id` stamp and appended after the row-ordered lines (no row means
no `order` to interleave by), without the row-supplied plan flags `superset`/`rest`,
which died with it. A set with neither a stamp nor a surviving row is genuinely
unidentifiable and throws, so no partial session document is ever produced and the
data stays intact on-device. That guarantee used to stop dead at the caller:
`exportService.exportSessionHistory` caught per session and continued, so the
*aggregate* export was silently short at session granularity — the very failure
this rule prevents at set granularity, one level up. Resolved in #212 by keeping
the resilience and deleting the silence: it returns `SessionHistoryExport`
(`{ markdown, failures }`), skipping a session that cannot be serialized but
naming it in `failures`. For a backup, 47 of 48 sessions beats 0 of 48; what was
wrong was that the caller could not tell. **A UI that writes `markdown` and drops
`failures` on the floor reinstates the bug** — a non-empty `failures` must reach
the user. Do not restore a `continue` on the unresolved-exercise path: silently
skipping a set is the data-loss bug itself.

**A measurement-less set is not refused by the serializer — it is written as an
unparseable line and silently exported, so the shell must not create one. The
guard is `buildLogSetValues`, not the serializer (#288).** `buildSessionSetLine`
states a measurement two ways and only two: `reps` fills the `1x<reps>` slot, and
failing that `durationSeconds` becomes a `duration=` flag. Weight, distance and
rpe are *flags*, not measurements, and none of them makes a line the parser will
take. A set with neither reps nor duration therefore emits
`- bench-press: set_type=working`, which `parseSession` refuses.

**Be precise about what that costs, because the all-or-nothing guarantee two
paragraphs up does not cover it.** That guarantee is scoped to a set whose
*exercise* cannot be resolved — the single `throw` in `buildSessionSetLine`. A
set whose *measurement* is missing has no such guard: `serializeSession` returns
normally, the session lands in the exported document, and `exportSessionHistory`
reports **success** while emitting markdown that violates the grammar. The
failure is a silent bad document, and it surfaces only when something parses it
back. Executed rather than reasoned about: `setInputsSerializerMirror.test.ts`
drives the real serializer and the real parser and pins both halves. A companion
serializer-side `ContractError` would convert that silence into a named failure,
which is what a reader of the all-or-nothing paragraph would assume already
happens; it does not exist yet, and adding it is coupled to the existing rows
below.

Blanking the reps field and tapping Log Set used to write exactly such a set.
`buildLogSetValues` (`src/state/setInputs.ts`) now returns `undefined` —
"nothing to log" — for that case, and the optional return type *is* the
enforcement: `onLogSet` takes a non-optional `SetInputValues`, so `tsc` rejects
an unguarded dispatch at both `.tsx` call sites. `setInputs.callSites.test.ts`
covers the laundering (`!`, `?? {}`, `|| {}`, `as`) that would compile, since
neither screen is jest-renderable, and
`setInputsSerializerMirror.test.ts` is the executable pin that the predicate and
`buildSessionSetLine` still agree. Two rules for anyone editing that predicate:
it compares against `undefined` and never truthiness, because `reps: 0` is a real
logged set of zero repetitions and collapsing it into "absent" reinstates the
PR #89 regression; and it mirrors `buildSessionSetLine`'s own branch exactly, so
a new measurement field (`SetInputValues` has no distance today) must be added to
both or neither. Do **not** move this decision into `validate_set`/`transition.lv`
instead: a blank form field is not a session-flow event, and rejecting it in the
engine surfaces as the session screen's red error banner.

**This guard closes the input door, and the engine boundary was the second
door — now closed too (#305).** `buildLogSetValues` preserves `reps: 0` and
`durationSeconds: 0`; that preservation once ended at `engine/index.ts`'s
`LogSet` conversion, which turned `reps === 0`, `weightKg === 0` and
`durationSeconds === 0` into `undefined` on the way into Rill via three inline
sentinels never in `SENTINEL_TO_OPTION_MAP` — falsifying both convention 8's
"authoritative list" claim and this file's own `1x0`-is-real rule, because such
a set never reached the serializer. #305 routes those three fields through
`toRillOptionalNumber` (only null/undefined → Rill None), so a logged `0` now
survives end to end; `engine/logSetZeroPreservation.test.ts` is the pin.
**Pre-#305 rows on device are not repaired by the fix**: every `reps: 0` and
every `durationSeconds: 0` set logged before it was written as the #288 shape
(neither reps nor duration), and there is no migration and no repair path. Any
repair carries a product decision — writing `reps = 0` invents a measurement,
deleting the row erases the fact that a set happened, and "unknown" has no
representation in the schema — so the fix stops the bleeding without rewriting
history.

`exportRoutine` took the opposite fix, because a single-item export has no
partial to salvage — it renders or it doesn't, so swallowing bought nothing and
cost the user a file that looked like an empty routine. Its blanket `catch` is
gone and failures propagate. "Routine not found" keeps its own distinct `''`,
now decided by an explicit `Q.where('id', ...)` query rather than by catching
`find()`'s rejection. Worth knowing why the two halves differ: `serialize.ts`
has exactly **one** `throw`, on the session path (`buildSessionSetLine`, an
unresolvable set identity). `serializeRoutine` cannot throw at all, so that
`catch` was only ever masking DB-layer errors.

Separately, every flag guard in that same line-building path (both the row-driven and
the orphaned-group path share `buildSessionSetLine`) must check `!= null`, not
`!== undefined`: WatermelonDB returns `null`, not `undefined`, for an unset optional
column, so every optional field read off a DB row — `reps`, `weightKg`, `distanceM`,
`durationSeconds`, `rpe` on `SessionSet`; `restSeconds` on `RoutineExercise`;
`targetReps`, `targetRepsMax`, `targetWeightKg`, `targetDurationSeconds`,
`targetDistanceM` on `RoutineSet` — is subject to it.
`exportService.ts`'s row-to-serializer mapping normalizes the same hazard a second time
at the shell boundary (`?? undefined`, matching its pre-existing `exerciseId` handling);
**keep both layers.** A bad
guard would therefore only become reachable if that mapping ever stopped normalizing — at which
point it writes a `<flag>=null` line straight into the exported document, and nothing
downstream rejects it.

**They do not all fail equally loudly, and that is where #289's fixtures are aimed.**
`weight=null` and `1xnull` are refused on the way back in, so a slip on `weightKg` or
`reps` produces an unreadable document. A slip on `durationSeconds` produces a
readable and wrong one: `null / 60` is `0` in JavaScript, so `formatDuration(null)` is
`0:00` and the line parses cleanly into a zero-second set that was never performed.
Each session guard now has a fixture that reaches its branch **in isolation** — and
the `durationSeconds` one only exists once `reps` is ABSENT, because the reps arm
short-circuits the `else if` above it. The fixture that carried `durationSeconds: null`
*and* `reps: 6` named the condition without being able to distinguish it, which is
exactly why that mutant survived the suite for as long as it did.

**`serializeRoutine` had the same hole on the same field**, and #289 named three
guards only because nobody had mutated the routine path: the routine null fixture
nulls four per-set columns and sets the fifth — `targetDurationSeconds` — to 30. Read
that as the general rule rather than as two anecdotes. `duration=` is the only flag
whose null formats to something the parser *accepts*, so it is the one field where
"the document contains no `null`" is not evidence of anything, on either path. Both
are covered now; a future optional duration-like column needs its own fixture rather
than a place in an all-nulls one.

The `RoutineExercise` half of that list used to be four aggregate plan columns.
They were undeclared at schema v7 (#276 Phase 6), and the four fields that carried
them on `serialize.ts`'s `RoutineExerciseRow` — `warmupSets`, `targetSets`,
`targetReps`, `targetDurationSeconds` — turned out to be read by nothing at all and
went with them.

**That type took three rounds to get right, and the first two rounds are the
lesson.** Phase 5 spotted **two** of the four aggregates, and a fix that named two
would have left two. Phase 6 removed all four and *still* left two more —
`order` and `notes` — which had never been aggregates and were simply never read;
the Phase 6 review found them. The session serializer reads exactly `id`,
`exerciseId`, `supersetGroup` and `restSeconds` off that row and **nothing else**;
`serializeRoutine` takes its own inline row type and is the reader of `notes` (as
`@hint`) and of `sets`. `exportService.ts` no longer maps the two dead fields either.

**The countermeasure, which is what to repeat instead of another grep:** when a
claim takes the form *"X reads only A, B, C"*, execute it — hand X a distinct
marker in every field and see which markers reach the output. This paragraph
itself asserted that the session path read `notes`; a marker disproved it in
about a minute. That probe is now a permanent test
(`src/interop/sessionRowFields.test.ts`), so the type and its readers cannot
drift apart silently a fourth time. Two fields on the *session-row* parameter —
`routineId` and `customSyncStatus` — are also unread and were deliberately left
in place: a workout document that never names its routine reads more like a gap
in the grammar than dead weight, and closing it is a contract change rather than
a sweep. The same test pins them so the distinction does not have to be
rediscovered.

**`upsertRoutine`'s zero-total default is gone, and nothing replaced it at that
layer.** It defaulted `target_sets` to 1 for an entry carrying no counts, so the
engine always had a set to visit, and it was the only enforcing layer. #276 Phase 6
made `RoutineExerciseEntry.sets` **required**: the shape the default caught cannot be
written without an explicit `[]`, and an explicit `[]` is a caller saying "nothing"
rather than a caller forgetting. The rule it enforced survives one layer up, in
`validateRoutineDraft` (`src/ai/draftSchema.ts`), which requires at least one set —
so a coach-authored entry still can never be zero-total, and a routine still always
has exercises that will actually be performed.

A malformed `0x10` line would never reach this layer anyway: `parseWorkoutLine`
rejects zero sets in both contexts, and `3x0` is refused by the routine sets-slot
rule (a routine line's slot must be `1`) rather than by any zero-reps rule — there
are no context-dependent zero rules left. No production *producer* writes such a
line — `serializeRoutine` cannot emit one — but since #267 Phase 2 there is a
production *consumer* that can be handed one: a user can pick any file out of
Files, so `parseRoutine`'s rejections are now a user-facing refusal path rather
than a test-only one. `importRoutine` turns each `ContractError` into a named
`unparseable` result and the screen renders it.

`serializeRoutine` **does** emit a prescribed load, under the distinct key
`target_weight=` (#276 Phase 5). This paragraph used to say the opposite — that the
grammar was deliberately not extended, and that wiring an export path to a screen
would mean *adding* a distinct key rather than reusing `weight=`. The key was added;
it is `target_weight`, it is on `ROUTINE_ONLY_FLAGS`, and `weight=` is on
`SESSION_ONLY_FLAGS`, so the leak that made the distinction urgent is closed by the
allowlist rather than by convention. `target_distance` joined at the same time, and
is a good illustration of why the count matters: the Phase-5 AC said "two new flags",
there were three, and a missing key makes the export drop the value **silently**.

**Both directions of the routine document are now on a user-facing path**, through
the one Settings → Data screen (`src/app/(tabs)/settings/data.tsx`). Out: #267
Phase 1's `exportRoutine`/`exportSessionHistory`, shared as markdown files. In:
#267 Phase 2's `importRoutine` (`src/interop/importRoutine.ts`, pure) →
`applyRoutineImport` (`src/state`, the write). `parseSession` and `parseFlags` are
still callerless; `parseRoutine` is not.

**The routine frontmatter carries a `name:` key (#267 Phase 2), and it is the one
piece of the document that is NOT in the workout block.** The block is exercise
lines, so before this key an exported routine could not round-trip its own name
and a re-import came back called `routine-1755300000000`. It is additive and
header-only: `parseFrontmatter` reads frontmatter as an open
`Record<string, string>`, nothing in `format.ts` knows the key exists, and a
document written before it still imports (`importRoutine` falls back to the `id`).
Two rules the key inherits from that generic reader — **a value must be one line,
and it is split on its FIRST colon**, so `name: Push: Day One` reads whole while a
newline would silently truncate. That is why the routine's own `notes` stays out
of the document rather than joining it: routine notes may be multi-line, and a
frontmatter key would lose everything after the first newline without saying so.
Per-*exercise* notes are unaffected — they ride the `@hint` flag on the line, and
that path is quote-aware (#277).

