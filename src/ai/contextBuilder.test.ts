import { Database } from '@nozbe/watermelondb';
import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import {
  createSession,
  appendSet,
  getExerciseWorkingSetHistory,
  updateRoutineExerciseExerciseId,
  upsertExercise,
  upsertRoutine,
  upsertRoutineExercise,
} from '@/db/repository';
import { setSettings, injectSettingsStorage, resetForTesting } from '@/state/settings';
import { SETTINGS_FIELD_MAX_LENGTH } from './draftSchema';
import {
  buildSystem,
  RECENT_WORKOUTS_IN_PROMPT,
  type AiCoachMode,
} from './contextBuilder';
import type { RoutineSetEntry } from '@/db/repository';

/**
 * Fixture conversion helper (#276 Phase 6): `upsertRoutineExercise`'s options
 * no longer carry `warmupSets`/`targetSets`/`targetReps`/`targetWeightKg` — only
 * `sets: RoutineSetEntry[]`. Reproduces exactly what the deleted `setsFromCounts`
 * did, plus the entry-level `targetWeightKg` these fixtures also relied on,
 * applied uniformly to every generated set the same way the deleted
 * `prescribedSets` fallback used to.
 */
function setsFromCounts(
  warmupSets: number,
  targetSets: number,
  targetReps: number,
  targetWeightKg?: number
): RoutineSetEntry[] {
  const reps = targetReps > 0 ? targetReps : undefined;
  return [
    ...Array.from({ length: warmupSets }, () => ({
      setType: 'warmup' as const,
      targetReps: reps,
      targetWeightKg,
    })),
    ...Array.from({ length: targetSets }, () => ({
      setType: 'normal' as const,
      targetReps: reps,
      targetWeightKg,
    })),
  ];
}

/**
 * Writes `sets` as `routine_sets` rows for `routineExerciseId`, mirroring what
 * `replaceRoutineSets` (`src/db/repository.ts`) does — needed only by the tests
 * below that build `routine_exercises` rows directly with `database.get(...).create()`
 * rather than through `upsertRoutineExercise`, because upsert would collapse
 * two rows sharing one `exerciseId`. Must be called from inside an open
 * `database.write`.
 */
