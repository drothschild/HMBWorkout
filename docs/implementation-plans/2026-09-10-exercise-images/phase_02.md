# Exercise Images Implementation Plan — Phase 2: Schema v9 and image state

**Goal:** Give `exercises` its two nullable image columns (schema v9, non-destructive migration) and define the pure eligibility rule that decides which rows a resolver pass touches.

**Architecture:** A real `addColumns` migration step (the v7→v8 `rest_seconds` precedent), two model fields, and a pure `src/state/exerciseImageState.ts` holding the `ImageSource` vocabulary and `isImageResolutionEligible`.

**Tech Stack:** WatermelonDB 0.28 (schema, migrations, LokiJS in tests), TypeScript, Jest.

**Scope:** Phase 2 of 7 from `docs/design-plans/2026-09-10-exercise-images.md`. Independent of Phase 1.

**Codebase verified:** 2026-09-10

---

## Context the executor needs

- Read AGENTS.md → **"Schema migrations (`src/db`)"** before touching either file. The one-line summary: bumping `databaseSchema.version` without a matching migration entry **silently wipes the user's database**; a gapped migration list throws at module init; `migrationsForAdapter` (`src/db/adapterMigrations.ts:95-104`) must stay a pass-through.
- Current state (verified): `src/db/schema.ts:4` is `version: 8`; the `exercises` table is at `src/db/schema.ts:15-25` with columns `title, kind, muscle_group, equipment, description, created_at`. The last migration entry is `toVersion: 8` at `src/db/migrations.ts:169-191`. The model is `src/db/models/Exercise.ts` (uses `@text` for string columns — `@text` trims and stores non-strings as `null`, which is what a nullable string column wants).
- `src/db/migrations.test.ts` **pins the version and the migration list** and will go red on the bump until updated (Task 1 updates it). `src/db/migrationV7ToV8.test.ts` is the template for the new upgrade test (Task 2).

## Acceptance Criteria Coverage

### exercise-images.AC2: Background resolution, retry, and backfill
- **exercise-images.AC2.4 Success:** A `none:nokey` row is re-resolved by the first pass that runs while an AI key is configured.
- **exercise-images.AC2.5 Failure:** A `none:nokey` row is not re-resolved while no key is configured; `none`, `catalog:`, and `url:` rows are never re-resolved by a pass.

(This phase proves both at the predicate level — the eligibility table. Phase 4 re-proves AC2.4 end-to-end through a real pass.)

### exercise-images.AC3: Storage and display
- **exercise-images.AC3.1 Success:** Upgrading a v8 database to v9 keeps every existing row, and `image_path`/`image_source` read null on existing exercises.
- **exercise-images.AC3.2 Failure:** With the v9 migration step withheld, the upgrade resets the database — the harness observes both outcomes.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Schema v9, migration step, model fields

**Verifies:** None directly (declaration-level pins in `migrations.test.ts`; behaviour is proven in Task 2).

**Files:**
- Modify: `src/db/schema.ts:4` (version 8 → 9) and `src/db/schema.ts:15-25` (exercises columns)
- Modify: `src/db/migrations.ts` — append a `toVersion: 9` entry after the `toVersion: 8` entry (ends ~line 191)
- Modify: `src/db/models/Exercise.ts` — two fields
- Modify: `src/db/migrations.test.ts` — the pins that name version 8

**Implementation:**

`src/db/schema.ts` — bump to `version: 9` and add to the `exercises` columns (after `description`, before `created_at` is fine; order does not matter to WatermelonDB):
```ts
// Exercise image (#335, schema v9). Both nullable and non-backfilled:
// image_path is RELATIVE to the documents directory (never file:// or /);
// image_source is 'catalog:<id>' | 'url:<url>' | 'none' | 'none:nokey'.
{ name: 'image_path', type: 'string', isOptional: true },
{ name: 'image_source', type: 'string', isOptional: true },
```

