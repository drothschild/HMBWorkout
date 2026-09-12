---
name: writing-structural-criteria
description: Use when a correctness property sits in code no test suite can execute - untested UI directories, dependency arrays, prompt wording, or a provably equivalent mutant - and the only possible criterion is a structural read of the source.
---

# Structural Criteria for Untestable Code

## Overview

Some properties cannot be pinned by any test. Where that is true, **a structural
read of the source is the criterion** — not ceremony, and not a weaker
substitute for a real test.

The proof case: in a codebase whose UI directory has zero test coverage,
**deleting one entry from a `useEffect` dependency array — removing the entire
subscription that makes a feature work — passed all 1,649 tests.**
`react-hooks/exhaustive-deps` cannot flag it either, because the symbol is never
referenced inside the effect body.

Worse than a plain miss: without the subscription the outcome degrades to the
race the counter exists to eliminate, so it behaves **correctly about half the
time**. A hand-tester writes "pass" on a coin flip.

## When a structural criterion is the right answer

- **The file is outside the test runner's reach.** Check the config, don't
  assume — a directory absent from `testMatch` has *zero* coverage, and a green
  run proves nothing about it.
- **The property is an absence or a wiring detail** with no deterministic
  observable signature: a dependency array entry, an import that must not exist,
  a call that must go through a shared helper rather than a local copy.
- **The mutant is provably equivalent** — undetectable by any test, so only a
  structural criterion forbids it (see `running-mutation-tests`).
- **The behaviour is model-dependent.** A prompt-wording fix cannot be proven by
  a test; a test can only pin the wording against drift. The evidence is a live
  run.

## How to write one

Name the identifiers and the exact shape. Compare **as a set**, not with a
containment check.

```
AC6.9: `routineRevision` appears in exactly one dependency array — the prefill
       effect's — and NOT the progression-hint effect's.
```

Then implement the check as a test that reads the source:

```ts
const deps = extractDepsArray(src, 'prefill effect');
expect(new Set(deps)).toEqual(
  new Set(['sessionId', 'exerciseIndex', 'setIndex', 'exerciseId', 'routineRevision']),
);
```

**The set comparison is the load-bearing part.** A `toContain` is satisfied by an
unrelated `const routineRevision = …` line, and a four-entry expectation is how a
missing fifth entry stayed invisible through an entire phase.

**Match on identifiers, never on a line number.** Line citations rot: one such
citation was wrong twice within a single issue.

## Push the mechanism down so the structural read sits on top of real tests

The best response to "this can't be tested" is usually to **move the logic into
a covered module**, leaving the untestable layer as thin wiring.

One phase deliberately put a swap-ordering counter in a covered store rather
than in the screen, giving the mechanism five automated cases *beneath* the
structural read of the screen's dependency array. That layering is the design
premise, not an accident.

When reviewing work of this shape, ask: **what logic could have moved into a
covered module and didn't?**

## Extraction without tests is not a fix

An implementor moved a pure function out of a screen into a covered module "to
make it testable" and added no tests. The suite stayed at 1,643 before and
after, and both mutants — dropping a unit conversion, always returning
`undefined` — survived. Dropping that conversion would have put kilograms in a
pounds field.

**The tell was the unchanged test count.** Extraction plus zero new tests is a
relocation, not a fix.

## Never let project documentation claim such a line is covered

One phase nearly shipped the sentence *"one of the few session-screen behaviours
with automated cover"* about the single least-protected line in the feature.

**A false reassurance in a CLAUDE.md or AGENTS.md is worse than silence**, because
future readers treat it as authoritative and skip the check.

## Rationalizations

| Thought | Reality |
|---|---|
| "All tests pass, so it works" | Deleting the whole subscription also passes all tests |
| "The linter would catch a missing dep" | Not when the symbol is unreferenced in the body |
| "A structural check is just ceremony" | It is the only possible criterion; the plan was pushed twice to weaken it and refused both times |
| "I extracted it, so it's testable now" | Testable ≠ tested. Did the test count change? |
| "A human will catch it in QA" | It behaves correctly ~50% of the time. They will write "pass" |

## Common mistakes

| Mistake | Consequence |
|---|---|
| `toContain` instead of a set comparison | Satisfied by an unrelated line; misses an absent entry |
| Anchoring the criterion to a line number | Rots immediately; cites the wrong code |
| Extraction with no new tests | Mutants still survive; suite count unchanged |
| Documenting the line as covered | Future readers skip the only check that exists |
