/**
 * The gate that makes the destructive bump reachable outside a Release build.
 *
 * #276's design says: bump the schema, write no migration into it, and let
 * WatermelonDB's own fallback drop and recreate. That is true — but only in a
 * production build. `validateAdapter`
 * (@nozbe/watermelondb/adapters/common.js:29) runs whenever NODE_ENV is not
 * 'production' and asserts `maxVersion === schema.version`, throwing
 *
 *     Missing migration. Database schema is currently at version 6, but
 *     migrations only cover range from 1 to 5
 *
 * straight out of the adapter constructor — before any reset can run. Both
 * adapters call it. So a Debug build would crash at boot rather than wipe.
 *
 * Both adapters therefore withhold the migrations object when the schema
 * deliberately outruns it. WatermelonDB treats a missing migrations object the
 * same way it treats an uncovered range — `if (!migrations) return null` in both
 * `_migrationSteps` (sqlite/index.js:275) and `_getMigrationSteps`
 * (lokijs/worker/DatabaseDriver.js:394) — so the reset path is identical, and
 * `validateAdapter`'s `if (migrations)` block is skipped, so dev and production
 * now behave the same.
 */

import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';
import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { migrationsForAdapter } from './adapterMigrations';

const upTo = (highest: number) =>
  schemaMigrations({
    migrations: Array.from({ length: highest - 1 }, (_unused, index) => ({
      toVersion: index + 2,
      steps: [
        addColumns({
          table: 'routines',
          columns: [{ name: `c${index}`, type: 'string' as const, isOptional: true }],
        }),
      ],
    })),
  });

describe('migrationsForAdapter', () => {
  it('passes the migrations through when they cover the declared schema version', () => {
    const covering = upTo(6);
    expect(migrationsForAdapter(6, covering)).toBe(covering);
  });

  it('withholds them when the schema deliberately outruns them, so the adapter resets instead of throwing', () => {
    expect(migrationsForAdapter(6, upTo(5))).toBeUndefined();
  });

  it('withholds them when they somehow run ahead of the schema', () => {
    // validateAdapter rejects this case too ("Migrations can't be newer than
    // schema"). Reaching it means a bad edit, and a crash at boot is a worse
    // outcome than a reset either way.
    expect(migrationsForAdapter(5, upTo(6))).toBeUndefined();
  });

  it('withholds the app’s real migrations at the current schema version, because v6 is the destructive bump', () => {
    // The live wiring, not a synthetic one. This flips to a pass-through in
    // Phase 6, when a toVersion: 7 entry lands alongside the v7 schema.
    expect(migrationsForAdapter(databaseSchema.version, migrations)).toBeUndefined();
  });

  it('would pass the real migrations through at the last version they cover', () => {
    expect(migrationsForAdapter(migrations.maxVersion, migrations)).toBe(migrations);
  });
});
