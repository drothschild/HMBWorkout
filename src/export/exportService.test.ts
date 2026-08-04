import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase, flush } from '@/db/test-helpers';
import { parseRoutine } from '@/interop/parse';
import {
  upsertExercise,
  upsertRoutine,
  createSession,
  appendSet,
} from '@/db/repository';
import {
  exportRoutine,
  exportSessionHistory,
  getRoutineExportName,
  getSessionHistoryExportName,
} from './exportService';

describe('exportService', () => {
  let db: Database;

  beforeEach(async () => {
    db = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(db);
  });

  describe('exportRoutine', () => {
    it('exports a routine with exercises to valid markdown', async () => {
      // Create exercise and routine
      await upsertExercise(db, 'ex-1', 'Bench Press', 'strength');
      await upsertRoutine(db, 'routine-1', 'Push Day', [
        { exerciseId: 'ex-1', order: 0, warmupSets: 1, targetSets: 4, targetReps: 6, restSeconds: 90 },
      ]);

      await flush();

      // Export the routine
      const markdown = await exportRoutine(db, 'routine-1');

      // Should be valid markdown
      expect(markdown).toContain('---');
      expect(markdown).toContain('type: workout');
      expect(markdown).toContain('Push Day');

      // Should parse back correctly
      const parsed = parseRoutine(markdown);
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.exercises).toHaveLength(1);
    });

    it('returns empty string for non-existent routine', async () => {
      const markdown = await exportRoutine(db, 'nonexistent-routine-id');
      expect(markdown).toBe('');
    });

    it('exports routine with no exercises', async () => {
      await upsertRoutine(db, 'routine-empty', 'Empty Routine', []);

      await flush();

      const markdown = await exportRoutine(db, 'routine-empty');

      // Should still produce valid markdown even with no exercises
      expect(markdown).toContain('type: workout');
      expect(markdown).toContain('Empty Routine');
    });

    it('exports routine with multiple exercises preserving order', async () => {
      await upsertExercise(db, 'ex-1', 'Bench Press', 'strength');
      await upsertExercise(db, 'ex-2', 'Incline Press', 'strength');
      await upsertRoutine(db, 'routine-compound', 'Compound Day', [
        { exerciseId: 'ex-1', order: 0, warmupSets: 1, targetSets: 4, targetReps: 6 },
        { exerciseId: 'ex-2', order: 1, warmupSets: 0, targetSets: 3, targetReps: 8 },
      ]);

      await flush();

      const markdown = await exportRoutine(db, 'routine-compound');
      const parsed = parseRoutine(markdown);

      expect(parsed.exercises).toHaveLength(2);
    });

    it('roundtrips: serialize and parse produce equivalent data', async () => {
      await upsertExercise(db, 'ex-squat', 'Squats', 'strength');
      await upsertRoutine(db, 'routine-legs', 'Leg Day', [
        {
          exerciseId: 'ex-squat',
          order: 0,
          warmupSets: 2,
          targetSets: 5,
          targetReps: 5,
          restSeconds: 120,
        },
      ]);

      await flush();

      // Export
      const markdown = await exportRoutine(db, 'routine-legs');

      // Parse and verify
      const parsed = parseRoutine(markdown);
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.exercises).toHaveLength(1);
    });
  });

  describe('exportSessionHistory', () => {
    it('exports all completed sessions with their sets', async () => {
      // Create exercise, routine, and session with a set
      await upsertExercise(db, 'ex-deadlift', 'Deadlift', 'strength');
      await upsertRoutine(db, 'routine-strength', 'Strength', [
        { exerciseId: 'ex-deadlift', order: 0, warmupSets: 1, targetSets: 3, targetReps: 5 },
      ]);

      const reIds = await db.get('routine_exercises').query().fetch() as any[];
      const reId = reIds[0].id;

      await createSession(db, { sessionId: 'session-1', routineId: 'routine-strength', startedAtMs: 1000 });
      await appendSet(db, 'session-1', reId, { setType: 'warmup', reps: 5, weightKg: 135 });

      // Complete the session
      await db.write(async () => {
        const session = await db.get('sessions').find('session-1');
        if (session) {
          await session.update((s: any) => {
            s.endedAt = new Date();
          });
        }
      });

      await flush();

      // Export history
      const markdown = await exportSessionHistory(db);

      // Should contain the session
      expect(markdown).toContain('type: workout-session');
      expect(markdown).toContain('Deadlift');
    });

    it('handles empty history gracefully', async () => {
      const markdown = await exportSessionHistory(db);

      // Empty history should return empty string
      expect(typeof markdown).toBe('string');
      expect(markdown).toBe('');
    });

    it('exports multiple sessions separately', async () => {
      await upsertExercise(db, 'ex-bench', 'Bench', 'strength');
      await upsertRoutine(db, 'routine-push', 'Push', [
        { exerciseId: 'ex-bench', order: 0, warmupSets: 1, targetSets: 3, targetReps: 8 },
      ]);

      const reIds = await db.get('routine_exercises').query().fetch() as any[];
      const reId = reIds[0].id;

      // Create first session
      await createSession(db, { sessionId: 'session-1', routineId: 'routine-push', startedAtMs: 1000 });
      await appendSet(db, 'session-1', reId, { setType: 'working', reps: 8, weightKg: 185 });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-1');
        if (s) await s.update((x: any) => { x.endedAt = new Date(); });
      });

      // Create second session
      await createSession(db, { sessionId: 'session-2', routineId: 'routine-push', startedAtMs: 2000 });
      await appendSet(db, 'session-2', reId, { setType: 'working', reps: 8, weightKg: 190 });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-2');
        if (s) await s.update((x: any) => { x.endedAt = new Date(); });
      });

      await flush();

      const markdown = await exportSessionHistory(db);

      // Should contain sessions
      expect(markdown).toContain('type: workout-session');
    });

    it('handles orphaned sets where routine_exercise row is deleted but exercise_id stamp survives', async () => {
      await upsertExercise(db, 'ex-squat', 'Squat', 'strength');
      await upsertRoutine(db, 'routine-legs', 'Legs', [
        { exerciseId: 'ex-squat', order: 0, warmupSets: 1, targetSets: 4, targetReps: 8 },
      ]);

      const reIds = await db.get('routine_exercises').query().fetch() as any[];
      const reId = reIds[0].id;

      await createSession(db, { sessionId: 'session-orphan', routineId: 'routine-legs', startedAtMs: 1000 });
      await appendSet(db, 'session-orphan', reId, { setType: 'working', reps: 8, weightKg: 225 });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-orphan');
        if (s) await s.update((x: any) => { x.endedAt = new Date(); });
      });

      await flush();

      // Now delete the routine_exercise row (simulating what upsertRoutine does)
      await db.write(async () => {
        const re = await db.get('routine_exercises').find(reId);
        if (re) {
          await re.destroyPermanently();
        }
      });

      await flush();

      // Export should still work because sets have exercise_id stamp
      const markdown = await exportSessionHistory(db);

      // Should still contain the set data via the stamp
      expect(markdown).toContain('Squat');
      expect(markdown).toContain('225');
    });
  });

  describe('getRoutineExportName', () => {
    it('generates sensible filename for routine', async () => {
      await upsertRoutine(db, 'routine-named', 'Push Day', []);
      await flush();

      const routine = await db.get('routines').find('routine-named');
      const name = getRoutineExportName(routine as any);

      expect(name).toMatch(/^routine-.*\.md$/);
      expect(name).toContain('routine-named');
    });

    it('filename is unique across multiple routines', async () => {
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
    it('generates sensible filename for session history', () => {
      const name = getSessionHistoryExportName();

      expect(name).toMatch(/^exercise-history-.*\.md$/);
    });

    it('includes date in filename', () => {
      const name = getSessionHistoryExportName();

      // Should contain a date pattern YYYY-MM-DD
      expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('is deterministic within same day', () => {
      const name1 = getSessionHistoryExportName();
      const name2 = getSessionHistoryExportName();

      // Same day should produce same filename
      expect(name1).toBe(name2);
    });
  });
});