async function createRoutineSetsRaw(
  db: Database,
  routineExerciseId: string,
  sets: readonly RoutineSetEntry[]
): Promise<void> {
  for (const [order, set] of sets.entries()) {
    await db.get('routine_sets').create((row: any) => {
      row._raw.routine_exercise_id = routineExerciseId;
      row._raw.order = order;
      row._raw.set_type = set.setType;
      if (set.targetReps !== undefined) row.targetReps = set.targetReps;
      if (set.targetRepsMax !== undefined) row.targetRepsMax = set.targetRepsMax;
      if (set.targetWeightKg !== undefined) row.targetWeightKg = set.targetWeightKg;
      if (set.targetDurationSeconds !== undefined) row.targetDurationSeconds = set.targetDurationSeconds;
      if (set.targetDistanceM !== undefined) row.targetDistanceM = set.targetDistanceM;
    });
  }
}

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

    // #276 AC4.7. This assertion previously pinned
    // 'warmupSets, targetDurationSeconds, restSeconds: when present, must be
    // integers >= 0'. Both bounds still exist — one on the exercise, one on the
    // set — so the sentence is rewritten rather than deleted.
    it('includes persona units contract for the >= 0 bounds, per level', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('restSeconds: when present, must be an integer >= 0');
      expect(prompt).toContain('durationSeconds: when present, must be an integer >= 0');
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

    // #276 AC4.7. Was 'targetSets, targetReps: when present, must be integers
    // >= 1'. The set count is now the list's length, so only the reps bound
    // survives as a number — restated per set, alongside the rep-range bound
    // the range case added.
    it('IMPORTANT 1: includes constraint that reps must be >= 1 when present', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('reps: when present, must be an integer >= 1');
      expect(prompt).toContain(
        'repsMax: the top of a rep range whose bottom is "reps"; when present, must be an integer >= reps, and "reps" must be present alongside it'
      );
    }, 30000);

    // #276 AC4.8. AGENTS.md flags this sentence as having no validator
    // counterpart — it steers the model away from zero-planned-set drafts — so
    // it survives the rewrite in per-set form rather than being dropped.
    it('includes guidance to give a duration-based exercise a single set', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'Give a duration-based exercise (durationSeconds instead of reps) a single set in the list unless the user asks for multiple timed sets — a timed hold is still one planned set in the session flow'
      );
    }, 30000);

    // #276 AC4.7. The rule the whole phase exists for. Nothing in
    // validateRoutineDraft can require a ramp, so this sentence is the only
    // thing that asks for one.
    it('tells the coach to write a warmup ramp out set by set', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'Write a warmup ramp out set by set, each warmup carrying its own weightLbs, rather than repeating one load — the set list exists so a ramp can be programmed'
      );
    }, 30000);

    it('states that the set list is required and non-empty', async () => {
      // The AC4.6 bound. validateRoutineDraft is its only enforcing layer —
      // `minItems` would 400 the request — so the persona must say it.
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'sets: the ordered list of sets to perform, one object per set. Required, and must contain at least one set'
      );
    }, 30000);

    it('states the set type vocabulary', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'type: must be "warmup" or "normal". Warmup sets come first, in the order they are performed'
      );
    }, 30000);

    it('documents the exercise description field and its create-only application', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'description: optional detailed how-to text shown under the exercise on the routine screen; it takes effect only when the draft creates a brand-new exercise — an existing exercise keeps its current description'
      );
    }, 30000);

    // coach-prescribed-weights.AC2.8, restated per set for #276 AC4.7. The
    // bound (positive, 0.5 grid) is unchanged; what moved is the level it
    // applies at — validateRoutineDraft now enforces it once per set.
    it('states the complete weightLbs bound and omit guidance in the set schema', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'weightLbs: the load for THIS set, in pounds; when present, must be a positive number in steps of 0.5 (e.g. 185, 187.5). Omit it when you are not programming a load — an omitted weight leaves the athlete\'s own recent history to fill the field'
      );
    }, 30000);

    // coach-prescribed-weights.AC2.9, renamed for #276 AC4.7: the exception is
    // still the load field, which is still the only non-integer in the
    // contract; it is now spelled weightLbs and lives on the set.
    it('updates the blanket integer guidance to allow weightLbs half-steps', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'All numeric values must be integers, except weightLbs, which may use 0.5 steps'
      );
    }, 30000);

    it('no longer offers the per-exercise aggregates the set list replaced', async () => {
      // One turn shape, three declarations. A persona still naming
      // targetSets/targetWeightLbs asks for fields AI_TURN_SCHEMA rejects with
      // additionalProperties: false, so the whole turn fails.
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).not.toContain('targetWeightLbs');
      expect(prompt).not.toContain('targetSets');
      expect(prompt).not.toContain('targetReps');
      expect(prompt).not.toContain('targetDurationSeconds');
      expect(prompt).not.toContain('warmupSets');
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

      // Age/Experience are labelled lines inside one "About the User"
      // section, not sections of their own — the prose must not promise the
      // model a structure the prompt does not contain.
      expect(prompt).toContain(
        'proposes new values for the "User Goals", "Available Equipment" and "Coaching Style" sections below, and for the Age and Experience lines under "About the User"'
      );
    }, 30000);

    it('includes constraint that a proposal must carry at least one field', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'A settings proposal must include at least one of "goals", "equipment", "personality", "age", or "experience"'
      );
    }, 30000);

    it('includes the non-empty and maximum-length bounds on proposal fields', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        `goals, equipment, personality, age, experience: when present, must be non-empty strings of at most ${SETTINGS_FIELD_MAX_LENGTH} characters`
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
        'Never include a settingsProposal unless the user asked to change their goals, equipment, coaching style, age, or experience'
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
        restSeconds: 120,
        sets: setsFromCounts(1, 3, 8),
      });
      await upsertRoutineExercise(database, 'routine-1', {
        exerciseId: 'exercise-2',
        order: 1,
        restSeconds: 90,
        sets: setsFromCounts(0, 4, 10),
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
        restSeconds: 180,
        sets: setsFromCounts(0, 3, 5),
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain('Upper Body');
      expect(prompt).toContain('Lower Body');
      expect(prompt).toContain('Bench Press');
      expect(prompt).toContain('Rows');
      expect(prompt).toContain('Squat');
      // #276 AC4.11: the plan renders as its set list. These fixtures write
      // uniform `routine_sets` lists (#276 Phase 6: there is no aggregate
      // fallback any more), and the run-length rule collapses each uniform
      // list back to one segment.
      expect(prompt).toContain('3 × 8 reps');
      expect(prompt).toContain('4 × 10 reps');
      expect(prompt).toContain('3 × 5 reps');
      expect(prompt).toContain('warmup 8 reps');
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
        sets: setsFromCounts(0, 3, 6),
      });
      await upsertRoutineExercise(database, 'routine-superset', {
        exerciseId: 'exercise-dumbbell',
        order: 1,
        supersetGroup: supersetLabel,
        sets: setsFromCounts(0, 3, 8),
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
        sets: setsFromCounts(0, 3, 6),
      });

      // Standalone exercise at order 1 (between supersets)
      await upsertRoutineExercise(database, 'routine-interleave', {
        exerciseId: 'exercise-standalone',
        order: 1,
        sets: setsFromCounts(0, 3, 12),
      });

      // Superset member at order 2
      await upsertRoutineExercise(database, 'routine-interleave', {
        exerciseId: 'exercise-superset-2',
        order: 2,
        supersetGroup: supersetLabel,
        sets: setsFromCounts(0, 3, 8),
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

    it('includes coach-prescribed weight in lbs when set on an entry, and omits it when absent or zero (AC3.2, AC3.3)', async () => {
      await database.write(async () => {
        const routinesTable = database.get('routines');
        await routinesTable.create((r: any) => {
          r._raw.id = 'routine-mixed-prescription';
          r.name = 'Mixed Loads';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        const exercisesTable = database.get('exercises');
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-squat';
          e.title = 'Back Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-bench';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
        await exercisesTable.create((e: any) => {
          e._raw.id = 'exercise-zero';
          e.title = 'Zero Squat';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      // Prescribed entry
      await upsertRoutineExercise(database, 'routine-mixed-prescription', {
        exerciseId: 'exercise-squat',
        order: 0,
        sets: setsFromCounts(0, 3, 5, 83.91),
      });

      // Unprescribed entry (absent)
      await upsertRoutineExercise(database, 'routine-mixed-prescription', {
        exerciseId: 'exercise-bench',
        order: 1,
        restSeconds: 120,
        sets: setsFromCounts(0, 3, 8),
      });

      // Zero-prescribed entry — kills the !== undefined and != null mutants
      await upsertRoutineExercise(database, 'routine-mixed-prescription', {
        exerciseId: 'exercise-zero',
        order: 2,
        sets: setsFromCounts(0, 3, 5, 0),
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      // Extract routine section to scope assertions
      const routineStart = prompt.indexOf('## Existing Routines');
      const historyStart = prompt.indexOf('## Recent Workouts');
      const routineSection = prompt.substring(routineStart, historyStart);

      // AC3.2: Prescribed entry renders weight in lbs in correct position.
      // #276 AC4.11 reshaped the line: the plan is now the entry's set list —
      // the fixture writes three identical normal `routine_sets` rows, and the
      // run-length rule collapses them back to one segment. The load still
      // renders in lbs, still on this segment.
      expect(routineSection).toContain('Back Squat (strength) | 3 × 5 reps @ 185lbs');
      // Assert the rendered lbs string, not the kg value — this proves
      // the conversion happened at the display edge. kgToLbs(83.91) = 185.
      expect(routineSection).toContain('@ 185lbs');

      // AC3.3: Unprescribed entries (absent and zero) don't render weight segment
      expect(routineSection).toContain('Bench Press');
      expect(routineSection).toContain('Zero Squat');
      expect(routineSection).toContain('3 × 8 reps');
      expect(routineSection).toContain('rest 120s');

      // Ensure exactly one weight segment: only the prescribed squat's 185lbs, not zero or absent
      const weightMatches = routineSection.match(/@ \d+(\.\d+)?lbs/g);
      expect(weightMatches).toHaveLength(1); // Only the squat's 185lbs
    }, 30000);

    it('returns a non-empty prompt when database is empty', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      // Should contain persona/rules and explicit placeholders
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('No routines yet');
      expect(prompt).not.toMatch(/undefined|null/);
    }, 30000);
  });

  // #276 AC4.11. The coach must be able to PROGRESS a ramp it wrote last week,
  // which it can only do if it can see it. A summarised "3 warmup sets" line
  // means the coach flattens the ramp on the next revision.
  describe('Per-set routine rendering (AC4.11)', () => {
    async function writeRamp(): Promise<void> {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-ramp';
          r.name = 'Push Day';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'bench-press-dumbbell';
          e.title = 'Bench Press (Dumbbell)';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      await upsertRoutine(database, 'routine-ramp', 'Push Day', [
        {
          exerciseId: 'bench-press-dumbbell',
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
    }

    it('renders RAMP with all three warmup loads, distinct and in lbs', async () => {
      await writeRamp();

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        '  - Bench Press (Dumbbell) (strength) | warmup 5 reps @ 20lbs, warmup 5 reps @ 25lbs, warmup 3 reps @ 40lbs, 4 × 8-10 reps @ 50lbs | rest 120s'
      );
    }, 30000);

    it('shows three distinct warmup weights, not one repeated', async () => {
      // The regression this AC names, asserted as a property rather than as
      // one string: a count-summarised line has fewer than three.
      await writeRamp();

      const prompt = await buildSystem(database, { kind: 'create' });
      const routineSection = prompt.slice(
        prompt.indexOf('## Existing Routines'),
        prompt.indexOf('## Recent Workouts')
      );

      const warmupLoads = [...routineSection.matchAll(/warmup [\d-]+ reps @ (\d+(?:\.\d+)?)lbs/g)].map(
        (match) => match[1]
      );
      expect(warmupLoads).toEqual(['20', '25', '40']);
    }, 30000);
  });

  describe('Routine description', () => {
    it('emits the routine notes directly under its heading in Existing Routines', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-noted';
          r.name = 'Deload Week';
          r._raw.notes = 'Keep everything light; stop two reps shy of failure.';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        await database.get('exercises').create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      await upsertRoutineExercise(database, 'routine-noted', {
        exerciseId: 'exercise-1',
        order: 0,
        sets: setsFromCounts(0, 3, 8),
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        '### Deload Week (id: routine-noted)\nKeep everything light; stop two reps shy of failure.'
      );
    }, 30000);

    it('strips leading # characters from notes lines so they cannot masquerade as section headings', async () => {
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-sneaky';
          r.name = 'Sneaky';
          r._raw.notes = '# Deload rules\n## Stay light\nStop two reps shy of failure.';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });

        await database.get('exercises').create((e: any) => {
          e._raw.id = 'exercise-1';
          e.title = 'Bench Press';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      await upsertRoutineExercise(database, 'routine-sneaky', {
        exerciseId: 'exercise-1',
        order: 0,
        sets: setsFromCounts(0, 3, 8),
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        '### Sneaky (id: routine-sneaky)\nDeload rules\nStay light\nStop two reps shy of failure.'
      );
      expect(prompt).not.toContain('# Deload rules');
      expect(prompt).not.toContain('## Stay light');
    }, 30000);

    it('documents the draft-level notes field in the persona', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        '- A draft may include "notes": a short description of the routine, shown to the user on the routine screen and at the start of a workout. Omitting it in a revision keeps the existing description'
      );
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
      // Stored 100kg speaks display lbs in the prompt, matching the UI
      expect(prompt).toContain('@ 220.5lbs');
    }, 30000);

    it('does not hand a substituted exercise the history the original earned', async () => {
      // The end-to-end shape of the swap bug: the coach reads history through
      // getExerciseWorkingSetHistory, so re-pointing a routine entry must not
      // make months of the original's work show up under the substitute's name.
      const routineId = 'routine-swap-history';
      const routineExerciseId = 'routine-exercise-swap';

      await upsertExercise(database, 'exercise-barbell-bench', 'Barbell Bench Press', 'strength');
      await upsertExercise(database, 'exercise-floor-press', 'Dumbbell Floor Press', 'strength');

      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Swap Routine';
        });
        await database.get('routine_exercises').create((re: any) => {
          re._raw.id = routineExerciseId;
          re._raw.routine_id = routineId;
          re._raw.exercise_id = 'exercise-barbell-bench';
          re._raw.order = 0;
          re._raw.warmup_sets = 0;
        });
      });

      // Three weeks of bench work, logged the way a pre-v3 install did:
      // no recorded identity, resolvable only through the join.
      for (const sessionId of ['session-w1', 'session-w2', 'session-w3']) {
        await createSession(database, { sessionId, routineId, startedAtMs: Date.now() - 100000 });
        await appendSet(database, sessionId, routineExerciseId, {
          setType: 'working',
          reps: 8,
          weightKg: 100,
        });
      }

      await updateRoutineExerciseExerciseId(
        database,
        routineExerciseId,
        'exercise-floor-press'
      );

      const prompt = await buildSystem(database, { kind: 'create' });
      const historyStart = prompt.indexOf('## Recent Training History');
      expect(historyStart).toBeGreaterThan(-1);
      const historySection = prompt.slice(historyStart);

      // The substitute is what the routine names now, so it is the exercise
      // whose history the coach looks up — and it has none. Before the fix this
      // section read as three sessions of 220.5lb work under its name.
      expect(historySection).not.toContain('Dumbbell Floor Press');
      expect(historySection).not.toContain('220.5lbs');

      // The sets themselves are intact and still the original's. (They are out
      // of the prompt only because the section is scoped to exercises the
      // user's routines currently name — the same reason any exercise dropped
      // from every routine stops appearing. That scoping predates the swap
      // feature and is unchanged by it.)
      expect(
        await getExerciseWorkingSetHistory(database, 'exercise-barbell-bench')
      ).toHaveLength(3);
      expect(
        await getExerciseWorkingSetHistory(database, 'exercise-floor-press')
      ).toHaveLength(0);
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
        restSeconds: 120,
        sets: setsFromCounts(1, 3, 8),
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: 'exercise-row',
        order: 1,
        sets: setsFromCounts(0, 4, 10),
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
        '  Bench Press (target warmup 8 reps, 3 × 8 reps): 5 reps @ 88lbs (warmup), 8 reps @ 220.5lbs, 6 reps @ 220.5lbs RPE 9'
      );
    }, 30000);

    it('says so for a planned exercise that was never logged', async () => {
      await seedFinishedWorkout();

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(lineFor(prompt, 'Rows')).toBe('  Rows (target 4 × 10 reps): no sets logged');
    }, 30000);

    it('resolves the plan for SUPERSET entries, not only standalone ones', async () => {
      // `planByRow` fills from two arrays because RoutineDetail partitions a
      // routine's entries into exactly those two — `supersetGroups` and
      // `standaloneExercises` are the two filters over a closed two-member
      // union in routineDetailPresenter, so there is no third source to miss.
      // Every OTHER debrief fixture in this file is standalone, which left the
      // superset half of that fill unpinned: dropping it silently strips the
      // target from every superset exercise, and the coach debriefs a plan it
      // cannot see.
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Arms';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });
        for (const [id, title] of [
          ['exercise-curl', 'Curls'],
          ['exercise-pushdown', 'Pushdowns'],
        ]) {
          await database.get('exercises').create((e: any) => {
            e._raw.id = id;
            e.title = title;
            e.kind = 'strength';
            e.created_at = Date.now();
          });
        }
      });

      // Two members of ONE group with visibly different plans, so a line that
      // read the other member's plan is not interchangeable with the right one.
      const curl = await upsertRoutineExercise(database, routineId, {
        exerciseId: 'exercise-curl',
        order: 0,
        supersetGroup: 'A',
        sets: setsFromCounts(0, 3, 12),
      });
      await upsertRoutineExercise(database, routineId, {
        exerciseId: 'exercise-pushdown',
        order: 1,
        supersetGroup: 'A',
        sets: setsFromCounts(0, 4, 15),
      });

      await createSession(database, {
        sessionId,
        routineId,
        startedAtMs: Date.now() - 3600000,
      });
      await appendSet(database, sessionId, (curl as any).id, {
        setType: 'working',
        reps: 12,
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(lineFor(prompt, 'Curls')).toBe('  Curls (target 3 × 12 reps): 12 reps');
      expect(lineFor(prompt, 'Pushdowns')).toBe('  Pushdowns (target 4 × 15 reps): no sets logged');
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

      // 999kg from the other session would render as 2202.5lbs
      expect(lineFor(prompt, 'Bench Press')).not.toContain('2202.5lbs');
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
      // routine_exercise lookup does by (routine, order). #276 Phase 6: the
      // row itself carries no plan any more, so the `routine_sets` rows have
      // to be written directly too, the way `replaceRoutineSets` would.
      let second: any;
      await database.write(async () => {
        const first = await database.get('routine_exercises').create((re: any) => {
          re.routineId = routineId;
          re.exerciseId = 'exercise-bench';
          re.order = 0;
        });
        second = await database.get('routine_exercises').create((re: any) => {
          re.routineId = routineId;
          re.exerciseId = 'exercise-bench';
          re.order = 1;
        });
        await createRoutineSetsRaw(database, first.id, setsFromCounts(0, 3, 8));
        await createRoutineSetsRaw(database, second.id, setsFromCounts(0, 1, 20));
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
        '  Bench Press (target 3 × 8 reps): no sets logged',
        '  Bench Press (target 20 reps): 20 reps @ 88lbs',
      ]);
    }, 30000);

    it('leaves the just-finished summary out of a create conversation', async () => {
      await seedFinishedWorkout();

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).not.toContain('Just-Finished Workout');
      expect(prompt).not.toContain('The user has just finished the routine');
    }, 30000);

    it('does not leak the anthropic key or openai key', async () => {
      await seedFinishedWorkout();
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        openaiKey: 'sk-proj-openai-test-secret',
      });

      const prompt = await buildSystem(database, { kind: 'debrief', routineId, sessionId });

      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('sk-proj-openai-test-secret');
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
        });
        await createRoutineSetsRaw(database, re.id, setsFromCounts(0, 3, 10));
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

      // ...and with NO target segment. This is the only debrief fixture whose
      // plan is unresolvable, so `formatTarget`'s empty-summary guard is
      // observable here and nowhere else: without it the line reads
      // "Push-ups (target ): 8 reps" — a dangling parenthetical the coach
      // would read as a real, empty prescription. Asserted as the whole line,
      // since `toContain('Push-ups')` passes either way.
      expect(prompt).toContain('  Push-ups: 8 reps');
      expect(prompt).not.toContain('(target )');
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
        '  Bench Press: 8 reps @ 226lbs (2026-07-29), 8 reps @ 220.5lbs (2026-07-22)'
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
    it('does not leak anthropic key or openai key in prompt', async () => {
      setSettings({
        anthropicKey: 'sk-ant-test-secret',
        openaiKey: 'sk-proj-openai-test-secret',
        aiGoals: 'Build strength',
        aiEquipment: 'Dumbbells',
      });

      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).not.toContain('sk-ant-test-secret');
      expect(prompt).not.toContain('sk-proj-openai-test-secret');
    }, 30000);
  });

  describe('Coach directives', () => {
    it('weaves the shipped directive content into the composed prompt in pinned order', async () => {
      // The constants now ship with real content (2026-07-31), so the default
      // composition must carry both sections: overridable before the user's
      // settings, immutable last, with the whitespace hygiene intact.
      const prompt = await buildSystem(database, { kind: 'create' });

      const overridableIdx = prompt.indexOf('## Coach Directives (Default Behavior)');
      const immutableIdx = prompt.indexOf('## Coach Directives (Non-Negotiable)');
      expect(overridableIdx).toBeGreaterThan(-1);
      expect(immutableIdx).toBeGreaterThan(-1);
      expect(overridableIdx).toBeLessThan(prompt.indexOf('## User Goals'));
      const lastHeaderIdx = Math.max(
        ...[...prompt.matchAll(/^## .*$/gm)].map((m) => m.index ?? -1)
      );
      expect(immutableIdx).toBe(lastHeaderIdx);
      expect(prompt).not.toMatch(/\n{3,}/);
    }, 30000);

    describe('Placement invariants in composed buildSystem', () => {
      it('places overridable directives before user goals', async () => {
        const prompt = await buildSystem(database, { kind: 'create' }, {
          overridable: '- OVERRIDABLE_MARKER',
          immutable: '',
        });

        const overridableIdx = prompt.indexOf('## Coach Directives (Default Behavior)');
        const goalsIdx = prompt.indexOf('## User Goals');

        expect(overridableIdx).toBeGreaterThan(-1);
        expect(goalsIdx).toBeGreaterThan(-1);
        expect(overridableIdx).toBeLessThan(goalsIdx);
        // An empty injected directive contributes no header at all.
        expect(prompt).not.toContain('## Coach Directives (Non-Negotiable)');
      }, 30000);

      it('places every other section before immutable directives', async () => {
        const prompt = await buildSystem(database, { kind: 'create' }, {
          overridable: '- OVERRIDABLE_MARKER',
          immutable: '- IMMUTABLE_MARKER',
        });

        const immutableIdx = prompt.indexOf('## Coach Directives (Non-Negotiable)');
        const goalsIdx = prompt.indexOf('## User Goals');
        const equipmentIdx = prompt.indexOf('## Available Equipment');
        const personalityIdx = prompt.indexOf('## Coaching Style');
        const routinesIdx = prompt.indexOf('## Existing Routines');

        expect(immutableIdx).toBeGreaterThan(-1);
        expect(goalsIdx).toBeGreaterThan(-1);
        expect(equipmentIdx).toBeGreaterThan(-1);
        expect(personalityIdx).toBeGreaterThan(-1);
        expect(routinesIdx).toBeGreaterThan(-1);

        // All these sections must come before the immutable directives
        expect(goalsIdx).toBeLessThan(immutableIdx);
        expect(equipmentIdx).toBeLessThan(immutableIdx);
        expect(personalityIdx).toBeLessThan(immutableIdx);
        expect(routinesIdx).toBeLessThan(immutableIdx);
      }, 30000);

      it('ends with immutable directives', async () => {
        const prompt = await buildSystem(database, { kind: 'create' }, {
          overridable: '',
          immutable: '- IMMUTABLE_MARKER',
        });

        expect(prompt.trimEnd()).toContain('- IMMUTABLE_MARKER');
        expect(prompt.trimEnd().endsWith('- IMMUTABLE_MARKER')).toBe(true);
      }, 30000);

      it('prevents composition from introducing excessive blank lines', async () => {
        const prompt = await buildSystem(database, { kind: 'create' }, {
          overridable: '- OVERRIDABLE_MARKER',
          immutable: '- IMMUTABLE_MARKER',
        });

        // Three or more consecutive newlines indicate a composition error
        expect(prompt).not.toMatch(/\n{3,}/);
      }, 30000);

      it('ends with immutable directives in debrief mode, after the workout addendum', async () => {
        // Debrief appends the most user-authored text (routine name, exercise
        // titles) after everything else — the immutable section must still land
        // last, or the anti-injection ordering silently breaks for this mode.
        await database.write(async () => {
          await database.get('routines').create((r: any) => {
            r._raw.id = 'routine-place-debrief';
            r.name = 'Placement Day';
            r.created_at = Date.now();
            r.updated_at = Date.now();
          });
          await database.get('exercises').create((e: any) => {
            e._raw.id = 'exercise-place-bench';
            e.title = 'Bench Press';
            e.kind = 'strength';
            e.created_at = Date.now();
          });
        });
        const re = await upsertRoutineExercise(database, 'routine-place-debrief', {
          exerciseId: 'exercise-place-bench',
          order: 0,
          sets: setsFromCounts(0, 3, 8),
        });
        await createSession(database, {
          sessionId: 'session-place-debrief',
          routineId: 'routine-place-debrief',
          startedAtMs: Date.now() - 3600000,
        });
        await appendSet(database, 'session-place-debrief', (re as any).id, {
          setType: 'working',
          reps: 8,
          weightKg: 100,
        });

        const prompt = await buildSystem(
          database,
          { kind: 'debrief', routineId: 'routine-place-debrief', sessionId: 'session-place-debrief' },
          { overridable: '', immutable: '- IMMUTABLE_MARKER' }
        );

        expect(prompt.indexOf('Bench Press')).toBeLessThan(
          prompt.indexOf('## Coach Directives (Non-Negotiable)')
        );
        expect(prompt.trimEnd().endsWith('- IMMUTABLE_MARKER')).toBe(true);
      }, 30000);
    });

    it('includes the RPE mention constraint in immutable directives', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });

      expect(prompt).toContain(
        'Do not spontaneously bring up or ask about RPE (Rate of Perceived Exertion) unless the user has logged RPE in their workout history or raises it themselves'
      );
    }, 30000);
  });

  describe('coach-onboarding.AC3.1: onboarding mode persona', () => {
    it('coach-onboarding.AC3.1 Success: persona includes interview instructions', async () => {
      const prompt = await buildSystem(database, { kind: 'onboarding' });
      expect(prompt).toContain('You are interviewing a new user to build their profile');
      // The WHOLE list plus the cap, in one literal. A prefix match here
      // ('Ask their goals, equipment, personality') let an extra field be
      // appended to the sentence with the entire suite green — verified.
      expect(prompt).toContain('Ask their goals, equipment, personality, age, and experience. Ask AT MOST TWO of them in any single message — never three or more, however naturally they group. Age is sensitive; ask it last.');
      expect(prompt).toContain('Age is sensitive; ask it last');
      // Pin the mechanism, not just the sentiment. The previous wording said
      // "record their refusal verbatim", which the live model read as something
      // to do in its reply rather than a field to emit — see #193. The words
      // that carry the fix are "send it in settingsProposal".
      expect(prompt).toContain('send it in settingsProposal with their own words as the value');
      expect(prompt).toContain('Never re-ask a field the user has declined');
      expect(prompt).toContain('Every field you record must be grounded in something the user actually said');
    }, 30000);

    it('coach-onboarding.AC3.2 Success: onboarding persona closes with routine offer', async () => {
      const prompt = await buildSystem(database, { kind: 'onboarding' });
      expect(prompt).toContain('At the end of the interview, offer to draft a first routine');
    }, 30000);

    it('coach-onboarding.AC3.3 Success: approval sentence absent in onboarding', async () => {
      const prompt = await buildSystem(database, { kind: 'onboarding' });
      expect(prompt).not.toContain('The user must approve a settings proposal before it takes effect');
      // Ensure onboarding mode still includes the base persona with JSON contract
      expect(prompt).toContain('Every response must be valid JSON');
    }, 30000);

    it('coach-onboarding.AC3.3 Success: approval sentence present in create mode', async () => {
      const prompt = await buildSystem(database, { kind: 'create' });
      expect(prompt).toContain('The user must approve a settings proposal before it takes effect');
      expect(prompt).not.toContain('You are interviewing a new user to build their profile');
    }, 30000);

    it('coach-onboarding.AC3.3 Success: approval sentence present in edit mode', async () => {
      // Create a routine first so edit mode is valid
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-edit-test';
          r.name = 'Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'exercise-edit-test';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      await upsertRoutineExercise(database, 'routine-edit-test', {
        exerciseId: 'exercise-edit-test',
        order: 0,
        sets: setsFromCounts(0, 3, 8),
      });

      const prompt = await buildSystem(database, { kind: 'edit', routineId: 'routine-edit-test' });
      expect(prompt).toContain('The user must approve a settings proposal before it takes effect');
      expect(prompt).not.toContain('You are interviewing a new user to build their profile');
    }, 30000);

    it('coach-onboarding.AC3.3 Success: approval sentence present in debrief mode', async () => {
      // Create session for debrief
      await database.write(async () => {
        await database.get('routines').create((r: any) => {
          r._raw.id = 'routine-debrief-test';
          r.name = 'Test Routine';
          r.created_at = Date.now();
          r.updated_at = Date.now();
        });
        await database.get('exercises').create((e: any) => {
          e._raw.id = 'exercise-debrief-test';
          e.title = 'Test Exercise';
          e.kind = 'strength';
          e.created_at = Date.now();
        });
      });

      await upsertRoutineExercise(database, 'routine-debrief-test', {
        exerciseId: 'exercise-debrief-test',
        order: 0,
        sets: setsFromCounts(0, 3, 8),
      });

      await createSession(database, {
        sessionId: 'session-debrief-test',
        routineId: 'routine-debrief-test',
        startedAtMs: Date.now() - 3600000,
      });

      const prompt = await buildSystem(database, {
        kind: 'debrief',
        routineId: 'routine-debrief-test',
        sessionId: 'session-debrief-test',
      });
      expect(prompt).toContain('The user must approve a settings proposal before it takes effect');
      expect(prompt).not.toContain('You are interviewing a new user to build their profile');
    }, 30000);
  });

  describe('coach-onboarding.AC3.4: already-recorded profile values', () => {
    it('coach-onboarding.AC3.4 Success: already-recorded profile values appear in prompt', async () => {
      setSettings({
        profileAge: '35',
        profileExperience: 'intermediate',
      });

      const prompt = await buildSystem(database, { kind: 'onboarding' });

      // Assert label pairs to ensure values aren't mislabeled
      expect(prompt).toContain('Age: 35');
      expect(prompt).toContain('Experience: intermediate');
      // ...and that the removed gender field never renders a line here. This
      // assertion must live in a test that POPULATES the profile: the AC3.7
      // guard runs against an empty profile, so About-the-User is absent there
      // and a re-added `Gender:` line slips past it — verified.
      expect(prompt).not.toMatch(/gender/i);
    }, 30000);

    it('coach-onboarding.AC3.4 Success: the profile reaches every mode, not just onboarding', async () => {
      // The profile is coaching input, not interview bookkeeping — the whole
      // point of Phase 6 was getting it in front of every surface. Asserting it
      // only in onboarding mode let a guard restricting the section to that mode
      // pass 1632/1632, which would silently strip the profile from ordinary
      // coaching while the create-mode persona still promises the model "the
      // Age and Experience lines under 'About the User'".
      setSettings({
        profileAge: '35',
        profileExperience: 'intermediate',
      });

      for (const mode of [{ kind: 'create' } as const, { kind: 'edit', routineId: 'routine-1' } as const]) {
        const prompt = await buildSystem(database, mode);
        expect(prompt).toContain('Age: 35');
        expect(prompt).toContain('Experience: intermediate');
        expect(prompt).not.toMatch(/gender/i);
      }
    }, 30000);

    it('coach-onboarding.AC6.6 Edge: profile field values are neutralized (markdown-safe)', async () => {
      setSettings({
        profileAge: '## Secret Heading',
        profileExperience: '#### Deep Heading',
      });

      const prompt = await buildSystem(database, { kind: 'onboarding' });

      // Values starting with ## should not render as markdown headings
      expect(prompt).not.toContain('## Secret Heading');
      expect(prompt).not.toContain('#### Deep Heading');
      // Instead, they should be neutralized (leading hashes stripped)
      expect(prompt).toContain('Secret Heading');
      expect(prompt).toContain('Deep Heading');
    }, 30000);
  });

  describe('coach-onboarding.AC3.7: no name field', () => {
    it('coach-onboarding.AC3.7 Failure: ONBOARDING_PROFILE_FIELDS does not contain name', async () => {
      // Import the constant
      const { ONBOARDING_PROFILE_FIELDS } = await import('./contextBuilder');
      expect(ONBOARDING_PROFILE_FIELDS).not.toContain('name');
    }, 30000);

    it('coach-onboarding.AC3.7 Failure: the rendered prompt asks for exactly the constant, and never a name', async () => {
      // The point of AC3.7 that the constant alone cannot carry: the constant is
      // only a guard if the PROSE is built from it. When it was declared but
      // unused, appending "and name" to the hand-written sentence left all 85
      // tests green. Asserting the rendered list against onboardingFieldList()
      // ties the sentence to the data; asserting the literal separately (above,
      // in AC3.1) stops the constant itself from quietly growing a field.
      const { onboardingFieldList } = await import('./contextBuilder');
      const prompt = await buildSystem(database, { kind: 'onboarding' });

      expect(prompt).toContain(`Ask their ${onboardingFieldList()}. Ask AT MOST TWO of them`);
      expect(onboardingFieldList()).not.toContain('name');
    }, 30000);

    it('coach-onboarding.AC3.7 Failure: ONBOARDING_PROFILE_FIELDS contains exactly expected fields', async () => {
      const { ONBOARDING_PROFILE_FIELDS } = await import('./contextBuilder');
      expect(ONBOARDING_PROFILE_FIELDS).toEqual([
        'goals',
        'equipment',
        'personality',
        'age',
        'experience',
      ]);
    }, 30000);

    it('coach-onboarding.AC3.7 Failure: the onboarding persona block is pinned whole, so no instruction can be added inside it', async () => {
      // Three previous attempts at this criterion were each walked around:
      //   1. a list of literal phrases ('ask for your name', ...) — the persona
      //      asked for the name in different words and passed;
      //   2. a constant with no production consumer — the prose was hand-written,
      //      so pinning the constant governed nothing;
      //   3. a regex over the whole prompt — catches "their name" but not
      //      "what the user is called" or "how they'd like to be addressed",
      //      both verified to survive.
      //
      // The threat is not one phrasing, it is ANY added instruction. So pin the
      // whole block: everything from the interview sentence to the next section
      // heading. An inserted sentence changes this string whatever its wording,
      // and a legitimate edit has to be re-approved here deliberately.
      //
      // The list inside it is rendered from ONBOARDING_PROFILE_FIELDS (asserted
      // separately above), so this literal and the constant must agree too.
      const prompt = await buildSystem(database, { kind: 'onboarding' });

      // Anchor the low edge at the END OF THE SHARED PERSONA, not at the
      // interview sentence. Anchoring on the interview sentence left everything
      // between the persona and it unguarded — and that is the natural place to
      // add an onboarding instruction, inside the same `if (mode.kind ===
      // 'onboarding')` return. Verified: a sentence inserted there passed
      // 1632/1632 before this change.
      const personaTail = 'suggest a lighter week when recent sessions have been both frequent and heavy';
      const tailIdx = prompt.indexOf(personaTail);
      expect(tailIdx).toBeGreaterThan(-1);
      const start = tailIdx + personaTail.length;
      expect(prompt.indexOf('You are interviewing a new user')).toBeGreaterThan(-1);
      const rest = prompt.slice(start);
      // Terminate on the SPECIFIC next section, not a generic '\n\n## '. A
      // generic heading terminator is controlled by the very content being
      // guarded: adding a '## Interview Notes' heading inside the onboarding
      // branch pushed everything after it outside the pin, and a name
      // solicitation there passed 1634/1634 (round-3 review).
      const end = rest.indexOf('\n\n## Coach Directives (Default Behavior)');
      const block = (end === -1 ? rest : rest.slice(0, end)).trim();

      expect(block).toBe(
        `You are interviewing a new user to build their profile. Ask their goals, equipment, personality, age, and experience. Ask AT MOST TWO of them in any single message — never three or more, however naturally they group. Age is sensitive; ask it last. If the user declines a field, that IS their answer: send it in settingsProposal with their own words as the value (e.g. age: "prefer not to say"). Acknowledging a refusal only in your reply does not record it — a field you never send is indistinguishable from one you never asked, so a later conversation will ask again. Never re-ask a field the user has declined.

Every field you record must be grounded in something the user actually said. Do not infer or guess.

At the end of the interview, offer to draft a first routine based on what you've learned about them.`
      );
      expect(block).not.toMatch(/\bname\b/i);

      // Keep the whole-PROMPT regex alongside the block pin. These are
      // complements, not alternatives: the pin catches any edit inside the
      // block whatever its wording, and this catches a literally-phrased name
      // solicitation placed anywhere else — a section pushed later in
      // buildSystem, or a sentence added to the base persona, neither of which
      // the block can see. Deleting this in favour of the pin was a net loss
      // for that case, which the round-2 review proved with a green mutation.
      //
      // Deliberately narrow. An earlier `ask.*\s+name` alternative was
      // line-scoped but otherwise unbounded, so any line pairing "ask" with a
      // later "name" tripped it — and this runs over the WHOLE prompt, which
      // interpolates user-authored routine and exercise titles. A guard that
      // fails on legitimate prose ("…repeat the routine name back in your
      // reply") gets weakened by whoever hits it next. The `name\s+is` branch
      // was also dead: ordered alternation always matched `name` first.
      expect(prompt).not.toMatch(/\b(their|your)\s+name\b/i);

      // Same complement for gender, which was removed from the contract entirely.
      // The block pin above cannot see outside the block, and review proved the
      // gap with two green mutations: a `Gender:` line re-added to
      // aboutTheUserSection, and "Find out the user's gender" added to the base
      // persona — both passed 1662/1662. Unlike name, gender may not appear
      // anywhere in this prompt at all, so the assertion can be absolute rather
      // than phrase-scoped. The three one-shot builders already carry their own
      // `not.toContain('Gender:')`; this is the primary builder finally matching
      // them.
      expect(prompt).not.toMatch(/gender/i);
    }, 30000);
  });

  describe('coach-onboarding.AC6.1: profile section before immutable directives', () => {
    it('coach-onboarding.AC6.1 Success: buildSystem renders profile before immutable directives', async () => {
      setSettings({
        profileAge: '40',
      });

      const prompt = await buildSystem(database, { kind: 'onboarding' });

      const profileIdx = prompt.indexOf('## About the User');
      const immutableIdx = prompt.indexOf('## Coach Directives (Non-Negotiable)');

      expect(profileIdx).toBeGreaterThan(-1);
      expect(profileIdx).toBeLessThan(immutableIdx);
    }, 30000);

    it('coach-onboarding.AC6.1 Success: omits About-the-User section when profile is empty', async () => {
      setSettings({
        profileAge: '',
        profileExperience: '',
      });

      const prompt = await buildSystem(database, { kind: 'onboarding' });

      expect(prompt).not.toContain('## About the User');
    }, 30000);
  });
});
