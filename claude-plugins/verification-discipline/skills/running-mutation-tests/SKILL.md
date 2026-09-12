---
name: running-mutation-tests
description: Use when running mutation testing or hand-crafting mutants to check test coverage - a mis-anchored or non-compiling mutant produces a "survivor" indistinguishable from a real coverage gap, so verify the mutation applied and still compiles before trusting any result.
---

# Running Mutation Tests Without False Readings

## Overview

Mutation testing is the only thing that reliably catches a fixture that cannot
discriminate the condition it names (see `discriminating-test-fixtures`). But
**a mutant that did not really apply produces a "survivor" indistinguishable
from a genuine gap.**

Three false readings were produced in a single session this way:

1. **Duplicated anchor.** Replacing a two-line string with `replace(old, new, 1)`
   silently hit the *first* of six identical occurrences in the file — the wrong
   function entirely. Reported to the user as "confirmed real gap." It was not.
2. **Invalid syntax.** Dropping `value <= 0 || ` left `... || || ...`, so most
   suites failed to load. Jest reported `103 tests` instead of `514` — the run
   looked green-ish and meant nothing.
3. **Wrong scope.** A harness piped jest into `tail`, masking the exit code, and
   labelled **all 20 mutants "SURVIVED."** Another scoped the run to two files
   while the killing tests lived in a third.

## The protocol — every mutation, no exceptions

- **Assert the anchor occurs exactly once** (`orig.count(old) == 1`), or target
  by **line number** after checking that line's content. A bare
  `replace(..., 1)` on a common pattern is the trap.
- **Re-read the file and assert it actually changed** before running.
- **Run `tsc --noEmit`.** A non-compiling mutant is not a survivor — discard it
  and say so.
- **Capture the test runner's exit code directly** (`spawnSync`), never through
  a pipe.
- **Run against the full suite**, never a scoped subset.
- **Count a failed *suite* as a kill, not just a failed test.** Many mutations
  break a module at import time; the runner then reports
  `Test Suites: 6 failed` with `Tests: 2226 passed, 0 failed`. A detector
  parsing only the `Tests:` line scores every one a survivor.

## Reporting

Report a **kill rate over the defined scope**, plus an explicit **anchor-miss
count** (normally 0; alarming otherwise), and classify survivors into **three**
buckets:

- **real gap** — the code is genuinely not covered
- **no-op** — the mutation does not change behaviour at this site
- **equivalent mutant** — provably undetectable by any test

The distinction is the whole point of the anchor-miss count: it separates *"my
harness did nothing"* from *"the code isn't covered."*

**Agents routinely misuse the term.** One reported "anchor-miss count: 1" to
describe a mutant that applied correctly and was killed by exactly one test —
which is the opposite (a strength of that test).

## Equivalent mutants are real and must not be "fixed"

One confirmed case: `if (contributed)` → `Object.keys(prefill).length > 0`
survives, because inside that block `prefill` is written only where `contributed`
is set. A 1,880-fixture differential harness confirmed it.

**Keep the original spelling anyway** — it stays correct if the write is ever
moved.

Note that the *other* spelling of the same "defect"
(`prefill.reps !== undefined || prefill.weightLbs !== undefined`) **is** killed
at that site, because a third field is neither of those. Nominally-equivalent
forms can have different blast radii at the same site, so test the exact
spelling you are claiming about.

## A harness drifts

Re-derive anchors every round. After two fix rounds, **12 of 26 mutants had
become no-ops** because their anchor strings no longer existed in the file.

## Verifying a fix takes three checks, not one

1. The target mutants now die.
2. The rest of the suite still passes.
3. **The known equivalent mutant still survives.**

The third catches a "fix" that over-fits by adopting the very shape the bug came
from.

## Quick reference

| Before running | Command |
|---|---|
| Anchor is unique | `grep -c '<anchor>' <file>` → must be 1 |
| Mutation applied | Re-read the file; diff it |
| Mutant compiles | `npx tsc --noEmit` |
| Result is real | Exit code from `spawnSync`, full suite, `Test Suites:` parsed |

## Rationalizations

| Thought | Reality |
|---|---|
| "It survived, so there's a gap" | Or the anchor missed, or it did not compile. Check both first |
| "The suite was mostly green" | A load failure looks green-ish. Compare the *test count* to a clean run |
| "It's equivalent" | Did you measure it, or does "equivalent" mean "not tested"? |
| "I'll reuse last round's anchors" | Half of them are no-ops by now |
| "Scoping to the changed files is faster" | The killing test often lives elsewhere |
