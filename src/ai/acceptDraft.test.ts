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

      await acceptDraft(database, draft);

      // proves the pre-accept zeros above were a real observation, not a
      // fixture that could never write
      expect(await database.get('routines').query().fetchCount()).toBe(1);
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

      const routineId = await acceptDraft(database, draft);

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

      const routineId = await acceptDraft(database, draft);

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
      const routineId = await acceptDraft(database, initialDraft);

      const updateDraft = {
        routineId,
        name: 'Updated Routine',
        exercises: [
          { title: 'Deadlift', kind: 'strength' as const },
          { title: 'Rows', kind: 'strength' as const },
          { title: 'Pullups', kind: 'strength' as const },
        ],
      };

      const returnedId = await acceptDraft(database, updateDraft);

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

      const routineId = await acceptDraft(database, draft);

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

      await acceptDraft(database, draft);

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

      await expect(acceptDraft(database, invalidDraft)).rejects.toThrow(DraftValidationError);

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

      await expect(acceptDraft(database, invalidDraft)).rejects.toThrow(DraftValidationError);

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

      await expect(acceptDraft(database, invalidDraft)).rejects.toThrow(DraftValidationError);

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
      await acceptDraft(database, initialDraft);

      const exercisesTable = database.get('exercises');
      let exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect((exercises[0] as any).id).toBe('cycling');
      expect((exercises[0] as any).kind).toBe('cardio');

      const secondDraft = {
        name: 'Second Routine',
        exercises: [{ title: 'Cycling', kind: 'strength' as const }],
      };
      await acceptDraft(database, secondDraft);

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

      await acceptDraft(database, draft);

      const exercisesTable = database.get('exercises');
      const exercises = await exercisesTable.query().fetch();
      expect(exercises).toHaveLength(1);
      expect((exercises[0] as any).title).toBe('bench press');
    });
  });
});
