---
name: discriminating-test-fixtures
description: Use when writing an acceptance criterion or a test fixture, or when reviewing a plan's ACs before code exists - catches the dominant defect class where a criterion names a condition its own fixture cannot distinguish, so the test passes and the behaviour it names is not pinned.
---

# Writing Fixtures That Can Discriminate

## Overview

The dominant defect class in reviewed multi-phase work is **an acceptance
criterion naming a condition its prescribed fixture cannot discriminate.** The
AC looks covered. A test gets written. It passes. The behaviour it names is not
pinned.

On one five-phase feature, this single class accounted for six findings — every
instance authored into the *plan*, not introduced by an implementor.

| Criterion says | Fixture used | Mutant that survived |
|---|---|---|
| "never `null` **or `0`**" | only `null` | drop the `> 0` guard |
| per-entity isolation | one entity | delete the `WHERE parent_id = ?` filter |
| "off the **0.5** grid" | `185.3` | loosen to a **quarter**-pound grid |
| validation per item | single-item payload | scope the guard to `items[0]` |
| "an entry with **no** prescription" | prescribed + `null` | `if (x != null)` → renders `@ 0` |

The 0.5-grid one is the sharpest. `185.3` is off the 0.5, 0.25 *and* 0.1 grids,
so it only proved "rejects an arbitrary decimal" — while quarter-pounds provably
break the round-trip the bound exists to protect (`185.25 → 84.03kg → 185.5`).
All 514 tests passed with the guard loosened.

## The check

**Name the condition the fixture does not discriminate, then WRITE the mutant
that would survive, and RUN it.**

Naming alone is insufficient, and there is proof: an implementor ran the naming
check, produced an audit, reported "✓ None identified" for all three of their
ACs, and two had gaps.

A fixture in the wrong *layer* reads as complete until you try to break it. One
zero-value fixture existed, but sat in a pass-through presenter where `0` and
`null` cannot behave differently — and was absent from the render guard where it
would have discriminated.

See `running-mutation-tests` for how to run that mutant without producing a
false reading.

## Generalisations worth applying as their own tests

- **A single-entity fixture cannot test a selection, isolation, or iteration
  predicate.** Anything filtered or keyed needs ≥2 entities with **colliding**
  values on whatever the result is keyed or ordered by. Non-colliding values
  pass against the unfiltered mutant too.
- **A boundary needs a legal-adjacent value**, not merely an invalid one. Ask:
  what is the nearest *wrong* value this fixture would still accept?
- **An AC naming two conditions needs both exercised.**
- **A fixture carrying two fields where only one is under test never exercises
  the other branch alone.** One fixture had reps *and* weight, so the reps
  branch set the flag first and the weight branch was never reached in
  isolation.
- **A manual-QA criterion whose setup guarantees the failure mode cannot occur
  proves nothing.** One scenario told the tester to build history first, when
  the bug only fires with none.

## Write the AC by naming the wrong implementation it must kill

A reviewer noticed one phase's ACs were markedly stronger than the next's and
diagnosed why: the strong ones read as though written by mutating the
implementation and asking what survives — each **names the wrong implementation
it kills**. The weak ones described a happy path. In the weak phase, the two
criteria written mutation-first were its two strongest.

```
Weak:   "The prefill uses the prescribed weight when one exists."
Strong: "Deleting the `> 0` guard must fail this test — a prescription of 0
         must be treated as absent, not as a prescribed zero."
```

## Front-load the audit

Auditing later phases' ACs **before any code existed** found five more
non-discriminating criteria plus five cross-cutting gaps — far cheaper than the
review round each of the earlier phases cost.

Audit the criteria as soon as the plan is written, not as the code lands.

## Rationalizations

| Thought | Reality |
|---|---|
| "The AC names the condition, so it's covered" | Naming is not discriminating. Write the mutant |
| "I audited and found none" | So did the implementor who had two gaps. Did you *run* a mutant? |
| "The fixture value is clearly invalid" | Invalid ≠ legal-adjacent. What is the nearest wrong value it still accepts? |
| "There's a test for the zero case" | In which layer? A pass-through cannot distinguish `0` from `null` |
| "One entity is enough to test the filter" | It passes against the filter-deleted mutant too |

## Common mistakes

| Mistake | Consequence |
|---|---|
| Arbitrary decimal for a grid boundary | Only proves "rejects a decimal"; the real grid can be loosened |
| Single entity for an isolation predicate | The filter can be deleted with tests green |
| Fixture with two live fields, one under test | The second branch is never reached alone |
| Auditing ACs after implementation | Pays a full review round per phase instead |
