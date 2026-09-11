> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Testing gotchas

- Jest runs a **single `node` project** (`jest.config.js`), not jest-expo. Its
  `testMatch` covers `engine/db/domain/interop/state/health/helpers/ai/hevy/theme/watch/components/export` — all pure TS, no
  RN runtime. A new `src/` domain gets no test coverage until it is added to that list.
  The commented-out `rn` project is intentional future work; don't assume RN-env tests
  run — screens (including `ai-coach.tsx`) are therefore untested by `npm test`.
- Because of that boundary, **layout in `src/components`/`src/app` is invisible to
  every suite**: a green run proves nothing about it (PR #66 shipped a 2pt-collapsed
  ScrollView past 159 passing tests — `flex: 1` inside an auto-height parent).
  Verify layout changes in the simulator, or model the node tree with Yoga, before
  calling them done.
- `watchman: false` is required — watchman's crawl hangs jest startup on this machine.
- **Never apply a mutant IN PLACE to a file under `src/app` or `src/components`
  while Metro is serving a simulator or device.** Metro hot-reloads the mutated file
  into the running app. During #335 a hook-placement mutant (a hook moved below an
  early return, to prove a structural test fails) produced a real "Rendered more
  hooks than during the previous render" crash and a full reload in the app someone
  was using. Mutate an in-memory copy of the source and run the structural test's
  checks against that string instead. The incident also proves the phase plans'
  hook-placement warnings are not hypothetical: that crash is exactly what the
  `exercise/[id].tsx` hook-placement guard in `exerciseImageWiring.static.test.ts`
  stands in for.
- **A mutation harness on this repo MUST count a failed *suite* as a kill, not just a
  failed test.** Plenty of mutations here break a module at import time rather than at
  assertion time — a gapped `migrations` list throws from `validateAdapter` during
  module init, and a signature change fails ts-jest's type-check — and jest reports
  those as `Test Suites: 6 failed` with **`Tests: 2226 passed, 2226 total`, zero
  failed tests**. A detector that parses only the `Tests:` line scores every one of
  them a survivor, which reads as a catastrophic coverage gap that is not there.
  Independently reproduced twice on #276 Phase 6. Parse the `Test Suites:` line too,
  or just use the exit code.
