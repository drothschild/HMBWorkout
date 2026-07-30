import { Database, Q } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { acceptDraft } from './acceptDraft';
import { DraftValidationError, validateRoutineDraft } from './draftSchema';

describe('acceptDraft', () => {
  let database: Database;

  beforeEach(async () => {
    database = createTestDatabase();
  });

  afterEach(async () => {
    await closeTestDatabase(database);
  });

  describe('AC3.1 (inert until accept)', () => {
    test('validating a draft writes nothing; accepting the same draft writes', async () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
      };

      validateRoutineDraft(draft);

      expect(await database.get('routines').query().fetchCount()).toBe(0);
      expect(await database.get('exercises').query().fetchCount()).toBe(0);
      expect(await database.get('routine_exercises').query().fetchCount()).toBe(0);

      await acceptDraft(database, draft, { kind: 'create' });

      // proves the pre-accept zeros above were a real observation, not a
      // fixture that could never write
      expect(await database.get('routines').query().fetchCount()).toBe(1);
      expect(await database.get('exercises').query().fetchCount()).toBe(1);
      expect(await database.get('routine_exercises').query().fetchCount()).toBe(1);
    });
  });

  describe('AC3.2 (new routine)', () => {
    test('creates a routine with exercises and routine_exercises entries', async () => {
      const draft = {
        name: 'My Routine',
        notes: 'Routine level notes',
        exercises: [
          { title: 'Bench Press', kind: 'strength' as const, targetSets: 3, targetReps: 8, restSeconds: 60 },
          { title: 'Incline Dumbbell', kind: 'strength' as const, targetSets: 3, targetReps: 10 },
        ],
      };

      const routineId = await acceptDraft(database, draft, { kind: 'create' });

      expect(routineId).toMatch(/^routine-\d+$/);

      const routinesTable = database.get('routines');
      const routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(1);
      expect(routines[0].id).toBe(routineId);
      expect((routines[0] as any).name).toBe('My Routine');
      expect((routines[0] as any).notes).toBe('Routine level notes');

      const exercisesTable = database.get('exercises');
      const exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(2);
      const benchPress = exercises.find((e: any) => e.id === 'bench-press');
      const inclineDumb = exercises.find((e: any) => e.id === 'incline-dumbbell');
      expect(benchPress).toBeDefined();
      expect((benchPress as any).kind).toBe('strength');
      expect(inclineDumb).toBeDefined();

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query(Q.where('routine_id', routineId)).fetch();
      expect(entries).toHaveLength(2);

      const first = entries.find((e: any) => e.order === 0);
      const second = entries.find((e: any) => e.order === 1);

      expect((first as any).exerciseId).toBe('bench-press');
      expect((first as any).targetSets).toBe(3);
      expect((first as any).targetReps).toBe(8);
      expect((first as any).restSeconds).toBe(60);

      expect((second as any).exerciseId).toBe('incline-dumbbell');
      expect((second as any).targetSets).toBe(3);
      expect((second as any).targetReps).toBe(10);
    });

    test('creates fully-populated exercise with all target fields', async () => {
      const draft = {
        name: 'Full Routine',
        notes: 'Full routine notes',
        exercises: [
          {
            title: 'Complex Exercise',
            kind: 'strength' as const,
            supersetGroup: 'group-1',
            warmupSets: 2,
            targetSets: 4,
            targetReps: 6,
            targetDurationSeconds: 30,
            restSeconds: 90,
            notes: 'Exercise notes',
          },
        ],
      };

      const routineId = await acceptDraft(database, draft, { kind: 'create' });

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query(Q.where('routine_id', routineId)).fetch();
      expect(entries).toHaveLength(1);

      const entry = entries[0] as any;
      expect(entry.exerciseId).toBe('complex-exercise');
      expect(entry.supersetGroup).toBe('group-1');
      expect(entry.warmupSets).toBe(2);
      expect(entry.targetSets).toBe(4);
      expect(entry.targetReps).toBe(6);
      expect(entry.targetDurationSeconds).toBe(30);
      expect(entry.restSeconds).toBe(90);
      expect(entry.notes).toBe('Exercise notes');
    });
  });

  describe('AC3.3 (edit in place)', () => {
    test('updates existing routine and replaces routine_exercises', async () => {
      const initialDraft = {
        name: 'Initial Routine',
        exercises: [
          { title: 'Bench Press', kind: 'strength' as const },
          { title: 'Squat', kind: 'strength' as const },
        ],
      };
      const routineId = await acceptDraft(database, initialDraft, { kind: 'create' });

      const updateDraft = {
        routineId,
        name: 'Updated Routine',
        exercises: [
          { title: 'Deadlift', kind: 'strength' as const },
          { title: 'Rows', kind: 'strength' as const },
          { title: 'Pullups', kind: 'strength' as const },
        ],
      };

      const returnedId = await acceptDraft(database, updateDraft, { kind: 'edit', routineId });

      expect(returnedId).toBe(routineId);

      const routinesTable = database.get('routines');
      const routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(1);
      expect((routines[0] as any).name).toBe('Updated Routine');

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query(Q.where('routine_id', routineId)).fetch();
      expect(entries).toHaveLength(3);

      const sorted = [...entries].sort((a: any, b: any) => a.order - b.order);
      expect((sorted[0] as any).exerciseId).toBe('deadlift');
      expect((sorted[1] as any).exerciseId).toBe('rows');
      expect((sorted[2] as any).exerciseId).toBe('pullups');
    });

    test('CRITICAL 1: create-mode draft echoing existing routine id creates new routine', async () => {
      // Create an initial routine
      const initialDraft = {
        name: 'Original Routine',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
      };
      const existingRoutineId = await acceptDraft(database, initialDraft, { kind: 'create' });

      // Capture the original routine's state
      const routinesTable = database.get('routines');
      let routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(1);
      const originalName = (routines[0] as any).name;
      expect(originalName).toBe('Original Routine');

      // Small delay to ensure Date.now() returns a different value (simulates real user interaction delay)
      await new Promise((resolve) => setTimeout(resolve, 2));

      // Create a new draft that echoes the existing routine's id (simulating model confusion)
      const confusedDraft = {
        routineId: existingRoutineId, // Model echoed back the existing id
        name: 'New Routine',
        exercises: [{ title: 'Squat', kind: 'strength' as const }],
      };

      // Accept in create mode (mode is authoritative, not draft.routineId)
      const newRoutineId = await acceptDraft(database, confusedDraft, { kind: 'create' });

      // Must create a NEW routine, not overwrite the existing one
      expect(newRoutineId).not.toBe(existingRoutineId);

      // Verify both routines exist
      routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(2);

      // Verify the original routine is unchanged
      const original = routines.find((r: any) => r.id === existingRoutineId);
      expect((original as any).name).toBe('Original Routine');

      const routineExercisesTable = database.get('routine_exercises');
      const originalEntries = await routineExercisesTable.query(Q.where('routine_id', existingRoutineId)).fetch();
      expect(originalEntries).toHaveLength(1);
      expect((originalEntries[0] as any).exerciseId).toBe('bench-press');

      // Verify the new routine has the new exercises
      const newRoutine = routines.find((r: any) => r.id === newRoutineId);
      expect((newRoutine as any).name).toBe('New Routine');

      const newEntries = await routineExercisesTable.query(Q.where('routine_id', newRoutineId)).fetch();
      expect(newEntries).toHaveLength(1);
      expect((newEntries[0] as any).exerciseId).toBe('squat');
    });

    test('CRITICAL 1: edit-mode draft with foreign routine id updates correct routine', async () => {
      // Create two routines
      const draft1 = {
        name: 'Routine A',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
      };
      const routineIdA = await acceptDraft(database, draft1, { kind: 'create' });

      // Small delay to ensure Date.now() returns a different value
      await new Promise((resolve) => setTimeout(resolve, 2));

      const draft2 = {
        name: 'Routine B',
        exercises: [{ title: 'Squat', kind: 'strength' as const }],
      };
      const routineIdB = await acceptDraft(database, draft2, { kind: 'create' });

      // Create a draft for routineA that has the wrong id (routineIdB)
      const confusedDraft = {
        routineId: routineIdB, // Wrong id
        name: 'Routine A Updated',
        exercises: [{ title: 'Deadlift', kind: 'strength' as const }],
      };

      // Accept in edit mode with correct routineId (mode is authoritative)
      const returnedId = await acceptDraft(database, confusedDraft, { kind: 'edit', routineId: routineIdA });

      expect(returnedId).toBe(routineIdA);

      const routinesTable = database.get('routines');
      const routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(2);

      // Verify routineA was updated
      const routineA = routines.find((r: any) => r.id === routineIdA);
      expect((routineA as any).name).toBe('Routine A Updated');

      // Verify routineB was untouched
      const routineB = routines.find((r: any) => r.id === routineIdB);
      expect((routineB as any).name).toBe('Routine B');

      const routineExercisesTable = database.get('routine_exercises');
      const entriesA = await routineExercisesTable.query(Q.where('routine_id', routineIdA)).fetch();
      expect((entriesA[0] as any).exerciseId).toBe('deadlift');

      const entriesB = await routineExercisesTable.query(Q.where('routine_id', routineIdB)).fetch();
      expect((entriesB[0] as any).exerciseId).toBe('squat');
    });
  });

  describe('AC3.4 (slug dedupe)', () => {
    test('creates one exercise for duplicate slugs', async () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          { title: 'Bench Press', kind: 'strength' as const },
          { title: 'bench   press', kind: 'strength' as const },
          { title: 'Bench Press', kind: 'strength' as const },
        ],
      };

      const routineId = await acceptDraft(database, draft, { kind: 'create' });

      // Verify only one exercise created
      const exercisesTable = database.get('exercises');
      const exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect(exercises[0].id).toBe('bench-press');

      // Verify all three routine_exercises reference the same exercise
      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query(Q.where('routine_id', routineId)).fetch();
      expect(entries).toHaveLength(3);
      expect((entries[0] as any).exerciseId).toBe('bench-press');
      expect((entries[1] as any).exerciseId).toBe('bench-press');
      expect((entries[2] as any).exerciseId).toBe('bench-press');
    });

    test('creates new exercise with free-form title', async () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: 'Bulgarian Split Squat', kind: 'strength' as const }],
      };

      await acceptDraft(database, draft, { kind: 'create' });

      // Verify exercise created with correct slug
      const exercisesTable = database.get('exercises');
      const exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect(exercises[0].id).toBe('bulgarian-split-squat');
      expect((exercises[0] as any).kind).toBe('strength');
    });
  });

  describe('AC3.5 (validation rejection, no partial writes)', () => {
    test('rejects invalid kind and writes nothing', async () => {
      const invalidDraft = {
        name: 'Invalid Routine',
        exercises: [{ title: 'Exercise', kind: 'yoga' as any }],
      };

      await expect(acceptDraft(database, invalidDraft, { kind: 'create' })).rejects.toThrow(DraftValidationError);

      // Verify nothing was written
      const routinesTable = database.get('routines');
      const exercises = await routinesTable.query().fetch();
      expect(exercises).toHaveLength(0);

      const exercisesTable = database.get('exercises');
      const exs = await exercisesTable.query().fetch();
      expect(exs).toHaveLength(0);

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query().fetch();
      expect(entries).toHaveLength(0);
    });

    test('rejects empty exercises and writes nothing', async () => {
      const invalidDraft = {
        name: 'Invalid Routine',
        exercises: [],
      };

      await expect(acceptDraft(database, invalidDraft, { kind: 'create' })).rejects.toThrow(DraftValidationError);

      const routinesTable = database.get('routines');
      const routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(0);

      const exercisesTable = database.get('exercises');
      const exs = await exercisesTable.query().fetch();
      expect(exs).toHaveLength(0);

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query().fetch();
      expect(entries).toHaveLength(0);
    });

    test('rejects title that slugifies to empty', async () => {
      const invalidDraft = {
        name: 'Invalid Routine',
        exercises: [{ title: '!!!', kind: 'strength' as const }],
      };

      await expect(acceptDraft(database, invalidDraft, { kind: 'create' })).rejects.toThrow(DraftValidationError);

      const routinesTable = database.get('routines');
      const routines = await routinesTable.query().fetch();
      expect(routines).toHaveLength(0);

      const exercisesTable = database.get('exercises');
      const exs = await exercisesTable.query().fetch();
      expect(exs).toHaveLength(0);

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query().fetch();
      expect(entries).toHaveLength(0);
    });
  });

  describe('AC3.4 variant (existing exercise kind preserved)', () => {
    test('preserves existing exercise kind when accepting draft for same exercise', async () => {
      const initialDraft = {
        name: 'Initial Routine',
        exercises: [{ title: 'Cycling', kind: 'cardio' as const }],
      };
      await acceptDraft(database, initialDraft, { kind: 'create' });

      const exercisesTable = database.get('exercises');
      let exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect((exercises[0] as any).id).toBe('cycling');
      expect((exercises[0] as any).kind).toBe('cardio');

      const secondDraft = {
        name: 'Second Routine',
        exercises: [{ title: 'Cycling', kind: 'strength' as const }],
      };
      await acceptDraft(database, secondDraft, { kind: 'create' });

      exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect((exercises[0] as any).kind).toBe('cardio');
    });
  });

  describe('Whitespace normalization', () => {
    test('normalizes internal whitespace in exercise title', async () => {
      const draft = {
        name: 'My Routine',
        exercises: [{ title: '  bench   press  ', kind: 'strength' as const }],
      };

      await acceptDraft(database, draft, { kind: 'create' });

      const exercisesTable = database.get('exercises');
      const exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect((exercises[0] as any).title).toBe('bench press');
    });
  });
});
