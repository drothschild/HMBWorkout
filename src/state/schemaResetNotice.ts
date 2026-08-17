/**
 * Telling the user their on-device data was reset by a schema bump (#276 AC1.8).
 *
 * The reset itself is deliberate — see the tail comment in `src/db/migrations.ts`
 * for why a back-fill of the per-set model is impossible — but WatermelonDB
 * performs it silently, with nothing but a `logger.warn`. A user who opens the
 * app to find their routines gone and no explanation has been handed what looks
 * exactly like a bug. This module decides when to say so; `_layout.tsx` renders
 * the banner and nothing else.
 *
 * The decision cannot live in the database, because the database is the thing
 * that was destroyed. It rides in the settings blob instead, which is secure
 * storage and survives.
 */

import { databaseSchema } from '@/db/schema';
import { migrations } from '@/db/migrations';
import type { BridgeSettings } from '@/state/settings';

export const SCHEMA_RESET_NOTICE_TITLE = 'Your saved data was reset';

/**
 * Deliberately does not claim logged history survived — it did not. The reset
 * drops and recreates the whole database, sessions and logged sets included.
 */
export const SCHEMA_RESET_NOTICE_BODY =
  'This update changed how workout plans are stored on this device, and the old ' +
  'data could not be carried over. Your routines and workout history have been ' +
  'cleared. Ask the coach to rebuild your routines.';

export interface SchemaVersionContext {
  /** What `databaseSchema.version` declares. */
  readonly currentSchemaVersion: number;
  readonly migrationsMinVersion: number;
  readonly migrationsMaxVersion: number;
}

/** The live values, so callers cannot drift from the real schema. */
export function liveSchemaVersionContext(): SchemaVersionContext {
  return {
    currentSchemaVersion: databaseSchema.version,
    migrationsMinVersion: migrations.minVersion,
    migrationsMaxVersion: migrations.maxVersion,
  };
}

/**
 * Whether opening a database recorded at `fromVersion` under this schema
 * destroys it.
 *
 * This restates WatermelonDB's own predicate rather than approximating it.
 * `stepsForMigration` returns `null` when `fromVersion < minVersion ||
 * toVersion > maxVersion`, and `null` is precisely the signal both adapters
 * branch on to reset (adapters/sqlite/index.js:132,
 * adapters/lokijs/worker/DatabaseDriver.js:354). Its agreement with the real
 * `stepsForMigration` over the whole reachable domain is asserted in the tests
 * — a plausible-looking reimplementation is not good enough here, because the
 * consequence of disagreeing is telling the user the wrong thing about their
 * data.
 *
 * The one case not covered by that predicate is a *downgrade*: an install whose
 * database is newer than the app. Loki resets outright in that case
 * ("Database has newer version … Resetting database"), so it counts as
 * destructive too.
 */
export function isDestructiveSchemaUpgrade(
  fromVersion: number,
  context: SchemaVersionContext
): boolean {
  const { currentSchemaVersion, migrationsMinVersion, migrationsMaxVersion } = context;

  if (fromVersion === currentSchemaVersion) return false;
  if (fromVersion > currentSchemaVersion) return true;

  return fromVersion < migrationsMinVersion || currentSchemaVersion > migrationsMaxVersion;
}

/**
 * Whether this install has been used before, judged from anything the user (or
 * onboarding) has ever written.
 *
 * Needed only for the v6 transition itself, and it is the honest weak point of
 * this module. `lastSchemaVersion` ships *with* v6, so every install the wipe
 * actually hits has no recorded version — the same state as a brand-new
 * install. There is no other durable signal outside the database, so prior use
 * of the settings blob stands in for "this install had data".
 *
 * The cost, stated plainly: a user who installed the app, hand-built routines,
 * and never touched an AI setting or the onboarding card is indistinguishable
 * from a fresh install and will not see the notice. From v6 onward the recorded
 * version makes the question exact and this fallback stops mattering.
 */
function hasPriorInstallEvidence(settings: BridgeSettings): boolean {
  if (settings.onboardingState !== 'unseen') return true;

  return [
    settings.anthropicKey,
    settings.openaiKey,
    settings.aiGoals,
    settings.aiEquipment,
    settings.aiPersonality,
    settings.profileAge,
    settings.profileExperience,
  ].some((value) => (value ?? '').trim().length > 0);
}

/**
 * True when the app should tell the user their data was reset by an update.
 *
 * Shows once: the boot path records the version it came up at
 * (`schemaVersionRecordPatch`), so the next launch takes the equality branch.
 */
export function shouldShowSchemaResetNotice(
  settings: BridgeSettings,
  context: SchemaVersionContext
): boolean {
  const recorded =
    settings.lastSchemaVersion ??
    // No record. Either an install that predates the field — which is exactly
    // an install at the last version the migrations cover — or a fresh one,
    // which has nothing to have lost and is treated as already current.
    (hasPriorInstallEvidence(settings)
      ? context.migrationsMaxVersion
      : context.currentSchemaVersion);

  return isDestructiveSchemaUpgrade(recorded, context);
}

/**
 * The settings patch that marks this schema version as seen.
 *
 * A patch rather than a write so the caller goes through `setSettings`, which
 * merges — writing the whole blob from here would clobber whatever else changed
 * during boot.
 */
export function schemaVersionRecordPatch(
  context: SchemaVersionContext
): Partial<BridgeSettings> {
  return { lastSchemaVersion: context.currentSchemaVersion };
}
