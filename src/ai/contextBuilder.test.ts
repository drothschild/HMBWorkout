import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, appendSet, upsertRoutineExercise } from '@/db/repository';
import { setSettings, injectSettingsStorage, resetForTesting } from '@/state/settings';
import { buildSystem, type AiCoachMode } from './contextBuilder';

describe('buildSystem: AI Coach context builder', () => {
  let database: Database;
  let fakeStorage: { [key: string]: string } = {};

  const fakeStorageBackend = {
    getItemAsync: async (key: string) => fakeStorage[key] ?? null,
    setItemAsync: async (key: string, value: string) => {
      fakeStorage[key] = value;
    },
    deleteItemAsync: async (key: string) => {
      delete fakeStorage[key];
    },
  };

  beforeEach(async () => {
    database = createTestDatabase();
    fakeStorage = {};
    resetForTesting();
    injectSettingsStorage(fakeStorageBackend);
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('Persona and rules', () => {
    it('includes exercise kind enum (strength, cardio, stretch) in persona', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('strength');
      expect(prompt).toContain('cardio');
      expect(prompt).toContain('stretch');
    }, 30000);

    it('includes guidance to reuse existing exercise titles', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Prefer reusing exercise titles that already exist in the user\'s data');
    }, 30000);

    it('includes persona units contract in exercise schema', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('warmupSets, targetDurationSeconds, restSeconds: when present, must be integers >= 0');
    }, 30000);

    it('IMPORTANT 1: includes constraint that draft must contain at least one exercise', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('at least one exercise');
      expect(prompt).toContain('exercises array must not be empty');
    }, 30000);

    it('includes constraint that a draft must have a non-empty name', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('A draft must have a non-empty name');
    }, 30000);

    it('IMPORTANT 1: includes constraint that exercise title must contain ASCII letters or digits', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('title: must contain at least one ASCII letter or digit (a-z, 0-9)');
    }, 30000);

    it('IMPORTANT 1: includes constraint that targetSets and targetReps must be >= 1 when present', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('targetSets, targetReps: when present, must be integers >= 1');
    }, 30000);
  });

  describe('AC2.2 — goals and equipment', () => {
    it('includes user goals and equipment in the system prompt', async () => {
      setSettings({
        aiGoals: 'Build strength and muscle',
        aiEquipment: 'Dumbbells and a pull-up bar',
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Build strength and muscle');
      expect(prompt).toContain('Dumbbells and a pull-up bar');
    }, 30000);

    it('includes "Not specified" placeholders when goals and equipment are empty', async () => {
      setSettings({ aiGoals: '', aiEquipment: '' });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Not specified');
    }, 30000);
  });

  describe('AC2.2 — routines', () => {
    it('includes routine names and exercise details in the prompt', async () => {
      // Seed first routine with exercises
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-1';
          r.name = 'Upper Body';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-2';
          e.title = 'Rows';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // Seed exercises into routine
      await upsertRoutineExercise(database, 'routine-1', {
        exerciseId: 'exercise-1',
        order: 0,
        warmupSets: 1,
        targetSets: 3,
        targetReps: 8,
        restSeconds: 120,
      });
      await upsertRoutineExercise(database, 'routine-1', {
        exerciseId: 'exercise-2',
        order: 1,
        targetSets: 4,
        targetReps: 10,
        restSeconds: 90,
      });

      // Seed second routine
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-2';
          r.name = 'Lower Body';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-3';
          e.title = 'Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      await upsertRoutineExercise(database, 'routine-2', {
        exerciseId: 'exercise-3',
        order: 0,
        targetSets: 3,
        targetReps: 5,
        restSeconds: 180,
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Upper Body');
      expect(prompt).toContain('Lower Body');
      expect(prompt).toContain('Bench Press');
      expect(prompt).toContain('Rows');
      expect(prompt).toContain('Squat');
      expect(prompt).toContain('3x8');
      expect(prompt).toContain('4x10');
      expect(prompt).toContain('3x5');
      expect(prompt).toContain('warmup: 1');
      expect(prompt).toContain('rest 120s');
      expect(prompt).toContain('rest 90s');
      expect(prompt).toContain('rest 180s');
    }, 30000);

    it('handles superset grouping in routine prompt', async () => {
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-superset';
          r.name = 'Chest Superset';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-barbell';
          e.title = 'Barbell Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-dumbbell';
          e.title = 'Dumbbell Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      const supersetLabel = 'chest-superset';
      await upsertRoutineExercise(database, 'routine-superset', {
        exerciseId: 'exercise-barbell',
        order: 0,
        supersetGroup: supersetLabel,
        targetSets: 3,
        targetReps: 6,
      });
      await upsertRoutineExercise(database, 'routine-superset', {
        exerciseId: 'exercise-dumbbell',
        order: 1,
        supersetGroup: supersetLabel,
        targetSets: 3,
        targetReps: 8,
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Chest Superset');
      expect(prompt).toContain('Barbell Bench Press');
      expect(prompt).toContain('Dumbbell Bench Press');
      expect(prompt).toContain(supersetLabel);
    }, 30000);

    it('preserves exercise order interleaved with superset and standalone exercises', async () => {
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-interleave';
          r.name = 'Mixed Order Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-superset-1';
          e.title = 'Barbell Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-standalone';
          e.title = 'Dumbbell Flyes';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-superset-2';
          e.title = 'Incline Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // Superset member at order 0
      const supersetLabel = 'bench-superset';
      await upsertRoutineExercise(database, 'routine-interleave', {
        exerciseId: 'exercise-superset-1',
        order: 0,
        supersetGroup: supersetLabel,
        targetSets: 3,
        targetReps: 6,
      });

      // Standalone exercise at order 1 (between supersets)
      await upsertRoutineExercise(database, 'routine-interleave', {
        exerciseId: 'exercise-standalone',
        order: 1,
        targetSets: 3,
        targetReps: 12,
      });

      // Superset member at order 2
      await upsertRoutineExercise(database, 'routine-interleave', {
        exerciseId: 'exercise-superset-2',
        order: 2,
        supersetGroup: supersetLabel,
        targetSets: 3,
        targetReps: 8,
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      // Verify relative positions: Barbell first, then Dumbbell Flyes, then Incline
      const barbellIdx = prompt.indexOf('Barbell Bench Press');
      const dumbellIdx = prompt.indexOf('Dumbbell Flyes');
      const inclineIdx = prompt.indexOf('Incline Bench Press');

      expect(barbellIdx).toBeGreaterThan(-1);
      expect(dumbellIdx).toBeGreaterThan(-1);
      expect(inclineIdx).toBeGreaterThan(-1);
      expect(barbellIdx).toBeLessThan(dumbellIdx);
      expect(dumbellIdx).toBeLessThan(inclineIdx);
    }, 30000);

    it('returns a non-empty prompt when database is empty', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      // Should contain persona/rules and explicit placeholders
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('No routines yet');
      expect(prompt).not.toMatch(/undefined|null/);
    }, 30000);
  });

  describe('AC2.2 — history', () => {
    it('includes recent working set history in the prompt', async () => {
      const routineId = 'routine-history';
      const exerciseId = 'exercise-bench';
      const routineExerciseId = 'routine-exercise-bench';

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'History Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      // Create session with working set
      await createSession(database, {
        sessionId: 'session-history-1',
        routineId: routineId,
        startedAtMs: Date.now() - 100000,
      });

      await appendSet(database, 'session-history-1', routineExerciseId, {
        setType: 'working',
        reps: 8,
        weightKg: 100,
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Bench Press');
      expect(prompt).toContain('8 reps');
      expect(prompt).toContain('@ 100kg');
    }, 30000);

    it('handles cardio exercises with duration, distance, and RPE in history', async () => {
      const routineId = 'routine-cardio';
      const exerciseId = 'exercise-treadmill';
      const routineExerciseId = 'routine-exercise-treadmill';

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Cardio';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Treadmill';
          e.kind = 'cardio';
          e.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      await createSession(database, {
        sessionId: 'session-cardio-1',
        routineId: routineId,
        startedAtMs: Date.now() - 100000,
      });

      await appendSet(database, 'session-cardio-1', routineExerciseId, {
        setType: 'working',
        durationSeconds: 1200,
        distanceM: 3000,
        rpe: 7,
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Treadmill');
      expect(prompt).toContain('1200s');
      expect(prompt).toContain('3000m');
      expect(prompt).toContain('RPE 7');
    }, 30000);

    it('returns "No workout history yet" when no sets exist', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('No workout history yet');
    }, 30000);

    it('omits metric-less working sets from history lines', async () => {
      const routineId = 'routine-empty-set';
      const exerciseId = 'exercise-empty-set';
      const routineExerciseId = 'routine-exercise-empty-set';

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Cardio';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Treadmill';
          e.kind = 'cardio';
          e.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      await createSession(database, {
        sessionId: 'session-empty-set-1',
        routineId: routineId,
        startedAtMs: Date.now() - 100000,
      });

      await appendSet(database, 'session-empty-set-1', routineExerciseId, {
        setType: 'working',
        durationSeconds: 1200,
        distanceM: 3000,
        rpe: 7,
      });

      // SetLogger dispatches only the fields the user filled in, so a set
      // logged with every input blank persists with no metrics at all
      await appendSet(database, 'session-empty-set-1', routineExerciseId, {
        setType: 'working',
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      const treadmillLine = prompt
        .split('\n')
        .find((line) => line.includes('Treadmill:'));

      expect(treadmillLine).toBeDefined();
      expect(treadmillLine).not.toContain(', ,');
      expect(treadmillLine!.trimEnd().endsWith(',')).toBe(false);
      expect(treadmillLine).toBe('  Treadmill: 1200s 3000m RPE 7');
    }, 30000);

    it('omits exercises whose only sets have no metrics', async () => {
      const routineId = 'routine-all-empty-sets';
      const exerciseId = 'exercise-all-empty-sets';
      const routineExerciseId = 'routine-exercise-all-empty-sets';

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Cardio';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Treadmill';
          e.kind = 'cardio';
          e.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      await createSession(database, {
        sessionId: 'session-all-empty-1',
        routineId: routineId,
        startedAtMs: Date.now() - 100000,
      });

      await appendSet(database, 'session-all-empty-1', routineExerciseId, {
        setType: 'working',
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('No workout history yet');
      expect(prompt).not.toContain('Treadmill:');
    }, 30000);
  });

  describe('AC5.2 — history capping at 5 per exercise', () => {
    it('caps working set history to 5 most recent sets per exercise', async () => {
      const routineId = 'routine-cap-test';
      const exerciseId = 'exercise-cap-test';
      const routineExerciseId = 'routine-exercise-cap-test';

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Cap Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      // Create one session and append 7 sets with explicit ascending timestamps
      await createSession(database, {
        sessionId: 'session-cap-test',
        routineId: routineId,
        startedAtMs: Date.now() - 1000000,
      });

      // Append 7 sets with distinct, ascending timestamps
      // reps go from 11 to 17
      const baseTime = Date.now() - 500000;
      for (let i = 0; i < 7; i++) {
        const reps = 11 + i;

        // We need to manually set the created_at timestamp by writing directly
        // appendSet doesn't expose timestamp control, so we'll use database.write
        await database.write(async () => {
          const sessionSetsTable = database.get('session_sets');
          const existingSets = (await sessionSetsTable
            .query()
            .fetch()) as any[];
          const maxPosition = existingSets.length > 0
            ? Math.max(...existingSets.map((s: any) => s._raw.position || 0))
            : -1;
          const nextPosition = maxPosition + 1;

          await sessionSetsTable.create((set: any) => {
            set.sessionId = 'session-cap-test';
            set.routineExerciseId = routineExerciseId;
            set.setType = 'working';
            set.reps = reps;
            set.weightKg = 50 + i;
            set.position = nextPosition;
            // Explicitly set ascending timestamps
            set._raw.created_at = baseTime + i * 1000;
          });
        });
      }

      const prompt = await buildSystem(database, { kind: 'create' });

      // Should contain the 5 most recent (13, 14, 15, 16, 17)
      expect(prompt).toContain('17 reps');
      expect(prompt).toContain('16 reps');
      expect(prompt).toContain('15 reps');
      expect(prompt).toContain('14 reps');
      expect(prompt).toContain('13 reps');

      // Should NOT contain the oldest 2 (11, 12)
      expect(prompt).not.toContain('11 reps');
      expect(prompt).not.toContain('12 reps');
    }, 30000);
  });

  describe('AC2.3 — edit mode', () => {
    it('includes routine name and routineId in edit-mode prompt', async () => {
      const routineId = 'routine-edit-test';

      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Legs';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-squat';
          e.title = 'Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });

        const routineExercisesTable = database.get('routine_exercises');
        await routineExercisesTable.create((re: any) => {
          re._raw.id = 'routine-exercise-squat';
          re._raw.routine_id = routineId;
          re._raw.exercise_id = 'exercise-squat';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      const mode: AiCoachMode = { kind: 'edit', routineId };
      const prompt = await buildSystem(database, mode);

      expect(prompt).toContain(`The user is editing the routine "Legs"`);
      expect(prompt).toContain('Return any draft as a complete revision of this routine');
    }, 30000);

    it('falls back to create-mode content when routineId does not exist', async () => {
      const mode: AiCoachMode = { kind: 'edit', routineId: 'non-existent-routine' };
      const prompt = await buildSystem(database, mode);

      expect(prompt).toContain('No routines yet');
      expect(prompt).not.toContain('The user is editing the routine');
    }, 30000);
  });

  describe('Empty cases', () => {
    it('produces non-empty prompt with coach persona when DB is empty', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('strength');
      expect(prompt).toContain('coach');
      expect(prompt).not.toMatch(/undefined|null/);
    }, 30000);

    it('produces non-empty prompt with coach persona when settings are empty', async () => {
      setSettings({ aiGoals: '', aiEquipment: '' });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('strength');
      expect(prompt).not.toMatch(/undefined|null/);
    }, 30000);
  });

  describe('Security: secrets regression guard', () => {
    it('does not leak anthropic key, bridge token, or baseUrl in prompt', async () => {
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        token: 'bridge-token-12345',
        baseUrl: 'http://bridge.local:3000',
        aiGoals: 'Build strength',
        aiEquipment: 'Dumbbells',
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('bridge-token-12345');
      expect(prompt).not.toContain('bridge.local');
    }, 30000);
  });
});
