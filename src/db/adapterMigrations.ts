/**
 * Which migrations object an adapter should be given, if any.
 *
 * #276's Phase 1 bumps the schema past the last version the migrations cover,
 * so that WatermelonDB drops and recreates the database (see the long comment
 * at the end of ./migrations.ts for why a back-fill is impossible). That is a
 * supported path — but only half the story, and the missing half bites in
 * exactly the build a developer runs.
 *
 * `validateAdapter` (@nozbe/watermelondb/adapters/common.js:29) runs whenever
 * `NODE_ENV !== 'production'` and asserts `maxVersion === schema.version`:
 *
 *     Missing migration. Database schema is currently at version 6, but
 *     migrations only cover range from 1 to 5
 *
 * It throws from the adapter *constructor*, before `_init` and therefore before
 * any reset can run, and both adapters call it. A Release build skips the check
 * and wipes as designed; a Debug build crashes at boot instead. Verified by
 * construction against LokiJSAdapter under both NODE_ENV values.
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
 * deliberate, commented state. Phase 6 adds a `toVersion: 7` entry alongside
 * the v7 schema and this returns the migrations again, restoring the normal
 * in-place upgrade for everyone who is already on v6.
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
