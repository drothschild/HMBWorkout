/**
 * Sync service tests
 * AC5.1: offline sessions queue and flip to synced on retry
 * AC5.3: retrying already-synced sessions is idempotent
 * AC4.5: unreachable health short-circuits without posts
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import {
  createSession,
  deleteSession,
  deleteRoutine,
  appendSet,
  updateRoutineExerciseExerciseId,
} from '@/db/repository';
import { BridgeUnreachable, BridgeHttpError } from './bridgeClient';
import { createSyncService, defaultTargetSetsForDurationLine } from './syncService';
import { parseSession } from '@/interop/parse';

describe('Sync Service', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('AC5.1: offline sessions queue and flip to synced', () => {
    it('stores session as "local" when bridge is unreachable', async () => {
      const mockBridgeClient = {
        health: jest.fn().mockRejectedValueOnce(new BridgeUnreachable('Network error')),
        postSession: jest.fn(),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Create a finished session
      await createSession(database, {
        sessionId: 'session-1',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      // Manually mark session as finished (set ended_at)
      const session = await database.get('sessions').find('session-1');
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      // Run sync while unreachable
      await syncService.syncNow();

      // Verify health was called
      expect(mockBridgeClient.health).toHaveBeenCalled();

      // Verify postSession was NOT called (early return)
      expect(mockBridgeClient.postSession).not.toHaveBeenCalled();

      // Verify session is still "local"
      const updatedSession = await database.get('sessions').find('session-1');
      expect((updatedSession as any).customSyncStatus).toBe('local');
    });

    it('transitions session to "synced" on later successful sync', async () => {
      const postSessionCalls: any[] = [];
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValueOnce({ ok: true }),
        postSession: jest.fn().mockImplementation(async (payload) => {
          postSessionCalls.push(payload);
        }),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Set up routine and exercise
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re._raw.routine_id = 'routine-1';
          re._raw.exercise_id = 'exercise-1';
          re._raw.order = 0; // Canonical 0-based order
          re._raw.warmup_sets = 0;
        });
      });

      // Create a finished session
      await createSession(database, {
        sessionId: 'session-1',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      // Manually mark session as finished
      const session = await database.get('sessions').find('session-1');
      const endedAt = Date.now();
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = endedAt;
        });
      });

      // Run sync
      await syncService.syncNow();

      // Verify health was called
      expect(mockBridgeClient.health).toHaveBeenCalled();

      // Verify postSession was called (because health is ok and session is finished)
      expect(mockBridgeClient.postSession).toHaveBeenCalled();

      // Verify session transitioned to "synced"
      const updatedSession = await database.get('sessions').find('session-1');
      expect((updatedSession as any).customSyncStatus).toBe('synced');
    });
  });

  describe('vault export after a mid-session exercise replacement', () => {
    // A session can sit at sync_status='local' for days (bridge offline). If a
    // ReplaceExercise swap lands in the meantime, the routine_exercises row now
    // names the substitute — but the markdown posted to the vault must still
    // name what was actually performed.
    async function seedSwappedRoutine() {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Push Day';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        for (const [id, title] of [
          ['barbell-bench-press', 'Barbell Bench Press'],
          ['dumbbell-floor-press', 'Dumbbell Floor Press'],
        ]) {
          await database.get('exercises').create((e: any) => {
            e._raw.id = id;
            e.title = title;
            e.kind = 'strength';
            e._raw.created_at = Date.now();
          });
        }
        await database.get('routine_exercises').create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re._raw.routine_id = 'routine-1';
          re._raw.exercise_id = 'barbell-bench-press';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      await createSession(database, {
        sessionId: 'session-1',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-1', 'routine-exercise-1', {
        setType: 'working',
        reps: 6,
        weightKg: 80,
        exerciseId: 'barbell-bench-press',
      });
      await database.write(async () => {
        const session = await database.get('sessions').find('session-1');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });
    }

    function makeClient(postSessionCalls: any[]) {
      return {
        health: jest.fn().mockResolvedValue({ ok: true }),
        postSession: jest.fn().mockImplementation(async (payload) => {
          postSessionCalls.push(payload);
        }),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };
    }

    it('serializes the exercise performed, not the substitute swapped in later', async () => {
      await seedSwappedRoutine();
      await updateRoutineExerciseExerciseId(
        database,
        'routine-exercise-1',
        'dumbbell-floor-press'
      );

      const postSessionCalls: any[] = [];
      await createSyncService(database, makeClient(postSessionCalls)).syncNow();

      expect(postSessionCalls).toHaveLength(1);
      expect(postSessionCalls[0].markdown).toContain('- barbell-bench-press: 1x6');
      expect(postSessionCalls[0].markdown).not.toContain('dumbbell-floor-press');
    });

    it('changes only the identity slot, leaving the rest of the line alone', async () => {
      // The swap must not perturb the grammar: same flags, same order, same
      // block. (serialize → parse symmetry for this case is pinned in the
      // interop round-trip suite, where the inputs are contract-shaped.)
      await seedSwappedRoutine();

      const before: any[] = [];
      await createSyncService(database, makeClient(before)).syncNow();

      await database.write(async () => {
        const session = await database.get('sessions').find('session-1');
        await (session as any).update((record: any) => {
          record._raw.sync_status = 'local';
        });
      });
      await updateRoutineExerciseExerciseId(
        database,
        'routine-exercise-1',
        'dumbbell-floor-press'
      );

      const after: any[] = [];
      await createSyncService(database, makeClient(after)).syncNow();

      expect(after[0].markdown).toBe(before[0].markdown);
    });

    it('serializes an unswapped routine exactly as before', async () => {
      await seedSwappedRoutine();

      const postSessionCalls: any[] = [];
      await createSyncService(database, makeClient(postSessionCalls)).syncNow();

      expect(postSessionCalls[0].markdown).toContain('- barbell-bench-press: 1x6');
    });
  });

  describe('vault export omits unset optional fields cleanly', () => {
    // WatermelonDB returns null (not undefined) for an unset optional column.
    // syncService maps DB rows straight through, and serialize.ts's flag
    // guards check `!== undefined` — null sails past them and gets emitted
    // literally (e.g. "rpe=null"), which parseFlags then rejects. The interop
    // roundtrip suite can't catch this class of bug: its fixtures pass
    // undefined, which the guards handle correctly. Only a DB-backed path
    // exercises the real null.
    it('produces markdown that parseSession can read back, for a strength set with no RPE logged', async () => {
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValue({ ok: true }),
        postSession: jest.fn(),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re._raw.routine_id = 'routine-1';
          re._raw.exercise_id = 'exercise-1';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
          // rest_seconds deliberately left unset (null), same as rpe/distanceM
          // below — exercises the same guard bug on the routine_exercises side.
        });
      });

      await createSession(database, {
        sessionId: 'session-1',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      // Real repository path: log a set with reps + weight, no RPE — matches
      // the reported repro exactly. appendSet's create callback only assigns
      // a column when the option is provided, so rpe/distanceM/durationSeconds
      // stay at WatermelonDB's default for an unset optional column: null.
      await appendSet(database, 'session-1', 'routine-exercise-1', {
        setType: 'working',
        reps: 6,
        weightKg: 80,
      });

      const session = await database.get('sessions').find('session-1');
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      const syncService = createSyncService(database, mockBridgeClient);
      await syncService.syncNow();

      expect(mockBridgeClient.postSession).toHaveBeenCalledTimes(1);
      const { markdown } = mockBridgeClient.postSession.mock.calls[0][0];

      // The bridge's validateSessionDoc only checks frontmatter + block
      // presence (workout-bridge/src/contract.ts) — it never runs parseFlags,
      // so a "rpe=null" line is written into the vault as-is instead of being
      // rejected. parseSession is the app-side grammar check standing in here
      // for "is this valid contract markdown".
      expect(() => parseSession(markdown)).not.toThrow();
    });
  });

  describe('AC5.3: idempotent posting', () => {
    it('retrying already-synced session does not re-post', async () => {
      const postSessionCalls: any[] = [];
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValue({ ok: true }),
        postSession: jest.fn().mockImplementation(async (payload) => {
          postSessionCalls.push(payload);
        }),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Create a finished session
      await createSession(database, {
        sessionId: 'session-1',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });

      // Manually mark session as finished
      const session = await database.get('sessions').find('session-1');
      const endedAt = Date.now();
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = endedAt;
          record._raw.sync_status = 'synced'; // Already synced
        });
      });

      // Run sync twice
      await syncService.syncNow();
      await syncService.syncNow();

      // Verify postSession was never called (session is already synced)
      expect(mockBridgeClient.postSession).not.toHaveBeenCalled();
    });
  });

  describe('AC4.5: unreachable health short-circuits', () => {
    it('returns early without posting when health is unreachable', async () => {
      const mockBridgeClient = {
        health: jest.fn().mockRejectedValueOnce(new BridgeUnreachable('Offline')),
        postSession: jest.fn(),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Create multiple finished sessions
      for (let i = 1; i <= 3; i++) {
        await createSession(database, {
          sessionId: `session-${i}`,
          routineId: 'routine-1',
          startedAtMs: Date.now(),
        });

        const session = await database.get('sessions').find(`session-${i}`);
        await database.write(async () => {
          await (session as any).update((record: any) => {
            record._raw.ended_at = Date.now();
          });
        });
      }

      // Run sync
      await syncService.syncNow();

      // Verify health was called
      expect(mockBridgeClient.health).toHaveBeenCalled();

      // Verify postSession was NOT called (zero posts attempted)
      expect(mockBridgeClient.postSession).not.toHaveBeenCalled();
    });
  });

  describe('deleted sessions are not queued for sync', () => {
    it('posts a finished session when NOT deleted (control)', async () => {
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValue({ ok: true }),
        postSession: jest.fn(),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Set up routine and exercise (same fixture as "transitions to synced" test)
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re._raw.routine_id = 'routine-1';
          re._raw.exercise_id = 'exercise-1';
          re._raw.order = 0; // Canonical 0-based order
          re._raw.warmup_sets = 0;
        });
      });

      // Create a finished session with a logged set
      await createSession(database, {
        sessionId: 'session-kept',
        routineId: 'routine-1',
        startedAtMs: Date.now() - 60000,
      });
      await appendSet(database, 'session-kept', 'routine-exercise-1', {
        setType: 'working',
        reps: 8,
        weightKg: 100,
      });
      const session = await database.get('sessions').find('session-kept');
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      await syncService.syncNow();

      // Verify postSession WAS called (session not deleted)
      expect(mockBridgeClient.health).toHaveBeenCalled();
      expect(mockBridgeClient.postSession).toHaveBeenCalled();
    }, 15000);

    it('does not post a session that was deleted before syncNow runs', async () => {
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValue({ ok: true }),
        postSession: jest.fn(),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Set up routine and exercise (same fixture as control)
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re._raw.routine_id = 'routine-1';
          re._raw.exercise_id = 'exercise-1';
          re._raw.order = 0; // Canonical 0-based order
          re._raw.warmup_sets = 0;
        });
      });

      // Create and finish a session with a logged set, then delete it before sync ever runs.
      await createSession(database, {
        sessionId: 'session-deleted',
        routineId: 'routine-1',
        startedAtMs: Date.now(),
      });
      await appendSet(database, 'session-deleted', 'routine-exercise-1', {
        setType: 'working',
        reps: 8,
        weightKg: 100,
      });
      const session = await database.get('sessions').find('session-deleted');
      await database.write(async () => {
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      await deleteSession(database, 'session-deleted');

      await syncService.syncNow();

      // The row is gone, so the candidate query in syncNow() never selects it.
      expect(mockBridgeClient.health).toHaveBeenCalled();
      expect(mockBridgeClient.postSession).not.toHaveBeenCalled();
    }, 15000);
  });

  describe('error handling', () => {
    it('continues syncing other sessions if one post fails', async () => {
      const postSessionCalls: any[] = [];
      let postCount = 0;
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValueOnce({ ok: true }),
        postSession: jest.fn().mockImplementation(async (payload) => {
          postCount++;
          if (payload.id === 'session-1' && postCount === 1) {
            throw new BridgeHttpError(500, 'Server error');
          }
          postSessionCalls.push(payload);
        }),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      const syncService = createSyncService(database, mockBridgeClient);

      // Set up routine and exercise
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Test Routine';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-1';
          re._raw.routine_id = 'routine-1';
          re._raw.exercise_id = 'exercise-1';
          re._raw.order = 1;
          re._raw.warmup_sets = 0;
        });
      });

      // Create two finished sessions
      for (let i = 1; i <= 2; i++) {
        await createSession(database, {
          sessionId: `session-${i}`,
          routineId: 'routine-1',
          startedAtMs: Date.now(),
        });

        const session = await database.get('sessions').find(`session-${i}`);
        await database.write(async () => {
          await (session as any).update((record: any) => {
            record._raw.ended_at = Date.now();
          });
        });
      }

      // Run sync
      await syncService.syncNow();

      // Session 1 should fail and stay "local"
      const session1 = await database.get('sessions').find('session-1');
      expect((session1 as any).customSyncStatus).toBe('local');

      // Session 2 should succeed and become "synced"
      const session2 = await database.get('sessions').find('session-2');
      expect((session2 as any).customSyncStatus).toBe('synced');
    });
  });

  describe('deleteRoutine does not collaterally swallow unrelated syncs', () => {
    it('deleting a routine whose sessions are all synced still lets syncNow post an unrelated pending session', async () => {
      const postSessionCalls: any[] = [];
      const mockBridgeClient = {
        health: jest.fn().mockResolvedValue({ ok: true }),
        postSession: jest.fn().mockImplementation(async (payload) => {
          postSessionCalls.push(payload);
        }),
        getRoutines: jest.fn(),
        getRoutine: jest.fn(),
      };

      await database.write(async () => {
        const routinesTable = database.get('routines');
        const exercisesTable = database.get('exercises');
        const routineExercisesTable = database.get('routine_exercises');

        // Routine A: will be deleted after its only session is synced.
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-a';
          r.name = 'Routine A';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-a';
          e.title = 'Exercise A';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-a';
          re._raw.routine_id = 'routine-a';
          re._raw.exercise_id = 'exercise-a';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });

        // Routine B: stays, still has a pending unsynced session.
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-b';
          r.name = 'Routine B';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-b';
          e.title = 'Exercise B';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-b';
          re._raw.routine_id = 'routine-b';
          re._raw.exercise_id = 'exercise-b';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      // Session A: finished and already synced, referencing routine A.
      await createSession(database, {
        sessionId: 'session-a',
        routineId: 'routine-a',
        startedAtMs: Date.now() - 120000,
      });
      await database.write(async () => {
        const session = await database.get('sessions').find('session-a');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now() - 60000;
          record._raw.sync_status = 'synced';
        });
      });

      // Session B: finished, still pending ("local"), referencing routine B.
      await createSession(database, {
        sessionId: 'session-b',
        routineId: 'routine-b',
        startedAtMs: Date.now() - 30000,
      });
      await database.write(async () => {
        const session = await database.get('sessions').find('session-b');
        await (session as any).update((record: any) => {
          record._raw.ended_at = Date.now();
        });
      });

      // Deleting routine A is allowed because its only session is synced.
      await deleteRoutine(database, 'routine-a');

      // Precondition: routine-a should be gone
      await expect(database.get('routines').find('routine-a')).rejects.toThrow();

      const syncService = createSyncService(database, mockBridgeClient);
      await syncService.syncNow();

      // Routine A's absence must not collaterally block session B's post.
      expect(postSessionCalls).toHaveLength(1);
      expect(postSessionCalls[0].id).toBe('session-b');

      const updatedSessionB = await database.get('sessions').find('session-b');
      expect((updatedSessionB as any).customSyncStatus).toBe('synced');
    });
  });

  describe('defaultTargetSetsForDurationLine', () => {
    it('returns the targetSets value unchanged when it is defined', () => {
      expect(defaultTargetSetsForDurationLine(5, undefined)).toBe(5);
      expect(defaultTargetSetsForDurationLine(3, 2)).toBe(3);
      // An explicit 0 is passed through unchanged — only an *absent* targetSets is
      // defaulted. Layer-2 only: as of the parseWorkoutLine zero-sets guard, no
      // authoring path can still deliver an explicit 0 here (vault `0x10` throws at
      // parse; an AI draft's targetSets: 0 fails validateRoutineDraft's >= 1 bound).
      expect(defaultTargetSetsForDurationLine(0, 0)).toBe(0);
    });

    it('defaults to 1 when targetSets is undefined and warmupSets is undefined', () => {
      expect(defaultTargetSetsForDurationLine(undefined, undefined)).toBe(1);
    });

    it('defaults to 1 when targetSets is undefined and warmupSets is 0', () => {
      expect(defaultTargetSetsForDurationLine(undefined, 0)).toBe(1);
    });

    it('returns undefined when targetSets is undefined but warmupSets is > 0 (entry already has sets)', () => {
      // This guards against the sync warmup case: if warmupSets is 2, the entry
      // already has 2 sets of activity, so don't add a third.
      expect(defaultTargetSetsForDurationLine(undefined, 1)).toBeUndefined();
      expect(defaultTargetSetsForDurationLine(undefined, 2)).toBeUndefined();
    });
  });
});
