/**
 * AC1.8 — the user is told their routines were reset by an app update.
 *
 * The wipe itself is a `logger.warn` nobody sees, which is exactly how a
 * deliberate reset comes to look like a bug. The decision to show the notice
 * lives here, in the covered node project; `_layout.tsx` only renders it, and
 * that half is checked structurally at the bottom of this file because no suite
 * can load a screen.
 */

import * as fs from 'fs';
import * as path from 'path';
import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import { databaseSchema } from '@/db/schema';
import { migrations } from '@/db/migrations';
import type { BridgeSettings } from '@/state/settings';
import {
  SCHEMA_RESET_NOTICE_BODY,
  SCHEMA_RESET_NOTICE_TITLE,
  isDestructiveSchemaUpgrade,
  liveSchemaVersionContext,
  schemaVersionRecordPatch,
  shouldShowSchemaResetNotice,
  type SchemaVersionContext,
} from './schemaResetNotice';

const FRESH: BridgeSettings = {
  anthropicKey: '',
  aiGoals: '',
  aiEquipment: '',
  aiPersonality: '',
  profileAge: '',
  profileExperience: '',
  onboardingState: 'unseen',
};

/** An install that has been used: it has a key and has met the coach. */
const ESTABLISHED: BridgeSettings = {
  ...FRESH,
  anthropicKey: 'sk-ant-whatever',
  onboardingState: 'completed',
};

/** v6 as shipped: migrations stop at 5, so every upgrade into 6 wipes. */
const V6: SchemaVersionContext = {
  currentSchemaVersion: 6,
  migrationsMinVersion: 1,
  migrationsMaxVersion: 5,
};

/** What Phase 6 will look like: a covered, non-destructive bump to 7. */
const V7_COVERED: SchemaVersionContext = {
  currentSchemaVersion: 7,
  migrationsMinVersion: 1,
  migrationsMaxVersion: 7,
};

describe('isDestructiveSchemaUpgrade', () => {
  it('agrees with WatermelonDB’s own predicate across every reachable version pair', () => {
    // stepsForMigration returning null IS the reset signal, so this function
    // must not merely be plausible — it must be the same predicate. Checked
    // against the app's real migrations object over the whole domain.
    const live = liveSchemaVersionContext();
    for (let from = 1; from <= live.currentSchemaVersion + 1; from += 1) {
      const covered =
        stepsForMigration({
          migrations,
          fromVersion: from,
          toVersion: live.currentSchemaVersion,
        }) !== null;
      const destructive = isDestructiveSchemaUpgrade(from, live);
      if (from < live.currentSchemaVersion) {
        expect(destructive).toBe(!covered);
      }
    }
  });

  it('calls an upgrade into an uncovered version destructive', () => {
    expect(isDestructiveSchemaUpgrade(5, V6)).toBe(true);
    expect(isDestructiveSchemaUpgrade(1, V6)).toBe(true);
  });

  it('calls a covered upgrade non-destructive', () => {
    expect(isDestructiveSchemaUpgrade(6, V7_COVERED)).toBe(false);
    expect(isDestructiveSchemaUpgrade(1, V7_COVERED)).toBe(false);
  });

  it('is false when nothing changed', () => {
    expect(isDestructiveSchemaUpgrade(6, V6)).toBe(false);
  });

  it('calls a downgrade destructive, because the adapter resets a database newer than the app', () => {
    expect(isDestructiveSchemaUpgrade(8, V7_COVERED)).toBe(true);
  });
});

