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
  needsSchemaVersionRecord,
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

/**
 * #292. `setSettings` merges a patch and then re-serialises the WHOLE
 * `bridge_settings` blob into secure storage — the blob that holds the user's
 * API key — so recording the schema version unconditionally meant a full
 * read-modify-write on the boot path of every launch, to store an integer that
 * was already there on all but one of them.
 *
 * This decides whether the write is worth doing. It changes nothing about WHEN
 * THE NOTICE IS SHOWN — `shouldShowSchemaResetNotice` is untouched and its
 * cases above still hold.
 */
describe('needsSchemaVersionRecord', () => {
  it('skips the write when the recorded version is already the current one', () => {
    // The overwhelmingly common launch, and the entire point of the guard.
    expect(needsSchemaVersionRecord({ ...ESTABLISHED, lastSchemaVersion: 6 }, V6)).toBe(false);
  });

  it('writes when the recorded version is older than the current one', () => {
    expect(needsSchemaVersionRecord({ ...ESTABLISHED, lastSchemaVersion: 5 }, V6)).toBe(true);
  });

  it('writes when the recorded version is NEWER than the current one', () => {
    // A downgrade. `isDestructiveSchemaUpgrade` already treats it as a wipe;
    // leaving a future version recorded would keep claiming a wipe on every
    // later launch of this older build.
    expect(needsSchemaVersionRecord({ ...ESTABLISHED, lastSchemaVersion: 9 }, V6)).toBe(true);
  });

  it('writes when there is no record at all, on an ESTABLISHED install', () => {
    expect(needsSchemaVersionRecord(ESTABLISHED, V6)).toBe(true);
  });

  it('writes when there is no record at all, on a BRAND-NEW install too', () => {
    // THE DISCRIMINATING CASE, and the reason this guard reads the raw
    // `lastSchemaVersion` field rather than reusing the value
    // `shouldShowSchemaResetNotice` derives.
    //
    // That function defaults an absent record on a fresh install to
    // `currentSchemaVersion` — a fiction that makes the notice decision come
    // out right. A guard built on the same defaulted value would conclude
    // "already current, nothing to write" and skip. Nothing would then ever
    // record the version, and the fallback would stay live forever: the moment
    // this user typed an API key or completed onboarding,
    // `hasPriorInstallEvidence` would flip, the default would become
    // `migrationsMaxVersion`, and the app would tell a user who never lost
    // anything that their data had been wiped.
    //
    // So: a fresh install must still take the one write that closes that door.
    expect(needsSchemaVersionRecord(FRESH, V6)).toBe(true);
  });

  it('skips the write for a fresh install that has already recorded the version', () => {
    expect(needsSchemaVersionRecord({ ...FRESH, lastSchemaVersion: 6 }, V6)).toBe(false);
  });
});

/**
 * The boot sequence as `_layout.tsx` performs it: decide, then record only if
 * the record is stale. Modelled here rather than asserted piecemeal because
 * the property that matters spans launches — the notice must still fire
 * exactly once (verified live across a v5→v6 wipe and two relaunches, #292),
 * and the blob must be written exactly once, not once per launch.
 */
function simulateLaunch(
  settings: BridgeSettings,
  context: SchemaVersionContext
): { readonly settings: BridgeSettings; readonly noticeShown: boolean; readonly wrote: boolean } {
  const noticeShown = shouldShowSchemaResetNotice(settings, context);
  const wrote = needsSchemaVersionRecord(settings, context);
  return {
    settings: wrote ? { ...settings, ...schemaVersionRecordPatch(context) } : settings,
    noticeShown,
    wrote,
  };
}

