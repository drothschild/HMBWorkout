---
name: migrating-watermelondb-schema
description: Use when changing a WatermelonDB schema - adding, removing, or altering a column or table, or bumping databaseSchema.version - because an uncovered version range silently wipes the user's database with only a logger.warn, and the failure differs between Debug and Release builds.
---

# Migrating a WatermelonDB Schema

## Overview

**Bumping `databaseSchema.version` without a matching migration entry destroys
the user's database, silently.** This is not a crash and not a bug — it is
WatermelonDB's documented fallback. It can be used deliberately, but never
by accident.

Know the mechanism before touching either file.

## The mechanism

`stepsForMigration` returns `null` when
`fromVersion < minVersion || toVersion > maxVersion`. `null` is precisely the
signal both adapters branch on to reset: they log

```
Migrations not available for this version range, resetting database instead
```

and set up from schema. No `unsafeResetDatabase` call is involved.

**The only trace is a `logger.warn`.** Nothing is user-facing, so the user opens
the app to find their data gone with no explanation.

If your app can hit this path at all, tell the user. That decision cannot live
in the database — the database is the thing that was destroyed — so it has to
ride in whatever settings store survives, and it should restate the adapter's
own predicate rather than approximate it.

## Three traps, each of which must be verified by execution

### 1. `[]` and `null` are both falsy and mean opposite things

`[]` means "no steps to run" and **migrates**. `null` means "no path" and
**resets**. Any assertion about a migration path must distinguish them — a
`toBeFalsy()` or a `toEqual([])` alone passes under `null`.

### 2. A gapped list throws at MODULE INIT

`schemaMigrations` refuses one outright:

```
Migrations must be listed without gaps, or duplicates
```

Bumping from 5 to 7 needs a `toVersion: 6` entry as well as a `toVersion: 7`
one. The check is gated on `NODE_ENV !== 'production'`, making it a **Debug-only
crash** — and a module-init throw lands before any error screen can render.

### 3. The same NODE_ENV asymmetry applies to the wipe itself

`validateAdapter` asserts `maxVersion === schema.version` in non-production
builds and throws `Missing migration` from the adapter **constructor**, before
any reset can run. So the same code **wipes as designed in Release and crashes
at boot in Debug**.

Remove the divergence with a gate that withholds the migrations object entirely
when coverage and schema disagree — both adapters treat that identically to an
uncovered range (`if (!migrations) return null`). Keep it a pass-through in the
normal case.

```ts
export function migrationsForAdapter(
  migrations: SchemaMigrations,
  schemaVersion: number,
): SchemaMigrations | undefined {
  const maxVersion = /* highest toVersion in migrations */;
  return maxVersion === schemaVersion ? migrations : undefined;
}
```

## Removing a column: undeclare, don't drop

WatermelonDB 0.28 ships no `destroyColumn`, and the adapters ignore a physical
column the schema omits. The migration is `steps: []` plus deleting the column
from `schema.ts`.

Two consequences worth knowing:

- The data is still in the file, so a later re-declaration recovers it.
- `unsafeExecuteSql('ALTER TABLE … DROP COLUMN')` is the wrong fix: LokiJS
  ignores SQL steps outright, so the platforms would diverge.

## Proving any of this

Open a real database twice through one shared in-memory adapter, so the second
open is a genuine upgrade of the first:

```ts
const adapter = new LokiJSAdapter({ /* … */, _testLokiAdapter: shared });
// open 1: write at version N
// open 2: same shared adapter, schema at version N+1
```

**Assert both outcomes** — data surviving a covered upgrade, *and* data destroyed
when the migrations are withheld. A harness that can only observe one of them
proves nothing.

## Checklist for a schema change

- [ ] Migration entry exists for **every** intermediate `toVersion` — no gaps
- [ ] `maxVersion` of the migrations equals `databaseSchema.version`
- [ ] Column removal is undeclare + `steps: []`, not a SQL `DROP COLUMN`
- [ ] The test distinguishes `[]` from `null`
- [ ] The test asserts the destructive path too, not only the happy one
- [ ] If a reset is reachable, the user is told

## Common mistakes

| Mistake | Consequence |
|---|---|
| Bumping `version` with no migration entry | Silent total data loss, `logger.warn` only |
| Skipping an intermediate `toVersion` | Module-init throw in Debug, before any error UI |
| Asserting `toBeFalsy()` on migration steps | Passes under `null`; the wipe path is untested |
| `ALTER TABLE … DROP COLUMN` via `unsafeExecuteSql` | LokiJS ignores it; platforms diverge |
| Testing only in Debug | Release wipes where Debug throws; you see one of two behaviours |
