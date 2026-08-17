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

  describe('coach-onboarding.AC7.1 (partial: onboarding takes the create branch)', () => {
    test('onboarding mode yields a minted routine id, not mode.routineId', async () => {
      // Onboarding carries no routine id — the first routine the interview
      // offers is brand new — so it must take the create branch. Without this,
      // a mutation resolving the id from `mode.routineId` survives the suite;
      // TypeScript blocks the naive version, but a cast defeats it.
      //
      // Scope of this test, stated precisely because the previous name
      // overclaimed: it does NOT prove freshness (the `routine-\d+` shape is
      // satisfied by a hardcoded constant — the pre-existing AC3.2 test covers
      // per-accept uniqueness), and it does not cover AC7.1's "and navigates to
      // it" half, which is Phase 4's. It pins branch selection only.
      //
      // Not reachable from the UI yet: ai-coach.tsx drops the `onboarding`
      // route param before the mode mapper sees it (issue #189, folded into
      // #179).
      const draft = {
        name: 'Starter Routine',
        exercises: [{ title: 'Goblet Squat', kind: 'strength' as const, targetSets: 3, targetReps: 8 }],
      };

      const routineId = await acceptDraft(database, draft, { kind: 'onboarding' });

      expect(routineId).toMatch(/^routine-\d+$/);
      const routines = await database.get('routines').query().fetch();
      expect(routines).toHaveLength(1);
      expect(routines[0].id).toBe(routineId);
      expect((routines[0] as any).name).toBe('Starter Routine');
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

    test('writes a draft description onto a newly created exercise', async () => {
      const draft = {
        name: 'Cooldown',
        exercises: [
          {
            title: 'Pigeon Stretch (Left)',
            kind: 'stretch' as const,
            targetDurationSeconds: 30,
            description: 'From all fours, bring the left shin forward and lower the hips toward the floor.',
          },
        ],
      };

      await acceptDraft(database, draft, { kind: 'create' });

      const exercise = await database.get('exercises').find('pigeon-stretch-left');
      expect((exercise as any).description).toBe(
        'From all fours, bring the left shin forward and lower the hips toward the floor.'
      );
    });

    test('never overwrites an existing exercise description, even a null one', async () => {
      // First accept creates the exercise without a description.
      await acceptDraft(
        database,
        { name: 'Cooldown v1', exercises: [{ title: 'Pigeon Stretch', kind: 'stretch' as const }] },
        { kind: 'create' }
      );
      const created = await database.get('exercises').find('pigeon-stretch');
      expect((created as any).description ?? null).toBeNull();

      // Second accept reuses the title and carries a description: the existing
      // record must stay untouched (create-only accept path).
      await acceptDraft(
        database,
        {
          name: 'Cooldown v2',
          exercises: [
            { title: 'Pigeon Stretch', kind: 'stretch' as const, description: 'Late-arriving how-to' },
          ],
        },
        { kind: 'create' }
      );

      const after = await database.get('exercises').find('pigeon-stretch');
      expect((after as any).description ?? null).toBeNull();
    });

    test('create mode mints a fresh id per accept and never touches the prior routine', async () => {
      // Distinct mocked Date.now() values make the two minted ids deterministic
      const nowSpy = jest.spyOn(Date, 'now');
      try {
        const initialDraft = {
          name: 'First Routine',
          exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
        };
        nowSpy.mockReturnValueOnce(1000);
        const firstRoutineId = await acceptDraft(database, initialDraft, { kind: 'create' });
        expect(firstRoutineId).toBe('routine-1000');

        const secondDraft = {
          name: 'Second Routine',
          exercises: [{ title: 'Squat', kind: 'strength' as const }],
        };
        nowSpy.mockReturnValueOnce(2000);
        const secondRoutineId = await acceptDraft(database, secondDraft, { kind: 'create' });
        expect(secondRoutineId).toBe('routine-2000');

        // Verify both routines exist and are distinct
        const routinesTable = database.get('routines');
        const routines = await routinesTable.query().fetch();
        expect(routines).toHaveLength(2);

        const first = routines.find((r: any) => r.id === firstRoutineId);
        expect((first as any).name).toBe('First Routine');

        const second = routines.find((r: any) => r.id === secondRoutineId);
        expect((second as any).name).toBe('Second Routine');

        // Verify exercises are correctly associated
        const routineExercisesTable = database.get('routine_exercises');
        const firstEntries = await routineExercisesTable.query(Q.where('routine_id', firstRoutineId)).fetch();
        expect(firstEntries).toHaveLength(1);
        expect((firstEntries[0] as any).exerciseId).toBe('bench-press');

        const secondEntries = await routineExercisesTable.query(Q.where('routine_id', secondRoutineId)).fetch();
        expect(secondEntries).toHaveLength(1);
        expect((secondEntries[0] as any).exerciseId).toBe('squat');
      } finally {
        nowSpy.mockRestore();
      }
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
      // Distinct Date.now() values so an edit that wrongly minted a fresh id
      // would produce routine-2000 !== routineId and fail below.
      const nowSpy = jest.spyOn(Date, 'now');
      let routineId: string;
      let returnedId: string;
      try {
        nowSpy.mockReturnValueOnce(1000);
        routineId = await acceptDraft(database, initialDraft, { kind: 'create' });
        nowSpy.mockReturnValue(2000);

        const updateDraft = {
          name: 'Updated Routine',
          exercises: [
            { title: 'Deadlift', kind: 'strength' as const },
            { title: 'Rows', kind: 'strength' as const },
            { title: 'Pullups', kind: 'strength' as const },
          ],
        };

        returnedId = await acceptDraft(database, updateDraft, { kind: 'edit', routineId });
      } finally {
        nowSpy.mockRestore();
      }

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

    test('CRITICAL 1: edit-mode uses mode.routineId to determine target, ignoring any draft id mismatch', async () => {
      // Create two routines
      const draft1 = {
        name: 'Routine A',
        exercises: [{ title: 'Bench Press', kind: 'strength' as const }],
      };
      const nowSpy = jest.spyOn(Date, 'now');
      try {
        nowSpy.mockReturnValueOnce(1000);
        const routineIdA = await acceptDraft(database, draft1, { kind: 'create' });
        expect(routineIdA).toBe('routine-1000');

        const draft2 = {
          name: 'Routine B',
          exercises: [{ title: 'Squat', kind: 'strength' as const }],
        };
        nowSpy.mockReturnValueOnce(2000);
        const routineIdB = await acceptDraft(database, draft2, { kind: 'create' });
        expect(routineIdB).toBe('routine-2000');

        // Create a draft to update routineA with a new exercise
        const updateDraft = {
          name: 'Routine A Updated',
          exercises: [{ title: 'Deadlift', kind: 'strength' as const }],
        };

        // Accept in edit mode with routineIdA (mode is authoritative)
        const returnedId = await acceptDraft(database, updateDraft, { kind: 'edit', routineId: routineIdA });

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
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('debrief mode', () => {
    test('revises the routine that was just performed, never a fresh one', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      try {
        nowSpy.mockReturnValueOnce(1000);
        const routineId = await acceptDraft(
          database,
          { name: 'Upper Body', exercises: [{ title: 'Bench Press', kind: 'strength' as const }] },
          { kind: 'create' }
        );
        // A fresh id would be routine-2000, so minting one here would be visible.
        nowSpy.mockReturnValue(2000);

        const returnedId = await acceptDraft(
          database,
          {
            name: 'Upper Body',
            exercises: [
              { title: 'Bench Press', kind: 'strength' as const, targetSets: 3, targetReps: 6 },
            ],
          },
          { kind: 'debrief', routineId, sessionId: 'session-1' }
        );

        expect(returnedId).toBe(routineId);

        const routines = await database.get('routines').query().fetch();
        expect(routines).toHaveLength(1);

        const entries = await database
          .get('routine_exercises')
          .query(Q.where('routine_id', routineId))
          .fetch();
        expect(entries).toHaveLength(1);
        expect((entries[0] as any).targetReps).toBe(6);
      } finally {
        nowSpy.mockRestore();
      }
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

  describe('coach-prescribed-weights.AC2.10-11 (lbs to kg conversion)', () => {
    // coach-prescribed-weights.AC2.10: Converts lbs to kg exactly once
    test('coach-prescribed-weights.AC2.10: converts targetWeightLbs: 185 to targetWeightKg: 83.91', async () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            targetWeightLbs: 185,
          },
        ],
      };

      const routineId = await acceptDraft(database, draft, { kind: 'create' });

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query(Q.where('routine_id', routineId)).fetch();
      expect(entries).toHaveLength(1);

      const entry = entries[0] as any;
      // Hard-code 83.91 rather than computing via lbsToKg to catch conversion bugs
      expect(entry.targetWeightKg).toBe(83.91);
      expect(typeof entry.targetWeightKg).toBe('number');
    });

    // coach-prescribed-weights.AC2.11: Edge case — omitting targetWeightLbs leaves column null
    test('coach-prescribed-weights.AC2.11: exercise omitting targetWeightLbs stores null targetWeightKg', async () => {
      const draft = {
        name: 'My Routine',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
          },
        ],
      };

      const routineId = await acceptDraft(database, draft, { kind: 'create' });

      const routineExercisesTable = database.get('routine_exercises');
      const entries = await routineExercisesTable.query(Q.where('routine_id', routineId)).fetch();
      expect(entries).toHaveLength(1);

      const entry = entries[0] as any;
      expect(entry.targetWeightKg).toBeNull();
    });
  });

  // #276 Phase 4. Until this landed, acceptDraft passed no `sets`, so EVERY
  // coach-authored routine was aggregate-only and could not express a ramp.
  describe('per-set drafts (AC4.9)', () => {
    /** RAMP as the coach drafts it: pounds. Storage is kg. */
    const RAMP_DRAFT = {
      name: 'Push Day',
      exercises: [
        {
          title: 'Bench Press (Dumbbell)',
          kind: 'strength' as const,
          restSeconds: 120,
          sets: [
            { type: 'warmup' as const, reps: 5, weightLbs: 20 },
            { type: 'warmup' as const, reps: 5, weightLbs: 25 },
            { type: 'warmup' as const, reps: 3, weightLbs: 40 },
            { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
            { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
            { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
            { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
          ],
        },
      ],
    };

    /** The entry's `routine_sets` rows in `order`, as raw columns. */
    async function storedSets(routineId: string): Promise<any[]> {
      const entries = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', routineId))
        .fetch();
      const rows = await database
        .get('routine_sets')
        .query(Q.where('routine_exercise_id', entries[0].id))
        .fetch();

      return rows
        .map((row) => (row as any)._raw)
        .sort((a, b) => a.order - b.order);
    }

    test('stores RAMP as seven sets with distinct-then-repeating kg loads, in order', async () => {
      const routineId = await acceptDraft(database, RAMP_DRAFT, { kind: 'create' });

      const rows = await storedSets(routineId);

      // Hard-coded rather than computed through lbsToKg, so a conversion bug
      // (or a second conversion) is visible rather than cancelled out.
      expect(rows.map((row) => row.target_weight_kg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(rows.map((row) => row.set_type)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      expect(rows.map((row) => row.target_reps)).toEqual([5, 5, 3, 8, 8, 8, 8]);
      expect(rows.map((row) => row.target_reps_max)).toEqual([
        null,
        null,
        null,
        10,
        10,
        10,
        10,
      ]);
      expect(rows.map((row) => row.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    test('converts lbs to kg exactly once per set', async () => {
      // A second conversion turns 50lbs into 22.68kg and then 10.29kg. The
      // ramp assertion above catches that too, but this names the failure.
      const routineId = await acceptDraft(
        database,
        {
          name: 'Single',
          exercises: [
            {
              title: 'Bench Press',
              kind: 'strength' as const,
              sets: [{ type: 'normal' as const, weightLbs: 185 }],
            },
          ],
        },
        { kind: 'create' }
      );

      expect((await storedSets(routineId))[0].target_weight_kg).toBe(83.91);
    });

    test('a set with no prescribed load stores null, not zero', async () => {
      const routineId = await acceptDraft(
        database,
        {
          name: 'Bodyweight',
          exercises: [
            {
              title: 'Push Up',
              kind: 'strength' as const,
              sets: [{ type: 'normal' as const, reps: 20 }],
            },
          ],
        },
        { kind: 'create' }
      );

      // computeSetPrefill treats a non-positive weight as absent, so a stored
      // 0 is a value nothing honours.
      expect((await storedSets(routineId))[0].target_weight_kg).toBeNull();
    });

    test('stores a duration prescription on the set', async () => {
      const routineId = await acceptDraft(
        database,
        {
          name: 'Mobility',
          exercises: [
            {
              title: 'Couch Stretch',
              kind: 'stretch' as const,
              sets: [{ type: 'normal' as const, durationSeconds: 45 }],
            },
          ],
        },
        { kind: 'create' }
      );

      expect((await storedSets(routineId))[0].target_duration_seconds).toBe(45);
    });

    test('a revision replaces the set list wholesale and keeps the entry row id', async () => {
      // Drafts are whole routines, never diffs, and
      // session_sets.routine_exercise_id references the row that must survive.
      const routineId = await acceptDraft(database, RAMP_DRAFT, { kind: 'create' });
      const before = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', routineId))
        .fetch();

      await acceptDraft(
        database,
        {
          name: 'Push Day',
          exercises: [
            {
              title: 'Bench Press (Dumbbell)',
              kind: 'strength' as const,
              restSeconds: 120,
              sets: [
                { type: 'warmup' as const, reps: 5, weightLbs: 25 },
                { type: 'normal' as const, reps: 8, weightLbs: 55 },
              ],
            },
          ],
        },
        { kind: 'edit', routineId }
      );

      const after = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', routineId))
        .fetch();
      expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));

      const rows = await storedSets(routineId);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.target_weight_kg)).toEqual([11.34, 24.95]);
    });
  });

  // The decision Phase 1 deferred: which aggregate columns a set list drives.
  // Answer — ALL FIVE. warmup_sets/target_sets/target_reps were already derived
  // (Phase 1); target_duration_seconds and target_weight_kg join them here,
  // because a per-set draft is the first writer that could make them disagree
  // with the list. `acceptDraft` therefore passes no per-exercise load or
  // duration at all: the set list is the only place either lives.
  describe('derived aggregates (#276 Phase 4 decision)', () => {
    async function storedEntry(routineId: string): Promise<any> {
      const entries = await database
        .get('routine_exercises')
        .query(Q.where('routine_id', routineId))
        .fetch();

      return (entries[0] as any)._raw;
    }

    test('derives the counts and the first working set’s reps from the list', async () => {
      const routineId = await acceptDraft(
        database,
        {
          name: 'Push Day',
          exercises: [
            {
              title: 'Bench Press',
              kind: 'strength' as const,
              sets: [
                { type: 'warmup' as const, reps: 5, weightLbs: 20 },
                { type: 'warmup' as const, reps: 5, weightLbs: 25 },
                { type: 'warmup' as const, reps: 3, weightLbs: 40 },
                { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
                { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
                { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
                { type: 'normal' as const, reps: 8, repsMax: 10, weightLbs: 50 },
              ],
            },
          ],
        },
        { kind: 'create' }
      );

      const raw = await storedEntry(routineId);
      expect(raw.warmup_sets).toBe(3);
      expect(raw.target_sets).toBe(4);
      expect(raw.target_reps).toBe(8);
    });

    test('derives target_weight_kg from the first working set, NOT from a warmup', async () => {
      // The discriminating case: RAMP's first set is 20lbs and its first
      // WORKING set is 50lbs. An implementation reading sets[0] writes 9.07
      // and every surviving aggregate reader describes the ramp as a 20lb
      // exercise.
      const routineId = await acceptDraft(database, {
        name: 'Push Day',
        exercises: [
          {
            title: 'Bench Press',
            kind: 'strength' as const,
            sets: [
              { type: 'warmup' as const, reps: 5, weightLbs: 20 },
              { type: 'normal' as const, reps: 8, weightLbs: 50 },
            ],
          },
        ],
      }, { kind: 'create' });

      expect((await storedEntry(routineId)).target_weight_kg).toBe(22.68);
    });

    test('derives target_duration_seconds from the first working set', async () => {
      const routineId = await acceptDraft(database, {
        name: 'Mobility',
        exercises: [
          {
            title: 'Couch Stretch',
            kind: 'stretch' as const,
            sets: [
              { type: 'warmup' as const, durationSeconds: 20 },
              { type: 'normal' as const, durationSeconds: 60 },
            ],
          },
        ],
      }, { kind: 'create' });

      const raw = await storedEntry(routineId);
      expect(raw.target_duration_seconds).toBe(60);
      expect(raw.target_sets).toBe(1);
    });

    test('leaves the load and duration columns null when no working set prescribes them', async () => {
      const routineId = await acceptDraft(database, {
        name: 'Bodyweight',
        exercises: [
          {
            title: 'Push Up',
            kind: 'strength' as const,
            sets: [{ type: 'normal' as const, reps: 20 }],
          },
        ],
      }, { kind: 'create' });

      const raw = await storedEntry(routineId);
      expect(raw.target_weight_kg).toBeNull();
      expect(raw.target_duration_seconds).toBeNull();
    });

    test('a warmup-only entry derives target_sets 0 — the zero-total default must not fire', async () => {
      // `sets` present means the list is the source of truth. Defaulting
      // target_sets to 1 against a list holding none is exactly the drift the
      // derivation exists to prevent.
      const routineId = await acceptDraft(database, {
        name: 'Warmup Only',
        exercises: [
          {
            title: 'Band Pull Apart',
            kind: 'strength' as const,
            sets: [{ type: 'warmup' as const, reps: 15 }],
          },
        ],
      }, { kind: 'create' });

      const raw = await storedEntry(routineId);
      expect(raw.warmup_sets).toBe(1);
      expect(raw.target_sets).toBe(0);
    });
  });
});