describe('the boot sequence across launches', () => {
  it('shows the notice once and writes the blob once, on an install the wipe hit', () => {
    const first = simulateLaunch(ESTABLISHED, V6);
    expect(first.noticeShown).toBe(true);
    expect(first.wrote).toBe(true);

    const second = simulateLaunch(first.settings, V6);
    expect(second.noticeShown).toBe(false);
    expect(second.wrote).toBe(false);

    const third = simulateLaunch(second.settings, V6);
    expect(third.noticeShown).toBe(false);
    expect(third.wrote).toBe(false);
  });

  it('never shows the notice to a fresh install, even after it starts being used', () => {
    // The trap the guard must not open: launch 1 is a fresh install, so it has
    // nothing to say — but it MUST still record the version. Between launches
    // the user types an API key, which is exactly what
    // `hasPriorInstallEvidence` reads. Without launch 1's write, launch 2 would
    // announce a data wipe that never happened.
    const first = simulateLaunch(FRESH, V6);
    expect(first.noticeShown).toBe(false);
    expect(first.wrote).toBe(true);

    const used = { ...first.settings, anthropicKey: 'sk-ant-typed-later' };
    const second = simulateLaunch(used, V6);
    expect(second.noticeShown).toBe(false);
    expect(second.wrote).toBe(false);
  });

  it('writes exactly once more when a later version bump arrives', () => {
    const settled = simulateLaunch(ESTABLISHED, V6).settings;
    expect(simulateLaunch(settled, V6).wrote).toBe(false);

    const bumped = simulateLaunch(settled, V7_COVERED);
    // Covered bump: nothing was lost, so no notice — but the record moves.
    expect(bumped.noticeShown).toBe(false);
    expect(bumped.wrote).toBe(true);
    expect(bumped.settings.lastSchemaVersion).toBe(7);
    expect(simulateLaunch(bumped.settings, V7_COVERED).wrote).toBe(false);
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

  // "currently describes a destructive bump, which is the whole point of
  // Phase 1" deleted (#276 Phase 6): it pinned a fact scoped to Phase 1 on
  // purpose (`migrations.ts` stopped short of `databaseSchema.version`, so
  // any live upgrade wiped the database) — the same commit that added it
  // ("test(#276): failing coverage for the per-set routine table (Phase 1)")
  // introduced the `V7_COVERED` fixture above precisely to describe what
  // Phase 6 would make true instead. `db/migrations.ts` now carries a real
  // `toVersion: 7` step, so `databaseSchema.version` (7) equals
  // `migrations.maxVersion` (7) and `isDestructiveSchemaUpgrade` returns
  // `false` for this exact call — the opposite of what this test asserted.
  // That is not a regression to chase: it is the bump becoming covered,
  // which "stays silent after Phase 6's covered bump, even for an
  // established install" (above) already exercises with the same
  // now-live values via `V7_COVERED`. Re-asserting the flipped boolean here
  // would only duplicate that coverage.
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
 *
 * EVERY ANCHOR BELOW NAMES A CALL OR A JSX USE, NEVER A BARE IDENTIFIER, and
 * that is the whole point of the block. The first version of it asserted
 * `toContain('shouldShowSchemaResetNotice')`, `toContain('liveSchemaVersionContext')`,
 * `toContain('schemaVersionRecordPatch')` and `toContain('SCHEMA_RESET_NOTICE_TITLE')` —
 * and every one of those four strings appears in `_layout.tsx`'s *import block*.
 * Deleting the entire boot wiring while leaving the imports behind passed all
 * 2045 tests, and `npm run lint` reports the orphaned imports as warnings and
 * still exits 0, so nothing in the repo caught it. Four mutants were run
 * against that version and all four survived: delete the wiring, swap the
 * decide/record order, drop the record call, and render `{false ? (`.
 *
 * A bare-identifier `toContain` on an imported symbol is worth nothing here.
 * If you add an assertion to this block, anchor it on something the import
 * statement cannot satisfy, and watch it fail before you trust it.
 */
describe('_layout.tsx wiring (structural — read from source, not executed)', () => {
  const layout = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', '_layout.tsx'),
    'utf8'
  );

  const decideAt = layout.indexOf('setShowSchemaResetNotice(shouldShowSchemaResetNotice(');
  const recordAt = layout.indexOf('setSettings(schemaVersionRecordPatch(');

  it('imports the decision from schemaResetNotice rather than re-deriving it in the screen', () => {
    expect(layout).toMatch(/from ['"]@\/state\/schemaResetNotice['"]/);
    // The call, not the imported name: the boot effect must actually consult it.
    expect(decideAt).toBeGreaterThan(-1);
  });

  it('consults the decision with the live schema context', () => {
    // Parenthesised, so the import line cannot satisfy this on its own.
    expect(layout).toContain('liveSchemaVersionContext()');
  });

  it('records the current schema version, so the notice cannot show twice', () => {
    expect(recordAt).toBeGreaterThan(-1);
  });

  it('records only when the record is stale, rather than on every launch (#292)', () => {
    // Anchored on the whole `if (` head, deliberately: a bare
    // `toContain('needsSchemaVersionRecord(')` would be satisfied by an
    // INVERTED guard, which skips exactly the launch the record exists for.
    const guardAt = layout.indexOf(
      'if (needsSchemaVersionRecord(settingsAtBoot, schemaContext)) {'
    );
    expect(guardAt).toBeGreaterThan(-1);
    // The record must sit inside that guard, not beside it.
    expect(recordAt).toBeGreaterThan(guardAt);
  });

  it('guards on the pre-write settings snapshot the decision itself read', () => {
    // One `getSettings()` for both, so the guard cannot be handed a blob that
    // the record has already mutated.
    expect(layout).toContain('const settingsAtBoot = getSettings();');
    expect(layout).toContain('shouldShowSchemaResetNotice(settingsAtBoot, schemaContext)');
  });

  it('has exactly one record call, so a second unguarded one cannot hide behind it', () => {
    const occurrences = layout.split('setSettings(schemaVersionRecordPatch(').length - 1;
    expect(occurrences).toBe(1);
  });

  it('decides BEFORE it records, or the notice is suppressed on the one launch it exists for', () => {
    // Recording first writes lastSchemaVersion = 6, so the decision that runs
    // next takes shouldShowSchemaResetNotice's "already recorded" branch and
    // returns false — permanently, because the record is durable. The failure
    // is silent in the worst way: no crash, no red test, just a user whose
    // routines vanished with nothing on screen to explain it. The source
    // carries a comment saying "Decide BEFORE recording"; this is what makes
    // the comment enforceable.
    expect(decideAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(-1);
    expect(decideAt).toBeLessThan(recordAt);
  });

  it('renders the notice copy, gated on the decision rather than unconditionally or never', () => {
    expect(layout).toContain('{showSchemaResetNotice ? (');
    // Interpolated, so again the import block cannot satisfy these.
    expect(layout).toContain('{SCHEMA_RESET_NOTICE_TITLE}');
    expect(layout).toContain('{SCHEMA_RESET_NOTICE_BODY}');
  });

  /**
   * The banner's own body, sliced out so these assertions cannot be satisfied
   * by some unrelated style elsewhere in the file.
   *
   * The first version of the banner floated at a hardcoded `top: 60` and, in
   * the simulator, covered the Today screen's onboarding card — its title, its
   * body and the settings gear — leaving that card's Dismiss button visible
   * directly beneath the notice's own. Whether it *looks* right is still a
   * simulator question and always will be; what is pinnable is that it no
   * longer floats and no longer guesses at the notch.
   */
  const bannerStart = layout.indexOf('function SchemaResetBanner');
  const bannerEnd = layout.indexOf('export default function RootLayout');
  const banner = layout.slice(bannerStart, bannerEnd);

  it('has a locatable banner body for the checks below to read', () => {
    // Without this the slice could silently become '' and every assertion
    // below would pass vacuously.
    expect(bannerStart).toBeGreaterThan(-1);
    expect(bannerEnd).toBeGreaterThan(bannerStart);
  });

  it('does not position the notice absolutely, so it cannot cover a control', () => {
    expect(banner).not.toContain("position: 'absolute'");
    expect(banner).not.toMatch(/\btop:\s*\d/);
    expect(banner).not.toContain('zIndex');
  });

  it('takes the notch inset from the safe area instead of guessing an offset', () => {
    expect(banner).toContain("edges={['top']}");
  });
});
