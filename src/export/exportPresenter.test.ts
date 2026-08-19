import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import { upsertRoutine } from '@/db/repository';
import {
  getRoutineExportName,
  getSessionHistoryExportName,
} from './exportPresenter';

describe('exportPresenter', () => {
  let db: Database;

  beforeEach(async () => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  describe('getRoutineExportName', () => {
    it('generates filename format routine-{id}.md', async () => {
      await upsertRoutine(db, 'routine-test', 'Push Day', []);
      await flush();

      const routine = await db.get('routines').find('routine-test');
      const name = getRoutineExportName(routine as any);

      expect(name).toMatch(/^routine-[a-z0-9-]+\.md$/);
      expect(name).toContain('routine-test');
    });

    it('filename is deterministic for same routine', async () => {
      await upsertRoutine(db, 'routine-strength', 'Strength', []);
      await flush();

      const routine = await db.get('routines').find('routine-strength');
      const name1 = getRoutineExportName(routine as any);
      const name2 = getRoutineExportName(routine as any);

      expect(name1).toBe(name2);
    });

    it('different routines get different filenames', async () => {
      await upsertRoutine(db, 'routine-push', 'Push', []);
      await upsertRoutine(db, 'routine-pull', 'Pull', []);
      await flush();

      const routine1 = await db.get('routines').find('routine-push');
      const routine2 = await db.get('routines').find('routine-pull');

      const name1 = getRoutineExportName(routine1 as any);
      const name2 = getRoutineExportName(routine2 as any);

      expect(name1).not.toBe(name2);
    });

    // AC1.4: the name must survive being written to disk — non-empty,
    // `.md`-suffixed, no path separators or drive/scheme colons. A routine id
    // is minted as `routine-<epoch>` or a `slugifyTitle` output, both of which
    // are `[a-z0-9-]`, so this holds by construction; pinned so a future id
    // scheme that admits `/` or `:` fails here rather than producing an
    // unwritable filename in the share flow.
    it('produces a disk-safe filename (AC1.4)', async () => {
      await upsertRoutine(db, 'routine-1755555555555', 'Push Day', []);
      await flush();

      const routine = await db.get('routines').find('routine-1755555555555');
      const name = getRoutineExportName(routine as any);

      expect(name.length).toBeGreaterThan(0);
      expect(name.endsWith('.md')).toBe(true);
      expect(name).not.toContain('/');
      expect(name).not.toContain(':');
    });
  });

  describe('getSessionHistoryExportName', () => {
    it('generates filename format exercise-history-{date}.md', () => {
      const name = getSessionHistoryExportName();

      expect(name).toMatch(/^exercise-history-\d{4}-\d{2}-\d{2}\.md$/);
    });

    it('includes today\'s date in ISO format', () => {
      const name = getSessionHistoryExportName();

      const today = new Date().toISOString().split('T')[0];
      expect(name).toContain(today);
    });

    it('is deterministic within same day', () => {
      const name1 = getSessionHistoryExportName();
      const name2 = getSessionHistoryExportName();

      // Same day should produce same filename
      expect(name1).toBe(name2);
    });

    // AC1.4: disk-safe. `YYYY-MM-DD` carries no `/` or `:`.
    it('produces a disk-safe filename (AC1.4)', () => {
      const name = getSessionHistoryExportName();

      expect(name.length).toBeGreaterThan(0);
      expect(name.endsWith('.md')).toBe(true);
      expect(name).not.toContain('/');
      expect(name).not.toContain(':');
    });
  });
});
