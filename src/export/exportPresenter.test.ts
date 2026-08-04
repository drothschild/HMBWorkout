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
  });
});