`src/db/migrations.ts` — new last entry, mirroring the v8 one (a real step; `steps: []` would leave upgraded installs with declared-but-absent columns):
```ts
{
  // #335: an image per exercise. Non-destructive: two nullable columns, a
  // real addColumns step, every existing exercises row survives with both
  // reading null — which is exactly what makes the first resolver pass a
  // backfill (see src/state/exerciseImageState.ts).
  toVersion: 9,
  steps: [
    addColumns({
      table: 'exercises',
      columns: [
        { name: 'image_path', type: 'string', isOptional: true },
        { name: 'image_source', type: 'string', isOptional: true },
      ],
    }),
  ],
},
```

`src/db/models/Exercise.ts` — add alongside the existing `@text` fields:
```ts
@text('image_path') imagePath!: string | null;
@text('image_source') imageSource!: string | null;
```

`src/db/migrations.test.ts` — update, do not delete, the pins that name v8:
- `'has bumped the schema version to 8 for the per-set rest column'` → assert `9` and rename to name the image columns (#335).
- `'covers the schema exactly, so no install is reset on the way to v8'` → `migrations.maxVersion` is `9`; keep the equality-with-schema assertion; update the title.
- `'returns real steps for every upgrade path into v8…'` → loop `fromVersion` 1..**8**; update the title.
- Add: `'adds exercises.image_path and image_source with a real addColumns step from v8 to v9'` — `stepsForMigration({ migrations, fromVersion: 8, toVersion: 9 })` is non-null, has length 1, `type === 'add_columns'`, `table === 'exercises'`, and `columns` equals the two column objects above (in that order).
- Add: `'declares exercises.image_path and image_source as optional string columns'` — both `toEqual({ name, type: 'string', isOptional: true })`.
- Leave every frozen historical literal (the v6 `routine_sets` shape, the v1→v5 walk, etc.) untouched — AGENTS.md says those describe what shipped and must not chase later schema changes. The `routine_sets` drift-alarm test is unaffected (v9 touches `exercises` only).

Also modify the **three suites that derive a historical schema from the shipping one** — after v9 they would claim `exercises.image_path`/`image_source` existed at v5–v7, falsifying their own "derived, never stale" headers (they would likely stay green, because LokiJS's `addColumns` re-nulls the column, which is exactly why this has to be fixed by reading rather than by a red test):
- `src/db/migrationV7ToV8.test.ts` — `historicalV7Schema()`: also filter `image_path` and `image_source` out of the `exercises` table.
- `src/db/migrationV6ToV7.test.ts` — `historicalSchema(...)` (~`:66-81`) has **no** column exclusion today: its `columns:` ternary special-cases only `routine_exercises` and passes `[...table.columnArray]` through for every other table. Give `exercises` its own arm in that ternary: `table.columnArray.filter((column) => column.name !== 'image_path' && column.name !== 'image_source')`, applied for every historical version it builds.
- `src/db/schemaResetWipe.test.ts` — its v5 schema derivation (~`:58-63`) filters whole **tables** and passes the `TableSchema` objects through unchanged (`as any`), so there is no column filter to extend and the derivation's shape must change: after the table filter, add `.map((table) => tableSchema({ name: table.name, columns: table.name === 'exercises' ? table.columnArray.filter((column) => column.name !== 'image_path' && column.name !== 'image_source') : [...table.columnArray] }))`, and add `tableSchema` to its `@nozbe/watermelondb` import.
Add a one-line comment naming schema v9 (#335) at each of the three sites.

**Verification:**
- Run: `npx jest src/db/migrations.test.ts src/db/migrationV7ToV8.test.ts src/db/migrationV6ToV7.test.ts src/db/schemaResetWipe.test.ts`
- Expected: all pass.
- Run: `grep -rln "databaseSchema.version\|schema.version" src --include='*.test.ts'` and then `npx jest <each listed file>` — the suites that read the live version (planning found six that do not hardcode 8; confirm they still pass at 9).

**Commit:** `feat(#335): schema v9 adds exercise image columns`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: v8 → v9 upgrade test (both outcomes)

**Verifies:** exercise-images.AC3.1, exercise-images.AC3.2

**Files:**
- Test: `src/db/migrationV8ToV9.test.ts` (integration, real LokiJS driver)

**Implementation:** Copy the structure of `src/db/migrationV7ToV8.test.ts` exactly (its header comment explains why: `_testLokiAdapter` shares one `LokiMemoryAdapter` so the second open is an *upgrade*; `persistAndClose` must call `saveDatabase` because `autosave: false`). Changes:
- `historicalV8Schema()` derives v8 from the shipping schema by filtering `image_path` and `image_source` out of the `exercises` table only (`version: 8`). Derived, never a literal.
- Seed (on the v8 open, straight to `_raw` like the template): a routine, **two** exercises (with title/kind/created_at and one with a `description`), a `routine_exercises` row, and a `routine_sets` row. No image columns are written — v8 has none.

**Testing:**
- **AC3.1:** open v8, seed, persist/close; open with `databaseSchema` and `withMigrations: true`. Assert both exercises survive (ids and titles), the description survives, the routine/row/set survive, and on every exercise `_raw.image_path == null` and `_raw.image_source == null`. Add a second test that writes `image_path`/`image_source` on a migrated row and reads them back (the column is writable, not merely present) — mirror `'writes and reads a per-set rest_seconds through the migrated column'`.
- **AC3.2:** same seed, reopen with `withMigrations: false`; assert `exercises` and `routines` queries resolve to `[]` (the reset). This negative control is what proves the harness can observe a wipe at all.

**Verification:**
Run: `npx jest src/db/migrationV8ToV9.test.ts`
Expected: all pass.

**Commit:** `test(#335): v8→v9 upgrade keeps data; withheld migration resets`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-3) -->

<!-- START_TASK_3 -->
### Task 3: `ImageSource` vocabulary and the eligibility rule

**Verifies:** exercise-images.AC2.4, exercise-images.AC2.5

**Files:**
- Create: `src/state/exerciseImageState.ts`
- Test: `src/state/exerciseImageState.test.ts` (unit)

**Implementation:**

```ts
// pattern: Functional Core
/**
 * The vocabulary of `exercises.image_source` and the one rule that decides
 * whether a resolver pass (re)resolves a row (#335). This predicate alone
 * drives the first-launch backfill, the first-view retry, and the
 * key-added retry — there is no separate mechanism for any of them.
 */

export type ImageSource = `catalog:${string}` | `url:${string}` | 'none' | 'none:nokey';

/** No acceptable match. Final: never re-resolved by a pass. */
export const IMAGE_SOURCE_NONE = 'none';
/** The no-key name match missed the threshold. Re-resolved once an AI key exists. */
export const IMAGE_SOURCE_NONE_NOKEY = 'none:nokey';

export function catalogImageSource(catalogId: string): ImageSource {
  return `catalog:${catalogId}`;
}

export function urlImageSource(url: string): ImageSource {
  return `url:${url}`;
}

/**
 * True when a pass should (re)resolve this row: `image_source` is null (never
 * decided, or every earlier attempt failed transiently and wrote nothing), or
 * it is `none:nokey` and an AI key is configured NOW. `none`, `catalog:…` and
 * `url:…` are terminal. An unrecognised value is left alone rather than
 * overwritten — the resolver never destroys data it does not understand.
 *
 * Takes the raw column value (`string | null`), because that is what a row
 * carries; the design's `imagePath` field is not needed by the rule.
 */
export function isImageResolutionEligible(
  row: { readonly imageSource: string | null },
  hasAiKey: boolean
): boolean {
  if (row.imageSource === null) return true;
  return row.imageSource === IMAGE_SOURCE_NONE_NOKEY && hasAiKey;
}
```

**Testing** — one table-driven test (`it.each`) over **every source value × key state**, asserting the exact boolean:

| imageSource | hasAiKey=false | hasAiKey=true |
|---|---|---|
| `null` | true | true |
| `'none:nokey'` | **false** (AC2.5) | **true** (AC2.4) |
| `'none'` | false | false |
| `'catalog:Barbell_Squat'` | false | false |
| `'url:https://example.com/x.jpg'` | false | false |
| `'garbage'` (unrecognised) | false | false |

Plus: `catalogImageSource('Face_Pull') === 'catalog:Face_Pull'`, `urlImageSource('https://a/b.jpg') === 'url:https://a/b.jpg'`.

**Verification:**
Run: `npx jest src/state/exerciseImageState.test.ts`
Expected: all pass.

**Commit:** `feat(#335): image-source vocabulary and resolution eligibility rule`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->
