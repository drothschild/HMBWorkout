import { createTestDatabase } from '@/db/test-helpers';
import { routineDetailPresenter } from './routineDetailPresenter';

describe('routineDetailPresenter', () => {
  it('returns null when routine does not exist', async () => {
    const db = await createTestDatabase();

    const detail = await routineDetailPresenter(db, 'nonexistent');

    expect(detail).toBeNull();
  });

  it('returns routine detail with exercises and superset grouping', async () => {
    const db = await createTestDatabase();

    // Create routine with exercises including superset
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

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'db-fly';
        e.title = 'Dumbbell Fly';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'tricep-dip';
        e.title = 'Tricep Dip';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      // Superset: bench + fly
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'bench-press';
        re._raw.order = 0;
        re._raw.superset_group = 'ss1';
        re._raw.warmup_sets = 2;
        re._raw.target_sets = 4;
        re._raw.target_reps = 6;
        re._raw.rest_seconds = 120;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'db-fly';
        re._raw.order = 1;
        re._raw.superset_group = 'ss1';
        re._raw.warmup_sets = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 10;
        re._raw.rest_seconds = 90;
      });

      // Standalone
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-1';
        re._raw.exercise_id = 'tricep-dip';
        re._raw.order = 2;
        re._raw.warmup_sets = 1;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
        re._raw.rest_seconds = 60;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-1');

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('routine-1');
    expect(detail!.name).toBe('Push Day');
    expect(detail!.supersetGroups).toHaveLength(1);
    expect(detail!.supersetGroups[0].label).toBe('ss1');
    expect(detail!.supersetGroups[0].exercises).toHaveLength(2);
    expect(detail!.supersetGroups[0].exercises[0]).toMatchObject({
      exerciseId: 'bench-press',
      title: 'Bench Press',
      order: 0,
      warmupSets: 2,
      targetSets: 4,
      targetReps: 6,
      restSeconds: 120,
      kind: 'strength',
    });
    expect(detail!.supersetGroups[0].exercises[1]).toMatchObject({
      exerciseId: 'db-fly',
      title: 'Dumbbell Fly',
      order: 1,
      warmupSets: 0,
      targetSets: 3,
      targetReps: 10,
      restSeconds: 90,
      kind: 'strength',
    });

    expect(detail!.standaloneExercises).toHaveLength(1);
    expect(detail!.standaloneExercises[0]).toMatchObject({
      exerciseId: 'tricep-dip',
      title: 'Tricep Dip',
      order: 2,
      warmupSets: 1,
      targetSets: 3,
      targetReps: 8,
      restSeconds: 60,
      kind: 'strength',
    });
  });

  it('handles cardio exercises with duration instead of reps', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-2';
        r.name = 'Cardio';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'rowing';
        e.title = 'Rowing Machine';
        e._raw.kind = 'cardio';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-2';
        re._raw.exercise_id = 'rowing';
        re._raw.order = 0;
        re._raw.target_duration_seconds = 300;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-2');

    expect(detail).not.toBeNull();
    expect(detail!.standaloneExercises).toHaveLength(1);
    expect(detail!.standaloneExercises[0]).toMatchObject({
      exerciseId: 'rowing',
      kind: 'cardio',
      targetDurationSeconds: 300,
    });
  });

  it('includes exercise description when present, and null when absent', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-3';
        r.name = 'Legs';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'squat';
        e.title = 'Back Squat';
        e._raw.kind = 'strength';
        e._raw.description = 'Bar on traps, brace, break at the hips and knees together.';
        e._raw.created_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'lunge';
        e.title = 'Walking Lunge';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
        // no description set — simulates an exercise nobody has described yet
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-3';
        re._raw.exercise_id = 'squat';
        re._raw.order = 0;
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-3';
        re._raw.exercise_id = 'lunge';
        re._raw.order = 1;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-3');

    expect(detail!.standaloneExercises[0]).toMatchObject({
      exerciseId: 'squat',
      description: 'Bar on traps, brace, break at the hips and knees together.',
    });
    expect(detail!.standaloneExercises[1]).toMatchObject({
      exerciseId: 'lunge',
      description: null,
    });
  });

  it('includes routine notes when present, and null when absent or whitespace-only', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-noted';
        r.name = 'Deload Week';
        r._raw.notes = 'Keep everything light; stop two reps shy of failure.';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-plain';
        r.name = 'No Notes';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-blank';
        r.name = 'Blank Notes';
        // Raw write bypasses the model's trim, so the presenter must normalize.
        r._raw.notes = '   ';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });
    });

    const noted = await routineDetailPresenter(db, 'routine-noted');
    const plain = await routineDetailPresenter(db, 'routine-plain');
    const blank = await routineDetailPresenter(db, 'routine-blank');

    expect(noted!.notes).toBe('Keep everything light; stop two reps shy of failure.');
    expect(plain!.notes).toBeNull();
    expect(blank!.notes).toBeNull();
  });

  it('exposes a distinct routineExerciseId per row when the same exercise repeats', async () => {
    const db = await createTestDatabase();

    let firstRowId = '';
    let secondRowId = '';
    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-4';
        r.name = 'Swing EMOM';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'kb-swing';
        e.title = 'Kettlebell Swing';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      // Same exercise twice — repeated entries are a modeled reality, so each
      // row must stay individually addressable in the presented detail.
      const first = await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-4';
        re._raw.exercise_id = 'kb-swing';
        re._raw.order = 0;
        re._raw.target_sets = 1;
        re._raw.target_reps = 15;
      });
      const second = await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-4';
        re._raw.exercise_id = 'kb-swing';
        re._raw.order = 1;
        re._raw.target_sets = 1;
        re._raw.target_reps = 15;
      });
      firstRowId = (first as any).id;
      secondRowId = (second as any).id;
    });

    const detail = await routineDetailPresenter(db, 'routine-4');

    expect(firstRowId).not.toBe(secondRowId);
    expect(detail!.standaloneExercises).toHaveLength(2);
    expect(detail!.standaloneExercises[0].routineExerciseId).toBe(firstRowId);
    expect(detail!.standaloneExercises[1].routineExerciseId).toBe(secondRowId);
  });

  it('reports hasActiveExercise: false when every exercise plans zero total sets', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-all-zero';
        r.name = 'Recovery Day';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'rowing';
        e.title = 'Rowing';
        e._raw.kind = 'cardio';
        e._raw.created_at = Date.now();
      });

      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-all-zero';
        re._raw.exercise_id = 'rowing';
        re._raw.order = 0;
        re._raw.target_duration_seconds = 1800;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-all-zero');

    expect(detail!.hasActiveExercise).toBe(false);
  });

  it('reports hasActiveExercise: true when at least one exercise plans a nonzero total, superset or standalone', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-mixed';
        r.name = 'Mixed Day';
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
        re._raw.routine_id = 'routine-mixed';
        re._raw.exercise_id = 'bench-press';
        re._raw.order = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-mixed');

    expect(detail!.hasActiveExercise).toBe(true);
  });

  it('includes targetWeightKg when coach has prescribed a load, and omits when absent or zero (AC3.1)', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-prescribed';
        r.name = 'Prescribed Loads';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'squat';
        e.title = 'Back Squat';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'bench-press';
        e.title = 'Bench Press';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      await db.get('exercises').create((e: any) => {
        e._raw.id = 'deadlift';
        e.title = 'Deadlift';
        e._raw.kind = 'strength';
        e._raw.created_at = Date.now();
      });

      // Entry with prescribed load
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-prescribed';
        re._raw.exercise_id = 'squat';
        re._raw.order = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 5;
        re._raw.target_weight_kg = 83.91;
      });

      // Entry without prescribed load
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-prescribed';
        re._raw.exercise_id = 'bench-press';
        re._raw.order = 1;
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
      });

      // Entry with 0 prescribed (boundary condition — should be falsy like absent)
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-prescribed';
        re._raw.exercise_id = 'deadlift';
        re._raw.order = 2;
        re._raw.target_sets = 1;
        re._raw.target_reps = 5;
        re._raw.target_weight_kg = 0;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-prescribed');

    expect(detail).not.toBeNull();
    expect(detail!.standaloneExercises).toHaveLength(3);
    // Prescribed entry: 83.91 renders as-is
    expect(detail!.standaloneExercises[0].targetWeightKg).toBe(83.91);
    // Unprescribed entry: WatermelonDB gives null (not undefined) — kills || undefined mutants
    expect(detail!.standaloneExercises[1].targetWeightKg).toBeNull();
    // Zero-prescribed entry: 0 is distinct from null — kills ?? 0 and truthiness-guard mutants
    expect(detail!.standaloneExercises[2].targetWeightKg).toBe(0);
  });

  it('preserves routine order via items, and keeps a reused superset label as a separate contiguous group rather than merging (#268)', async () => {
    const db = await createTestDatabase();

    await db.write(async () => {
      await db.get('routines').create((r: any) => {
        r._raw.id = 'routine-interleaved';
        r.name = 'Interleaved';
        r._raw.created_at = Date.now();
        r._raw.updated_at = Date.now();
      });

      for (const [id, title] of [
        ['squat', 'Squat'],
        ['bench', 'Bench'],
        ['row', 'Row'],
        ['plank', 'Plank'],
        ['curl', 'Curl'],
        ['lunge', 'Lunge'],
      ]) {
        await db.get('exercises').create((e: any) => {
          e._raw.id = id;
          e.title = title;
          e._raw.kind = 'strength';
          e._raw.created_at = Date.now();
        });
      }

      // order 0: standalone
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'squat';
        re._raw.order = 0;
        re._raw.target_sets = 3;
        re._raw.target_reps = 5;
      });
      // order 1-2: superset "ss1"
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'bench';
        re._raw.order = 1;
        re._raw.superset_group = 'ss1';
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
      });
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'row';
        re._raw.order = 2;
        re._raw.superset_group = 'ss1';
        re._raw.target_sets = 3;
        re._raw.target_reps = 8;
      });
      // order 3: standalone
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'plank';
        re._raw.order = 3;
        re._raw.target_duration_seconds = 60;
      });
      // order 4-5: superset "ss1" AGAIN — same label, non-contiguous with the
      // first "ss1" run. Per AGENTS.md engine convention 9, labels are
      // contiguous but not routine-unique; a later group may reuse an
      // earlier label. This must stay a distinct group, not merge with it.
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'curl';
        re._raw.order = 4;
        re._raw.superset_group = 'ss1';
        re._raw.target_sets = 3;
        re._raw.target_reps = 12;
      });
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'lunge';
        re._raw.order = 5;
        re._raw.superset_group = 'ss1';
        re._raw.target_sets = 3;
        re._raw.target_reps = 12;
      });
      // order 6-7: superset "ss2" — a DIFFERENT label, immediately ADJACENT to
      // the ss1 run above. Two back-to-back supersets must stay two items.
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'squat';
        re._raw.order = 6;
        re._raw.superset_group = 'ss2';
        re._raw.target_sets = 3;
        re._raw.target_reps = 10;
      });
      await db.get('routine_exercises').create((re: any) => {
        re._raw.routine_id = 'routine-interleaved';
        re._raw.exercise_id = 'bench';
        re._raw.order = 7;
        re._raw.superset_group = 'ss2';
        re._raw.target_sets = 3;
        re._raw.target_reps = 10;
      });
    });

    const detail = await routineDetailPresenter(db, 'routine-interleaved');

    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(5);

    expect(detail!.items[0].type).toBe('exercise');
    expect((detail!.items[0] as any).exercise.exerciseId).toBe('squat');

    expect(detail!.items[1].type).toBe('superset');
    expect((detail!.items[1] as any).label).toBe('ss1');
    expect((detail!.items[1] as any).exercises.map((e: any) => e.exerciseId)).toEqual(['bench', 'row']);

    expect(detail!.items[2].type).toBe('exercise');
    expect((detail!.items[2] as any).exercise.exerciseId).toBe('plank');

    expect(detail!.items[3].type).toBe('superset');
    expect((detail!.items[3] as any).label).toBe('ss1');
    expect((detail!.items[3] as any).exercises.map((e: any) => e.exerciseId)).toEqual(['curl', 'lunge']);

    // The two same-label groups are distinct objects — not merged into one.
    expect(detail!.items[1]).not.toBe(detail!.items[3]);

    expect(detail!.items[4].type).toBe('superset');
    expect((detail!.items[4] as any).label).toBe('ss2');
    expect((detail!.items[4] as any).exercises.map((e: any) => e.exerciseId)).toEqual(['squat', 'bench']);

    // The derived buckets stay in routine order too (contextBuilder reads them).
    expect(detail!.supersetGroups.map((g) => g.exercises[0].exerciseId)).toEqual(['bench', 'curl', 'squat']);
  });
});
