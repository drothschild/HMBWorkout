---
name: testing-watermelondb
description: Use when writing or debugging tests that assert on WatermelonDB state - covers why a fire-and-forget write is not visible when the assertion runs, the two-stage flush idiom and its limits, the tsconfig options that must not be modernized, and the worker-exit warning that is cosmetic.
---

# Testing Against WatermelonDB

## Overview

Two things make WatermelonDB tests fail in ways that look like product bugs:
**writes that have not landed yet**, and **compiler options that quietly break
the models**. Neither produces a useful error message.

## Fire-and-forget writes are not visible yet

Effect executors commonly dispatch a write and do not await it. WatermelonDB's
`WorkQueue` routes a write queued behind another through a **real
`setTimeout(fn, 0)` timer** — not a microtask — scheduled from the promise
continuation after the preceding item resolves.

So neither of these is sufficient before an assertion:

```ts
await new Promise((r) => setImmediate(r));      // catches the write ~0% of runs
await new Promise((r) => setTimeout(r, 0));     // catches the write ~0% of runs
```

A **two-stage** flush is what clears a queue depth of two:

```ts
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
}
```

Call it the way production code calls it — **synchronously, right after the
writes, with no special setup.** Measured that way it catches a depth-two queue
in the high-90s% of individual calls.

### The anchoring trap

Anchoring the probe inside an I/O callback to "make it deterministic" makes it
*worse*: it changes which of WorkQueue's timer and the flush's own first-stage
timer is queued first, and the test can then no longer distinguish a real
two-stage flush from a one-stage `setTimeout(fn, 0)` — both pass. If you are
testing the helper itself, use the plain unanchored call shape that matches
every real usage.

Because a single measurement run is only ~90% reliable, a guard test for the
helper should retry the measurement a few times and pass on the first clean
result. A genuinely broken one-stage implementation stays at 0% across every
attempt.

### `flush()` does not scale with queue depth

It advances the queue by one extra step, not a full drain. A sequence that
queues **three or more** writes — draining several pending persists and then
doing its own `database.write` — needs a bounded retry instead:

```ts
for (let attempt = 0; attempt < 20; attempt++) {
  const rows = await collection.query().fetch();
  if (rows.length === expected) break;
  await flush();
}
```

Reach for the bounded retry whenever the depth is not obviously 1 or 2.

## Compiler options that must not be modernized

The ts-jest transform must pin:

```json
{
  "useDefineForClassFields": false,
  "experimentalDecorators": true,
  "emitDecoratorMetadata": true
}
```

WatermelonDB models rely on **legacy** decorator semantics. Class-fields-define
shadows the `@field` / `@relation` getters and silently breaks the models — the
fields read as `undefined` rather than erroring.

## Two warnings that are not what they look like

### "A worker process has failed to exit gracefully"

Cosmetic, intermittent, and tracks ambient machine load. The obvious explanation
is measured-wrong: WatermelonDB's `WorkQueue.enqueue` does register a 1500 ms
dev-mode timer on every *contended* enqueue that is never cleared or
`unref()`ed, and it does hold a worker's event loop open ~1497 ms — but an
interleaved A/B of the full suite with and without that timer unref'ed produced
**zero warnings in both arms**. The hold stays under jest's force-exit
threshold.

**Do not "fix" this by running jest with `NODE_ENV=production`.** That gates
dozens of executed checks across WatermelonDB — schema, query, migration and
model invariants — trading real dev-mode validation for one cosmetic message.

### A mutation harness must count a failed *suite* as a kill

Many mutations here break a module at **import time** rather than at assertion
time — a gapped migrations list throws from `validateAdapter` during module
init, and a signature change fails ts-jest's type check. Jest reports those as:

```
Test Suites: 6 failed
Tests:       2226 passed, 2226 total
```

Zero failed *tests*. A detector parsing only the `Tests:` line scores every one
of them a survivor, which reads as a catastrophic coverage gap that is not
there. **Parse the `Test Suites:` line too, or just use the exit code.**

## Quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Row missing right after a fire-and-forget write | Queue depth 1–2 | `await flush()` |
| Row still missing after `flush()` | Queue depth 3+ | Bounded retry loop |
| Model fields read `undefined` | `useDefineForClassFields: true` | Pin the legacy decorator options |
| Worker-exit warning | Ambient load | Ignore; do not change `NODE_ENV` |
| Mutants all "survive" | Harness parses only `Tests:` | Parse `Test Suites:` / use exit code |

## Common mistakes

| Mistake | Consequence |
|---|---|
| `setImmediate` or `setTimeout(0)` alone before asserting | Write has not landed; flaky or always-failing test |
| Anchoring the flush probe in an I/O callback | Test can no longer detect a one-stage implementation |
| Assuming `flush()` drains the queue | Fails at depth 3+ |
| Modernizing the decorator tsconfig options | Models silently stop working |
| `NODE_ENV=production` to quiet a warning | Disables dozens of real invariant checks |
