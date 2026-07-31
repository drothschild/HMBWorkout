import * as fs from 'fs';
import * as path from 'path';

/**
 * Test support for interop specs that read routine files from the real
 * Obsidian vault. The vault renames files over time (e.g. date prefixes like
 * "2026-07-08 0935 Push.md"), so tests must resolve routines by logical name
 * instead of hardcoding filenames.
 */

export const DEFAULT_VAULT_SYNC_DIR =
  '/Users/davidrothschild/Documents/Obsidian/Organizer/2-Areas/Exercise/_sync';

/**
 * The vault `_sync` directory to test against. Override with the
 * HMB_VAULT_SYNC_DIR environment variable.
 */
export function getVaultSyncDir(
  env: Record<string, string | undefined> = process.env
): string {
  return env.HMB_VAULT_SYNC_DIR || DEFAULT_VAULT_SYNC_DIR;
}

/**
 * Resolve the markdown file for a logical routine name (e.g. "Push") inside
 * the vault `_sync` directory, tolerating date-prefix renames. Matches
 * `<name>.md` exactly or any filename ending in ` <name>.md` (the space keeps
 * e.g. "SuperPush.md" from matching "Push"). When several files match, the
 * most recently modified one wins.
 */
export function resolveRoutineFile(dir: string, routineName: string): string {
  if (!fs.existsSync(dir)) {
    throw new Error(`Vault _sync directory not found: ${dir}`);
  }

  const suffix = `${routineName}.md`;
  const entries = fs.readdirSync(dir);
  const candidates = entries.filter(
    (name) => name === suffix || name.endsWith(` ${suffix}`)
  );

  if (candidates.length === 0) {
    throw new Error(
      `No routine file matching "${suffix}" (exact or "* ${suffix}") found in ${dir}. ` +
        `Files present: ${entries.join(', ') || '(none)'}`
    );
  }

  const ranked = candidates
    .map((name) => {
      const filePath = path.join(dir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));

  return ranked[0].filePath;
}
