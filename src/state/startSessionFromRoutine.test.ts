import { createTestDatabase } from '@/db/test-helpers';
import { startSessionFromRoutine } from './startSessionFromRoutine';

/**
 * RAMP (#276): the real Hevy payload for Bench Press (Dumbbell) — three warmups
 * at ascending loads, then four working sets in a rep range. The aggregate model
 * could hold only the number 3 here, so every assertion on the three distinct
 * ascending weights fails the moment a count-based derivation comes back.
 */
const RAMP_SETS = [
  { set_type: 'warmup', target_reps: 5, target_weight_kg: 9.07 },
  { set_type: 'warmup', target_reps: 5, target_weight_kg: 11.34 },
  { set_type: 'warmup', target_reps: 3, target_weight_kg: 18.14 },
  { set_type: 'normal', target_reps: 8, target_reps_max: 10, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_reps_max: 10, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_reps_max: 10, target_weight_kg: 22.68 },
  { set_type: 'normal', target_reps: 8, target_reps_max: 10, target_weight_kg: 22.68 },
];

/** Create the `routine_sets` rows for an entry. Caller must be inside a write. */
async function addRoutineSets(db: any, routineExerciseId: string, sets: any[]): Promise<void> {
  for (const [order, set] of sets.entries()) {
    await db.get('routine_sets').create((row: any) => {
      row._raw.routine_exercise_id = routineExerciseId;
      row._raw.order = order;
      row._raw.set_type = set.set_type;
      if (set.target_reps != null) row._raw.target_reps = set.target_reps;
      if (set.target_reps_max != null) row._raw.target_reps_max = set.target_reps_max;
      if (set.target_weight_kg != null) row._raw.target_weight_kg = set.target_weight_kg;
      if (set.target_duration_seconds != null)
        row._raw.target_duration_seconds = set.target_duration_seconds;
      if (set.target_distance_m != null) row._raw.target_distance_m = set.target_distance_m;
    });
  }
}

