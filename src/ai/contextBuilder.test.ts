import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createSession, appendSet, upsertExercise, upsertRoutineExercise } from '@/db/repository';
import { setSettings, injectSettingsStorage, resetForTesting } from '@/state/settings';
import { SETTINGS_FIELD_MAX_LENGTH } from './draftSchema';
import {
  buildSystem,
  RECENT_WORKOUTS_IN_PROMPT,
  type AiCoachMode,
} from './contextBuilder';

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

  // These sentences restate the bounds validateSettingsProposal enforces. They are
  // pinned as exact strings so that changing a bound in draftSchema.ts without
  // rewording the persona fails here instead of drifting silently.
  describe('Settings proposal persona', () => {
    it('names settingsProposal in the response structure', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('"settingsProposal"');
    }, 30000);

    it('maps the proposal fields to the prompt sections they replace', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'proposes new values for the "User Goals", "Available Equipment", and "Coaching Style" sections below'
      );
    }, 30000);

    it('includes constraint that a proposal must carry at least one field', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'A settings proposal must include at least one of "goals", "equipment", or "personality"'
      );
    }, 30000);

    it('includes the non-empty and maximum-length bounds on proposal fields', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        `goals, equipment, personality: when present, must be non-empty strings of at most ${SETTINGS_FIELD_MAX_LENGTH} characters`
      );
    }, 30000);

    it('states that a proposed field replaces the current value wholesale', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        "Each field is a full replacement for the user's current value, not an addition to it"
      );
    }, 30000);

    it('states that proposals are only for explicit user requests', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'Never include a settingsProposal unless the user asked to change their goals, equipment, or coaching style'
      );
    }, 30000);

    it('states that the user must approve a proposal before it takes effect', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('The user must approve a settings proposal before it takes effect');
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

  describe('Coaching style', () => {
    it('includes the personality setting under a "## Coaching Style" section', async () => {
      setSettings({ aiPersonality: 'Direct and no-nonsense; celebrate PRs' });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('## Coaching Style');
      expect(prompt).toContain('Direct and no-nonsense; celebrate PRs');
    }, 30000);

    it('includes a "Not specified." placeholder when personality is empty', async () => {
      setSettings({ aiPersonality: '' });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('## Coaching Style\n\nNot specified.');
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

      // Every history set is dated, so read the logged date back rather than
      // assuming the clock has not rolled over since the set was appended.
      const loggedSets = (await database.get('session_sets').query().fetch()) as any[];
      const loggedDate = new Date(loggedSets[0]._raw.created_at)
        .toISOString()
        .split('T')[0];

      expect(treadmillLine).toBeDefined();
      expect(treadmillLine).not.toContain(', ,');
      expect(treadmillLine!.trimEnd().endsWith(',')).toBe(false);
      expect(treadmillLine).toBe(`  Treadmill: 1200s 3000m RPE 7 (${loggedDate})`);
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
    it('includes routine name and revision instruction in edit-mode prompt', async () => {
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

  describe('Debrief mode', () => {
    const sessionId = 'session-debrief';
    const routineId = 'routine-debrief';

    // A finished workout: two exercises planned, only the first one logged,
    // with a warmup set ahead of the working sets.
    async function seedFinishedWorkout() {
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Upper Body';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-bench';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-row';
          e.title = 'Rows';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      const bench = await upsertRoutineExercise(database, routineId, {
        exerciseId: 'exercise-bench',
        order: 0,
        warmupSets: 1,
        targetSets: 3,
        targetReps: 8,
        restSeconds: 120,
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: 'exercise-row',
        order: 1,
        targetSets: 4,
        targetReps: 10,
      });

      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now() - 3600000,
      });

      await appendSet(database, sessionId, (bench as any).id, {
        setType: 'warmup',
        reps: 5,
        weightKg: 40,
      });
      await appendSet(database, sessionId, (bench as any).id, {
        setType: 'working',
        reps: 8,
        weightKg: 100,
      });
      await appendSet(database, sessionId, (bench as any).id, {
        setType: 'working',
        reps: 6,
        weightKg: 100,
        rpe: 9,
      });
    }

    function lineFor(prompt: string, exerciseTitle: string): string | undefined {
      return prompt.split('\n').find((line) => line.trimStart().startsWith(`${exerciseTitle} (`));
    }

    it('names the routine the user just finished', async () => {
      await seedFinishedWorkout();

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(prompt).toContain('The user has just finished the routine "Upper Body"');
    }, 30000);

    it('lists every set logged for an exercise against its target', async () => {
      await seedFinishedWorkout();

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(lineFor(prompt, 'Bench Press')).toBe(
        '  Bench Press (target 3x8): 5 reps @ 40kg (warmup), 8 reps @ 100kg, 6 reps @ 100kg RPE 9'
      );
    }, 30000);

    it('says so for a planned exercise that was never logged', async () => {
      await seedFinishedWorkout();

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(lineFor(prompt, 'Rows')).toBe('  Rows (target 4x10): no sets logged');
    }, 30000);

    it('summarises only the session being debriefed', async () => {
      await seedFinishedWorkout();

      const bench = (
        await database.get('routine_exercises').query().fetch()
      )[0] as any;
      await createSession(database, {
        sessionId: 'session-other',
        routineId,
        startedAtMs: Date.now() - 7200000,
      });
      await appendSet(database, 'session-other', bench.id, {
        setType: 'working',
        reps: 3,
        weightKg: 999,
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(lineFor(prompt, 'Bench Press')).not.toContain('999kg');
    }, 30000);

    it('keeps a repeated exercise as two separate entries', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Upper Body';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'exercise-bench';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // Same exercise twice in one routine: distinct rows, so upsert would
      // collapse them — create them directly, as the session engine's
      // routine_exercise lookup does by (routine, order).
      let second: any;
      await database.write(async () => {
        await database.get('routine_exercises').create((re: any) => {
          re.routineId = routineId;
          re.exerciseId = 'exercise-bench';
          re.order = 0;
          re.warmupSets = 0;
          re.targetSets = 3;
          re.targetReps = 8;
        });
        second = await database.get('routine_exercises').create((re: any) => {
          re.routineId = routineId;
          re.exerciseId = 'exercise-bench';
          re.order = 1;
          re.warmupSets = 0;
          re.targetSets = 1;
          re.targetReps = 20;
        });
      });

      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now() - 3600000,
      });
      await appendSet(database, sessionId, second.id, {
        setType: 'working',
        reps: 20,
        weightKg: 40,
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      const benchLines = prompt
        .split('\n')
        .filter((line) => line.trimStart().startsWith('Bench Press ('));

      expect(benchLines).toEqual([
        '  Bench Press (target 3x8): no sets logged',
        '  Bench Press (target 1x20): 20 reps @ 40kg',
      ]);
    }, 30000);

    it('leaves the just-finished summary out of a create conversation', async () => {
      await seedFinishedWorkout();

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).not.toContain('Just-Finished Workout');
      expect(prompt).not.toContain('The user has just finished the routine');
    }, 30000);

    it('does not leak the anthropic key or bridge credentials', async () => {
      await seedFinishedWorkout();
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        token: 'bridge-token-12345',
        baseUrl: 'http://bridge.local:3000',
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('bridge-token-12345');
      expect(prompt).not.toContain('bridge.local');
    }, 30000);

    it('handles a debrief when the routine no longer exists and no sets logged', async () => {
      // Create a session with no backing routine and no logged sets
      await createSession(database, {
        sessionId,
        routineId, // routine-debrief does not exist
        startedAtMs: Date.now() - 3600000,
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(prompt).toContain('The user has just finished the routine "routine-debrief"');
      // When there are no logged sets, the header should not promise them
      expect(prompt).not.toContain('These are the sets they logged');
      expect(prompt).toContain('This routine no longer exists');
    }, 30000);

    it('shows logged sets even when the routine no longer exists', async () => {
      // Create a routine and exercise, capture the routine_exercise id
      const reId = await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Deleted Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'exercise-pushups';
          e.title = 'Push-ups';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        const re = await database.get('routine_exercises').create((re: any) => {
          re.routineId = routineId;
          re.exerciseId = 'exercise-pushups';
          re.order = 0;
          re.warmupSets = 0;
          re.targetSets = 3;
          re.targetReps = 10;
        });
        return re.id;
      });

      // Create session and log a set
      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now() - 3600000,
      });

      await appendSet(database, sessionId, reId, {
        setType: 'working' as const,
        reps: 8,
      });

      // Delete the routine (but sets remain)
      await database.write(async () => {
        const routine = await database.get('routines').find(routineId);
        await routine.destroyPermanently();
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(prompt).toContain('The user has just finished the routine "routine-debrief"');
      // When there are logged sets, the header should mention them
      expect(prompt).toContain('These are the sets they logged');
      // Should show the logged exercise, not the "no longer exists" message
      expect(prompt).toContain('Push-ups');
      expect(prompt).not.toContain('This routine no longer exists');
    }, 30000);
  });

  // Pinned as exact strings for the same reason as the draft and settings
  // bounds: the persona is what the model reads, so a behaviour change here
  // has to be a deliberate edit rather than a silent drift.
  describe('Debrief persona', () => {
    it('tells the coach to open by asking how the workout went', async () => {
      const prompt = await buildSystem(database, {
        kind: 'debrief',
        routineId: 'routine-1',
        sessionId: 'session-1',
      });

      expect(prompt).toContain(
        'Open the conversation by asking how the workout went before proposing any changes'
      );
    }, 30000);

    it('scopes a debrief draft to the routine just performed', async () => {
      const prompt = await buildSystem(database, {
        kind: 'debrief',
        routineId: 'routine-1',
        sessionId: 'session-1',
      });

      expect(prompt).toContain(
        'Any draft you propose is a complete revision of the routine the user just performed, for next time'
      );
    }, 30000);

    it('keeps the debrief instructions out of a create conversation', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).not.toContain(
        'Open the conversation by asking how the workout went before proposing any changes'
      );
    }, 30000);
  });

  // The cross-session view the coach plans from: when the user trained, on
  // what, and how much of it. Bounded by RECENT_WORKOUTS_IN_PROMPT sessions and
  // one line each, so it cannot grow with the user's training age.
  describe('Recent Workouts', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const JULY_29 = Date.parse('2026-07-29T18:00:00.000Z');

    async function seedSession(options: {
      sessionId: string;
      routineId: string;
      routineName: string;
      /** null leaves the session in progress. */
      endedAtMs: number | null;
      exercises?: { exerciseId: string; title: string; workingSets: number }[];
    }): Promise<void> {
      const { sessionId, routineId, routineName, endedAtMs, exercises = [] } = options;

      await database.write(async () => {
        try {
          await database.get('routines').find(routineId);
        } catch {
          await database.get('routines').create((r: any) => {
            r._raw.id = routineId;
            r.name = routineName;
            r._raw.created_at = Date.now();
            r._raw.updated_at = Date.now();
          });
        }
      });

      const routineExerciseIds: string[] = [];
      for (const [index, entry] of exercises.entries()) {
        await upsertExercise(database, entry.exerciseId, entry.title, 'strength');
        const routineExercise = await upsertRoutineExercise(database, routineId, {
          exerciseId: entry.exerciseId,
          order: index,
        });
        routineExerciseIds.push((routineExercise as any).id);
      }

      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: (endedAtMs ?? Date.now()) - 3600000,
      });

      for (const [index, entry] of exercises.entries()) {
        for (let i = 0; i < entry.workingSets; i++) {
          await appendSet(database, sessionId, routineExerciseIds[index], {
            setType: 'working',
            reps: 8,
            weightKg: 100,
          });
        }
      }

      if (endedAtMs !== null) {
        await database.write(async () => {
          const session = await database.get('sessions').find(sessionId);
          await session.update((record: any) => {
            record._raw.ended_at = endedAtMs;
          });
        });
      }
    }

    function recentWorkoutLines(prompt: string): string[] {
      const section = prompt.split('## Recent Workouts')[1] ?? '';
      return section
        .split('\n\n## ')[0]
        .split('\n')
        .filter((line) => line.trim().length > 0);
    }

    it('IMPORTANT 1,2: includes "Today:" anchor with UTC date and weekday', async () => {
      await seedSession({
        sessionId: 'session-test',
        routineId: 'routine-test',
        routineName: 'Test',
        endedAtMs: JULY_29,
        exercises: [{ exerciseId: 'bench', title: 'Bench Press', workingSets: 1 }],
      });

      // Two-window derivation makes the value assertion midnight-safe: the
      // real "today" at build time is one of the two captured values.
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const todayWithWeekday = (ms: number) =>
        `${new Date(ms).toISOString().split('T')[0]} (${weekdays[new Date(ms).getUTCDay()]})`;

      const before = todayWithWeekday(Date.now());
      const prompt = await buildSystem(database, { kind: 'create' });
      const after = todayWithWeekday(Date.now());
      const lines = recentWorkoutLines(prompt);

      // First line is the "Today:" anchor carrying the CURRENT date (not the
      // session's) — pinned by value so a regression to the newest session's
      // date fails here.
      expect(lines.length).toBeGreaterThan(0);
      expect([`Today: ${before}`, `Today: ${after}`]).toContain(lines[0]);
    }, 30000);

    it('says so when nothing has been completed', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('## Recent Workouts');
      expect(prompt).toContain('No completed workouts yet.');
    }, 30000);

    it('gives one dated line per completed session', async () => {
      await seedSession({
        sessionId: 'session-upper',
        routineId: 'routine-upper',
        routineName: 'Upper Body',
        endedAtMs: JULY_29,
        exercises: [
          { exerciseId: 'bench', title: 'Bench Press', workingSets: 3 },
          { exerciseId: 'rows', title: 'Rows', workingSets: 4 },
        ],
      });

      const prompt = await buildSystem(database, { kind: 'create' });
      const lines = recentWorkoutLines(prompt);

      // Skip the "Today:" line and check session lines
      const sessionLines = lines.slice(1);
      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | Upper Body | 2 exercises, 7 working sets',
      ]);
    }, 30000);

    it('counts a single exercise and set in the singular', async () => {
      await seedSession({
        sessionId: 'session-solo',
        routineId: 'routine-solo',
        routineName: 'Solo',
        endedAtMs: JULY_29,
        exercises: [{ exerciseId: 'bench', title: 'Bench Press', workingSets: 1 }],
      });

      const prompt = await buildSystem(database, { kind: 'create' });
      const lines = recentWorkoutLines(prompt);
      const sessionLines = lines.slice(1);

      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | Solo | 1 exercise, 1 working set',
      ]);
    }, 30000);

    it('says so for a completed session with no working sets', async () => {
      await seedSession({
        sessionId: 'session-bailed',
        routineId: 'routine-bailed',
        routineName: 'Bailed',
        endedAtMs: JULY_29,
      });

      const prompt = await buildSystem(database, { kind: 'create' });
      const lines = recentWorkoutLines(prompt);
      const sessionLines = lines.slice(1);

      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | Bailed | no working sets logged',
      ]);
    }, 30000);

    it('lists the most recent workout first', async () => {
      await seedSession({
        sessionId: 'session-older',
        routineId: 'routine-lower',
        routineName: 'Lower Body',
        endedAtMs: JULY_29 - DAY_MS,
      });
      await seedSession({
        sessionId: 'session-newer',
        routineId: 'routine-upper',
        routineName: 'Upper Body',
        endedAtMs: JULY_29,
      });

      const prompt = await buildSystem(database, { kind: 'create' });
      const lines = recentWorkoutLines(prompt);
      const sessionLines = lines.slice(1);

      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | Upper Body | no working sets logged',
        '  2026-07-28 (Tue) | Lower Body | no working sets logged',
      ]);
    }, 30000);

    it('leaves an in-progress session out', async () => {
      await seedSession({
        sessionId: 'session-open',
        routineId: 'routine-open',
        routineName: 'Still Going',
        endedAtMs: null,
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('No completed workouts yet.');
      expect(prompt).not.toContain('| Still Going |');
    }, 30000);

    it('falls back to the routine id when the routine has been deleted', async () => {
      await seedSession({
        sessionId: 'session-orphan',
        routineId: 'routine-gone',
        routineName: 'Deleted Routine',
        endedAtMs: JULY_29,
      });

      await database.write(async () => {
        const routine = await database.get('routines').find('routine-gone');
        await routine.destroyPermanently();
      });

      const prompt = await buildSystem(database, { kind: 'create' });
      const lines = recentWorkoutLines(prompt);
      const sessionLines = lines.slice(1);

      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | routine-gone | no working sets logged',
      ]);
    }, 30000);

    it(`keeps only the ${RECENT_WORKOUTS_IN_PROMPT} most recent workouts`, async () => {
      for (let i = 0; i <= RECENT_WORKOUTS_IN_PROMPT; i++) {
        await seedSession({
          sessionId: `session-${i}`,
          routineId: 'routine-daily',
          routineName: 'Daily',
          endedAtMs: JULY_29 - i * DAY_MS,
        });
      }

      const prompt = await buildSystem(database, { kind: 'create' });
      const lines = recentWorkoutLines(prompt);

      // First line is "Today:", remaining lines are sessions
      expect(lines).toHaveLength(1 + RECENT_WORKOUTS_IN_PROMPT);
      // The (N+1)th session back is the one that must not survive the bound.
      const droppedDate = new Date(JULY_29 - RECENT_WORKOUTS_IN_PROMPT * DAY_MS)
        .toISOString()
        .split('T')[0];
      expect(prompt).not.toContain(droppedDate);
    }, 30000);

    it('reaches a debrief conversation too', async () => {
      await seedSession({
        sessionId: 'session-done',
        routineId: 'routine-upper',
        routineName: 'Upper Body',
        endedAtMs: JULY_29,
        exercises: [{ exerciseId: 'bench', title: 'Bench Press', workingSets: 3 }],
      });

      const prompt = await buildSystem(database, {
        kind: 'debrief',
        routineId: 'routine-upper',
        sessionId: 'session-done',
      });

      const lines = recentWorkoutLines(prompt);
      const sessionLines = lines.slice(1);

      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | Upper Body | 1 exercise, 3 working sets',
      ]);
    }, 30000);

    it('reaches an edit conversation too', async () => {
      await seedSession({
        sessionId: 'session-done',
        routineId: 'routine-upper',
        routineName: 'Upper Body',
        endedAtMs: JULY_29,
        exercises: [{ exerciseId: 'bench', title: 'Bench Press', workingSets: 3 }],
      });

      const prompt = await buildSystem(database, {
        kind: 'edit',
        routineId: 'routine-upper',
      });

      const lines = recentWorkoutLines(prompt);
      const sessionLines = lines.slice(1);

      expect(sessionLines).toEqual([
        '  2026-07-29 (Wed) | Upper Body | 1 exercise, 3 working sets',
      ]);
    }, 30000);
  });

  describe('Dated set history', () => {
    it('dates every recent set so progression over time is readable', async () => {
      const routineId = 'routine-progression';
      const exerciseId = 'exercise-bench';
      const routineExerciseId = 'routine-exercise-bench';

      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Progression';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = exerciseId;
          e.title = 'Bench Press';
          e.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        await database.get('routine_exercises').create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = exerciseId;
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      // Two sessions a week apart, seeded with explicit timestamps so the
      // rendered dates are fixed rather than clock-dependent.
      const weights: { weightKg: number; loggedAtMs: number }[] = [
        { weightKg: 100, loggedAtMs: Date.parse('2026-07-22T18:00:00.000Z') },
        { weightKg: 102.5, loggedAtMs: Date.parse('2026-07-29T18:00:00.000Z') },
      ];

      await createSession(database, {
        sessionId: 'session-progression',
        routineId,
        startedAtMs: Date.parse('2026-07-22T17:00:00.000Z'),
      });

      for (const [index, entry] of weights.entries()) {
        await database.write(async () => {
          await database.get('session_sets').create((set: any) => {
            set.sessionId = 'session-progression';
            set.routineExerciseId = routineExerciseId;
            set.setType = 'working';
            set.reps = 8;
            set.weightKg = entry.weightKg;
            set.position = index;
            set._raw.created_at = entry.loggedAtMs;
          });
        });
      }

      const prompt = await buildSystem(database, { kind: 'create' });
      const benchLine = prompt
        .split('\n')
        .find((line) => line.includes('Bench Press:'));

      expect(benchLine).toBe(
        '  Bench Press: 8 reps @ 102.5kg (2026-07-29), 8 reps @ 100kg (2026-07-22)'
      );
    }, 30000);
  });

  // Pinned as exact strings for the same reason as the draft and settings
  // bounds: this prose is what turns the history sections from data the model
  // can see into planning it is expected to do.
  describe('Planning persona', () => {
    it('points the coach at the recent-workouts bound for frequency', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        `The "Recent Workouts" section below lists the last ${RECENT_WORKOUTS_IN_PROMPT} completed sessions, so read training frequency and recovery from it rather than assuming a schedule`
      );
    }, 30000);

    it('points the coach at the dated set history for progression', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'Every set in "Recent Training History" carries the date it was logged, so read load progression over time from it instead of only echoing the last weight'
      );
    }, 30000);

    it('asks the coach to plan from that history rather than describe it', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'Plan against that history: pace progression from what actually moved, and suggest a lighter week when recent sessions have been both frequent and heavy'
      );
    }, 30000);

    it('carries the planning guidance into a debrief conversation', async () => {
      const prompt = await buildSystem(database, {
        kind: 'debrief',
        routineId: 'routine-1',
        sessionId: 'session-1',
      });

      expect(prompt).toContain(
        'Plan against that history: pace progression from what actually moved, and suggest a lighter week when recent sessions have been both frequent and heavy'
      );
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
