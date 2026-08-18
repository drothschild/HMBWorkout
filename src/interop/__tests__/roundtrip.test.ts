/**
 * Round-trip tests (Task 4).
 * AC3.1, AC8.4, AC9.2: parse(serialize(rows)) equals original machine fields.
 */

import { serializeSession, serializeRoutine } from '../serialize';
import { parseRoutine, parseSession } from '../parse';
import { WorkoutLine, SupersetGroup } from '../format';

describe('round-trip', () => {
  describe('AC3.1: Serialization round-trip is lossless', () => {
    test('session round-trip: parse(serialize(rows)) preserves machine fields', () => {
      const sessionRow = {
        id: 'sess-rt-001',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'warmup' as const,
          reps: 8,
          weightKg: 20,
          durationSeconds: undefined,
          rpe: undefined,
          position: 0,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: 8,
          position: 1,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 5,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: 7.5,
          position: 2,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
      ];

      // Serialize
      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);

      // Parse
      const parsed = parseSession(markdown);

      // Verify frontmatter
      expect(parsed.frontmatter.id).toBe(sessionRow.id);

      // Verify exercises structure
      expect(parsed.exercises).toHaveLength(3); // 3 sets logged

      // Check each set - verify FULL machine-field equality per set (I2)
      const set0 = parsed.exercises[0] as WorkoutLine;
      expect(set0.exerciseId).toBe('bench-press-db');
      expect(set0.setType).toBe('warmup');
      expect(set0.targetReps).toBe(8); // parsed from 1x8
      expect(set0.weight).toBe(20); // logged weight in kg
      expect(set0.rpe).toBeUndefined(); // no rpe on this set
      expect(set0.distance).toBeUndefined();
      expect(set0.kind).toBe('strength');

      const set1 = parsed.exercises[1] as WorkoutLine;
      expect(set1.exerciseId).toBe('bench-press-db');
      expect(set1.setType).toBe('working');
      expect(set1.targetReps).toBe(6); // parsed from 1x6
      expect(set1.weight).toBe(30); // logged weight in kg
      expect(set1.rpe).toBe(8); // effort rating preserved
      expect(set1.distance).toBeUndefined();
      expect(set1.kind).toBe('strength');

      const set2 = parsed.exercises[2] as WorkoutLine;
      expect(set2.exerciseId).toBe('bench-press-db');
      expect(set2.setType).toBe('working');
      expect(set2.targetReps).toBe(5); // parsed from 1x5
      expect(set2.weight).toBe(30); // logged weight in kg
      expect(set2.rpe).toBe(7.5); // 0.5-step rpe
      expect(set2.distance).toBeUndefined();
      expect(set2.kind).toBe('strength');
    });

    test('session round-trip preserves the exercise a set was performed as, not its routine row', () => {
      // ReplaceExercise re-points the routine_exercises row. A session
      // serialized after that swap must round-trip back to what was performed
      // — the identity travels in the line's existing id slot, so the grammar
      // is the same one every other session uses.
      const sessionRow = {
        id: 'sess-rt-swap',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          exerciseId: 'barbell-bench-press',
          setType: 'working' as const,
          reps: 6,
          weightKg: 80,
          durationSeconds: undefined,
          rpe: 8,
          position: 0,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          // Already swapped: the plan names the substitute now.
          exerciseId: 'dumbbell-floor-press',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
        },
      ];

      const exercises = [
        { id: 'barbell-bench-press', title: 'Barbell Bench Press', kind: 'strength' as const },
        { id: 'dumbbell-floor-press', title: 'Dumbbell Floor Press', kind: 'strength' as const },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const line = parsed.exercises[0] as WorkoutLine;
      expect(line.exerciseId).toBe('barbell-bench-press');
      // Everything else still comes from the plan and survives untouched.
      expect(line.setType).toBe('working');
      expect(line.targetReps).toBe(6);
      expect(line.weight).toBe(80);
      expect(line.rpe).toBe(8);
      expect(line.restSeconds).toBe(90);
    });

    test('routine round-trip: parse(serialize(rows)) preserves machine fields', () => {
      const routineRow = {
        id: 'push-rt-001',
        name: 'Push Day',
        notes: undefined,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      // #276 Phase 5: the entry's plan is an ordered SET LIST, not a count.
      // Two warmups then four working sets, which the aggregate grammar wrote
      // as `4x6 warmup=2` and can no longer express once the warmups carry
      // their own reps.
      const exercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
          sets: [
            { setType: 'warmup' as const, targetReps: 8 },
            { setType: 'warmup' as const, targetReps: 6 },
            { setType: 'normal' as const, targetReps: 6 },
            { setType: 'normal' as const, targetReps: 6 },
            { setType: 'normal' as const, targetReps: 6 },
            { setType: 'normal' as const, targetReps: 6 },
          ],
        },
      ];

      const exerciseData = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
      ];

      // Serialize
      const markdown = serializeRoutine(routineRow as any, exercises as any, exerciseData as any);

      // Parse
      const parsed = parseRoutine(markdown);

      // Verify frontmatter
      expect(parsed.frontmatter.id).toBe(routineRow.id);

      // Verify exercises: six lines, one entry, six sets.
      expect(parsed.exercises).toHaveLength(1);
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.exerciseId).toBe('bench-press-db');
      expect(ex.restSeconds).toBe(90);
      expect(ex.sets).toEqual(exercises[0].sets);
    });

    test('round-trip with AI prose in session', () => {
      // Session markdown with AI prose before and after the workout block
      const originalMarkdown = `---
type: workout-session
id: sess-rt-prose
date: 2026-07-08
created: 2026-07-08
tags: []
---

Great session today! Hit all my targets.

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 1x8 set_type=warmup
- bench-press-db: 1x6 set_type=working rpe=8
\`\`\`

Notes: Felt strong on the working sets. Maybe increase weight next time.
`;

      // Parse the original (with prose)
      const parsed1 = parseSession(originalMarkdown);

      // Verify prose is ignored but data is preserved
      expect(parsed1.exercises).toHaveLength(2);
      expect((parsed1.exercises[0] as any).setType).toBe('warmup');
      expect((parsed1.exercises[1] as any).rpe).toBe(8);

      // Now serialize back (creates a new markdown without the prose)
      const sessionRow = {
        id: 'sess-rt-prose',
        routineId: 'test',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'warmup' as const,
          reps: 8,
          weightKg: 20,
          durationSeconds: undefined,
          rpe: undefined,
          position: 0,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: 8,
          position: 1,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);
      const parsed2 = parseSession(markdown);

      // Verify machine fields survive round-trip
      expect(parsed2.exercises).toHaveLength(2);
      expect((parsed2.exercises[0] as any).setType).toBe('warmup');
      expect((parsed2.exercises[1] as any).rpe).toBe(8);
    });
  });

  describe('AC8.4: Superset, set type, kind/duration round-trip', () => {
    test('preserves superset grouping', () => {
      const sessionRow = {
        id: 'sess-superset-rt',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: undefined,
          position: 0,
        },
        {
          routineExerciseId: 're-002',
          setType: 'working' as const,
          reps: 12,
          weightKg: 12,
          durationSeconds: undefined,
          rpe: undefined,
          position: 1,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: 'A',
          restSeconds: undefined,
          notes: undefined,
        },
        {
          id: 're-002',
          exerciseId: 'rear-delt-fly-db',
          order: 1,
          supersetGroup: 'A',
          restSeconds: 90,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
        {
          id: 'rear-delt-fly-db',
          title: 'Rear Delt Fly (DB)',
          kind: 'strength' as const,
        },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);
      const parsed = parseSession(markdown);

      // Should have a superset group
      expect(parsed.exercises).toHaveLength(1);
      expect((parsed.exercises[0] as any).supersetLabel).toBe('A');
      expect((parsed.exercises[0] as SupersetGroup).exercises).toHaveLength(2);

      const group = parsed.exercises[0] as SupersetGroup;
      expect(group.exercises[0].exerciseId).toBe('bench-press-db');
      expect(group.exercises[1].exerciseId).toBe('rear-delt-fly-db');
    });

    test('preserves warm-up vs working set types', () => {
      const routineRow = {
        id: 'routine-settype-rt',
        name: 'Settype Test',
        notes: undefined,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      // #276 Phase 5: set type is per set, so it survives INTERLEAVED — the
      // shape the `warmup=<count>` flag could not represent at all, because a
      // count can only describe a leading run.
      const sets = [
        { setType: 'warmup' as const, targetReps: 5 },
        { setType: 'normal' as const, targetReps: 3 },
        { setType: 'warmup' as const, targetReps: 5 },
        { setType: 'normal' as const, targetReps: 3 },
      ];

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'squat-bb',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 180,
          notes: undefined,
          sets,
        },
      ];

      const exerciseData = [
        {
          id: 'squat-bb',
          title: 'Barbell Squat',
          kind: 'strength' as const,
        },
      ];

      const markdown = serializeRoutine(routineRow as any, exercises as any, exerciseData as any);
      const parsed = parseRoutine(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.sets?.map((s) => s.setType)).toEqual(['warmup', 'normal', 'warmup', 'normal']);
      expect(ex.sets).toEqual(sets);
    });

    test('preserves stretch duration and kind', () => {
      const routineRow = {
        id: 'routine-stretch-rt',
        name: 'Stretch Test',
        notes: undefined,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      // Two prescribed holds of different lengths — per-set duration, which the
      // single `target_duration_seconds` column could not hold either.
      const sets = [
        { setType: 'normal' as const, targetDurationSeconds: 30 },
        { setType: 'normal' as const, targetDurationSeconds: 45 },
      ];

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'chest-stretch',
          order: 0,
          supersetGroup: undefined,
          restSeconds: undefined,
          notes: undefined,
          sets,
        },
      ];

      const exerciseData = [
        {
          id: 'chest-stretch',
          title: 'Chest Stretch',
          kind: 'stretch' as const,
        },
      ];

      const markdown = serializeRoutine(routineRow as any, exercises as any, exerciseData as any);
      const parsed = parseRoutine(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.kind).toBe('stretch');
      expect(ex.sets).toEqual(sets);
      expect(ex.setsSlot).toBeUndefined();
      expect(ex.targetReps).toBeUndefined();
    });

    test('preserves cardio duration and kind', () => {
      const routineRow = {
        id: 'routine-cardio-rt',
        name: 'Cardio Test',
        notes: undefined,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      const sets = [
        { setType: 'normal' as const, targetDurationSeconds: 300, targetDistanceM: 2000 },
      ];

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'cycling',
          order: 0,
          supersetGroup: undefined,
          restSeconds: undefined,
          notes: undefined,
          sets,
        },
      ];

      const exerciseData = [
        {
          id: 'cycling',
          title: 'Cycling',
          kind: 'cardio' as const,
        },
      ];

      const markdown = serializeRoutine(routineRow as any, exercises as any, exerciseData as any);
      const parsed = parseRoutine(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.kind).toBe('cardio');
      // `target_distance` is the routine-side sibling of the session line's
      // `distance=`; without it the schema-v6 column would be dropped silently
      // on export.
      expect(ex.sets).toEqual(sets);
      expect(ex.setsSlot).toBeUndefined();
      expect(ex.targetReps).toBeUndefined();
    });
  });

  describe('AC8.3+I2: Logged cardio/stretch session round-trip (full machine fields)', () => {
    test('logged stretch session preserves all machine fields', () => {
      const sessionRow = {
        id: 'sess-stretch-logged',
        routineId: 'cool-down',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-stretch-001',
          setType: 'working' as const,
          reps: undefined, // stretch has no reps
          weightKg: undefined,
          distanceM: undefined,
          durationSeconds: 30, // 0:30 stretch
          rpe: undefined,
          position: 0,
        },
      ];

      const routineExercises = [
        {
          id: 're-stretch-001',
          exerciseId: 'chest-stretch',
          order: 0,
          supersetGroup: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'chest-stretch',
          title: 'Chest Stretch',
          kind: 'stretch' as const,
        },
      ];

      // Serialize
      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);

      // Parse
      const parsed = parseSession(markdown);

      // Verify full machine fields (I2)
      expect(parsed.exercises).toHaveLength(1);
      const stretchSet = parsed.exercises[0] as WorkoutLine;
      expect(stretchSet.exerciseId).toBe('chest-stretch');
      expect(stretchSet.kind).toBe('stretch');
      expect(stretchSet.setType).toBe('working');
      expect(stretchSet.targetDurationSeconds).toBe(30); // logged duration
      expect(stretchSet.targetReps).toBeUndefined(); // stretch has no reps
      expect(stretchSet.weight).toBeUndefined();
      expect(stretchSet.distance).toBeUndefined();
      expect(stretchSet.rpe).toBeUndefined();
    });

    test('logged cardio session preserves all machine fields (duration, distance)', () => {
      const sessionRow = {
        id: 'sess-cardio-logged',
        routineId: 'warmup',
        startedAt: new Date('2026-07-08T09:30:00Z'),
        endedAt: new Date('2026-07-08T10:00:00Z'),
        createdAt: new Date('2026-07-08T09:30:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-cardio-001',
          setType: 'working' as const,
          reps: undefined, // cardio has no reps
          weightKg: undefined,
          distanceM: 2500, // logged 2.5km
          durationSeconds: 300, // 5:00 cardio
          rpe: 6, // perceived exertion during cardio
          position: 0,
        },
      ];

      const routineExercises = [
        {
          id: 're-cardio-001',
          exerciseId: 'cycling',
          order: 0,
          supersetGroup: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'cycling',
          title: 'Cycling',
          kind: 'cardio' as const,
        },
      ];

      // Serialize
      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);

      // Parse
      const parsed = parseSession(markdown);

      // Verify full machine fields including distance (I2)
      expect(parsed.exercises).toHaveLength(1);
      const cardioSet = parsed.exercises[0] as WorkoutLine;
      expect(cardioSet.exerciseId).toBe('cycling');
      expect(cardioSet.kind).toBe('cardio');
      expect(cardioSet.setType).toBe('working');
      expect(cardioSet.targetDurationSeconds).toBe(300);
      expect(cardioSet.distance).toBe(2500); // logged distance in m
      expect(cardioSet.rpe).toBe(6);
      expect(cardioSet.targetReps).toBeUndefined(); // cardio has no reps
      expect(cardioSet.weight).toBeUndefined();
    });
  });

  describe('engine-written set_type values round-trip', () => {
    // The engine logs non-strength sets with their kind as the set type
    // (transition.lv: setType = entry.kind for stretch/cardio), so serialized
    // sessions carry set_type=stretch and set_type=cardio.
    const sessionRow = {
      id: 'sess-kind-settype',
      routineId: 'full-body',
      startedAt: new Date('2026-07-08T10:00:00Z'),
      endedAt: new Date('2026-07-08T10:30:00Z'),
      createdAt: new Date('2026-07-08T10:00:00Z'),
      customSyncStatus: 'local',
    };

    test('a stretch set logged as set_type=stretch survives serialize → parse', () => {
      const sets = [
        {
          routineExerciseId: 're-stretch-001',
          setType: 'stretch' as const,
          reps: undefined,
          weightKg: undefined,
          distanceM: undefined,
          durationSeconds: 30,
          rpe: undefined,
          position: 0,
        },
      ];

      const routineExercises = [
        {
          id: 're-stretch-001',
          exerciseId: 'chest-stretch',
          order: 0,
          supersetGroup: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
      ];

      const exercises = [
        { id: 'chest-stretch', title: 'Chest Stretch', kind: 'stretch' as const },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const stretchSet = parsed.exercises[0] as WorkoutLine;
      expect(stretchSet.setType).toBe('stretch');
      expect(stretchSet.kind).toBe('stretch');
      expect(stretchSet.targetDurationSeconds).toBe(30);
    });

    test('a cardio set logged as set_type=cardio survives serialize → parse', () => {
      const sets = [
        {
          routineExerciseId: 're-cardio-001',
          setType: 'cardio' as const,
          reps: undefined,
          weightKg: undefined,
          distanceM: 2500,
          durationSeconds: 300,
          rpe: 6,
          position: 0,
        },
      ];

      const routineExercises = [
        {
          id: 're-cardio-001',
          exerciseId: 'cycling',
          order: 0,
          supersetGroup: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
      ];

      const exercises = [
        { id: 'cycling', title: 'Cycling', kind: 'cardio' as const },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const cardioSet = parsed.exercises[0] as WorkoutLine;
      expect(cardioSet.setType).toBe('cardio');
      expect(cardioSet.kind).toBe('cardio');
      expect(cardioSet.targetDurationSeconds).toBe(300);
      expect(cardioSet.distance).toBe(2500);
      expect(cardioSet.rpe).toBe(6);
    });
  });

  describe('AC9.2: RPE round-trip', () => {
    test('preserves RPE with 0.5 steps', () => {
      const sessionRow = {
        id: 'sess-rpe-rt',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: 8,
          position: 0,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 5,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: 7.5,
          position: 1,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 4,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: 9.5,
          position: 2,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 3,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: undefined,
          position: 3,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(4);

      const set0 = parsed.exercises[0] as WorkoutLine;
      expect(set0.rpe).toBe(8);

      const set1 = parsed.exercises[1] as WorkoutLine;
      expect(set1.rpe).toBe(7.5);

      const set2 = parsed.exercises[2] as WorkoutLine;
      expect(set2.rpe).toBe(9.5);

      const set3 = parsed.exercises[3] as WorkoutLine;
      expect(set3.rpe).toBeUndefined();
    });

    test('unrated sets stay unrated', () => {
      const sessionRow = {
        id: 'sess-unrated-rt',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: undefined,
          position: 0,
        },
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 5,
          weightKg: 30,
          durationSeconds: undefined,
          rpe: undefined,
          position: 1,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
        },
      ];

      const exercises = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(2);

      const set0 = parsed.exercises[0] as WorkoutLine;
      expect(set0.rpe).toBeUndefined();

      const set1 = parsed.exercises[1] as WorkoutLine;
      expect(set1.rpe).toBeUndefined();
    });
  });

  describe('null (WatermelonDB unset-column value) round-trips the same as undefined', () => {
    // WatermelonDB returns null, not undefined, for an unset optional column.
    // syncService normalizes this at the shell boundary (see the DB-backed
    // case in syncService.test.ts), but serialize.ts's own flag guards must
    // be null-safe independently: any other caller that passes a raw DB
    // value straight through must not get e.g. "rpe=null" in the output.
    test('serializeSession: null rpe/distance/restSeconds are omitted, not emitted as "null"', () => {
      const sessionRow = {
        id: 'sess-defense-001',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 80,
          durationSeconds: null,
          distanceM: null,
          rpe: null,
          position: 0,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: null,
          notes: undefined,
        },
      ];

      const exercises = [
        { id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const },
      ];

      const markdown = serializeSession(sessionRow as any, sets as any, routineExercises as any, exercises as any);

      expect(markdown).not.toContain('null');
      expect(() => parseSession(markdown)).not.toThrow();

      const set0 = parseSession(markdown).exercises[0] as WorkoutLine;
      expect(set0.rpe).toBeUndefined();
      expect(set0.distance).toBeUndefined();
      expect(set0.restSeconds).toBeUndefined();
    });

    test('serializeRoutine: null restSeconds and null per-set columns are omitted, not emitted as "null"', () => {
      const routineRow = {
        id: 'routine-defense-001',
        name: 'Push Day',
        notes: undefined,
        createdAt: new Date('2026-07-08T10:00:00Z'),
        updatedAt: new Date('2026-07-08T10:00:00Z'),
      };

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'plank',
          order: 0,
          supersetGroup: undefined,
          // rest_seconds is legitimately unset in the DB, which WatermelonDB
          // surfaces as null, never undefined.
          restSeconds: null,
          notes: undefined,
          // Same hazard one level down: routine_sets' optional columns come
          // back as null too, and every one of them is on this line.
          sets: [
            {
              setType: 'normal' as const,
              targetReps: null,
              targetRepsMax: null,
              targetWeightKg: null,
              targetDurationSeconds: 30,
              targetDistanceM: null,
            },
          ],
        },
      ];

      const exercises = [{ id: 'plank', title: 'Plank', kind: 'stretch' as const }];

      const markdown = serializeRoutine(routineRow as any, routineExercises as any, exercises as any);

      expect(markdown).not.toContain('null');
      expect(() => parseRoutine(markdown)).not.toThrow();

      const line0 = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(line0.restSeconds).toBeUndefined();
      expect(line0.sets).toEqual([{ setType: 'normal', targetDurationSeconds: 30 }]);
    });

    /**
     * The routine line's own `targetDurationSeconds`, which the test above
     * cannot reach — it nulls four of the five per-set columns and sets the
     * fifth to 30, so the guard it looks like it covers is the one guard it
     * proves nothing about. Found by mutating rather than by reading, and it is
     * #289's `durationSeconds` case exactly, one file section over: the routine
     * path was never audited, so the issue named three guards where there were
     * four.
     *
     * Same silent failure mode, too. `duration=` is the only flag whose null
     * formats to something the parser accepts (`null / 60` is `0`, so
     * `formatDuration(null)` is `0:00`), which is why every other mutant on
     * this line dies against the "not.toContain('null')" assertion above and
     * this one walked straight past it.
     */
    test('serializeRoutine: a null targetDurationSeconds is absent, not a 0:00 target', () => {
      const routineRow = {
        id: 'routine-defense-002',
        name: 'Mobility',
        notes: undefined,
        createdAt: new Date('2026-08-17T10:00:00Z'),
        updatedAt: new Date('2026-08-17T10:00:00Z'),
      };

      const routineExercises = [
        {
          id: 're-002',
          exerciseId: 'plank',
          order: 0,
          supersetGroup: undefined,
          restSeconds: null,
          notes: undefined,
          // Every per-set column unset — a `routine_sets` row that prescribes
          // nothing, which the DB stores and `getRoutineSets` answers for.
          sets: [
            {
              setType: 'normal' as const,
              targetReps: null,
              targetRepsMax: null,
              targetWeightKg: null,
              targetDurationSeconds: null,
              targetDistanceM: null,
            },
          ],
        },
      ];

      const exercises = [{ id: 'plank', title: 'Plank', kind: 'stretch' as const }];

      const markdown = serializeRoutine(routineRow as any, routineExercises as any, exercises as any);

      const lines = markdown.split('\n').filter((l) => l.startsWith('- '));
      expect(lines).toEqual(['- plank: kind=stretch']);
      expect(markdown).not.toContain('duration');

      // One contentless set out, not one prescribed at zero seconds.
      const line0 = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(line0.sets).toEqual([{ setType: 'normal' }]);
    });

    /**
     * The three session-line guards that had no DISCRIMINATING fixture (#289).
     *
     * The block above covers `rpe`, `distance` and `restSeconds`, and looks
     * like it covers the rest — its set carries `durationSeconds: null` too.
     * It does not: that set also carries `reps: 6`, so `buildSessionSetLine`
     * takes the reps arm and the `else if (set.durationSeconds != null)` branch
     * is never reached. The fixture states the condition and cannot distinguish
     * it, which is this repo's most-repeated test defect and is why all three
     * of these guards survived a `!== undefined` mutation.
     *
     * Each test below drives exactly one guard, with the values that make the
     * mutant's output differ from the correct one:
     *
     * | guard             | correct        | `!== undefined` mutant           |
     * |-------------------|----------------|----------------------------------|
     * | `weightKg`        | no `weight=`   | `weight=null` — parse refuses it |
     * | `reps`            | duration arm   | `1xnull` — parse refuses it      |
     * | `durationSeconds` | no `duration=` | `duration=0:00` — parse ACCEPTS  |
     *
     * The last row is the one that matters. `null / 60` is `0` in JavaScript,
     * so `formatDuration(null)` is `0:00` and the mutant's document parses
     * cleanly into a set that was never performed — a fabricated zero-second
     * entry rather than the loud failure the other two produce. It is the only
     * silent one of the three, and the only one whose test has to assert on
     * the bytes rather than on a round trip.
     */
    const sessionRow289 = {
      id: 'sess-289',
      routineId: 'push-06-01',
      startedAt: new Date('2026-08-17T10:00:00Z'),
      endedAt: new Date('2026-08-17T10:30:00Z'),
      createdAt: new Date('2026-08-17T10:00:00Z'),
      customSyncStatus: 'local',
    };

    const serialize289 = (set: Record<string, unknown>): { markdown: string; line: string } => {
      const markdown = serializeSession(
        sessionRow289 as any,
        [{ routineExerciseId: 're-289', position: 0, ...set }] as any,
        [{ id: 're-289', exerciseId: 'bench-press-db', order: 0, notes: undefined }] as any,
        [{ id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const }] as any
      );

      const lines = markdown.split('\n').filter((l) => l.startsWith('- '));
      expect(lines).toHaveLength(1);
      expect(markdown).not.toContain('null');
      return { markdown, line: lines[0] };
    };

    test('a null weightKg writes no weight flag, and the set still round-trips', () => {
      const { markdown, line } = serialize289({ setType: 'working', reps: 6, weightKg: null });

      expect(line).toBe('- bench-press-db: 1x6 set_type=working');
      expect(line).not.toContain('weight=');

      // `weight=null` is refused by `parseSingleFlag`, so the mutant's document
      // is unreadable where this one reads back as the set that was logged.
      const set0 = parseSession(markdown).exercises[0] as WorkoutLine;
      expect(set0.loggedReps).toBe(6);
      expect(set0.weight).toBeUndefined();
    });

    test('a null reps falls through to the duration arm, instead of writing 1xnull', () => {
      // The inverse of the fixture that misled #286: reps is the ABSENT field
      // here, which is the only way the duration arm below it is ever reached.
      const { markdown, line } = serialize289({
        setType: 'working',
        reps: null,
        durationSeconds: 45,
      });

      expect(line).toBe('- bench-press-db: duration=0:45 set_type=working');
      expect(line).not.toContain('1x');

      const set0 = parseSession(markdown).exercises[0] as WorkoutLine;
      expect(set0.loggedDurationSeconds).toBe(45);
      expect(set0.loggedReps).toBeUndefined();
    });

    test('a null durationSeconds writes no duration flag — no fabricated 0:00 set', () => {
      // Both measure-bearing columns unset, which the DB stores happily
      // (`validateSet` checks each field on its own and requires none of them).
      // The correct line says what was measured — a load — and says nothing
      // about time. The mutant adds `duration=0:00`, which is not a shorter
      // way of saying "unset": it is a measurement the user never made, and it
      // parses, so nothing downstream ever questions it.
      const { line } = serialize289({
        setType: 'working',
        reps: null,
        durationSeconds: null,
        weightKg: 80,
      });

      expect(line).toBe('- bench-press-db: set_type=working weight=80');
      expect(line).not.toContain('duration');
    });
  });

  describe('AC3.1: bodyweight sets (weight 0) round-trip', () => {
    test('a logged set with weightKg 0 survives serialize → parse', () => {
      const sessionRow = {
        id: 'sess-bw-001',
        routineId: 'pull-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };
      const sets = [
        {
          routineExerciseId: 're-bw-001',
          setType: 'working' as const,
          reps: 10,
          weightKg: 0,
          durationSeconds: undefined,
          rpe: 7,
          position: 0,
        },
      ];
      const routineExercises = [
        {
          id: 're-bw-001',
          exerciseId: 'pull-up',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
        },
      ];
      const exercises = [{ id: 'pull-up', title: 'Pull-up', kind: 'strength' as const }];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const set0 = parsed.exercises[0] as WorkoutLine;
      expect(set0.exerciseId).toBe('pull-up');
      expect(set0.weight).toBe(0);
      expect(set0.targetReps).toBe(10);
      expect(set0.rpe).toBe(7);
      expect(set0.setType).toBe('working');
    });
  });

  describe('AC3.1: zero logged reps (reps 0) round-trip', () => {
    test('a logged set with reps 0 survives serialize → parse', () => {
      // PR #89 regression: an earlier version of the zero-reps guard in
      // parseWorkoutLine was unconditional, so parseSession rejected the
      // 1x0 lines serializeSession correctly emits for a set logged with
      // zero reps. This pins the fix — serializeSession's `!= null` reps
      // guard preserves the 0, and parseSession accepts it in session
      // context even though parseRoutine would reject 3x0 as a routine
      // target.
      const sessionRow = {
        id: 'sess-zero-reps-001',
        routineId: 'pull-06-01',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };
      const sets = [
        {
          routineExerciseId: 're-zero-reps-001',
          setType: 'working' as const,
          reps: 0, // User performed zero repetitions
          weightKg: 50,
          durationSeconds: undefined,
          rpe: 6,
          position: 0,
        },
      ];
      const routineExercises = [
        {
          id: 're-zero-reps-001',
          exerciseId: 'bench-press-bb',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 120,
          notes: undefined,
        },
      ];
      const exercises = [{ id: 'bench-press-bb', title: 'Barbell Bench Press', kind: 'strength' as const }];

      // Serialize: reps guard must preserve 0
      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      // Verify serialization contains the 1x0 token
      expect(markdown).toContain('1x0');

      // Parse: session context allows zero reps
      const parsed = parseSession(markdown);

      expect(parsed.exercises).toHaveLength(1);
      const set0 = parsed.exercises[0] as WorkoutLine;
      expect(set0.exerciseId).toBe('bench-press-bb');
      expect(set0.loggedReps).toBe(0); // Verified: zero reps round-trip
      expect(set0.weight).toBe(50);
      expect(set0.rpe).toBe(6);
      expect(set0.setType).toBe('working');
    });
  });

  /**
   * #284: `serializeSession` emitted `rpe=0` and `parseSession` refused it.
   *
   * The write side guarded on presence only (`set.rpe != null`) while the read
   * side enforced the 1–10 scale, so a stored 0 produced a document the parser
   * threw on — and because `serializeSession` is all-or-nothing, that would
   * have failed the WHOLE session rather than one flag.
   *
   * Deliberately modelled on the `reps: 0` fixture above, and deliberately
   * resolved the other way: 0 reps is a real measurement ("the user performed
   * zero repetitions"), whereas the app's RPE scale starts at 1 and its own
   * input path (`buildLogSetValues`) already reads a 0 as *cleared*. So the
   * writer, not the reader, was wrong.
   */
  describe('#284: the RPE scale agrees across serialize → parse', () => {
    const sessionRow = {
      id: 'sess-rpe-scale-001',
      routineId: 'push-06-01',
      startedAt: new Date('2026-07-08T10:00:00Z'),
      endedAt: new Date('2026-07-08T10:30:00Z'),
      createdAt: new Date('2026-07-08T10:00:00Z'),
      customSyncStatus: 'local',
    };
    const routineExercises = [
      {
        id: 're-rpe-scale-001',
        exerciseId: 'bench-press-bb',
        order: 0,
        supersetGroup: undefined,
        restSeconds: 120,
        notes: undefined,
      },
    ];
    const exercises = [
      { id: 'bench-press-bb', title: 'Barbell Bench Press', kind: 'strength' as const },
    ];

    const roundTripRpe = (rpe: number | undefined) => {
      const sets = [
        {
          routineExerciseId: 're-rpe-scale-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 50,
          durationSeconds: undefined,
          rpe,
          position: 0,
        },
      ];
      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );
      const parsed = parseSession(markdown);
      return { markdown, line: parsed.exercises[0] as WorkoutLine };
    };

    test('a set stored with rpe 0 survives serialize → parse', () => {
      // The regression fixture. Before the fix this threw
      // `Contract violation: Invalid flag value: rpe=0` out of parseSession.
      const { markdown, line } = roundTripRpe(0);

      expect(markdown).not.toContain('rpe=');
      expect(line.rpe).toBeUndefined();

      // Scoped to the one flag: the work the athlete actually did is intact.
      expect(line.loggedReps).toBe(6);
      expect(line.weight).toBe(50);
      expect(line.setType).toBe('working');
    });

    test('an absent rpe and a zero rpe produce the same document', () => {
      // "Treat 0 the way it treats absent" — stated as an equality rather
      // than as two separate assertions about what is missing.
      expect(roundTripRpe(0).markdown).toBe(roundTripRpe(undefined).markdown);
    });

    test.each([
      { rpe: 0, legal: false },
      { rpe: 0.5, legal: false },
      { rpe: 1, legal: true },
      // A quarter step: rejected for the step SIZE, not merely for being
      // fractional. Nothing else in the suite discriminates the two.
      { rpe: 7.25, legal: false },
      { rpe: 7.3, legal: false },
      { rpe: 7.5, legal: true },
      { rpe: 10, legal: true },
      { rpe: 10.5, legal: false },
      { rpe: 11, legal: false },
    ])('rpe $rpe round-trips (legal: $legal)', ({ rpe, legal }) => {
      // The whole boundary list, driven through the real document path: every
      // value either survives intact or is dropped, and NONE produces a
      // document parseSession refuses.
      const { markdown, line } = roundTripRpe(rpe);

      expect(markdown).toContain('1x6');
      if (legal) {
        expect(markdown).toContain(`rpe=${rpe}`);
        expect(line.rpe).toBe(rpe);
      } else {
        expect(markdown).not.toContain('rpe=');
        expect(line.rpe).toBeUndefined();
      }
    });
  });

  // #277: `serializeRoutine` writes `routine_exercises.notes` into the `@hint`
  // flag, and the flag tokeniser split the whole flag string on whitespace — so
  // a hint was one token by construction. A prose note lost everything after
  // its first word *silently* (the remaining words fell through as unknown
  // non-flag tokens), and a note containing `=` was worse: a stray `x=y` token
  // reached the allowlist check and threw. Every pre-existing hint fixture in
  // this suite is a single token, which is exactly why 59 interop tests never
  // caught it — so every fixture below is deliberately multi-token.
  describe('#277: routine notes survive the round-trip', () => {
    const routineRow = {
      id: 'push-notes-001',
      name: 'Push Day',
      notes: undefined,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-07-07T12:00:00Z'),
    };

    const exerciseData = [
      { id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const },
    ];

    /**
     * Round-trips one routine exercise carrying `notes`. The entry also carries
     * warmup/rest/superset flags on purpose: they are emitted *before* the hint,
     * so they prove the note neither swallows them nor is swallowed by them.
     */
    const roundTripNote = (notes: string | undefined): { markdown: string; line: WorkoutLine } => {
      const routineExercises = [
        {
          id: 're-notes-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: 'A',
          restSeconds: 90,
          notes,
          sets: [
            { setType: 'warmup' as const, targetReps: 8 },
            { setType: 'normal' as const, targetReps: 6 },
          ],
        },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        routineExercises as any,
        exerciseData as any
      );
      const parsed = parseRoutine(markdown);
      expect(parsed.exercises).toHaveLength(1);
      return { markdown, line: parsed.exercises[0] as WorkoutLine };
    };

    test('a real multi-word Hevy note survives intact', () => {
      // The exact note off the user's Hevy "Push" routine that motivated #277.
      // Before the fix this round-tripped to "↑" with error: null.
      const note = '↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8';

      const { line } = roundTripNote(note);

      expect(line.hint).toBe(note);
      // The flags emitted before the hint are unharmed — including the per-set
      // ones now sharing the line with it.
      expect(line.sets).toEqual([
        { setType: 'warmup', targetReps: 8 },
        { setType: 'normal', targetReps: 6 },
      ]);
      expect(line.restSeconds).toBe(90);
      expect(line.supersetLabel).toBe('A');
    });

    test('a note containing = survives intact instead of throwing', () => {
      // Second failure mode: before the fix this threw
      // `ContractError: Unknown flag key`, not silent truncation.
      // The fixture also contains `3x12`, which the line tokeniser would grab
      // as a sets×reps token if the hint were not held together as one token.
      const note = '3x12 = the goal';

      const { line } = roundTripNote(note);

      expect(line.hint).toBe(note);
      expect(line.sets).toHaveLength(2);
      expect(line.sets?.[1].targetReps).toBe(6);
    });

    test('a note containing the grammar delimiters survives intact', () => {
      // The quote character is the new value delimiter, backslash is its escape,
      // and `@` introduces the hint — a note made of nothing but delimiters is
      // the case that catches an escaping bug on either side.
      const note = 'He said "go heavy" \\ then rest=90 @cue';

      const { line } = roundTripNote(note);

      expect(line.hint).toBe(note);
      expect(line.restSeconds).toBe(90); // the real flag, not the one inside the note
    });

    test('a single-token note keeps its existing unquoted wire form', () => {
      // Backward compatibility: previously-serialized documents carry bare
      // `@token` hints, and this must stay byte-identical so they still parse.
      const { markdown, line } = roundTripNote('progressive');

      expect(line.hint).toBe('progressive');
      expect(markdown).toContain('@progressive');
      expect(markdown).not.toContain('@"progressive"');
    });

    test('an absent or blank note emits no hint at all', () => {
      const absent = roundTripNote(undefined);
      expect(absent.line.hint).toBeUndefined();
      expect(absent.markdown).not.toContain('@');

      // A note that is only whitespace is treated as absent rather than
      // emitting a bare (or empty quoted) hint.
      const blank = roundTripNote('   ');
      expect(blank.line.hint).toBeUndefined();
      expect(blank.markdown).not.toContain('@');
    });

    test('a multi-word superset label survives too', () => {
      // `superset=` is the other free-text value and had the identical latent
      // truncation: nothing writes a label with a space today, which is
      // precisely why nothing would notice if the serializer stopped quoting it.
      const routineExercises = [
        {
          id: 're-ss-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: 'Group One',
          restSeconds: 90,
          notes: undefined,
          sets: [{ setType: 'normal' as const, targetReps: 6 }],
        },
        {
          id: 're-ss-002',
          exerciseId: 'rear-delt-fly-db',
          order: 1,
          supersetGroup: 'Group One',
          restSeconds: 90,
          notes: undefined,
          sets: [{ setType: 'normal' as const, targetReps: 12 }],
        },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        [...routineExercises] as any,
        [...exerciseData, { id: 'rear-delt-fly-db', title: 'Rear Delt Fly', kind: 'strength' as const }] as any
      );
      const parsed = parseRoutine(markdown);

      // Both lines carry the same label, so they collapse into one group.
      expect(parsed.exercises).toHaveLength(1);
      const group = parsed.exercises[0] as SupersetGroup;
      expect(group.supersetLabel).toBe('Group One');
      expect(group.exercises).toHaveLength(2);
      expect(group.exercises[0].supersetLabel).toBe('Group One');
    });

    test('a multi-line note round-trips its newline', () => {
      // (see the session-path sibling below: the same property, other document)
      // Decision (#277): newlines are PRESERVED, escaped as `\n` inside the
      // quoted value, not normalized to spaces. The document stays line-based
      // because the escape means no literal newline is ever emitted inside a
      // workout line.
      const note = 'Cue: elbows tucked.\nLast week: 45 lb x 12.';

      const { markdown, line } = roundTripNote(note);

      expect(line.hint).toBe(note);
      // Two workout lines because the entry prescribes two sets — and exactly
      // two, so the newline inside the note has not become a document line.
      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2);
    });
  });

  /**
   * The SESSION document's free-text value (#277 review, C1).
   *
   * `serializeSession` never writes a hint, so `superset=` is its whole exposure
   * to free text — and it built its flag list by hand rather than through
   * `formatFlags`, so the routine path's quoting never reached it. Nothing in
   * the suite exercised a session label at all, which is why the asymmetry
   * survived to review; these are that missing surface.
   */
  describe('#277: session superset labels survive the round-trip', () => {
    const sessionRow = {
      id: 'sess-ss-001',
      routineId: 'push-ss-001',
      startedAt: new Date('2026-07-07T10:00:00Z'),
      endedAt: new Date('2026-07-07T11:00:00Z'),
      createdAt: new Date('2026-07-07T10:00:00Z'),
      customSyncStatus: 'local',
    };

    const exerciseData = [
      { id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const },
    ];

    /**
     * Round-trips one logged set under a superset label. `restSeconds` is set
     * on purpose: `superset=` is emitted before `rest=`, so a label that fails
     * to hold together takes a real flag down with it rather than just losing
     * its own tail.
     */
    const roundTripLabel = (
      supersetGroup: string
    ): { markdown: string; line: WorkoutLine } => {
      const markdown = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-ss-001',
            exerciseId: 'bench-press-db',
            setType: 'working' as const,
            reps: 8,
            weightKg: 60,
            position: 0,
          },
        ] as any,
        [
          {
            id: 're-ss-001',
            exerciseId: 'bench-press-db',
            order: 0,
            supersetGroup,
            restSeconds: 90,
            notes: undefined,
          },
        ] as any,
        exerciseData as any
      );

      const parsed = parseSession(markdown);
      expect(parsed.exercises).toHaveLength(1);
      const first = parsed.exercises[0];
      const line = ('exercises' in first ? first.exercises[0] : first) as WorkoutLine;
      return { markdown, line };
    };

    test('a multi-word label survives, and does not swallow the flag after it', () => {
      // Before the session path went through formatFlags this emitted
      // `superset=Group One rest=1:30`, which parsed back as label "Group" with
      // rest silently gone.
      const { line } = roundTripLabel('Group One');

      expect(line.supersetLabel).toBe('Group One');
      expect(line.restSeconds).toBe(90);
      expect(line.loggedReps).toBe(8);
      expect(line.weight).toBe(60);
    });

    test('a label containing a quote survives instead of throwing', () => {
      // The regression the unquoted session path introduced: `"` is significant
      // to the tokenizer now, so an unquoted `superset=A"B` made the whole
      // session document unparseable.
      const { line } = roundTripLabel('A"B');

      expect(line.supersetLabel).toBe('A"B');
      expect(line.restSeconds).toBe(90);
    });

    test('a label containing a newline stays on one workout line', () => {
      // A literal newline in the label used to split the line in two and
      // truncate it. Escaping it is the same mechanism as the routine path's
      // multi-line note, reached now that both share a formatter.
      const { markdown, line } = roundTripLabel('x\ny');

      expect(line.supersetLabel).toBe('x\ny');
      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
    });

    test('an ordinary label keeps its bare wire form', () => {
      // Backward compatibility: quoting must stay the exception on this path
      // too, or every previously-written session document changes shape.
      const { markdown, line } = roundTripLabel('A');

      expect(line.supersetLabel).toBe('A');
      expect(markdown).toContain('superset=A');
      expect(markdown).not.toContain('superset="A"');
    });
  });

  /**
   * #276 Phase 5: the routine grammar is per-set, and symmetric with itself.
   *
   * RAMP is the discriminating fixture for the whole of #276 — the real Bench
   * Press warmup ramp off the user's Hevy "Push" routine. The aggregate grammar
   * could not express it at all: three warmups at three different weights
   * collapse to the number 3, and the weights are unrecoverable. Any regression
   * to a per-exercise line fails these by returning one set, or seven separate
   * exercises, rather than one exercise with seven ordered sets.
   */
  describe('#276: the per-set routine grammar round-trips', () => {
    const routineRow = {
      id: 'push-per-set-001',
      name: 'Push Day',
      notes: undefined,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-16T12:00:00Z'),
    };

    const benchPress = [
      { id: 'bench-press-db', title: 'Bench Press (Dumbbell)', kind: 'strength' as const },
    ];

    /** RAMP: warmup 5×9.07, 5×11.34, 3×18.14, then four normal 8–10×22.68. */
    const RAMP_SETS = [
      { setType: 'warmup' as const, targetReps: 5, targetWeightKg: 9.07 },
      { setType: 'warmup' as const, targetReps: 5, targetWeightKg: 11.34 },
      { setType: 'warmup' as const, targetReps: 3, targetWeightKg: 18.14 },
      { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
      { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
      { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
      { setType: 'normal' as const, targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
    ];

    const rampEntry = {
      id: 're-ramp-001',
      exerciseId: 'bench-press-db',
      order: 0,
      supersetGroup: undefined,
      restSeconds: 120,
      notes: undefined,
      sets: RAMP_SETS,
    };

    test('RAMP: parse(serialize(RAMP)) returns seven sets, in order, with their own weights', () => {
      const markdown = serializeRoutine(routineRow as any, [rampEntry] as any, benchPress as any);

      // Seven prescribed sets, seven document lines. The verbosity IS the
      // representation: changing one warmup weight changes one line.
      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(7);

      const parsed = parseRoutine(markdown);
      expect(parsed.exercises).toHaveLength(1);

      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.exerciseId).toBe('bench-press-db');
      expect(ex.restSeconds).toBe(120);
      expect(ex.sets).toHaveLength(7);
      expect(ex.sets?.map((s) => s.targetWeightKg)).toEqual([
        9.07, 11.34, 18.14, 22.68, 22.68, 22.68, 22.68,
      ]);
      expect(ex.sets?.map((s) => s.setType)).toEqual([
        'warmup',
        'warmup',
        'warmup',
        'normal',
        'normal',
        'normal',
        'normal',
      ]);
      expect(ex.sets?.map((s) => s.targetReps)).toEqual([5, 5, 3, 8, 8, 8, 8]);
      expect(ex.sets).toEqual(RAMP_SETS);
    });

    test('RANGE: a rep range survives as two numbers, not one', () => {
      const entry = {
        ...rampEntry,
        sets: [{ setType: 'normal' as const, targetReps: 8, targetRepsMax: 10 }],
      };

      const parsed = parseRoutine(
        serializeRoutine(routineRow as any, [entry] as any, benchPress as any)
      );
      const ex = parsed.exercises[0] as WorkoutLine;

      expect(ex.sets).toEqual([{ setType: 'normal', targetReps: 8, targetRepsMax: 10 }]);
    });

    test('DROP: per-set rest serializes distinctly from the exercise default and round-trips', () => {
      // #281's discriminating fixture. A drop set is three descending loads
      // whose rest is 0 / 0 / full — a pattern no exercise-level rest can
      // express. The set-level `set_rest=` flag is deliberately DISTINCT from
      // the entry-level `rest=` so an overriding set and an inheriting one stay
      // decidable, so this pins both that the value survives AND that it lands
      // on the SET, not the entry.
      const DROP_SETS = [
        { setType: 'normal' as const, targetReps: 10, targetWeightKg: 40, restSeconds: 0 },
        { setType: 'normal' as const, targetReps: 10, targetWeightKg: 30, restSeconds: 0 },
        { setType: 'normal' as const, targetReps: 10, targetWeightKg: 20, restSeconds: 120 },
      ];
      const entry = { ...rampEntry, restSeconds: 90, sets: DROP_SETS };

      const markdown = serializeRoutine(routineRow as any, [entry] as any, benchPress as any);
      const lines = markdown.split('\n').filter((l) => l.startsWith('- '));

      // Each line carries the entry default `rest=1:30` AND its own
      // `set_rest=`, and the three set_rest values differ — the distinction the
      // exercise default cannot draw.
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('rest=1:30');
      expect(lines[0]).toContain('set_rest=0');
      expect(lines[1]).toContain('set_rest=0');
      expect(lines[2]).toContain('set_rest=2:00');

      const parsed = parseRoutine(markdown);
      const ex = parsed.exercises[0] as WorkoutLine;
      // The entry default survives on the entry…
      expect(ex.restSeconds).toBe(90);
      // …and the per-set overrides survive on each set, in order.
      expect(ex.sets?.map((s) => s.restSeconds)).toEqual([0, 0, 120]);
      expect(ex.sets).toEqual(DROP_SETS);
    });

    test('DROP: a set with no per-set rest reads back with restSeconds absent, inheriting the entry', () => {
      // The fallback path is a real, exercised one: an absent per-set rest must
      // NOT round-trip as 0 (which would mean "override to no rest"). It must
      // come back absent so the engine reads the exercise default.
      const entry = {
        ...rampEntry,
        restSeconds: 90,
        sets: [{ setType: 'normal' as const, targetReps: 8, targetWeightKg: 50 }],
      };
      const parsed = parseRoutine(
        serializeRoutine(routineRow as any, [entry] as any, benchPress as any)
      );
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.sets).toEqual([{ setType: 'normal', targetReps: 8, targetWeightKg: 50 }]);
      expect(ex.sets?.[0].restSeconds).toBeUndefined();
    });

    test('EMPTY: an entry with no prescribed sets is an exercise line, not a dropped exercise', () => {
      // AC5.8. Zero sets is a shape the DB can hold (convention 10), so the
      // grammar has to say it — dropping the exercise or throwing would both
      // lose the fact that the routine names it.
      const entry = { ...rampEntry, restSeconds: undefined, sets: [] };

      const markdown = serializeRoutine(routineRow as any, [entry] as any, benchPress as any);
      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);

      const parsed = parseRoutine(markdown);
      expect(parsed.exercises).toHaveLength(1);
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.exerciseId).toBe('bench-press-db');
      expect(ex.sets).toEqual([]);
    });

    test('EMPTY keeps its entry-level flags', () => {
      const entry = { ...rampEntry, sets: [], notes: 'warm up however you like' };

      const parsed = parseRoutine(
        serializeRoutine(routineRow as any, [entry] as any, benchPress as any)
      );
      const ex = parsed.exercises[0] as WorkoutLine;

      expect(ex.sets).toEqual([]);
      expect(ex.restSeconds).toBe(120);
      expect(ex.hint).toBe('warm up however you like');
    });

    /**
     * EMPTY is not a strength-only shape (C1, #293 review).
     *
     * `acceptDraft` writes no `routine_sets` rows yet, so every entry in every
     * routine the app holds today is EMPTY — cardio and stretch entries
     * included. An exercise line saying "prescribes nothing" must therefore not
     * be read as a set line that forgot its duration.
     */
    test('EMPTY: a cardio or stretch entry with no sets round-trips like any other', () => {
      for (const kind of ['cardio', 'stretch'] as const) {
        const entry = {
          id: 're-empty-kind',
          exerciseId: 'rower',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 60,
          notes: undefined,
          sets: [],
        };

        const markdown = serializeRoutine(routineRow as any, [entry] as any, [
          { id: 'rower', title: 'Rower', kind },
        ] as any);

        expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);

        const ex = parseRoutine(markdown).exercises[0] as WorkoutLine;
        expect(ex.exerciseId).toBe('rower');
        expect(ex.kind).toBe(kind);
        expect(ex.restSeconds).toBe(60);
        expect(ex.sets).toEqual([]);
      }
    });

    /**
     * PARTIAL: a set that prescribes some columns and not others (C2, #293
     * review).
     *
     * All five `routine_sets` columns are independently optional, so "one set
     * at 50 kg, reps unstated" is a storable prescription. It serialized to a
     * line carrying only flags, which the parser read as an exercise
     * prescribing nothing — and the set disappeared. Every set that goes in
     * comes back, or the call throws; nothing vanishes.
     */
    test('PARTIAL: a load-only, reps_max-only or warmup-only set is still a set', () => {
      const sets = [
        { setType: 'normal' as const, targetReps: 5, targetWeightKg: 40 },
        { setType: 'normal' as const, targetWeightKg: 50 },
        { setType: 'normal' as const, targetRepsMax: 12 },
        { setType: 'warmup' as const },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        [{ ...rampEntry, sets }] as any,
        benchPress as any
      );

      expect(markdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(4);

      const ex = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(ex.sets).toEqual(sets);
    });

    test('PARTIAL: a distance-only cardio set is still a set', () => {
      const sets = [{ setType: 'normal' as const, targetDistanceM: 5000 }];

      const markdown = serializeRoutine(
        routineRow as any,
        [{ id: 're-d', exerciseId: 'rower', order: 0, restSeconds: 60, sets }] as any,
        [{ id: 'rower', title: 'Rower', kind: 'cardio' as const }] as any
      );

      const ex = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(ex.sets).toEqual(sets);
    });

    /**
     * The floor of the PARTIAL family: a set prescribing NOTHING at all.
     *
     * A `routine_sets` row with all five columns null and `set_type=normal` is
     * storable, so the grammar owes it an answer. It is the one shape that
     * collides with the EMPTY exercise line, and the collision is what the
     * explicit `sets=0` marker resolves: EMPTY says `sets=0`, a contentless set
     * says nothing, and one set in is one set out.
     */
    test('PARTIAL: a set prescribing nothing is one set, not a zero-set entry', () => {
      const markdown = serializeRoutine(
        routineRow as any,
        [{ ...rampEntry, sets: [{ setType: 'normal' as const }] }] as any,
        benchPress as any
      );

      const ex = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(ex.sets).toEqual([{ setType: 'normal' }]);
    });

    test('MISMATCH: a superset whose members prescribe different set counts', () => {
      // Convention 9's fixture, at the grammar layer. The members' lines are
      // NOT interleaved in the document — the routine stores each entry's set
      // list whole, and the engine does the round-robin — so what must survive
      // is the grouping, not an ordering.
      const exercises = [
        {
          id: 're-mm-a',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: 'G5',
          restSeconds: 60,
          notes: undefined,
          sets: [
            { setType: 'normal' as const, targetReps: 8 },
            { setType: 'normal' as const, targetReps: 8 },
            { setType: 'normal' as const, targetReps: 8 },
          ],
        },
        {
          id: 're-mm-b',
          exerciseId: 'rear-delt-fly-db',
          order: 1,
          supersetGroup: 'G5',
          restSeconds: 60,
          notes: undefined,
          sets: [
            { setType: 'normal' as const, targetReps: 12 },
            { setType: 'normal' as const, targetReps: 12 },
          ],
        },
      ];

      const parsed = parseRoutine(
        serializeRoutine(routineRow as any, exercises as any, [
          ...benchPress,
          { id: 'rear-delt-fly-db', title: 'Rear Delt Fly', kind: 'strength' as const },
        ] as any)
      );

      expect(parsed.exercises).toHaveLength(1);
      const group = parsed.exercises[0] as SupersetGroup;
      expect(group.supersetLabel).toBe('G5');
      expect(group.exercises).toHaveLength(2);
      expect(group.exercises[0].sets).toHaveLength(3);
      expect(group.exercises[1].sets).toHaveLength(2);
    });

    test('two different exercises stay two entries, whatever their set counts', () => {
      const exercises = [
        {
          id: 're-a',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
          sets: [
            { setType: 'normal' as const, targetReps: 5 },
            { setType: 'normal' as const, targetReps: 5 },
          ],
        },
        {
          id: 're-b',
          exerciseId: 'squat-bb',
          order: 1,
          supersetGroup: undefined,
          restSeconds: 90,
          notes: undefined,
          sets: [{ setType: 'normal' as const, targetReps: 3 }],
        },
      ];

      const parsed = parseRoutine(
        serializeRoutine(routineRow as any, exercises as any, [
          ...benchPress,
          { id: 'squat-bb', title: 'Barbell Squat', kind: 'strength' as const },
        ] as any)
      );

      expect(parsed.exercises).toHaveLength(2);
      expect((parsed.exercises[0] as WorkoutLine).sets).toHaveLength(2);
      expect((parsed.exercises[1] as WorkoutLine).sets).toHaveLength(1);
    });

    /**
     * ZERO: every per-set measure at 0, and rest at 0.
     *
     * The discriminating fixture for the `!= null` guards on the routine line —
     * the hazard class AGENTS.md names and #289 left three instances of on the
     * session path. Zero is a legitimate value for all of these: a bodyweight
     * exercise is prescribed at 0 kg, a set can be prescribed at 0 reps
     * (AC5.4 admits `1x0`), a rest of 0 is "straight into the next set", and a
     * 0-metre or 0-second target is expressible. A truthiness guard drops each
     * one silently, and a fixture that never uses 0 cannot see the difference —
     * which is why every one of these mutants survived before this test.
     */
    test('ZERO: a prescribed 0 survives on every per-set field, and on rest', () => {
      const sets = [
        {
          setType: 'normal' as const,
          targetReps: 0,
          targetRepsMax: 0,
          targetWeightKg: 0,
        },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        [{ ...rampEntry, restSeconds: 0, sets }] as any,
        benchPress as any
      );

      // Each zero is on the wire, not omitted.
      expect(markdown).toContain('1x0');
      expect(markdown).toContain('rest=0');
      expect(markdown).toContain('reps_max=0');
      expect(markdown).toContain('target_weight=0');

      const ex = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(ex.restSeconds).toBe(0);
      expect(ex.sets).toEqual(sets);
    });

    test('ZERO: a 0-second, 0-metre cardio target survives too', () => {
      const sets = [
        { setType: 'normal' as const, targetDurationSeconds: 0, targetDistanceM: 0 },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        [{ id: 're-z', exerciseId: 'rower', order: 0, restSeconds: 60, sets }] as any,
        [{ id: 'rower', title: 'Rower', kind: 'cardio' as const }] as any
      );

      expect(markdown).toContain('duration=0:00');
      expect(markdown).toContain('target_distance=0');

      const ex = parseRoutine(markdown).exercises[0] as WorkoutLine;
      expect(ex.sets).toEqual(sets);
    });

    test('a duration-based entry round-trips per-set durations and distances', () => {
      const entry = {
        id: 're-cardio',
        exerciseId: 'rower',
        order: 0,
        supersetGroup: undefined,
        restSeconds: 60,
        notes: undefined,
        sets: [
          { setType: 'warmup' as const, targetDurationSeconds: 120, targetDistanceM: 400 },
          { setType: 'normal' as const, targetDurationSeconds: 300, targetDistanceM: 1000 },
        ],
      };

      const parsed = parseRoutine(
        serializeRoutine(routineRow as any, [entry] as any, [
          { id: 'rower', title: 'Rower', kind: 'cardio' as const },
        ] as any)
      );
      const ex = parsed.exercises[0] as WorkoutLine;

      expect(ex.kind).toBe('cardio');
      expect(ex.sets).toEqual(entry.sets);
    });
  });
});