describe('startSessionFromRoutine', () => {
  it('builds StartSession event from a routine', async () => {
    const db = await createTestDatabase();

    // Create routine with exercises
    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-1';
        r.name = 'Push Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'bench-press';
        e.title = 'Bench Press';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'bench-press';
        re._raw.order = 0;
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 4;
        re._raw.target_reps = 6;
        re._raw.rest_seconds = 120;
      });
    });

    const sessionId = `session-${Date.now()}`;
    const event = await startSessionFromRoutine(
      db,
      'routine-1',
      sessionId
    );

    expect(event.tag).toBe('StartSession');
    expect(event.sessionId).toBe(sessionId);
    expect(event.nowMs).toBeGreaterThan(0);
    expect(event.routine).toBeDefined();
    expect((event.routine as any).id).toBe('routine-1');
    expect((event.routine as any).name).toBe('Push Day');
    expect((event.routine as any).entries).toHaveLength(1);
    expect((event.routine as any).entries[0]).toMatchObject({
      idx: 0,
      exerciseId: 'bench-press',
      kind: 'strength',
      warmupSets: 1,
      targetSets: 4,
      targetReps: 6,
      targetDurationSeconds: 0,
      restSeconds: 120,
      supersetGroup: '',
    });
  });

  it('handles superset groups with idx field', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-2';
        r.name = 'Superset Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      for (let i = 1; i <= 2; i++) {
        await db.get('exercises').create((e: any) => {
          e._raw.id = `ex-${i}`;
          e.title = `Exercise ${i}`;
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      }

      // Superset pair
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-2';
        re._raw.exercise_id = 'ex-1';
        re._raw.order = 0;
        re._raw.superset_group = 'ss1';
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
        re._raw.rest_seconds = 90;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-2';
        re._raw.exercise_id = 'ex-2';
        re._raw.order = 1;
        re._raw.superset_group = 'ss1';
        re._raw.warmup_sets = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 10;
        re._raw.rest_seconds = 90;
      });
    });

    const sessionId2 = `session-${Date.now()}`;
    const event = await startSessionFromRoutine(
      db,
      'routine-2',
      sessionId2
    );

    const entries = (event.routine as any).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].idx).toBe(0);
    expect(entries[0].supersetGroup).toBe('ss1');
    expect(entries[1].idx).toBe(1);
    expect(entries[1].supersetGroup).toBe('ss1');
  });

  it('handles cardio and stretch exercises with duration', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-3';
        r.name = 'Cardio';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      for (const [id, kind] of [['rowing', 'cardio'], ['stretching', 'stretch']]) {
        await db.get('exercises').create((e: any) => {
          e._raw.id = id;
          e.title = id;
          e._raw.kind = kind;
          e._raw.created_at = Date.now();
        });
      }

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-3';
        re._raw.exercise_id = 'rowing';
        re._raw.order = 0;
        // Persona guidance (contextBuilder.ts): duration-based exercises get
        // targetSets: 1 ("a timed hold is still one planned set in the
        // session flow") — this fixture mirrors an AI-authored draft, not
        // cardio/stretch entries from parseWorkoutLine, where target_sets is
        // validly absent instead (see AGENTS.md's zero-planned-set Boundaries rule).
        re._raw.target_sets = 1;
        re._raw.target_duration_seconds = 300;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-3';
        re._raw.exercise_id = 'stretching';
        re._raw.order = 1;
        re._raw.target_sets = 1;
        re._raw.target_duration_seconds = 120;
      });
    });

    const sessionId3 = `session-${Date.now()}`;
    const event = await startSessionFromRoutine(
      db,
      'routine-3',
      sessionId3
    );

    const entries = (event.routine as any).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      idx: 0,
      exerciseId: 'rowing',
      kind: 'cardio',
      targetDurationSeconds: 300,
    });
    expect(entries[1]).toMatchObject({
      idx: 1,
      exerciseId: 'stretching',
      kind: 'stretch',
      targetDurationSeconds: 120,
    });
  });

  it('throws if routine does not exist', async () => {
    const db = await createTestDatabase();

    await expect(
      startSessionFromRoutine(db, 'nonexistent', 'session-123')
    ).rejects.toThrow();
  });

  it('refuses to start a session from a routine with no exercises', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-empty';
        r.name = 'Empty Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
    });

    await expect(
      startSessionFromRoutine(db, 'routine-empty', 'session-123')
    ).rejects.toThrow(/no exercises/);
  });

  it('refuses to start a session where every exercise plans zero total sets', async () => {
    // Distinct from the no-exercises case above: this routine has an entry,
    // but the engine's h.next_active_landing would find nothing active in it
    // at StartSession, which now rejects rather than instantly completing
    // (see AGENTS.md engine convention 10). Reachable in practice: targetSets
    // is optional on an AI draft, and startSessionFromRoutine already maps a
    // missing value to 0 below.
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-all-zero';
        r.name = 'All Zero Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'planking';
        e.title = 'Plank Hold';
        e._raw.kind = 'stretch';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-all-zero';
        re._raw.exercise_id = 'planking';
        re._raw.order = 0;
        re._raw.warmup_sets = 0;
        re._raw.target_sets = 0;
      });
    });

    await expect(
      startSessionFromRoutine(db, 'routine-all-zero', 'session-123')
    ).rejects.toThrow(/no entry with any sets to perform/);
  });

  // ---- #276 Phase 3: the entry carries its prescribed set list -------------

  describe('per-set prescription (#276 AC3.1, AC3.2)', () => {
    async function seedRamp(db: any, routineId = 'routine-ramp'): Promise<void> {
      await db.write(async () => {
        await db.get('routines').create((r: any) => {
          r._raw.id = routineId;
          r.name = 'Push';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await db.get('exercises').create((e: any) => {
          e._raw.id = 'bench-press-dumbbell';
          e.title = 'Bench Press (Dumbbell)';
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        const re = await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = routineId;
          row._raw.exercise_id = 'bench-press-dumbbell';
          row._raw.order = 0;
          row._raw.warmup_sets = 3;
          row._raw.target_sets = 4;
          row._raw.target_reps = 8;
          row._raw.rest_seconds = 120;
        });
        await addRoutineSets(db, re.id, RAMP_SETS);
      });
    }

    it('AC3.1: builds entry.sets from routine_sets in order, ramp weights intact', async () => {
      const db = await createTestDatabase();
      await seedRamp(db);

      const event = await startSessionFromRoutine(db, 'routine-ramp', 'session-ramp');
      const entry = (event.routine as any).entries[0];

      expect(entry.sets).toHaveLength(7);
      expect(entry.sets.map((set: any) => set.weightKg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(entry.sets.map((set: any) => set.setType)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      expect(entry.sets[0]).toMatchObject({ reps: 5 });
      expect(entry.sets[2]).toMatchObject({ reps: 3 });
      expect(entry.sets[3]).toMatchObject({ reps: 8, repsMax: 10 });
    });

    it('AC3.1: idx still comes from the row order, not the loop counter', async () => {
      const db = await createTestDatabase();
      await db.write(async () => {
        await db.get('routines').create((r: any) => {
          r._raw.id = 'routine-gap';
          r.name = 'Gapped';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await db.get('exercises').create((e: any) => {
          e._raw.id = 'squat';
          e.title = 'Squat';
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        const re = await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = 'routine-gap';
          row._raw.exercise_id = 'squat';
          // A non-zero order at array position 0 — onPersistSet looks the row
          // up by (routine_id, order: entry.idx), so the two must agree.
          row._raw.order = 4;
        });
        await addRoutineSets(db, re.id, [{ set_type: 'normal', target_reps: 5 }]);
      });

      const event = await startSessionFromRoutine(db, 'routine-gap', 'session-gap');
      expect((event.routine as any).entries[0].idx).toBe(4);
    });

    it('AC3.1: INTERLEAVE survives — a set-type order no count pair can express', async () => {
      const db = await createTestDatabase();
      await db.write(async () => {
        await db.get('routines').create((r: any) => {
          r._raw.id = 'routine-interleave';
          r.name = 'Interleave';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await db.get('exercises').create((e: any) => {
          e._raw.id = 'press';
          e.title = 'Press';
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        const re = await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = 'routine-interleave';
          row._raw.exercise_id = 'press';
          row._raw.order = 0;
          // Aggregates that cannot reproduce the list below, whichever way
          // they are split.
          row._raw.warmup_sets = 2;
          row._raw.target_sets = 1;
        });
        await addRoutineSets(db, re.id, [
          { set_type: 'warmup', target_reps: 5 },
          { set_type: 'normal', target_reps: 8 },
          { set_type: 'warmup', target_reps: 5 },
        ]);
      });

      const event = await startSessionFromRoutine(db, 'routine-interleave', 'session-il');
      expect((event.routine as any).entries[0].sets.map((s: any) => s.setType)).toEqual([
        'warmup',
        'normal',
        'warmup',
      ]);
    });

    it('AC1.9/AC3.2: an entry with no prescribed sets and no counts comes back with sets: []', async () => {
      const db = await createTestDatabase();
      await db.write(async () => {
        await db.get('routines').create((r: any) => {
          r._raw.id = 'routine-mixed';
          r.name = 'Mixed';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        for (const id of ['real', 'ghost']) {
          await db.get('exercises').create((e: any) => {
            e._raw.id = id;
            e.title = id;
            e._raw.kind = 'strength';
            e._raw.created_at = Date.now();
          });
        }
        const ghost = await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = 'routine-mixed';
          row._raw.exercise_id = 'ghost';
          row._raw.order = 0;
        });
        const real = await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = 'routine-mixed';
          row._raw.exercise_id = 'real';
          row._raw.order = 1;
        });
        void ghost;
        await addRoutineSets(db, real.id, [{ set_type: 'normal', target_reps: 5 }]);
      });

      const event = await startSessionFromRoutine(db, 'routine-mixed', 'session-mixed');
      const entries = (event.routine as any).entries;
      expect(entries).toHaveLength(2);
      expect(entries[0].sets).toEqual([]);
      expect(entries[1].sets).toHaveLength(1);
    });

    it('AC3.2: refuses a routine in which every entry has an empty set list', async () => {
      const db = await createTestDatabase();
      await db.write(async () => {
        await db.get('routines').create((r: any) => {
          r._raw.id = 'routine-no-sets';
          r.name = 'No Sets';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await db.get('exercises').create((e: any) => {
          e._raw.id = 'ghost-only';
          e.title = 'Ghost';
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = 'routine-no-sets';
          row._raw.exercise_id = 'ghost-only';
          row._raw.order = 0;
        });
      });

      await expect(
        startSessionFromRoutine(db, 'routine-no-sets', 'session-none')
      ).rejects.toThrow(/no entry with any sets to perform/);
    });

    it('DERIVATION SEAM (#276, Phase 6 deletes): a count-only row still starts', async () => {
      // `upsertRoutineExercise` and every pre-per-set fixture write aggregate
      // columns and no routine_sets rows. Until Phase 6 those still expand,
      // exactly as `toRillRoutineEntry` expands them at the Rill boundary.
      const db = await createTestDatabase();
      await db.write(async () => {
        await db.get('routines').create((r: any) => {
          r._raw.id = 'routine-counts';
          r.name = 'Counts';
          r._raw.created_at = Date.now();
          r._raw.updated_at = Date.now();
        });
        await db.get('exercises').create((e: any) => {
          e._raw.id = 'row';
          e.title = 'Row';
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
        await db.get('routine_exercises').create((row: any) => {
          row._raw.routine_id = 'routine-counts';
          row._raw.exercise_id = 'row';
          row._raw.order = 0;
          row._raw.warmup_sets = 1;
          row._raw.target_sets = 2;
          row._raw.target_reps = 10;
        });
      });

      const event = await startSessionFromRoutine(db, 'routine-counts', 'session-counts');
      expect((event.routine as any).entries[0].sets).toEqual([
        { setType: 'warmup', reps: 10, durationSeconds: undefined },
        { setType: 'normal', reps: 10, durationSeconds: undefined },
        { setType: 'normal', reps: 10, durationSeconds: undefined },
      ]);
    });
  });
});
