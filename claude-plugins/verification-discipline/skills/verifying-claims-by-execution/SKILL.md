---
name: verifying-claims-by-execution
description: Use before writing any claim about an artifact into a plan, review, PR body, or completion report - counts, greps, "X reads only A and B", "pushed", "all references updated" - because a claim about an artifact reads downstream as a measurement and nobody re-checks it.
---

# Verifying Claims by Execution

## Overview

**A claim about an artifact reads downstream as a measurement.** Nobody
re-checks it, and the cost of a wrong one compounds: it gets relayed, planned
against, and built on.

Every claim in the table below was cheap to check and expensive to inherit.
All of them shipped.

| Claim | Reality |
|---|---|
| A grep that "returns nothing but the call site" | Rewritten three times, never run. The call site contained none of the grepped strings, so the expected output was impossible in every version |
| "17 + 13 mutants" | The source has two tables saying different things. **Five** figures circulated: 13, 22, 27, 37, 38 |
| "Commit `9cebd5a` pushed" | Existed locally, on **no** remote branch |
| "Kill rate 4/4 (100%)" | A rate over the mutants the author *chose to run* — 14 of 37 |
| "This mutant is equivalent" | Measured dead three times. "Equivalent" was being used to mean "not tested" — the opposite |
| "All references updated" | Three files still carried the removed field |
| "73 tests" / "17 tests" | 88 and 6 |
| "X reads only fields A, B, C" | Disproved in about a minute by handing X a distinct marker per field |

## The rule

**If a statement could be produced by running something, run it before writing
it down.**

`git show origin/main:<file>` is usually enough. An "expected: nothing" grep
that has never been executed is an unverified claim, not a criterion.

## Specific checks that keep paying

- **Run every structural grep against real source before writing its expected
  output.**
- **After any report of a push, check `git ls-remote --heads origin <branch>`.**
  The object may exist locally, or in a shared worktree object store, with no
  branch pointing at it.
- **A rate is over the defined scope, never over what was run.** Demand
  `killed / <scope>`, with skipped and non-applying cases counted separately —
  and check the report's own arithmetic. Bucket list lengths repeatedly disagree
  with their stated counts.
- **Verify one load-bearing claim per report, preferring a number.** Test counts
  cost seconds. In one audit, three of six wrong claims were counts, and *every
  single check of this kind found something*.
- **To test "X reads only A, B, C", hand X a distinct marker in every field and
  see which markers reach the output.** Do not grep for it. A prose claim of
  this shape was disproved this way in about a minute, after surviving two
  rounds of review that used grep.
- **When a source is internally inconsistent, write the discrepancy into the
  document** rather than resolving it invisibly. An unexplained number invites
  the next reader to re-derive it and get a sixth answer.
- **When plan and code disagree, decide on the merits.** Twice the plan was
  wrong and the implementation right. An agent once "fixed" such a mismatch by
  weakening the design to match the code, silently deleting a guard.

## Verifying the claim that was made hides the claims that were not

This is the subtle one, and it defeats careful people.

A phase report gave one emphatic, checkable number: removing a particular gate
fails 18 tests. It was re-run, confirmed at 18, and the gate was read as
thoroughly covered. Review then found it was covered against exactly **one** of
three cases — widening the gate to either other case stayed green. Meanwhile the
scope the ticket had *expanded* carried **zero** assertions. Kill rate on that
phase was 32%, down from 90%.

**A confident, verifiable headline number is exactly what makes the unexamined
surface invisible.** A verified claim feels like coverage; it is coverage of one
assertion.

The countermeasure: **derive what *should* have been claimed from the ticket's
own scope before reading the report, then check for the absences.** Compare the
report against the ticket, never against itself.

## Rationalizations that mean you are about to ship a wrong claim

| Thought | Reality |
|---|---|
| "This grep obviously returns nothing" | Then it costs two seconds to prove. Unrun greps are wrong at a startling rate |
| "I checked via the tool" | Not the same claim as "I checked the artifact". See `capturing-api-ground-truth` |
| "The number came from the plan" | The plan's number is also a claim. Re-derive it |
| "It's just a completion report" | Completion reports are what the next person plans against |
| "I'm confident" | Every claim in the table above was written confidently |

## Common mistakes

| Mistake | Fix |
|---|---|
| Writing expected grep output from reasoning | Run it against real source first |
| Relaying a count from another report | Open the source and re-derive it |
| Reporting a rate over what you ran | Report over the defined scope |
| Checking the report's internal consistency | Check it against the ticket's scope |
| Resolving a contradictory source silently | Write the discrepancy down |
