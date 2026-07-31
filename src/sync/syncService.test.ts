/**
 * Sync service tests
 * AC5.1: offline sessions queue and flip to synced on retry
 * AC5.3: retrying already-synced sessions is idempotent
 * AC4.5: unreachable health short-circuits without posts
 */

import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, deleteSession, deleteRoutine, appendSet } from '@/db/repository';
import { BridgeUnreachable, BridgeHttpError } from './bridgeClient';
import { createSyncService } from './syncService';

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
});
