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
  throw new Error('not implemented');
}

/**
 * Resolve the markdown file for a logical routine name (e.g. "Push") inside
 * the vault `_sync` directory, tolerating date-prefix renames.
 */
export function resolveRoutineFile(dir: string, routineName: string): string {
  throw new Error('not implemented');
}