- **The intermittent "A worker process has failed to exit gracefully" warning is
  cosmetic, and the obvious explanation for it is measured-wrong.** WatermelonDB's
  `WorkQueue.enqueue` does register a 1500ms dev-mode timer on every *contended*
  enqueue that is never cleared or `.unref()`ed (`NODE_ENV !== 'production'`, and
  jest sets `test`), and it does hold a worker's event loop open ~1497ms — that
  much is proven (#186, `scripts/repro-workqueue-timer.mjs`). But it is **not**
  the source of the warning: a 16-run interleaved A/B of the full suite
  (`scripts/measure-worker-exit-warning.mjs`), load spanning 22–75, produced
  **0/8 warnings in both arms** — with and without the timer unref'ed. The
  harness was positive-controlled in the same session (a deliberately leaked
  ref'd timer makes it report 1/1 in both arms), so that is a real negative and
  not a dead detector. The 1497ms hold simply stays under jest's force-exit
  threshold. The warning is real but rare and tracks ambient machine load; its
  actual cause is unattributed and nothing is broken. Do **not** "fix" this by
  running jest with `NODE_ENV=production` — that gates 41 executed sites across
  20 files in WatermelonDB (schema, query, migration and model invariant checks;
  `scripts/count-watermelondb-node-env-gates.mjs` derives it), trading 40 dev-mode
  checks for one cosmetic message. See #129, closed with this measurement.
- ts-jest transform pins `useDefineForClassFields: false` + `experimentalDecorators`/
  `emitDecoratorMetadata`. WatermelonDB models rely on legacy decorator semantics;
  class-fields-define would shadow the `@field`/`@relation` getters and silently break
  the models. Do not "modernize" these compiler options.
- `npx tsc --noEmit` can report a false-positive route error on a **brand-new dynamic
  route** — e.g. an "argument of type `/workout/${string}` is not assignable to
  parameter of type ... 52 more ..." on a correct ``router.push(`/workout/${id}`)``.
  Expo Router's typed routes come from `.expo/types/router.d.ts`, which is gitignored
  and regenerated per-machine by Metro only when it notices the `src/app` route tree
  change; a checkout that hasn't run `npm start`/`npm run ios` since a new `[id].tsx`
  route landed is still type-checking against the old route set, so a structurally
  correct template-literal push (the established pattern — see the existing
  `/routine/${id}` and `/exercise/${id}` pushes) gets rejected as if the route didn't
  exist. There is no CI job running `tsc`, so this only ever surfaces locally. Before
  changing code to chase a route-shaped tsc error, regenerate types (run the dev
  server once, or copy a fresh `.expo/types/router.d.ts` from a checkout that has) and
  re-run `tsc --noEmit` — a stale cache, not the route push, is the usual cause.
- **A `tsc` error on a brand-new static route** — e.g. `/settings/ai-provider` on a checkout
  that hasn't run Metro since the route landed. `.expo/types/router.d.ts` enumerates
  static routes as literals, not templates, so a new route landing in a worktree shows
  as absent to `tsc` until Metro regenerates the file. The remedy is the same: run the
  dev server once or copy a fresh `router.d.ts` from a checkout that has, then re-run
  `tsc --noEmit`. A worktree with no `.expo/types/` at all type-checks everything because
  `expo-router` falls back to `string`.
- **Fire-and-forget DB writes need `flush()` before assertions, not a bare
  `setImmediate` or a bare `setTimeout(fn, 0)` alone — both of `flush()`'s
  two stages are load-bearing, and `flush()` itself only advances the queue
  by one extra step, not a full drain.** Effect executors like
  `onCompleteSession` dispatch side effects that return promises but do not
  await them. WatermelonDB's WorkQueue routes a write queued behind another
  via a real `setTimeout(fn, 0)` timer (not a microtask), scheduled from the
  promise continuation after the preceding item resolves. Call `flush()`
  (`src/db/test-helpers.ts`) the way every real call site does — synchronously,
  right after the writes, no special setup — and it catches a queue depth of *two*
  pending writes in the high-90s% of
  individual calls (~90% per run, measured as 46/51 fresh-process full-passes
  on a 10-trial measurement), where either a bare `setImmediate` or a bare
  `setTimeout(fn, 0)` alone catch it in 0% of runs. An earlier version of
  `test-helpers.test.ts` anchored its probe inside a nested `fs.readFile` I/O
  callback, reasoning that pinning a deterministic starting event-loop phase
  would make the test more reliable. That reasoning had it backwards for how
  this codebase actually calls `flush()`: anchoring inside a check-phase
  callback changes which of WorkQueue's timer and `flush()`'s own first-stage
  timer is queued first, which made that specific test unable to tell a real
  two-stage `flush()` apart from a one-stage `setTimeout(fn, 0)`-only
  implementation — both passed. The current test uses the plain, unanchored
  call shape instead, which matches every real usage and catches the round-5
  blind-spot mutation (the anchored test passed against a one-stage
  implementation, proving it was missing this detection). Since a single
  10-trial run is only ~90% reliable (individual `flush()` calls are ~99%
  reliable; one miss in ten trials is enough to fall short), the guard test
  itself retries the 10-trial measurement up to 3 times and passes as soon
  as any attempt reaches 10/10
  caught, giving the guard ~99.9% reliability (1 − 0.1³). A genuinely broken
  one-stage implementation stays 0% across all 3 attempts and still fails the
  test. `test-helpers.test.ts` is the actual source of truth for this
  contract — it repeats the probe and separately demonstrates (as documentation,
  not as the guard) that the two weaker alternatives never catch the write.

  `flush()` is not a guarantee for arbitrary queue depth — a sequence that
  queues three or more writes (e.g. `onCompleteSession` draining several
  pending set-persists and then doing its own `database.write`) needs the
  bounded-retry/poll-until-true idiom already used at `activeSession.test.ts:498,581`
  (two of the FOUR `for (let attempt ...)` loops in that file; the citation read
  `:512,601` and `the two` until #276 Phase 6's review), not a single `flush()`
  call. Always check for this hazard when asserting on DB state
  after fire-and-forget writes, and reach for a bounded retry over a fixed
  number of `flush()` calls whenever the queue depth isn't obviously 1 or 2.

