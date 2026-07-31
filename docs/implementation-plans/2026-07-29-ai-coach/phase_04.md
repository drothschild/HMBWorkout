# AI Coach Implementation Plan — Phase 4: Context builder

**Goal:** Claude receives the coach persona, the user's goals and equipment, all existing routines, and a bounded slice of recent working-set history as a single system-prompt string; edit mode additionally names the target routine and its `routineId`.

**Architecture:** `src/ai/contextBuilder.ts` composes existing read models — `routineListPresenter`, `routineDetailPresenter`, `getExerciseWorkingSetHistory` — plus `getSettings()` into a plain string. Pure composition: no new queries, no state, no side effects. History is capped at the 5 most recent working sets per distinct exercise so the prompt stays bounded (~a few thousand tokens).

**Tech Stack:** TypeScript, existing presenters/repository (LokiJS in tests), Jest (node project).

**Scope:** Phase 4 of 6 from `docs/design-plans/2026-07-29-ai-coach.md`.

**Codebase verified:** 2026-07-29 (codebase-investigator against worktree `.worktrees/ai-coach`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ai-coach.AC2: Conversation with Claude
- **ai-coach.AC2.2 Success:** System prompt contains goals, equipment, all existing routines, and recent working-set history
- **ai-coach.AC2.3 Success:** Edit mode's system prompt names the target routine and its `routineId`

### ai-coach.AC5: Ephemerality & isolation
- **ai-coach.AC5.2 Success:** History context is capped (~5 working sets per exercise) so the prompt stays bounded

---

## Verified codebase state (inputs to this phase)

- `src/state/routineListPresenter.ts:13-33`: `routineListPresenter(db: Database): Promise<RoutineListItem[]>` returning `{ id, name, exerciseCount }[]`.
- `src/state/routineDetailPresenter.ts:31-107`: `routineDetailPresenter(db: Database, routineId: string): Promise<RoutineDetail | null>` returning `{ id, name, supersetGroups, standaloneExercises }` (`RoutineDetail`, defined at `routineDetailPresenter.ts:20-25`). Each `ExerciseDetail` carries `exerciseId, title, order, warmupSets, targetSets, targetReps, targetDurationSeconds, restSeconds, kind`; `supersetGroups` groups `ExerciseDetail`s by superset.
- `src/db/repository.ts:190-233`: `getExerciseWorkingSetHistory(db: Database, exerciseId: string): Promise<SessionSet[]>` — working-type sets only, ordered most-recent-first by `created_at` then `position`; empty array when the exercise has no `routine_exercises`. `SessionSet` fields: `setType`, `reps?`, `weightKg?`, `durationSeconds?`, `distanceM?`, `rpe?`, `position`, `createdAt: Date`.
- `src/state/settings.ts`: `getSettings()` returns the settings record; after Phase 1 it includes `aiGoals` and `aiEquipment`. Tests configure it via `injectSettingsStorage(fakeBackend)` + `resetForTesting()` + `setSettings({...})` (pattern: `src/state/settings.test.ts:8-33`).
- Seeding pattern for history tests: create routines/exercises via `upsertRoutine`/`upsertExercise`, then create `sessions` and `session_sets` rows via `database.write` (mirror `src/db/repository.test.ts`, which seeds data for the existing `getExerciseWorkingSetHistory` tests — copy its seeding helpers/approach).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: `contextBuilder.ts` tests (TDD — write first)

**Verifies:** ai-coach.AC2.2, ai-coach.AC2.3, ai-coach.AC5.2

**Files:**
- Test: `src/ai/contextBuilder.test.ts` (integration against seeded LokiJS DB)

**Step 1: Write the failing tests**

Setup per test: `createTestDatabase()`/`closeTestDatabase()` (as in `repository.test.ts:9-15`) **plus** the settings fake-backend pattern (`resetForTesting()` + `injectSettingsStorage(fakeStorageBackend)` in `beforeEach`), so `getSettings()` is controllable. Cover:

- **AC2.2 — goals and equipment:** after `setSettings({ aiGoals: 'Build strength', aiEquipment: 'Dumbbells and a pull-up bar' })`, `buildSystem(db, { kind: 'create' })` resolves to a string containing both texts.
- **AC2.2 — routines:** seed two routines via `upsertExercise` + `upsertRoutine` (with targets, a superset group, and rest values). The prompt contains both routine names, every exercise title, and the target values (e.g. `3x8`, rest seconds) in some readable form.
- **AC2.2 — history:** seed a session with working sets for one exercise (mirror `repository.test.ts` seeding). **The exercise must be attached to a routine via `routine_exercises`** — `getExerciseWorkingSetHistory` returns `[]` when no `routine_exercises` rows exist for the exercise (`repository.ts:204-207`), and the builder only walks exercise ids reachable from the presenters. The prompt contains a history section referencing that exercise with its reps/weight (or duration for cardio).
- **AC5.2 — cap:** seed **7** working sets for one routine-attached exercise with reps 11 through 17. Two seeding requirements, or the test proves nothing:
  - Set each row's `s._raw.created_at` **explicitly** to distinct, ascending timestamps (the `_raw` seeding pattern already used at `repository.test.ts:51,401`). `appendSet` accepts no timestamp — sets appended in one test share a `created_at` millisecond, and `getExerciseWorkingSetHistory` sorts `created_at` DESC **then `position` ASC**, which would make the "5 most recent" actually the first 5 appended.
  - Choose assertion strings that match the **implemented output format** (`${reps} reps @ ...` per Task 2): assert the prompt contains `'17 reps'` and `'13 reps'` (newest five) and does **not** contain `'11 reps'` or `'12 reps'` (oldest two). Do not assert on strings the formatter never emits.

  Warmup sets are excluded by `getExerciseWorkingSetHistory` already — no extra test needed.
- **AC2.3 — edit mode:** with a seeded routine `'routine-1'` named `'Legs'`, `buildSystem(db, { kind: 'edit', routineId: 'routine-1' })` contains the routine name, the literal id `routine-1`, and an instruction that drafts must be returned as revisions carrying `routineId: 'routine-1'`.
- **Empty cases:** empty DB + empty settings still produce a non-empty prompt containing the coach persona/rules and explicit "none recorded"-style placeholders (no `undefined`/`null` text, no throw). Edit mode with an unknown `routineId` also does not throw (falls back to create-mode content — presenter returns `null`).

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/ai/contextBuilder.test.ts`
Expected: fails (module does not exist).

**Step 3: Commit the failing tests**

```bash
git add src/ai/contextBuilder.test.ts
git commit -m "test(ai): system prompt context builder tests"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `contextBuilder.ts`

**Verifies:** ai-coach.AC2.2, ai-coach.AC2.3, ai-coach.AC5.2

**Files:**
- Create: `src/ai/contextBuilder.ts`

**Step 1: Implement**

Public contract:

```typescript
import { Database } from '@nozbe/watermelondb';

export type AiCoachMode = { kind: 'create' } | { kind: 'edit'; routineId: string };

export const HISTORY_SETS_PER_EXERCISE = 5;

export async function buildSystem(db: Database, mode: AiCoachMode): Promise<string>;
```

Composition (assemble sections into one string, joined with blank lines):

1. **Persona/rules** (static text). Must state, at minimum: you are a strength-training coach inside a workout-logging app; every response is JSON matching the provided schema — `reply` is the conversational message, `draft` is included **only** when proposing a complete new routine or a complete revision of an existing one; a draft always contains the full exercise list (not a diff); exercise `kind` must be one of `strength`, `cardio`, `stretch`; use `supersetGroup` (same string on grouped exercises) for supersets; prefer reusing exercise titles that already exist in the user's data so they map to the same records; numbers are integers (`restSeconds`, `targetDurationSeconds` in seconds).
2. **User goals** — `getSettings().aiGoals`, or `Not specified.` when empty.
3. **Available equipment** — `getSettings().aiEquipment`, or `Not specified.` when empty.
4. **Existing routines** — `routineListPresenter(db)`, then `routineDetailPresenter(db, id)` per routine. Format each routine as a heading (`name`, include the id) and one line per exercise: title, kind, warmups, `targetSets x targetReps` or duration, `rest Ns`, and superset-group label where applicable — iterate `supersetGroups` then `standaloneExercises`, ordered by `order`. Empty DB → `No routines yet.`
5. **Recent training history** — collect the distinct `exerciseId`s from the routine details above (insertion order, deduped); for each, `getExerciseWorkingSetHistory(db, exerciseId)` and take `slice(0, HISTORY_SETS_PER_EXERCISE)` (the function already returns most-recent-first). Format one line per exercise: title/id followed by the recent sets, e.g. `bench-press-db: 8 reps @ 42.5kg, 8 reps @ 40kg, ...` (use `durationSeconds` for duration sets; skip fields that are undefined). No sets anywhere → `No workout history yet.`
6. **Edit-mode addendum** (only for `mode.kind === 'edit'` and when `routineDetailPresenter(db, mode.routineId)` is non-null): `The user is editing the routine "<name>" (routineId: <id>). Return any draft as a complete revision of this routine, and set the draft's routineId field to exactly "<id>".`

Implementation notes:
- Import `getSettings` from `@/state/settings`, presenters from `@/state/...`, `getExerciseWorkingSetHistory` from `@/db/repository`.
- Pure read-only composition: no writes, no caching, no `Date.now()` in the output (keeps the prompt deterministic and testable).
- Do not include the Anthropic API key or bridge settings anywhere in the prompt.

**Step 2: Run tests to verify they pass**

Run: `npm test -- src/ai/contextBuilder.test.ts`
Expected: all pass.

**Step 3: Commit**

```bash
git add src/ai/contextBuilder.ts
git commit -m "feat(ai): system prompt builder with goals, routines, capped history"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