describe('shouldShowSchemaResetNotice', () => {
  it('shows for an install that recorded v5 and is now on v6', () => {
    expect(
      shouldShowSchemaResetNotice({ ...ESTABLISHED, lastSchemaVersion: 5 }, V6)
    ).toBe(true);
  });

  it('does not show again once the current version has been recorded', () => {
    // This is what makes the notice one-time: the boot path records the version
    // it just came up at, so the next launch takes this branch.
    expect(
      shouldShowSchemaResetNotice({ ...ESTABLISHED, lastSchemaVersion: 6 }, V6)
    ).toBe(false);
  });

  it('shows for an established install with no recorded version at all', () => {
    // The field ships WITH v6, so the very installs the wipe hits are exactly
    // the ones that never recorded anything. Without this branch the notice
    // would never fire for anybody on the upgrade it exists for.
    expect(shouldShowSchemaResetNotice(ESTABLISHED, V6)).toBe(true);
  });

  it('stays silent on a brand-new install, which had nothing to lose', () => {
    expect(shouldShowSchemaResetNotice(FRESH, V6)).toBe(false);
  });

  it('treats any single trace of prior use as evidence of an existing install', () => {
    // Each of these on its own must be enough — an install that set goals but
    // never a key, or answered the age question and nothing else, still had
    // routines.
    const traces: Partial<BridgeSettings>[] = [
      { anthropicKey: 'sk-ant-x' },
      { openaiKey: 'sk-x' },
      { aiGoals: 'get stronger' },
      { aiEquipment: 'dumbbells' },
      { aiPersonality: 'blunt' },
      { profileAge: '41' },
      { profileExperience: 'beginner' },
      { onboardingState: 'dismissed' },
      { onboardingState: 'completed' },
    ];
    for (const trace of traces) {
      expect(shouldShowSchemaResetNotice({ ...FRESH, ...trace }, V6)).toBe(true);
    }
  });

  it('does not mistake whitespace for prior use', () => {
    expect(
      shouldShowSchemaResetNotice({ ...FRESH, anthropicKey: '   ', aiGoals: '\n' }, V6)
    ).toBe(false);
  });

  it('stays silent after Phase 6’s covered bump, even for an established install', () => {
    // The discriminating case for the whole function: a version change alone
    // must not trigger the notice. Only an UNCOVERED one wipes.
    expect(
      shouldShowSchemaResetNotice({ ...ESTABLISHED, lastSchemaVersion: 6 }, V7_COVERED)
    ).toBe(false);
  });

  it('stays silent for an established install with no record when the bump is covered', () => {
    expect(shouldShowSchemaResetNotice(ESTABLISHED, V7_COVERED)).toBe(false);
  });
});

describe('schemaVersionRecordPatch', () => {
  it('records only the schema version, so it cannot clobber a neighbouring setting', () => {
    expect(schemaVersionRecordPatch(V6)).toEqual({ lastSchemaVersion: 6 });
  });
});

describe('liveSchemaVersionContext', () => {
  it('reads the app’s real schema and migrations rather than a copy', () => {
    expect(liveSchemaVersionContext()).toEqual({
      currentSchemaVersion: databaseSchema.version,
      migrationsMinVersion: migrations.minVersion,
      migrationsMaxVersion: migrations.maxVersion,
    });
  });

  it('currently describes a destructive bump, which is the whole point of Phase 1', () => {
    expect(isDestructiveSchemaUpgrade(migrations.maxVersion, liveSchemaVersionContext())).toBe(
      true
    );
  });
});

describe('the notice copy', () => {
  it('names the update as the cause and does not promise history survived', () => {
    // The wipe takes sessions and logged sets too, not only routines. Copy that
    // reassures the user their history is safe would be a lie.
    expect(SCHEMA_RESET_NOTICE_TITLE.length).toBeGreaterThan(0);
    expect(SCHEMA_RESET_NOTICE_BODY).toMatch(/update/i);
    expect(SCHEMA_RESET_NOTICE_BODY).toMatch(/routines/i);
    expect(SCHEMA_RESET_NOTICE_BODY).toMatch(/history/i);
  });
});

/**
 * AC1.8's rendering half. `src/app` is outside every jest project's testMatch,
 * so this reads the screen as text — the technique
 * `src/state/activeSession.callSites.test.ts` established for exactly this
 * situation. It proves the wiring exists, not that it renders correctly; the
 * latter is a simulator check (AC7.4).
 */
describe('_layout.tsx wiring (structural — read from source, not executed)', () => {
  const layout = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', '_layout.tsx'),
    'utf8'
  );

  it('imports the decision from schemaResetNotice rather than re-deriving it in the screen', () => {
    expect(layout).toMatch(/from ['"]@\/state\/schemaResetNotice['"]/);
    expect(layout).toContain('shouldShowSchemaResetNotice');
  });

  it('consults the decision with the live schema context', () => {
    expect(layout).toContain('liveSchemaVersionContext');
  });

  it('records the current schema version, so the notice cannot show twice', () => {
    expect(layout).toContain('schemaVersionRecordPatch');
  });

  it('renders the notice copy', () => {
    expect(layout).toContain('SCHEMA_RESET_NOTICE_TITLE');
    expect(layout).toContain('SCHEMA_RESET_NOTICE_BODY');
  });
});
