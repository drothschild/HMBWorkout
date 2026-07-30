# AI Coach Implementation Plan — Phase 2: Draft schema and accept path

**Goal:** A validated `RoutineDraft` can be persisted through the existing repository functions (`upsertExercise`/`upsertRoutine`), with free-form exercise titles slugified into stable exercise ids.

**Architecture:** New `src/ai/` directory (first files of the vertical slice). `draftSchema.ts` owns the `AiTurn`/`RoutineDraft`/`DraftExercise` types, the JSON schema object used later for Anthropic structured outputs, and a runtime validator/parser with a typed error (mirroring `ContractError` in `src/interop/format.ts:315-320`). `acceptDraft.ts` maps a validated draft onto the existing repository write path — no new DB write functions.

**Tech Stack:** TypeScript, WatermelonDB repository functions (LokiJS in tests), Jest (node project, ts-jest).

**Scope:** Phase 2 of 6 from `docs/design-plans/2026-07-29-ai-coach.md`.

**Codebase verified:** 2026-07-29 (codebase-investigator against worktree `.worktrees/ai-coach`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ai-coach.AC3: Draft + Accept persistence
- **ai-coach.AC3.1 Success:** A draft renders as a card; the database is untouched before Accept
- **ai-coach.AC3.2 Success:** Accepting a new-routine draft persists it via repository and navigates to the routine
- **ai-coach.AC3.3 Success:** Accepting a draft carrying `routineId` updates that routine in place
- **ai-coach.AC3.4 Success:** Free-form exercise titles create exercises with a valid `kind`; repeated titles converge on one exercise (slug dedupe)
- **ai-coach.AC3.5 Failure:** An invalid draft payload is rejected with no partial DB writes
- **ai-coach.AC3.6 Edge:** A newer draft replaces the pending one; only the latest is Accept-able

**Cross-phase notes:** AC3.1's "renders as a card" half and AC3.2's "navigates to the routine" half complete in Phase 6; AC3.6's pending-draft replacement completes in Phase 5 (store). This phase tests the persistence/validation halves: no DB writes occur until `acceptDraft` is called (AC3.1), a new-routine draft persists via repository (AC3.2), edit-in-place preserves `routineId` (AC3.3), slug dedupe (AC3.4), and invalid-payload rejection with zero writes (AC3.5).

---

## Verified codebase state (inputs to this phase)

- `src/db/repository.ts`:
  - `upsertExercise(database: Database, exerciseId: string, title: string, kind: string): Promise<any>` (lines 377-405). **Note:** `kind` is typed `string` at the repository layer with no validation — the draft validator in this phase is what enforces the `'strength' | 'cardio' | 'stretch'` union before persisting.
  - `upsertRoutine(database: Database, routineId: string, name: string, exercises: RoutineExerciseEntry[], additionalFields?: { notes?: string }): Promise<any>` (lines 430-489) — single transaction, delete-and-recreate `routine_exercises`.
  - `RoutineExerciseEntry` interface (lines 418-428): `{ exerciseId: string; order: number; supersetGroup?: string; warmupSets?: number; targetSets?: number; targetReps?: number; targetDurationSeconds?: number; restSeconds?: number; notes?: string }`.
- `src/db/models/Exercise.ts:4`: `export type ExerciseKind = 'strength' | 'cardio' | 'stretch';`
- **No slugify helper exists** in the codebase — this phase creates it. Existing exercise ids follow the pattern `bench-press-db`, `chest-stretch`, `cycling` (lowercase, hyphen-separated).
- **No `newId()` helper exists.** The codebase generates ids with template-literal timestamps — `src/app/routine/[id].tsx:41` uses `` `session-${Date.now()}` ``. Do **not** use `crypto.randomUUID()`: it is not guaranteed on Hermes, there is no polyfill in `package.json` (no `expo-crypto`, no `uuid`), and the only in-repo uses are defensive (`crypto.randomUUID?.() || 'test-session-id'` in `activeSession.test.ts`). New routine ids here use `` `routine-${Date.now()}` ``.
- `RoutineExerciseEntry` (repository.ts:418) is **not currently exported** — Task 3 adds the `export` keyword to it.
- Error-class precedent: `ContractError` in `src/interop/format.ts:315-320` (`extends Error`, sets `this.name`).
- Test DB: `createTestDatabase()` / `closeTestDatabase(db)` from `src/db/test-helpers.ts` (LokiJS, `autoSave: false`), used with `beforeEach`/`afterEach` as in `src/db/repository.test.ts:9-15`.
- Test command: `npm test -- src/ai/<file>.test.ts` — note `jest.config.js` `testMatch` is `src/{engine,db,interop,state,sync,health,helpers}/**/*.test.ts`, which does **not** include `src/ai/` (see Task 1 Step 0 below).

---

<!-- START_TASK_1 -->
### Task 1: Add `src/ai` to the Jest testMatch

**Verifies:** None (infrastructure — enables all `src/ai/*.test.ts` suites)

**Files:**
- Modify: `jest.config.js:12` (the `testMatch` glob)

**Step 1: Edit the glob**

Change:

```javascript
testMatch: ['<rootDir>/src/{engine,db,interop,state,sync,health,helpers}/**/*.test.ts'],
```

to:

```javascript
testMatch: ['<rootDir>/src/{engine,db,interop,state,sync,health,helpers,ai}/**/*.test.ts'],
```

Leave `collectCoverageFrom` (line 17: `['src/{engine,db,interop}/**/*.ts', '!src/**/*.d.ts']`) unchanged — it deliberately covers a narrower set of directories than `testMatch`.

**Step 2: Verify operationally**

Run: `npm test -- src/state/settings.test.ts`
Expected: still runs and passes (config change breaks nothing).

**Step 3: Commit**

```bash
git add jest.config.js
git commit -m "chore(jest): include src/ai in test globs"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: `draftSchema.ts` — types, JSON schema, validator/parser (TDD)

**Verifies:** ai-coach.AC3.5 (validation half), ai-coach.AC3.4 (kind validity half)

**Files:**
- Create: `src/ai/draftSchema.ts`
- Test: `src/ai/draftSchema.test.ts` (unit)

**Step 1: Write the failing tests**

Create `src/ai/draftSchema.test.ts` covering:

- `parseAiTurn` on a valid JSON string `{"reply":"...","draft":{...}}` returns a typed `AiTurn` with the draft intact.
- `parseAiTurn` on a valid reply-only JSON string `{"reply":"..."}` returns `AiTurn` with `draft` undefined.
- `parseAiTurn` on non-JSON text throws `DraftValidationError`.
- `parseAiTurn` on JSON missing `reply` (or with non-string `reply`) throws `DraftValidationError`.
- `validateRoutineDraft` rejects (throws `DraftValidationError`): non-object; missing/empty `name`; missing/empty `exercises` array; an exercise missing `title`; an exercise whose `title` slugifies to empty (e.g. `"!!!"`); an exercise with `kind` outside `'strength' | 'cardio' | 'stretch'` (AC3.4's "valid kind" guarantee); an exercise with a non-number `targetSets`/`targetReps`/`targetDurationSeconds`/`restSeconds`/`warmupSets`.
- `validateRoutineDraft` accepts a minimal valid draft (title + kind only) and a fully-populated one (routineId, notes, supersetGroup, all targets), returning it typed.
- `AI_TURN_SCHEMA` sanity: every object node has `additionalProperties: false` (walk the schema object in the test) — this is required by Anthropic structured outputs.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/ai/draftSchema.test.ts`
Expected: fails (module does not exist).

**Step 3: Commit the failing tests**

```bash
git add src/ai/draftSchema.test.ts
git commit -m "test(ai): draft schema validator tests"
```

**Step 4: Implement `src/ai/draftSchema.ts`**

```typescript
import { ExerciseKind } from '@/db/models/Exercise';

export interface AiTurn {
  reply: string;
  draft?: RoutineDraft;
}

export interface RoutineDraft {
  routineId?: string; // present only when editing an existing routine
  name: string;
  notes?: string;
  exercises: DraftExercise[];
}

export interface DraftExercise {
  title: string; // free-form; may name a brand-new exercise
  kind: ExerciseKind;
  supersetGroup?: string;
  warmupSets?: number;
  targetSets?: number;
  targetReps?: number;
  targetDurationSeconds?: number;
  restSeconds?: number;
  notes?: string;
}

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(`Invalid AI response: ${message}`);
    this.name = 'DraftValidationError';
  }
}
```

The JSON schema object (passed to Anthropic structured outputs in Phase 3 — every object node **must** carry `additionalProperties: false`; do not add numeric `minimum`/`maximum` or string `minLength` constraints, they are unsupported by the API):

```typescript
export const AI_TURN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Conversational reply shown to the user' },
    draft: {
      type: 'object',
      description: 'Include only when proposing a new routine or a revision of an existing one',
      properties: {
        routineId: { type: 'string', description: 'Only when revising an existing routine: its exact id' },
        name: { type: 'string' },
        notes: { type: 'string' },
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              kind: { type: 'string', enum: ['strength', 'cardio', 'stretch'] },
              supersetGroup: { type: 'string' },
              warmupSets: { type: 'integer' },
              targetSets: { type: 'integer' },
              targetReps: { type: 'integer' },
              targetDurationSeconds: { type: 'integer' },
              restSeconds: { type: 'integer' },
              notes: { type: 'string' },
            },
            required: ['title', 'kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'exercises'],
      additionalProperties: false,
    },
  },
  required: ['reply'],
  additionalProperties: false,
} as const;
```

Validator/parser (hand-rolled type guards — no new dependency, matching the codebase's `ContractError`-style validation in `src/interop`):

- `export function slugifyTitle(title: string): string` — `title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')` (matches existing id style `bench-press-db`).
- `export function validateRoutineDraft(value: unknown): RoutineDraft` — throws `DraftValidationError` on every rejection case listed in Step 1; returns the value typed as `RoutineDraft` on success. Optional numeric fields, when present, must be finite numbers; optional string fields, when present, must be strings; every exercise's `slugifyTitle(title)` must be non-empty.
- `export function parseAiTurn(text: string): AiTurn` — `JSON.parse` inside try/catch (wrap failures in `DraftValidationError`), require `reply` to be a string, and when `draft` is present run `validateRoutineDraft` on it.

**Step 5: Run tests to verify they pass**

Run: `npm test -- src/ai/draftSchema.test.ts`
Expected: all pass.

**Step 6: Commit**

```bash
git add src/ai/draftSchema.ts
git commit -m "feat(ai): AiTurn draft schema, JSON schema, and validator"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: `acceptDraft.ts` — map a draft onto repository upserts (TDD)

**Verifies:** ai-coach.AC3.1 (no writes before accept), ai-coach.AC3.2 (persistence half), ai-coach.AC3.3, ai-coach.AC3.4, ai-coach.AC3.5

**Files:**
- Create: `src/ai/acceptDraft.ts`
- Test: `src/ai/acceptDraft.test.ts` (integration against LokiJS test DB)

**Step 1: Write the failing tests**

Create `src/ai/acceptDraft.test.ts` using `createTestDatabase`/`closeTestDatabase` in `beforeEach`/`afterEach` (pattern: `src/db/repository.test.ts:9-15`). Cover:

- **AC3.2 (new routine):** accepting a draft without `routineId` creates a routine (query `routines` collection), one exercise per distinct title with the slug as id and the given `kind`, and `routine_exercises` rows whose `order` matches array index and whose target fields (`targetSets`, `targetReps`, `restSeconds`, `supersetGroup`, `warmupSets`, `targetDurationSeconds`, `notes`) match the draft. Returns the new routine id (matches `/^routine-\d+$/`).
- **AC3.3 (edit in place):** seed a routine via `upsertRoutine` (e.g. id `'routine-1'`, two exercises), then accept a draft with `routineId: 'routine-1'` and a different name/exercise list. Assert: still exactly one routine with id `'routine-1'`, its `name` updated, its `routine_exercises` replaced by the draft's entries, and the returned id is `'routine-1'`.
- **AC3.4 (slug dedupe):** a draft containing `"Bench Press"` twice and `"bench   press"` once creates exactly **one** exercise with id `'bench-press'`; all three `routine_exercises` rows reference it. Also: a brand-new free-form title (e.g. `"Bulgarian Split Squat"`) creates exercise id `'bulgarian-split-squat'` with the draft's `kind`.
- **AC3.5 (invalid payload, no partial writes):** calling `acceptDraft` with an invalid draft (e.g. `kind: 'yoga'`, or empty `exercises`, or a title slugifying to empty) rejects with `DraftValidationError`, and afterwards the `routines`, `exercises`, and `routine_exercises` collections are all empty (validation runs before any write).
- **AC3.1 (inert until accept):** constructing and validating a valid draft (`validateRoutineDraft`) performs no DB writes — collections remain empty until `acceptDraft` is invoked.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/ai/acceptDraft.test.ts`
Expected: fails (module does not exist).

**Step 3: Commit the failing tests**

```bash
git add src/ai/acceptDraft.test.ts
git commit -m "test(ai): acceptDraft persistence tests"
```

**Step 4: Export `RoutineExerciseEntry` and implement `src/ai/acceptDraft.ts`**

First, add the `export` keyword to the `RoutineExerciseEntry` interface declaration at `src/db/repository.ts:418` (it is currently module-private). Do not redefine the type locally.

Then create `src/ai/acceptDraft.ts`:

```typescript
import { Database } from '@nozbe/watermelondb';
import { upsertExercise, upsertRoutine, RoutineExerciseEntry } from '@/db/repository';
import { RoutineDraft, slugifyTitle, validateRoutineDraft } from './draftSchema';

export async function acceptDraft(db: Database, draft: RoutineDraft): Promise<string> {
  const validated = validateRoutineDraft(draft); // throws DraftValidationError before any write

  const routineId = validated.routineId ?? `routine-${Date.now()}`;

  const upserted = new Set<string>();
  for (const ex of validated.exercises) {
    const slug = slugifyTitle(ex.title);
    if (!upserted.has(slug)) {
      upserted.add(slug);
      await upsertExercise(db, slug, ex.title.trim(), ex.kind);
    }
  }

  const entries: RoutineExerciseEntry[] = validated.exercises.map((ex, index) => ({
    exerciseId: slugifyTitle(ex.title),
    order: index,
    supersetGroup: ex.supersetGroup,
    warmupSets: ex.warmupSets,
    targetSets: ex.targetSets,
    targetReps: ex.targetReps,
    targetDurationSeconds: ex.targetDurationSeconds,
    restSeconds: ex.restSeconds,
    notes: ex.notes,
  }));

  await upsertRoutine(db, routineId, validated.name, entries, validated.notes !== undefined ? { notes: validated.notes } : undefined);

  return routineId;
}
```

Notes for the implementor:
- `` `routine-${Date.now()}` `` mirrors the codebase's existing id-generation pattern (`` `session-${Date.now()}` `` at `src/app/routine/[id].tsx:41`) and works identically on Hermes and node Jest. Do not substitute `crypto.randomUUID()` — it is not guaranteed on Hermes and the repo carries no polyfill. Millisecond collision is a non-concern: Accept is a single user-driven action.
- Validation happens as the first statement, so an invalid draft can never produce partial writes (AC3.5).

**Step 5: Run tests to verify they pass**

Run: `npm test -- src/ai/acceptDraft.test.ts`
Expected: all pass.

**Step 6: Commit**

```bash
git add src/ai/acceptDraft.ts src/db/repository.ts
git commit -m "feat(ai): acceptDraft maps drafts onto repository upserts"
```

(`src/db/repository.ts` is included because Step 4 added the `export` keyword to `RoutineExerciseEntry`.)
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
