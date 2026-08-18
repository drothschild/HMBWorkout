/**
 * Which migrations object an adapter should be given, if any.
 *
 * TODAY THIS GATE IS A PASS-THROUGH, and that is the state it should stay in.
 * Migration coverage and the declared schema agree at v7, so both adapters
 * receive the real migrations and every install upgrades in place. The gate
 * remains because the state it guards against is one line away and silent.
 *
 * WHAT IT GUARDS, AND WHY IT EXISTS AT ALL
 * ----------------------------------------
 * #276's Phase 1 deliberately bumped the schema past the last version the
 * migrations covered, so that WatermelonDB dropped and recreated the database
 * (see the v6 entry in ./migrations.ts for why a back-fill is impossible). That
 * is a supported path — but only half the story, and the missing half bites in
 * exactly the build a developer runs.
 *
 * `validateAdapter` (@nozbe/watermelondb/adapters/common.js:29) runs whenever
 * `NODE_ENV !== 'production'` and asserts `maxVersion === schema.version`:
 *
 *     Missing migration. Database schema is currently at version 6, but
 *     migrations only cover range from 1 to 5
 *
 * It throws from the adapter *constructor*, before `_init` and therefore before
 * any reset can run, and both adapters call it. A Release build skipped the
 * check and wiped as designed; a Debug build crashed at boot instead. Verified
 * by construction against LokiJSAdapter under both NODE_ENV values.
 *
 * The fix is to withhold the migrations object when the schema deliberately
 * outruns it. WatermelonDB treats an absent migrations object exactly as it
 * treats an uncovered range — `if (!migrations) { return null }` in both
 * `_migrationSteps` (adapters/sqlite/index.js:275) and `_getMigrationSteps`
 * (adapters/lokijs/worker/DatabaseDriver.js:394) — so the reset path is the
 * same one, reached the same way, and `validateAdapter`'s `if (migrations)`
 * block is simply skipped. Dev and production converge.
 *
 * This is not a permanent licence to skip migrations: it fires only while the
 * declared schema version and the migration coverage disagree, which is a
 * deliberate, commented state. It has been entered exactly once.
 *
 * HOW PHASE 6 LEFT IT (the history, because both readings were traps)
 * ------------------------------------------------------------------
 * An earlier version of this file told Phase 6 to "add a `toVersion: 7` entry
 * alongside the v7 schema and this returns the migrations again". That was
 * wrong, and both of its obvious readings destroy something. What follows was
 * established by executing `schemaMigrations` and `stepsForMigration`, and is
 * recorded because a future contract phase will face the same fork.
 *
 *  1. BOTH a `toVersion: 6` AND a `toVersion: 7` entry were needed. Adding only
 *     `toVersion: 7` throws at MODULE INIT:
 *
 *         Invalid migrations! Migrations listed cover range from version 1 to
 *         5, but migration {"toVersion":7,...} is to version 7. Migrations
 *         must be listed without gaps, or duplicates.
 *
 *     `schemaMigrations` requires a gapless list, and that check is gated on
 *     `NODE_ENV !== 'production'` (Schema/migrations/index.js:82) — so it is a
 *     Debug-only crash, the exact dev/Release asymmetry this file exists to
 *     remove, one phase later and in the same pair of files. A module-init
 *     throw also lands before RuleErrorScreen can render (engine convention 4).
 *
 *  2. LEAVING THE MIGRATIONS WITHHELD at v7 was the other reading, and it is
 *     worse than a crash: this gate goes on returning `undefined`, the adapter
 *     takes the reset path a second time, and the user loses the routines they
 *     rebuilt after Phase 1's wipe. Executed against a v6 database with data:
 *     routines 1 -> 0. That execution is now a permanent test — the third case
 *     in ./migrationV6ToV7.test.ts asserts the wipe, so the two outcomes are
 *     told apart by fixtures rather than by review.
 *
 *  3. THE `toVersion: 6` ENTRY CARRIES THE REAL `createTable` for
 *     `routine_sets`, not `steps: []`. Every install that exists in practice is
 *     already on v6 and runs only the 6 -> 7 step, so the entry is pure
 *     gap-filler for them; but an install that somehow never saw v6 would
 *     otherwise arrive at v7 with a schema declaring a table its database does
 *     not have, which is a crash on first query rather than a wipe. Its
 *     residual is unavoidable and is the reason Phase 1 shipped on its own:
 *     such an install lands with aggregate routines and zero `routine_sets`
 *     rows, and the aggregates cannot be back-filled (see ./migrations.ts).
 *     Since v7 no longer declares the aggregate columns, that install's
 *     routines are simply empty plans rather than misleading ones.
 *
 * With both entries present `maxVersion` is 7, this gate returns the migrations
 * again, and `stepsForMigration({ fromVersion: 6, toVersion: 7 })` returns `[]`
 * rather than `null` — so a v6 database upgrades in place instead of resetting.
 * `[]` and `null` are both falsy and both mean "no steps to run", and the
 * adapters treat them oppositely; that distinction is the whole phase.
 */

/** The shape both adapters need: WatermelonDB's `SchemaMigrations`. */
interface MigrationCoverage {
  readonly minVersion: number;
  readonly maxVersion: number;
}

export function migrationsForAdapter<T extends MigrationCoverage>(
  schemaVersion: number,
  candidate: T
): T | undefined {
  // Equality, not `>=`: `validateAdapter` rejects migrations newer than the
  // schema too ("Migrations can't be newer than schema"), and that state is a
  // bad edit rather than a designed one. Resetting is still a better outcome
  // than a crash at launch with no way for the user to recover.
  return candidate.maxVersion === schemaVersion ? candidate : undefined;
}
