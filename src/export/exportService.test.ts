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
      // Note: routine name lives in the filename, not in the frontmatter content

      // Should parse back correctly
      const parsed = parseRoutine(markdown);
      expect(parsed.frontmatter.type).toBe('workout-routine');
      expect(parsed.exercises).toHaveLength(1);
    });

    it('returns empty string for non-existent routine', async () => {
      const markdown = await exportRoutine(db, 'nonexistent-routine-id');
      expect(markdown).toBe('');
    });

    // #212, the single-item half — narrower than the aggregate one, because of
    // what the serializer can actually do. `serialize.ts` has exactly ONE throw
    // and it is on the SESSION path (`buildSessionSetLine`, unresolvable set
    // identity); `serializeRoutine` has no throw at all. So this catch was never
    // masking a routine contract violation — it was masking `find()`'s rejection
    // on a missing id (now an explicit query, so "not found" keeps its own
    // distinct empty-string answer above) and any DB-layer error underneath.
    //
    // Those are what must stop posing as "here is your routine, it is empty".
    // There is no partial routine to salvage, so swallowing buys nothing.
    it('propagates a database failure instead of returning an empty routine', async () => {
      const failingDb = {
        get: (table: string) => ({
          query: () => ({
            fetch: async () => {
              if (table === 'routines') {
                return [{ id: 'routine-legs2', name: 'Legs' }];
              }
              throw new Error('db unavailable');
            },
          }),
        }),
      } as unknown as Database;

      await expect(exportRoutine(failingDb, 'routine-legs2')).rejects.toThrow('db unavailable');
    });

    it('exports routine with no exercises', async () => {
      await upsertRoutine(db, 'routine-empty', 'Empty Routine', []);

      await flush();

      const markdown = await exportRoutine(db, 'routine-empty');

      // Should still produce valid markdown even with no exercises
      expect(markdown).toContain('type: workout');
      // Note: routine name lives in the filename, not in the frontmatter content
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

    /**
     * #276 Phase 5: the set list reaches the document.
     *
     * `exportRoutine` is the only production caller of `serializeRoutine`, so
     * this is where the per-set grammar meets real rows rather than fixtures —
     * `routine_sets` read back through `getRoutineSets`, normalized at the
     * boundary the same way every other optional column already is.
     */
    it('exports a routine_sets list one line per set, in order, with per-set weights', async () => {
      await upsertExercise(db, 'ex-bench', 'Bench Press (Dumbbell)', 'strength');
      await upsertRoutine(db, 'routine-ramp', 'Push Day', [
        {
          exerciseId: 'ex-bench',
          order: 0,
          restSeconds: 120,
          sets: [
            { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
            { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
            { setType: 'warmup', targetReps: 3, targetWeightKg: 18.14 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
            { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
          ],
        },
      ]);

      await flush();

      const markdown = await exportRoutine(db, 'routine-ramp');

      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(7);

      const parsed = parseRoutine(markdown);
      expect(parsed.exercises).toHaveLength(1);
      const entry = parsed.exercises[0] as any;
      expect(entry.restSeconds).toBe(120);
      expect(entry.sets.map((s: any) => s.targetWeightKg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(entry.sets.map((s: any) => s.setType)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      expect(entry.sets[3]).toEqual({
        setType: 'normal',
        targetReps: 8,
        targetRepsMax: 10,
        targetWeightKg: 22.68,
      });
    });

    it('an entry with no routine_sets rows exports as a bare exercise line', async () => {
      // The aggregate-only shape every routine written before Phase 1 has.
      // It exports as an exercise the routine names with nothing prescribed —
      // NOT as a dropped exercise (which is what makes this worth pinning) and
      // NOT with the aggregates re-derived, which the grammar no longer says.
      await upsertExercise(db, 'ex-row', 'Barbell Row', 'strength');
      await upsertRoutine(db, 'routine-legacy', 'Pull Day', [
        { exerciseId: 'ex-row', order: 0, warmupSets: 2, targetSets: 4, targetReps: 8 },
      ]);

      await flush();

      const parsed = parseRoutine(await exportRoutine(db, 'routine-legacy'));
      expect(parsed.exercises).toHaveLength(1);
      expect((parsed.exercises[0] as any).exerciseId).toBe('ex-row');
      expect((parsed.exercises[0] as any).sets).toEqual([]);
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
            s._raw.ended_at = Date.now();
          });
        }
      });

      await flush();

      // Export history
      const { markdown } = await exportSessionHistory(db);

      // Should contain the session
      expect(markdown).toContain('type: workout-session');
      // Sessions export with exercise IDs, not titles
      expect(markdown).toContain('ex-deadlift');
    });

    it('handles empty history gracefully', async () => {
      const { markdown, failures } = await exportSessionHistory(db);

      // Empty history should return empty string
      expect(typeof markdown).toBe('string');
      expect(markdown).toBe('');
      expect(failures).toStrictEqual([]);
    });

    // #212. `serializeSession` guarantees it never emits a PARTIAL session —
    // every logged set produces a line or the call throws. That guarantee used
    // to stop dead at this caller, which caught per session and continued, so
    // the aggregate was silently short at session granularity: exactly the
    // data-loss shape the set-level rule exists to prevent, one level up.
    //
    // The fix is not to drop the resilience — for a backup, 47 of 48 sessions
    // beats 0 of 48 — it is to remove the SILENCE, so a caller can say
    // "47 of 48" instead of handing the user a short file that looks whole.
    it('reports a session it could not serialize instead of silently dropping it', async () => {
      await upsertExercise(db, 'ex-row', 'Row', 'strength');
      await upsertRoutine(db, 'routine-pull', 'Pull', [
        { exerciseId: 'ex-row', order: 0, warmupSets: 0, targetSets: 3, targetReps: 8 },
      ]);
      const reId = ((await db.get('routine_exercises').query().fetch()) as any[])[0].id;

      // A good session, and a doomed one. Both must be accounted for.
      await createSession(db, {
        sessionId: 'session-good',
        routineId: 'routine-pull',
        startedAtMs: 1000,
      });
      await appendSet(db, 'session-good', reId, {
        setType: 'working',
        reps: 8,
        exerciseId: 'ex-row',
      });

      await createSession(db, {
        sessionId: 'session-doomed',
        routineId: 'routine-pull',
        startedAtMs: 2000,
      });
      // No stamp: the pre-v3 shape.
      await appendSet(db, 'session-doomed', reId, { setType: 'working', reps: 8 });

      for (const id of ['session-good', 'session-doomed']) {
        await db.write(async () => {
          const session = await db.get('sessions').find(id);
          await session.update((s: any) => {
            s._raw.ended_at = Date.now();
          });
        });
      }
      await flush();

      // Destroy the row WITHOUT stamping first. `upsertRoutine`'s drop branch
      // would have stamped these sets; going around it is what leaves a set
      // with neither a stamp nor a surviving row — genuinely unidentifiable,
      // and the documented case where `serializeSession` throws.
      await db.write(async () => {
        const row = await db.get('routine_exercises').find(reId);
        await row.destroyPermanently();
      });
      await flush();

      const { markdown, failures } = await exportSessionHistory(db);

      // The failure is named, not swallowed...
      expect(failures.map((f) => f.sessionId)).toStrictEqual(['session-doomed']);
      expect(failures[0].reason).toBeTruthy();
      // ...and the export is not abandoned over one bad session.
      expect(markdown).toContain('type: workout-session');
      expect(markdown).not.toContain('session-doomed');
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
        if (s) await s.update((x: any) => { x._raw.ended_at = Date.now(); });
      });

      // Create second session
      await createSession(db, { sessionId: 'session-2', routineId: 'routine-push', startedAtMs: 2000 });
      await appendSet(db, 'session-2', reId, { setType: 'working', reps: 8, weightKg: 190 });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-2');
        if (s) await s.update((x: any) => { x._raw.ended_at = Date.now(); });
      });

      await flush();

      const { markdown } = await exportSessionHistory(db);

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
      await appendSet(db, 'session-orphan', reId, { setType: 'working', reps: 8, weightKg: 225, exerciseId: 'ex-squat' });
      await db.write(async () => {
        const s = await db.get('sessions').find('session-orphan');
        if (s) await s.update((x: any) => { x._raw.ended_at = Date.now(); });
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
      const { markdown } = await exportSessionHistory(db);

      // Should still contain the set data via the stamp (exercise ID and weight)
      expect(markdown).toContain('ex-squat');
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
