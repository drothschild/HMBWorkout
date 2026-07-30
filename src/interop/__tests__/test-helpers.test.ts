import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_VAULT_SYNC_DIR,
  getVaultSyncDir,
  resolveRoutineFile,
} from '../test-helpers';

describe('getVaultSyncDir', () => {
  it('returns the default vault _sync dir when no override is set', () => {
    expect(getVaultSyncDir({})).toBe(DEFAULT_VAULT_SYNC_DIR);
  });

  it('honors the HMB_VAULT_SYNC_DIR override', () => {
    expect(getVaultSyncDir({ HMB_VAULT_SYNC_DIR: '/somewhere/else/_sync' })).toBe(
      '/somewhere/else/_sync'
    );
  });
});

describe('resolveRoutineFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-sync-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const touch = (name: string, mtime?: Date): string => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, '# stub');
    if (mtime) {
      fs.utimesSync(filePath, mtime, mtime);
    }
    return filePath;
  };

  it('resolves an exactly-named routine file', () => {
    const expected = touch('Push.md');
    expect(resolveRoutineFile(dir, 'Push')).toBe(expected);
  });

  it('resolves a date-prefixed routine file, ignoring unrelated files', () => {
    const expected = touch('2026-07-08 0935 Push.md');
    touch('2026-07-21 2121 session-session-1784693943609.md');
    touch('2026-07-08 0935 Pull.md');
    expect(resolveRoutineFile(dir, 'Push')).toBe(expected);
  });

  it('does not match files that only contain the name without a word boundary', () => {
    touch('2026-07-08 0935 SuperPush.md');
    expect(() => resolveRoutineFile(dir, 'Push')).toThrow('Push');
  });

  it('picks the most recently modified file when several match', () => {
    touch('2026-07-08 0935 Push.md', new Date('2026-07-08T09:35:00Z'));
    const newest = touch('2026-07-30 0800 Push.md', new Date('2026-07-30T08:00:00Z'));
    expect(resolveRoutineFile(dir, 'Push')).toBe(newest);
  });

  it('throws an error naming the routine and directory when nothing matches', () => {
    touch('Pull.md');
    expect(() => resolveRoutineFile(dir, 'Push')).toThrow('Push');
    expect(() => resolveRoutineFile(dir, 'Push')).toThrow(dir);
  });

  it('throws an error naming the directory when the directory is missing', () => {
    const missing = path.join(dir, 'does-not-exist');
    expect(() => resolveRoutineFile(missing, 'Push')).toThrow(missing);
  });
});
