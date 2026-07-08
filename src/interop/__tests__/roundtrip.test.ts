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
          warmupSets: 1,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
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

    test('routine round-trip: parse(serialize(rows)) preserves machine fields', () => {
      const routineRow = {
        id: 'push-rt-001',
        name: 'Push Day',
        notes: undefined,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'bench-press-db',
          order: 0,
          supersetGroup: undefined,
          warmupSets: 2,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
          restSeconds: 90,
          notes: undefined,
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

      // Verify exercises
      expect(parsed.exercises).toHaveLength(1);
      const ex = parsed.exercises[0] as WorkoutLine;
      expect(ex.exerciseId).toBe('bench-press-db');
      expect(ex.targetSets).toBe(4);
      expect(ex.targetReps).toBe(6);
      expect(ex.warmupSets).toBe(2);
      expect(ex.restSeconds).toBe(90);
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
          warmupSets: 1,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
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
          warmupSets: 0,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
        {
          id: 're-002',
          exerciseId: 'rear-delt-fly-db',
          order: 1,
          supersetGroup: 'A',
          warmupSets: 0,
          targetSets: 3,
          targetReps: 12,
          targetDurationSeconds: undefined,
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

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'squat-bb',
          order: 0,
          supersetGroup: undefined,
          warmupSets: 3,
          targetSets: 5,
          targetReps: 3,
          targetDurationSeconds: undefined,
          restSeconds: 180,
          notes: undefined,
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
      expect(ex.warmupSets).toBe(3);
      expect(ex.targetSets).toBe(5);
      expect(ex.targetReps).toBe(3);
    });

    test('preserves stretch duration and kind', () => {
      const routineRow = {
        id: 'routine-stretch-rt',
        name: 'Stretch Test',
        notes: undefined,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'chest-stretch',
          order: 0,
          supersetGroup: undefined,
          warmupSets: 0,
          targetSets: undefined,
          targetReps: undefined,
          targetDurationSeconds: 30,
          restSeconds: undefined,
          notes: undefined,
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
      expect(ex.targetDurationSeconds).toBe(30);
      expect(ex.targetSets).toBeUndefined();
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

      const exercises = [
        {
          id: 're-001',
          exerciseId: 'cycling',
          order: 0,
          supersetGroup: undefined,
          warmupSets: 0,
          targetSets: undefined,
          targetReps: undefined,
          targetDurationSeconds: 300,
          restSeconds: undefined,
          notes: undefined,
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
      expect(ex.targetDurationSeconds).toBe(300);
      expect(ex.targetSets).toBeUndefined();
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
          warmupSets: 0,
          targetSets: undefined,
          targetReps: undefined,
          targetDurationSeconds: 30,
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
          warmupSets: 0,
          targetSets: undefined,
          targetReps: undefined,
          targetDurationSeconds: 300,
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
          warmupSets: 0,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
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
          warmupSets: 0,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
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
});
