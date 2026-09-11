# Exercise Images Implementation Plan — Phase 4: Resolver and scheduler

**Goal:** Resolve every eligible exercise in the background — at launch (the backfill), on any `exercises` table change (every creation path), and on request — with single-flight passes and a compare-and-set write.

**Architecture:** `src/state/exerciseImageResolver.ts` is the injected-deps shell: a per-exercise pipeline (shortlist → pick → download → CAS write) and `startExerciseImageResolver` (observer + single-flight + coalescing). The CAS write is a repository function. The real expo-file-system / AI deps live in `src/state/exerciseImageFiles.ts`, which **no test imports** (this jest project is plain ts-jest, not jest-expo; `expo-file-system` cannot load in node). A tiny registry lets screens request a pass. `_layout.tsx` starts it once.

**Tech Stack:** WatermelonDB 0.28 (`withChangesForTables`, `database.write`), expo-file-system 57 (`File`, `Directory`, `Paths`), TypeScript, Jest.

**Scope:** Phase 4 of 7 from `docs/design-plans/2026-09-10-exercise-images.md`. Depends on Phases 2 and 3.

**Codebase verified:** 2026-09-10

---

## Verified library behaviour this phase relies on (read from installed sources)

- **WatermelonDB 0.28 `withChangesForTables`** (`node_modules/@nozbe/watermelondb/src/Database/index.js:286-290`) is `merge$(...changes).pipe(startWith(null))`: it **emits `null` immediately on subscribe**, then once per change batch, **synchronously after the batch commits**, including batches made by the subscriber itself and updates that change no field value. Consequences, each load-bearing:
  - Subscribing *is* the launch pass — no separate initial `request()` (AC2.1).
  - The resolver's own writes re-trigger it. Termination (AC2.7) holds only because every write makes its row **ineligible** — which is why Phase 3's with-key fallback records `none`, never `none:nokey`.
  - Any other write to `exercises` (e.g. the detail screen's description autosave, debounced 500 ms) also triggers a pass. A pass with nothing eligible writes nothing and ends. **Accepted cost, recorded in AGENTS.md (Phase 7):** a row that keeps failing (e.g. `ask` succeeds but the download keeps failing) is retried on *every* such trigger, and with a key each retry bills one `ask` call. The design's AC2.3 ("the next pass retries it") requires the retry; triggers are human-paced; a persistent download failure means the pinned catalog URL is broken, which is a bug to fix, not throttle. Do not add a cooldown without revisiting AC2.3.
- **expo-file-system 57** (`node_modules/expo-file-system/build/*.d.ts`, `ios/FileSystemDownload.swift`): `File.downloadFileAsync(url, destination: File | Directory, options?)` is static, returns `Promise<File>`, **rejects on non-2xx**, **throws if the destination exists** unless `idempotent: true`, and **does not create parent directories**. `Directory#create({ intermediates, idempotent })` is **synchronous**. `File#delete()` is **synchronous and throws if the file is missing**; `File#exists` is a getter. `new File(Paths.document, 'exercise-images/x.jpg')` joins correctly. The web build no-ops with a warning.
- `getSettings()` is synchronous and reads a cache that `loadSettings()` fills at boot (`src/state/settings.ts:104,129`). `hasAiKey(settings)` (`src/state/hasAiKey.ts:10`) is the canonical key predicate. `createAiClient(config)` (`src/ai/provider/factory.ts:55`) **throws** when no key is configured; stores call it as `createAiClient(getSettings())`.
- The database singleton is `export const database` in `src/db/index.ts`, imported in `_layout.tsx` as `import { database } from '@/db';` (line 9). The boot effect is `src/app/_layout.tsx:135-189` (`loadSettings()`, then `loadRules()` ~169, then `rehydrateActiveSession(...)` ~172-177).
- Exercise creation paths all go through `upsertExercise(db, id, title, kind, description?)` (`src/db/repository.ts:997-1026`): `acceptDraft(db, draft, { kind: 'create' })` (`src/ai/acceptDraft.ts:28-39`), `applyRoutineImport(db, routine)` (`src/state/applyRoutineImport.ts:47-54`), `ensureAlternateExercise(db, alternate, kind)` (`src/ai/acceptAlternate.ts:42-66`). None of them is touched by this phase — that is AC2.2.
- Shell code logs swallowed failures with an injected `log` defaulting to `console.warn` (e.g. `exerciseQuestionStore.ts:112`).
- DB tests use `createTestDatabase()` / `closeTestDatabase()` / `flush()` from `src/db/test-helpers.ts`; `flush()` is only reliable to queue depth 2 — for deeper async chains use the bounded poll-until-true idiom (`src/state/activeSession.test.ts:498,581`). The competing-writer race pattern is `src/db/replaceRoutineExercise.test.ts:213-261`.

## Design deviations recorded in this phase

1. **`ask` is a non-null dependency, gated per pass.** The design types it `… | null`. But key state is read *when a pass runs* (a key saved later must be picked up without restarting the resolver), so a static `null` cannot express it. `getAiKeyConfigured()` is read **exactly once at the start of each pass**, and `ask` is called only when it returned true. The real `ask` builds the client lazily (`createAiClient(getSettings()).ask(...)`); if that throws, it is an `ask` failure → row untouched, retried (AC2.3).
2. **Deps gain `makeImageSuffix: () => string`.** The design puts "a short random suffix" in the file name; injecting the randomness keeps the pipeline deterministic in tests.
3. **A screen-facing registry** (`ensureExerciseImageResolver` / `requestExerciseImagePass`) is added, because screens need a handle to call `request()` (Phase 5) and `_layout.tsx` must not start a second observer under Fast Refresh.

## Acceptance Criteria Coverage

### exercise-images.AC1: An image is chosen automatically
- **exercise-images.AC1.1 Success:** With an AI key configured, an `ask` reply that equals one shortlist id after trimming records `image_source = catalog:<id>` and downloads that entry's first image.
- **exercise-images.AC1.2 Success:** With an AI key configured, a reply of `NONE` records `image_source = none`, writes no `image_path`, and downloads nothing.
- **exercise-images.AC1.3 Failure:** With an AI key configured, a reply that is not exactly one shortlist id — an id absent from the shortlist, an id wrapped in prose, an empty string — is not trusted; the exercise is decided by the no-key rule instead. *(Fallback half: through the resolver.)*

### exercise-images.AC2: Background resolution, retry, and backfill
- **exercise-images.AC2.1 Success:** The pass started at app launch resolves every exercise whose `image_source` is null — this is the backfill for pre-existing exercises.
- **exercise-images.AC2.2 Success:** An exercise created through any path (`acceptDraft`, `applyRoutineImport`, `ensureAlternateExercise`) is resolved by a pass triggered from the `exercises` table change, with no call from the creating code.
- **exercise-images.AC2.3 Failure:** When `ask` rejects (unreachable or HTTP error) or the download fails, the row is left unchanged, and the next pass retries it.
- **exercise-images.AC2.6 Success:** At most one pass runs at a time; any number of requests arriving during a pass produce exactly one follow-up pass.
- **exercise-images.AC2.7 Edge:** The resolver's own row writes re-trigger the table observer, and the resulting passes terminate — the total pass count for one new exercise is bounded.
- **exercise-images.AC2.8 Failure:** No resolver or scheduler failure throws out of the scheduler; failures are logged and swallowed.
- **exercise-images.AC2.10 Success:** `_layout.tsx` starts the resolver (structural test on the source).

### exercise-images.AC3: Storage and display
- **exercise-images.AC3.3 Success:** `image_path` is written relative to the documents directory; it never begins with `file://` or `/`.

### exercise-images.AC4: Identity and manual override
- **exercise-images.AC4.5 Edge:** A resolve pass that finishes after a URL was pasted mid-pass does not overwrite the pasted image (compare-and-set write; race test with a competing writer).

(AC2.4 — a `none:nokey` row re-resolved once a key exists — is also re-proven here through a real pass, on top of Phase 2's predicate test.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Relative image path builder and the image write functions

**Verifies:** exercise-images.AC3.3 (path shape), and the CAS primitive AC4.5 rests on

**Files:**
- Modify: `src/state/exerciseImageState.ts` — add `EXERCISE_IMAGE_DIR` and `buildImageRelativePath`
- Modify: `src/state/exerciseImageState.test.ts`
- Modify: `src/db/repository.ts` — add `ExerciseImageFields`, `setExerciseImageIfSourceUnchanged` and `setExerciseImage` (near `upsertExercise`, ~line 997)
- Test: `src/db/exerciseImageWrites.test.ts` (integration, LokiJS)

**Implementation — `exerciseImageState.ts` additions:**

```ts
/** Directory under Paths.document that holds every downloaded exercise image. */
export const EXERCISE_IMAGE_DIR = 'exercise-images';

/**
 * `exercise-images/<exerciseId>-<suffix>.jpg` — RELATIVE to the documents
 * directory, because iOS moves the app container on reinstall/restore and an
 * absolute `file://` path would go stale. The suffix makes every download a
 * NEW file, so an override never overwrites a file a render may be reading.
 * Any character outside [a-z0-9-] in the id (ids are slugs today) is replaced,
 * so the result can never contain '/' past the directory or start with one.
 */
export function buildImageRelativePath(exerciseId: string, suffix: string): string {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${EXERCISE_IMAGE_DIR}/${safe(exerciseId)}-${safe(suffix)}.jpg`;
}
```

(Every download is saved as `.jpg`. expo-image decodes by content, so a pasted PNG still renders; the extension is a naming convention, not a format claim.)

**Implementation — `src/db/repository.ts` additions** (follow the file's existing style — it uses `any` casts for model access; typing via `Exercise` from `./models/Exercise` is preferred where it type-checks):

```ts
export type ExerciseImageFields = {
  readonly imagePath: string | null;
  readonly imageSource: string;
};

/**
 * Compare-and-set (#335): applies `next` only if the row's image_source still
 * equals `expectedSource` — the value read when resolution BEGAN. One
 * database.write, so the check and the update cannot interleave with another
 * writer (WatermelonDB serializes writers FIFO). Returns whether it applied.
 * A URL pasted while a pass was downloading therefore wins.
 */
export async function setExerciseImageIfSourceUnchanged(
  database: Database,
  exerciseId: string,
  expectedSource: string | null,
  next: ExerciseImageFields
): Promise<boolean> {
  return database.write(async () => {
    const exercise = (await database.get('exercises').find(exerciseId)) as Exercise;
    if ((exercise.imageSource ?? null) !== expectedSource) return false;
    await exercise.update((record) => {
      record.imagePath = next.imagePath;
      record.imageSource = next.imageSource;
    });
    return true;
  });
}

/**
 * Unconditional image write for the user's own override (Phase 6). Returns the
 * image_path the row held BEFORE the write, so the caller can delete that file
 * strictly after the row no longer points at it.
 */
export async function setExerciseImage(
  database: Database,
  exerciseId: string,
  next: ExerciseImageFields
): Promise<string | null> {
  return database.write(async () => {
    const exercise = (await database.get('exercises').find(exerciseId)) as Exercise;
    const previous = exercise.imagePath ?? null;
    await exercise.update((record) => {
      record.imagePath = next.imagePath;
      record.imageSource = next.imageSource;
    });
    return previous;
  });
}
```

**Testing:**
- `exerciseImageState.test.ts` — **AC3.3**: `buildImageRelativePath('back-squat', '3f9a')` equals `'exercise-images/back-squat-3f9a.jpg'`; for a set of hostile ids (`'/etc/passwd'`, `'file://x'`, `'../up'`, `'Back Squat'`) the result starts with `'exercise-images/'`, never starts with `'/'` or `'file://'`, and contains exactly one `'/'`.
- `src/db/exerciseImageWrites.test.ts` (`createTestDatabase`/`closeTestDatabase`; seed an exercise with `upsertExercise`):
  - CAS applies when the expected source matches (`null` → writes both columns, returns `true`).
  - CAS refuses when it does not (row holds `'url:https://a/b.jpg'`, expected `null` → returns `false`, row unchanged).
  - `setExerciseImage` returns the previous path (`null` first, then the earlier path on a second write) and leaves the new values.

**Verification:**
Run: `npx jest src/state/exerciseImageState.test.ts src/db/exerciseImageWrites.test.ts`
Expected: all pass.

**Commit:** `feat(#335): relative image paths and compare-and-set image write`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Per-exercise pipeline and one pass

**Verifies:** exercise-images.AC1.1, exercise-images.AC1.2, exercise-images.AC1.3 (fallback half), exercise-images.AC2.1, exercise-images.AC2.3, exercise-images.AC2.4 (end-to-end), exercise-images.AC3.3 (written value), exercise-images.AC4.5

**Files:**
- Create: `src/state/exerciseImageResolver.ts`
- Test: `src/state/exerciseImageResolver.test.ts` (integration: real LokiJS database, fake `ask`/`download`/`deleteFile`)

**Implementation:**

```ts
// pattern: Imperative Shell
/**
 * Background exercise-image resolution (#335). Orchestration only: the
 * decisions live in exerciseImageMatch (pure) and exerciseImageState (pure);
 * this module gathers rows, calls them, and persists. Every dep is injected so
 * the whole path runs in the node jest project — the real deps are in
 * exerciseImageFiles.ts, which no test may import (expo-file-system is native).
 *
 * Nothing about a workout waits on this, and nothing here may throw out of
 * the scheduler: every failure is logged and swallowed (AC2.8). A failed row
 * writes nothing, stays eligible, and is retried by the next pass — which can
 * be any `exercises` write; see phase_04.md / AGENTS.md for that accepted cost.
 */
import type { Database } from '@nozbe/watermelondb';
import { buildCatalogPickPrompt, parseCatalogPick } from '@/ai/catalogPickPrompt';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import { setExerciseImageIfSourceUnchanged } from '@/db/repository';
import type Exercise from '@/db/models/Exercise';
import { catalogImageUrl, type CatalogEntry } from './exerciseCatalog';
import {
  decideByScore,
  decideFromAiPick,
  type CatalogMatcher,
  type ImageDecision,
} from './exerciseImageMatch';
import {
  buildImageRelativePath,
  catalogImageSource,
  isImageResolutionEligible,
} from './exerciseImageState';

export type ExerciseImageResolverDeps = {
  readonly database: Database;
  readonly catalog: readonly CatalogEntry[];
  /** Read EXACTLY ONCE at the start of every pass. */
  readonly getAiKeyConfigured: () => boolean;
  /** Called only in a pass where getAiKeyConfigured() was true. */
  readonly ask: (request: { system: string; message: string }) => Promise<string>;
  /** Download `url` to `relativePath` under the documents directory. Rejects on failure. */
  readonly download: (url: string, relativePath: string) => Promise<void>;
  readonly deleteFile: (relativePath: string) => Promise<void>;
  readonly makeImageSuffix: () => string;
  readonly log: (message: string, error?: unknown) => void;
};

export type ExerciseImageResolver = {
  /** Queue a pass; coalesces while one is running. Never throws. */
  request(): void;
  /** Unsubscribe the table observer; later requests are ignored. Does not wait for an in-flight pass. */
  stop(): void;
};

async function decide(
  deps: ExerciseImageResolverDeps,
  matcher: CatalogMatcher,
  title: string,
  hasAiKey: boolean
): Promise<ImageDecision> {
  const hits = matcher.shortlist(title);
  if (hits.length === 0) return { kind: 'none' }; // AC1.6: no ask on an empty shortlist
  if (!hasAiKey) return decideByScore(hits, { aiConsulted: false });
  const reply = await deps.ask(
    buildCatalogPickPrompt({ title, candidates: hits.map((hit) => hit.entry), directives: IMMUTABLE_DIRECTIVES })
  ); // a rejection propagates: the row is left untouched and retried (AC2.3)
  return decideFromAiPick(hits, parseCatalogPick(reply, hits.map((hit) => hit.entry.id)));
}

async function resolveOne(
  deps: ExerciseImageResolverDeps,
  matcher: CatalogMatcher,
  exercise: { readonly id: string; readonly title: string; readonly imageSource: string | null },
  hasAiKey: boolean
): Promise<void> {
  const decision = await decide(deps, matcher, exercise.title, hasAiKey);
  let imagePath: string | null = null;
  if (decision.kind === 'catalog') {
    imagePath = buildImageRelativePath(exercise.id, deps.makeImageSuffix());
    await deps.download(catalogImageUrl(decision.entry), imagePath); // rejection → row untouched
  }
  const imageSource = decision.kind === 'catalog' ? catalogImageSource(decision.entry.id) : decision.kind;
  const applied = await setExerciseImageIfSourceUnchanged(deps.database, exercise.id, exercise.imageSource, {
    imagePath,
    imageSource,
  });
  if (!applied && imagePath !== null) {
    // Someone (a pasted URL) decided this row while we were downloading. Their
    // write wins; the file we fetched is now an orphan.
    const orphan = imagePath;
    await deps.deleteFile(orphan).catch((error: unknown) =>
      deps.log(`exercise image: deleting orphan ${orphan} failed`, error)
    );
  }
}

/** One pass over every currently eligible row, sequentially. Never throws per row. */
export async function runImageResolutionPass(
  deps: ExerciseImageResolverDeps,
  matcher: CatalogMatcher
): Promise<void> {
  const hasAiKey = deps.getAiKeyConfigured();
  const rows = (await deps.database.get('exercises').query().fetch()) as Array<Exercise>;
  for (const row of rows) {
    const imageSource = row.imageSource ?? null;
    if (!isImageResolutionEligible({ imageSource }, hasAiKey)) continue;
    try {
      await resolveOne(deps, matcher, { id: row.id, title: row.title, imageSource }, hasAiKey);
    } catch (error) {
      deps.log(`exercise image: resolving ${row.id} failed; will retry on a later pass`, error);
    }
  }
}
```

(Do **not** import `createCatalogMatcher` in this task — nothing here uses it and lint would flag it. Task 3 adds that import. Tests build the matcher themselves.)

**Testing** — `src/state/exerciseImageResolver.test.ts`, calling `runImageResolutionPass(deps, createCatalogMatcher(EXERCISE_CATALOG))` directly (no scheduler yet). Build the matcher once at module scope. Use a real `createTestDatabase()` and seed exercises with `upsertExercise`. Build deps with a helper `makeDeps(overrides)` whose fakes **record calls**: `download` records `(url, relativePath)` and resolves; `deleteFile` records paths; `ask` is a `jest.fn` resolving a scripted reply; `makeImageSuffix` returns a fixed `'s1'`; `log` records. Titles come from the real catalog so shortlists are real:
- **AC1.1**: key on, exercise id `'romanian-deadlift'` titled "Romanian Deadlift", `ask` resolves `'  Romanian_Deadlift\n'` → row `image_source === 'catalog:Romanian_Deadlift'`, `image_path === 'exercise-images/romanian-deadlift-s1.jpg'`, and `download` was called once with `catalogImageUrl(<Romanian_Deadlift entry>)`, i.e. a URL ending `/exercises/Romanian_Deadlift/0.jpg`.
- **AC1.2**: key on, `ask` resolves `'NONE'` → `image_source === 'none'`, `image_path == null`, `download` never called.
- **AC1.3** (fallback via resolver), key on. **Use "Couch Stretch" for the untrusted cases** — its threshold fallback is a *miss*, so a resolver that trusted the reply leniently would record a catalog image and the test fails; on a title whose fallback is a hit (Romanian Deadlift) a lenient parse and the correct fallback produce the same row, so such a case cannot discriminate. Compute `const shortlistId = matcher.shortlist('Couch Stretch')[0].entry.id` in the test. Then:
  - prose around an id that IS in the shortlist: reply `` `The best match is ${shortlistId}.` `` → `image_source === 'none'`, `image_path == null`, `download` never called, and explicitly `image_source !== \`catalog:${shortlistId}\``;
  - an id absent from the shortlist: reply `'Romanian_Deadlift'` (assert first that it is not among the Couch Stretch shortlist ids) → `none`, no download;
  - empty reply `''` → `none` (terminal — assert it is NOT `none:nokey`), no download.
  - And one hit-side case to show the fallback can still accept: "Romanian Deadlift" with reply `'Barbell_Squat'` (assert absent from its shortlist) → `catalog:Romanian_Deadlift` via the threshold.
- **AC1.6** (no ask on empty shortlist), key on: title `'!!!'` → `image_source === 'none'`, `ask` never called.
- No key: "Romanian Deadlift" → `catalog:…` with `ask` never called; "Couch Stretch" → `none:nokey`, `ask` never called.
- **AC2.1** (backfill): seed three exercises with null image columns (Romanian Deadlift, Plank, Couch Stretch), no key; one pass → all three have a non-null `image_source`.
- **AC2.3**: key on, `ask` rejects (`new Error('unreachable')`) → row's `image_source`/`image_path` still null, `log` recorded the failure; a second pass with `ask` now resolving the id → row resolved. Same pair for `download` rejecting (row untouched, then resolved on the next pass). Also: one row failing does not stop the pass — seed two rows, make `ask` reject only for the first title, assert the second is resolved.
- **AC2.4** end-to-end: row pre-set to `none:nokey` (via `setExerciseImage(db, id, { imagePath: null, imageSource: 'none:nokey' })`). Pass with key off → untouched and `ask` not called; pass with key on → re-resolved (`ask` called, row now `catalog:…` or `none`).
- **AC2.5** through a pass: rows at `none`, `catalog:X`, `url:https://a/b.jpg` are never passed to `ask`/`download` with key on or off.
- **AC3.3** written value: after AC1.1, `image_path` does not start with `'/'` or `'file://'`.
- **AC4.5** race (pattern: `src/db/replaceRoutineExercise.test.ts:213-261`): key off, exercise "Romanian Deadlift". Make `download` return a promise you resolve manually. Start `runImageResolutionPass` **without awaiting**; poll until `download` has been called (bounded loop over `await flush()`); then, as the competing writer, `await setExerciseImage(db, id, { imagePath: 'exercise-images/pasted.jpg', imageSource: 'url:https://example.com/p.jpg' })`; now resolve the download and await the pass. Assert the row still holds `url:https://example.com/p.jpg` / `exercise-images/pasted.jpg`, and `deleteFile` was called with the resolver's own path (`exercise-images/romanian-deadlift-s1.jpg`) — the orphan cleanup.

**Verification:**
Run: `npx jest src/state/exerciseImageResolver.test.ts`
Expected: all pass.

**Commit:** `feat(#335): exercise image resolution pass with compare-and-set write`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Scheduler — observer, single-flight, coalescing

**Verifies:** exercise-images.AC2.1 (via the observer's initial emission), exercise-images.AC2.2, exercise-images.AC2.6, exercise-images.AC2.7, exercise-images.AC2.8

**Files:**
- Modify: `src/state/exerciseImageResolver.ts` — add `createCatalogMatcher` to the `./exerciseImageMatch` import, and add `startExerciseImageResolver`
- Modify: `src/state/exerciseImageResolver.test.ts`

**Implementation:**

```ts
/**
 * Starts the resolver. Subscribes to `exercises` changes — which covers every
 * creation path (acceptDraft, applyRoutineImport, ensureAlternateExercise)
 * without any of them calling in — and runs passes one at a time.
 *
 * `withChangesForTables` emits once IMMEDIATELY on subscribe (startWith(null)
 * in WatermelonDB 0.28), so subscribing is itself the launch pass/backfill. It
 * also fires after the resolver's OWN writes; that terminates because every
 * write makes its row ineligible, so the follow-up pass finds nothing to do.
 */
export function startExerciseImageResolver(deps: ExerciseImageResolverDeps): ExerciseImageResolver {
  const matcher = createCatalogMatcher(deps.catalog);
  let running = false;
  let pending = false;
  let stopped = false;

  const safeLog = (message: string, error?: unknown) => {
    try {
      deps.log(message, error);
    } catch {
      // A throwing logger must not escape the scheduler either (AC2.8).
    }
  };

  const runLoop = async (): Promise<void> => {
    running = true;
    try {
      do {
        pending = false;
        try {
          await runImageResolutionPass({ ...deps, log: safeLog }, matcher);
        } catch (error) {
          safeLog('exercise image: pass failed; will retry on a later pass', error);
        }
      } while (pending && !stopped);
    } finally {
      running = false;
    }
  };

  const request = (): void => {
    if (stopped) return;
    if (running) {
      pending = true; // any number of requests collapse into ONE follow-up (AC2.6)
      return;
    }
    void runLoop();
  };

  const subscription = deps.database.withChangesForTables(['exercises']).subscribe({
    next: () => request(),
    error: (error: unknown) => safeLog('exercise image: exercises observer failed', error),
  });

  return {
    request,
    stop: () => {
      stopped = true;
      subscription.unsubscribe();
    },
  };
}
```

`getAiKeyConfigured` is read exactly once per pass (Task 2's contract), so **its call count is the pass count** — the tests below use it as the observable, without adding any test-only hook to production code.

**Test helpers** (in the test file): `countPasses = () => getAiKeyConfigured.mock.calls.length`; `waitUntilIdle()` — flush in a bounded loop (e.g. up to 200 iterations) until the pass count has been unchanged across 5 consecutive `await flush()`es, then return. **Every test's teardown is: `resolver.stop()`, then `await waitUntilIdle()`, then `closeTestDatabase(db)`** — `stop()` does not wait for an in-flight pass, and closing the database under a writing pass is a flake source.

**Testing** (additions to `exerciseImageResolver.test.ts`; bounded polling only — never a fixed sleep):
- **AC2.1** via the observer: seed two null rows, then `startExerciseImageResolver(deps)` with no explicit `request()` → poll until both rows have `image_source`.
- **AC2.2**: start the resolver on an empty database and `waitUntilIdle()`; then create an exercise through **each real creation path**, with no resolver call in the test: (a) `acceptDraft(db, <minimal valid draft whose one exercise has a new title, e.g. 'Plank'>, { kind: 'create' })` — take the draft shape from `src/ai/acceptDraft.test.ts`; (b) `applyRoutineImport(db, <imported routine with a new exercise>)` — take a fixture from its test file; (c) `ensureAlternateExercise(db, <alternate>, 'strength')` — take the alternate shape from `src/ai/acceptAlternate.test.ts`. For each, poll until the new exercise row has a non-null `image_source`.
- **AC2.6** — set up so the only passes are the ones under test:
  1. Key on. **Seed** one exercise ("Romanian Deadlift") **before** starting the resolver (a seed after start adds its own observer-triggered pass).
  2. `ask`: the **first** call returns a promise held by a manual gate that, when released, **rejects**; **every later call rejects immediately** (so pass 2 cannot block, and no pass writes anything — a write would emit and add a pass).
  3. Start the resolver (its subscribe emission starts pass 1, which blocks inside `ask`). Poll until `ask` has been called once.
  4. Call `resolver.request()` five times. Assert `countPasses() === 1` still (no concurrent pass).
  5. Release the gate. `waitUntilIdle()`.
  6. Assert `countPasses() === 2` exactly (five requests → one follow-up) and `ask` was called exactly 2 times.
- **AC2.7**: start on an empty DB and `waitUntilIdle()`; record `n0 = countPasses()`. Create one exercise ("Plank", no key); poll until resolved; `waitUntilIdle()`. Assert `countPasses() - n0 <= 3` (the creation-triggered pass + at most one follow-up from its own write, + one slack for batching) and that it is unchanged after 10 further `flush()`es. Repeat with key on and `ask` resolving garbage (`'???'`) for "Couch Stretch": still bounded, and the row ends `none` — this is the loop Phase 3's deviation prevents; a `none:nokey` outcome would make this test fail by running away.
- **AC2.8**: (a) the rows fetch fails — pass deps whose `database` is a thin wrapper that delegates everything to the real test database except `get('exercises')`, which throws **once** (a plain object with the methods the resolver calls — `get`, `withChangesForTables`, `write` — delegating to the real instance is enough); start, `waitUntilIdle()`, and assert `log` recorded the failure and a later request still runs a pass; (b) a **throwing logger on a real failure path** — `log` alone throwing proves nothing, because `log` is only invoked when something fails. Set up: key on; `log` throws `new Error('log exploded')` on every call; seed one row ("Couch Stretch") whose `ask` **rejects**, so the failure is routed through `log` (the per-row catch in `runImageResolutionPass`, which receives the wrapped `safeLog` via the `{ ...deps, log: safeLog }` spread). Start and `waitUntilIdle()`. Then make `ask` resolve `'NONE'`, create a new row ("Plank"), and poll until it resolves — proving the scheduler survived.

  **The oracle for "nothing escapes" is jest-circus itself, not a `process.on('unhandledRejection')` spy.** Do not register such a spy: in this repo's jest the test file's `process` is a sandboxed copy (`jest-util`'s `createProcessObject` blacklists `_events`), so a spy registered in the test **never fires** — verified by a probe during planning review (`seen=0` while the rejection escaped). What does fire is jest-circus's own handler, which **fails the running test** on any unhandled rejection raised during its body. Two consequences: keep `waitUntilIdle()` **inside the test body** (not in teardown), so any escaped rejection lands while the test is still running; and the mutation check reads the failure message. Before committing, replace `safeLog` with `deps.log` at **both** sites in `startExerciseImageResolver` (the spread and the `runLoop` catch) and confirm this test fails with `log exploded`; mutating only the spread survives, because `runLoop`'s catch is a second layer — intended defence in depth, not a gap. Restore; (c) `request()` after `stop()` is a no-op (pass count unchanged).
- `stop()` unsubscribes: after `stop()` + `waitUntilIdle()`, creating an exercise does not increase the pass count.

**Verification:**
Run: `npx jest src/state/exerciseImageResolver.test.ts`
Expected: all pass, no open-handle warnings attributable to the subscription (every test stops its resolver and waits for idle).

**Commit:** `feat(#335): single-flight exercise image scheduler on the exercises observer`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Registry, real deps, `_layout.tsx` wiring, structural test

**Verifies:** exercise-images.AC2.10

**Files:**
- Create: `src/state/exerciseImageResolverRegistry.ts`
- Test: `src/state/exerciseImageResolverRegistry.test.ts` (unit)
- Create: `src/state/exerciseImageFiles.ts` (real deps — **never imported by any test**)
- Modify: `src/app/_layout.tsx` — boot effect (`~135-189`), after the `rehydrateActiveSession(...)` call (~172-177)
- Test: `src/state/exerciseImageResolverWiring.static.test.ts` (structural)

**Implementation — registry:**

```ts
// pattern: Imperative Shell
/**
 * The one running exercise-image resolver (#335), so screens can ask for a
 * pass (first-view retry, Phase 5) and so a re-run boot effect (Fast Refresh)
 * cannot start a second observer.
 */
import type { ExerciseImageResolver } from './exerciseImageResolver';

let active: ExerciseImageResolver | null = null;

export function ensureExerciseImageResolver(start: () => ExerciseImageResolver): ExerciseImageResolver {
  if (active === null) active = start();
  return active;
}

/** No-op until the resolver has started. Never throws. */
export function requestExerciseImagePass(): void {
  active?.request();
}
```

Registry tests use `jest.isolateModules` to get a fresh module per test (no test-only reset export): `requestExerciseImagePass()` before start is a no-op (no throw); `ensureExerciseImageResolver(start)` calls `start` once across two calls and returns the same object; after it, `requestExerciseImagePass()` calls that resolver's `request` once.

**Implementation — real deps (`src/state/exerciseImageFiles.ts`):**

```ts
// pattern: Imperative Shell
/**
 * Real I/O for exercise images (#335): expo-file-system and the AI client.
 * NO TEST MAY IMPORT THIS FILE — this jest project is plain ts-jest in node,
 * and expo-file-system requires its native module at import time. Everything
 * testable takes these as injected deps instead.
 *
 * Known edge: `getAiKeyConfigured` uses the canonical `hasAiKey`, while
 * `createAiClient` additionally needs a resolvable provider. With BOTH keys set
 * and no `aiProvider`, hasAiKey is true but every `ask` throws, so rows stay
 * null and retry. The one-key-per-install invariant (switching provider clears
 * the outgoing key — AGENTS.md "One key per install") makes that state
 * unreachable through the UI; it is documented rather than special-cased.
 */
import type { Database } from '@nozbe/watermelondb';
import { Directory, File, Paths } from 'expo-file-system';
import { createAiClient } from '@/ai/provider/factory';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import { EXERCISE_IMAGE_DIR } from './exerciseImageState';
import type { ExerciseImageResolverDeps } from './exerciseImageResolver';
import { getSettings } from './settings';
import { hasAiKey } from './hasAiKey';

export async function downloadExerciseImage(url: string, relativePath: string): Promise<void> {
  // downloadFileAsync does not create parent directories (verified in the
  // iOS implementation), and rejects on non-2xx.
  new Directory(Paths.document, EXERCISE_IMAGE_DIR).create({ intermediates: true, idempotent: true });
  await File.downloadFileAsync(url, new File(Paths.document, relativePath));
}

export async function deleteExerciseImage(relativePath: string): Promise<void> {
  const file = new File(Paths.document, relativePath);
  if (file.exists) file.delete(); // delete() is synchronous and throws on a missing file
}

export function makeExerciseImageSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function createExerciseImageResolverDeps(database: Database): ExerciseImageResolverDeps {
  return {
    database,
    catalog: EXERCISE_CATALOG,
    getAiKeyConfigured: () => hasAiKey(getSettings()),
    // Built per call, from settings at that moment: a key saved after boot is
    // used by the next pass with no restart.
    ask: (request) => createAiClient(getSettings()).ask(request),
    download: downloadExerciseImage,
    deleteFile: deleteExerciseImage,
    makeImageSuffix: makeExerciseImageSuffix,
    log: (message, error) => console.warn(message, error),
  };
}
```

Confirm the exact export name/path of `createAiClient` (`src/ai/provider/factory.ts`) and that `Directory` is exported from `expo-file-system` (it is, per `build/Directory.d.ts`) before writing the imports.

**Implementation — `_layout.tsx`:** add imports

```ts
import { startExerciseImageResolver } from '@/state/exerciseImageResolver';
import { createExerciseImageResolverDeps } from '@/state/exerciseImageFiles';
import { ensureExerciseImageResolver } from '@/state/exerciseImageResolverRegistry';
```

and in the boot effect one un-awaited line, placed **after the closing brace of the `if (savedState) { … }` block that wraps `rehydrateActiveSession(...)` (`_layout.tsx:~173-177`), immediately before `setRulesLoaded(true)`**:

```ts
// Exercise images (#335): background only — never awaited, never blocks boot.
// Subscribing runs the first pass (the backfill); later passes follow table
// changes. Must follow loadSettings(): the first pass reads the settings cache
// for the AI key. OUTSIDE the `if (savedState)` block: it must start on every
// launch, not only one that restores a session. See src/state/exerciseImageResolver.ts.
ensureExerciseImageResolver(() => startExerciseImageResolver(createExerciseImageResolverDeps(database)));
setRulesLoaded(true);
```

(The `setRulesLoaded(true);` line already exists — shown only to fix the position; do not duplicate it.) The trap this avoids: `rehydrateActiveSession(...)` sits **inside** `if (savedState) { … }` (verified: `loadSettings(` `:152`, `loadRules()` `:169`, `rehydrateActiveSession(` `:174`), so "right after the rehydrate" reads as inside that block — where the resolver would start only on a boot that has an in-progress session, i.e. no backfill and no observer on a normal launch. Read the boot effect before editing; if its shape differs from this (e.g. the success path no longer ends in `setRulesLoaded(true)`), place the line at the end of the success path, outside any conditional, and adjust the adjacency assertion below to the real following statement. Do not move any existing line.

**Testing — `exerciseImageResolverWiring.static.test.ts`** (pattern: `src/state/sessionPrefillWiring.static.test.ts` — `readFileSync` the screen via `join(__dirname, '..', 'app', '_layout.tsx')`; anchor on identifiers, never line numbers; throw a "re-anchor this gate" error when a marker is missing):
- The source contains `ensureExerciseImageResolver(() => startExerciseImageResolver(createExerciseImageResolverDeps(database)))` (whitespace-normalize both sides with `.replace(/\s+/g, '')` before comparing), exactly once.
- **Placement, outside the `if (savedState)` block:** the whitespace-stripped source contains `ensureExerciseImageResolver(()=>startExerciseImageResolver(createExerciseImageResolverDeps(database)));setRulesLoaded(true);` — adjacency to `setRulesLoaded(true)` is what an in-`if` placement cannot satisfy (a `}` would follow the call instead). Before committing, move the call inside the `if (savedState)` block once, watch this assertion fail, and restore.
- It appears **after** both `loadSettings(` and `rehydrateActiveSession(` (compare `indexOf`s). Starting before `loadSettings` would make the first pass see no key and write `none:nokey` across a keyed install.
- It is not awaited: the source does not match `/await\s+ensureExerciseImageResolver/`.
- No test imports `exerciseImageFiles`: recursively list `src/**/*.test.ts` with `fs.readdirSync`, **skip this test file itself** (`path !== __filename`), and assert none matches the import-shaped regex `/from\s+['"][^'"]*exerciseImageFiles['"]|require\(\s*['"][^'"]*exerciseImageFiles['"]\s*\)/` — guarding the rule in that file's header without matching this file's own source.

**Verification:**
- Run: `npx jest src/state/exerciseImageResolverRegistry.test.ts src/state/exerciseImageResolverWiring.static.test.ts`
- Expected: all pass.
- Run: `npx tsc --noEmit` — Expected: no new errors in the touched files.
- Run: `npm run lint` — Expected: no new errors.

**Commit:** `feat(#335): start the exercise image resolver at boot`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

**Phase exit state:** images populate on disk and in the database; nothing displays them yet (Phase 5). A quick sanity check on the simulator is optional here (Phases 5 and 7 carry the required on-device checks).
