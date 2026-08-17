/**
 * Tests for serialize.ts (Task 2).
 * AC3.2: output conforms to vault conventions (frontmatter, ✅ token).
 */

import {
  serializeSession,
  serializeRoutine,
} from '../serialize';
import { ContractError } from '../format';

describe('serialize', () => {
  describe('AC3.2: Frontmatter and vault conventions', () => {
    test('serializeSession includes required frontmatter keys', () => {
      const sessionRow = {
        id: 'sess-001',
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

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      // Check frontmatter keys
      const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).toBeTruthy();
      const frontmatter = frontmatterMatch![1];

      expect(frontmatter).toContain('type: workout-session');
      expect(frontmatter).toContain(`id: ${sessionRow.id}`);
      expect(frontmatter).toContain('tags:');
      expect(frontmatter).toContain('created:');

      // Check ✅ date token
      expect(markdown).toContain('✅ 2026-07-08');

      // Check workout block exists
      expect(markdown).toContain('```workout');
      expect(markdown).toContain('```');
    });

    test('serializeSession includes date in ISO format', () => {
      const sessionRow = {
        id: 'sess-002',
        routineId: 'push-06-01',
        startedAt: new Date('2026-07-09T15:45:00Z'),
        endedAt: new Date('2026-07-09T16:15:00Z'),
        createdAt: new Date('2026-07-09T15:45:00Z'),
        customSyncStatus: 'local',
      };

      const markdown = serializeSession(
        sessionRow as any,
        [],
        [],
        []
      );

      // Extract frontmatter
      const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = frontmatterMatch![1];

      // Date should be in frontmatter
      expect(frontmatter).toMatch(/date: 2026-07-09/);
    });

    test('serializeRoutine includes required frontmatter keys', () => {
      const routineRow = {
        id: 'push-06-01',
        name: 'Push Day',
        notes: 'Chest, shoulders, triceps',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T12:00:00Z'),
      };

      const exercises = [
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

      const exerciseData = [
        {
          id: 'bench-press-db',
          title: 'Bench Press (DB)',
          kind: 'strength' as const,
        },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        exercises as any,
        exerciseData as any
      );

      const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).toBeTruthy();
      const frontmatter = frontmatterMatch![1];

      expect(frontmatter).toContain('type: workout-routine');
      expect(frontmatter).toContain(`id: ${routineRow.id}`);
      expect(frontmatter).toContain('tags:');
      expect(frontmatter).toContain('created:');
      expect(frontmatter).toContain('updated:');
    });
  });

  describe('Session set identity: what was performed, not what the row names now', () => {
    // ReplaceExercise re-points a routine_exercises row. A session serialized
    // after that swap — one still queued as sync_status='local' — must name the
    // exercise its sets were actually performed as. Only the identity in the
    // existing `- <exercise-id>:` slot changes; the line grammar does not.
    const sessionRow = {
      id: 'sess-swap',
      routineId: 'push-06-01',
      startedAt: new Date('2026-07-08T10:00:00Z'),
      endedAt: new Date('2026-07-08T10:30:00Z'),
      createdAt: new Date('2026-07-08T10:00:00Z'),
      customSyncStatus: 'local',
    };

    const routineExercises = [
      {
        id: 're-001',
        // The row has already been swapped to the substitute.
        exerciseId: 'dumbbell-floor-press',
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
      { id: 'barbell-bench-press', title: 'Barbell Bench Press', kind: 'strength' as const },
      { id: 'dumbbell-floor-press', title: 'Dumbbell Floor Press', kind: 'strength' as const },
    ];

    test('names the exercise the set recorded, not the one the row was swapped to', () => {
      const sets = [
        {
          routineExerciseId: 're-001',
          exerciseId: 'barbell-bench-press',
          setType: 'working' as const,
          reps: 6,
          weightKg: 80,
          durationSeconds: undefined,
          rpe: undefined,
          position: 0,
        },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      expect(markdown).toContain('- barbell-bench-press: 1x6');
      expect(markdown).not.toContain('dumbbell-floor-press');
    });

    test('falls back to the row for a set with no recorded identity', () => {
      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: 6,
          weightKg: 80,
          durationSeconds: undefined,
          rpe: undefined,
          position: 0,
        },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      expect(markdown).toContain('- dumbbell-floor-press: 1x6');
    });

    test('keeps the line grammar identical — only the identity slot differs', () => {
      const withStamp = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-001',
            exerciseId: 'barbell-bench-press',
            setType: 'working' as const,
            reps: 6,
            weightKg: 80,
            rpe: 8,
            position: 0,
          },
        ] as any,
        routineExercises as any,
        exercises as any
      );
      const withoutStamp = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-001',
            setType: 'working' as const,
            reps: 6,
            weightKg: 80,
            rpe: 8,
            position: 0,
          },
        ] as any,
        routineExercises as any,
        exercises as any
      );

      // Byte-identical once the id is normalized away: same flags, same order,
      // same frontmatter, same block structure.
      expect(withStamp.replace('barbell-bench-press', 'dumbbell-floor-press')).toBe(withoutStamp);
    });

    test('takes the kind flag from the exercise performed', () => {
      const sets = [
        {
          routineExerciseId: 're-stretch',
          exerciseId: 'hamstring-stretch',
          setType: 'stretch' as const,
          durationSeconds: 30,
          position: 0,
        },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        [
          {
            id: 're-stretch',
            exerciseId: 'calf-stretch',
            order: 0,
            warmupSets: 0,
            restSeconds: undefined,
          },
        ] as any,
        [
          { id: 'hamstring-stretch', title: 'Hamstring Stretch', kind: 'stretch' as const },
          { id: 'calf-stretch', title: 'Calf Stretch', kind: 'stretch' as const },
        ] as any
      );

      expect(markdown).toContain('- hamstring-stretch:');
      expect(markdown).toContain('kind=stretch');
    });
  });

  describe('Sets whose routine_exercises row is gone', () => {
    // upsertRoutine's drop branch destroys the routine_exercises row of an
    // exercise removed from a routine. A finished session still queued as
    // sync_status='local' keeps its session_sets, but their
    // routine_exercise_id now names nothing — and the serializer's outer loop
    // walks surviving rows, so those sets were never even visited. The session
    // posted short and flipped to 'synced', permanently losing that work from
    // the vault. Identity survives in the schema-v3 stamp; use it.
    const sessionRow = {
      id: 'sess-dropped',
      routineId: 'push-06-01',
      startedAt: new Date('2026-07-08T10:00:00Z'),
      endedAt: new Date('2026-07-08T10:30:00Z'),
      createdAt: new Date('2026-07-08T10:00:00Z'),
      customSyncStatus: 'local',
    };

    // The routine has been edited since the workout: only the press survives.
    const survivingRows = [
      {
        id: 're-press',
        exerciseId: 'barbell-bench-press',
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
      { id: 'barbell-bench-press', title: 'Barbell Bench Press', kind: 'strength' as const },
      { id: 'cable-fly', title: 'Cable Fly', kind: 'strength' as const },
    ];

    test('still exports a set whose row was dropped by a routine edit', () => {
      const sets = [
        {
          routineExerciseId: 're-press',
          exerciseId: 'barbell-bench-press',
          setType: 'working' as const,
          reps: 6,
          weightKg: 80,
          position: 0,
        },
        {
          // This row was destroyed when the exercise left the routine.
          routineExerciseId: 're-fly',
          exerciseId: 'cable-fly',
          setType: 'working' as const,
          reps: 12,
          weightKg: 15,
          position: 1,
        },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        survivingRows as any,
        exercises as any
      );

      expect(markdown).toContain('- barbell-bench-press: 1x6');
      expect(markdown).toContain('- cable-fly: 1x12');
    });

    test('takes a dropped set\'s kind from the exercise it recorded', () => {
      const sets = [
        {
          routineExerciseId: 're-stretch',
          exerciseId: 'hamstring-stretch',
          setType: 'stretch' as const,
          durationSeconds: 30,
          position: 0,
        },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        survivingRows as any,
        [
          ...exercises,
          { id: 'hamstring-stretch', title: 'Hamstring Stretch', kind: 'stretch' as const },
        ] as any
      );

      // Flag order is `formatFlags`'s, shared with the routine path since #277:
      // rest, warmup, superset, kind, duration, set_type, rpe, weight, distance,
      // hint. Parsing is order-insensitive, so this pins the bytes, not a
      // requirement.
      expect(markdown).toContain('- hamstring-stretch: kind=stretch duration=0:30 set_type=stretch');
    });

    test('orders dropped groups by position, after the surviving rows', () => {
      const sets = [
        {
          routineExerciseId: 're-fly',
          exerciseId: 'cable-fly',
          setType: 'working' as const,
          reps: 12,
          position: 1,
        },
        {
          routineExerciseId: 're-raise',
          exerciseId: 'lateral-raise',
          setType: 'working' as const,
          reps: 15,
          position: 2,
        },
        {
          routineExerciseId: 're-press',
          exerciseId: 'barbell-bench-press',
          setType: 'working' as const,
          reps: 6,
          position: 0,
        },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        survivingRows as any,
        [
          ...exercises,
          { id: 'lateral-raise', title: 'Lateral Raise', kind: 'strength' as const },
        ] as any
      );

      const emitted = markdown
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) => line.split(':')[0]);

      expect(emitted).toEqual([
        '- barbell-bench-press',
        '- cable-fly',
        '- lateral-raise',
      ]);
    });

    test('throws rather than dropping a set whose identity cannot be recovered', () => {
      // Pre-v3 set: no stamp, and its row is gone. Nothing names the exercise.
      // Refusing leaves the session sync_status='local' and the data on-device;
      // exporting anyway would write the vault copy permanently short.
      const sets = [
        {
          routineExerciseId: 're-fly',
          setType: 'working' as const,
          reps: 12,
          position: 0,
        },
      ];

      expect(() =>
        serializeSession(sessionRow as any, sets as any, survivingRows as any, exercises as any)
      ).toThrow(ContractError);
    });
  });

  describe('Task 2: Structured flags serialization', () => {
    test('serializeSession includes set_type for warmup/working sets', () => {
      const sessionRow = {
        id: 'sess-003',
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

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      expect(markdown).toContain('set_type=warmup');
      expect(markdown).toContain('set_type=working');
      expect(markdown).toContain('rpe=8');
    });

    test('serializeSession serializes superset grouping', () => {
      const sessionRow = {
        id: 'sess-004',
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
          warmupSets: 1,
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

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      expect(markdown).toContain('superset=A');
    });

    test('serializeSession includes rpe for logged sets', () => {
      const sessionRow = {
        id: 'sess-005',
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
          rpe: undefined,
          position: 2,
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

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      expect(markdown).toContain('rpe=8');
      expect(markdown).toContain('rpe=7.5');
      // Unrated set should not have rpe=
      const lines = markdown.split('\n');
      const lastSetLine = lines[lines.length - 2]; // before closing ```
      expect(lastSetLine).not.toContain('rpe=');
    });

    test('serializeRoutine includes superset and warmup flags', () => {
      const routineRow = {
        id: 'push-06-01',
        name: 'Push Day',
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
        {
          id: 're-002',
          exerciseId: 'bench-press-db',
          order: 1,
          supersetGroup: 'A',
          warmupSets: 2,
          targetSets: 4,
          targetReps: 6,
          targetDurationSeconds: undefined,
          restSeconds: 90,
          notes: undefined,
        },
        {
          id: 're-003',
          exerciseId: 'rear-delt-fly-db',
          order: 2,
          supersetGroup: 'A',
          warmupSets: 0,
          targetSets: 3,
          targetReps: 12,
          targetDurationSeconds: undefined,
          restSeconds: 90,
          notes: undefined,
        },
        {
          id: 're-004',
          exerciseId: 'lateral-raise-db',
          order: 3,
          supersetGroup: undefined,
          warmupSets: 0,
          targetSets: 4,
          targetReps: 10,
          targetDurationSeconds: undefined,
          restSeconds: 90,
          notes: undefined,
        },
        {
          id: 're-005',
          exerciseId: 'chest-stretch',
          order: 4,
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
        { id: 'cycling', title: 'Cycling', kind: 'cardio' as const },
        { id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const },
        { id: 'rear-delt-fly-db', title: 'Rear Delt Fly (DB)', kind: 'strength' as const },
        { id: 'lateral-raise-db', title: 'Lateral Raise (DB)', kind: 'strength' as const },
        { id: 'chest-stretch', title: 'Chest Stretch', kind: 'stretch' as const },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        exercises as any,
        exerciseData as any
      );

      expect(markdown).toContain('kind=cardio');
      expect(markdown).toContain('duration=5:00');
      expect(markdown).toContain('warmup=2');
      expect(markdown).toContain('superset=A');
      expect(markdown).toContain('kind=stretch');
      expect(markdown).toContain('duration=0:30');
    });

    test('serializeSession duration-only lines have no double space', () => {
      const sessionRow = {
        id: 'sess-006',
        routineId: 'cardio-stretch',
        startedAt: new Date('2026-07-08T10:00:00Z'),
        endedAt: new Date('2026-07-08T10:30:00Z'),
        createdAt: new Date('2026-07-08T10:00:00Z'),
        customSyncStatus: 'local',
      };

      const sets = [
        {
          routineExerciseId: 're-001',
          setType: 'working' as const,
          reps: undefined,
          weightKg: undefined,
          durationSeconds: 300,
          rpe: undefined,
          position: 0,
        },
        {
          routineExerciseId: 're-002',
          setType: 'working' as const,
          reps: undefined,
          weightKg: undefined,
          durationSeconds: 30,
          rpe: undefined,
          position: 1,
        },
      ];

      const routineExercises = [
        {
          id: 're-001',
          exerciseId: 'cycling',
          order: 0,
          supersetGroup: undefined,
          warmupSets: 0,
          targetSets: undefined,
          targetReps: undefined,
          targetDurationSeconds: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
        {
          id: 're-002',
          exerciseId: 'chest-stretch',
          order: 1,
          supersetGroup: undefined,
          warmupSets: 0,
          targetSets: undefined,
          targetReps: undefined,
          targetDurationSeconds: undefined,
          restSeconds: undefined,
          notes: undefined,
        },
      ];

      const exercises = [
        { id: 'cycling', title: 'Cycling', kind: 'cardio' as const },
        { id: 'chest-stretch', title: 'Chest Stretch', kind: 'stretch' as const },
      ];

      const markdown = serializeSession(
        sessionRow as any,
        sets as any,
        routineExercises as any,
        exercises as any
      );

      // Extract workout lines
      const lines = markdown.split('\n');
      const workoutLines = lines.filter(l => l.startsWith('- '));

      // Check that duration-only lines do not have double space (e.g., ": " not ":  ")
      for (const line of workoutLines) {
        expect(line).not.toMatch(/:\s{2,}/);
      }
    });

    test('serializeRoutine duration-only lines have no double space', () => {
      const routineRow = {
        id: 'cardio-routine',
        name: 'Cardio',
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
        {
          id: 're-002',
          exerciseId: 'chest-stretch',
          order: 1,
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
        { id: 'cycling', title: 'Cycling', kind: 'cardio' as const },
        { id: 'chest-stretch', title: 'Chest Stretch', kind: 'stretch' as const },
      ];

      const markdown = serializeRoutine(
        routineRow as any,
        exercises as any,
        exerciseData as any
      );

      // Extract workout lines
      const lines = markdown.split('\n');
      const workoutLines = lines.filter(l => l.startsWith('- '));

      // Check that duration-only lines do not have double space (e.g., ": " not ":  ")
      for (const line of workoutLines) {
        expect(line).not.toMatch(/:\s{2,}/);
      }
    });
  });

  // #277: the emitted wire form of a note. The round-trip tests prove
  // serialize/parse agree with each other; these pin WHAT they agree on, so a
  // symmetric change of delimiter (both sides switching to single quotes, say)
  // is caught rather than passing a round-trip silently.
  describe('#277: hint wire format', () => {
    const routineRow = {
      id: 'push-hint-01',
      name: 'Push Day',
      notes: undefined,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-07-07T12:00:00Z'),
    };
    const exerciseData = [
      { id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const },
    ];

    const lineFor = (notes: string | undefined): string => {
      const exercises = [
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
          notes,
        },
      ];
      const markdown = serializeRoutine(
        routineRow as any,
        exercises as any,
        exerciseData as any
      );
      const workoutLines = markdown.split('\n').filter(l => l.startsWith('- '));
      expect(workoutLines).toHaveLength(1);
      return workoutLines[0];
    };

    test('a note needing no quoting is emitted bare, exactly as before', () => {
      expect(lineFor('progressive')).toBe('- bench-press-db: 4x6 rest=1:30 @progressive');
    });

    test('a multi-word note is emitted as one double-quoted token', () => {
      expect(lineFor('↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8')).toBe(
        '- bench-press-db: 4x6 rest=1:30 @"↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8"'
      );
    });

    test('quote, backslash and newline are escaped inside the quoted value', () => {
      expect(lineFor('say "hi" \\ then\nrest')).toBe(
        '- bench-press-db: 4x6 rest=1:30 @"say \\"hi\\" \\\\ then\\nrest"'
      );
    });

    test('a whitespace-only note is emitted as no hint at all', () => {
      expect(lineFor('  \t ')).toBe('- bench-press-db: 4x6 rest=1:30');
    });

    test('a null note is absent, not a crash and not the string "null"', () => {
      // WatermelonDB returns null, not undefined, for an unset optional column,
      // and `notes` is not in exportService's normalized-field list — so null
      // reaches this guard for real (#277 review, m2/R35). A truthiness check
      // handles it; an `!== undefined` check would call .trim() on null.
      expect(lineFor(null as unknown as undefined)).toBe('- bench-press-db: 4x6 rest=1:30');
    });
  });

  /**
   * The session line's wire form (#277 review, C1).
   *
   * `buildSessionSetLine` now builds a `ParsedFlags` and hands it to
   * `formatFlags`, the same formatter the routine path uses, so `superset=` is
   * quoted by the same helper. These pin the emitted bytes; the parse side of
   * the same change is in `roundtrip.test.ts`.
   */
  describe('#277: session line wire format', () => {
    const sessionRow = {
      id: 'sess-wire-01',
      routineId: 'push-wire-01',
      startedAt: new Date('2026-07-07T10:00:00Z'),
      endedAt: new Date('2026-07-07T11:00:00Z'),
      createdAt: new Date('2026-07-07T10:00:00Z'),
      customSyncStatus: 'local',
    };
    const exerciseData = [
      { id: 'bench-press-db', title: 'Bench Press (DB)', kind: 'strength' as const },
    ];

    const lineFor = (supersetGroup: string | undefined): string => {
      const markdown = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-wire-01',
            exerciseId: 'bench-press-db',
            setType: 'working' as const,
            reps: 8,
            weightKg: 60,
            position: 0,
          },
        ] as any,
        [
          {
            id: 're-wire-01',
            exerciseId: 'bench-press-db',
            order: 0,
            supersetGroup,
            warmupSets: 0,
            targetSets: 4,
            targetReps: 6,
            restSeconds: 90,
            notes: undefined,
          },
        ] as any,
        exerciseData as any
      );
      const workoutLines = markdown.split('\n').filter((l) => l.startsWith('- '));
      expect(workoutLines).toHaveLength(1);
      return workoutLines[0];
    };

    test('a label needing no quoting is emitted bare', () => {
      expect(lineFor('A')).toBe(
        '- bench-press-db: 1x8 rest=1:30 superset=A set_type=working weight=60'
      );
    });

    test('a multi-word label is emitted as one double-quoted token', () => {
      expect(lineFor('Group One')).toBe(
        '- bench-press-db: 1x8 rest=1:30 superset="Group One" set_type=working weight=60'
      );
    });

    test('a quote in the label is escaped, not emitted raw', () => {
      // Emitted raw, this made the whole session document unparseable.
      expect(lineFor('A"B')).toBe(
        '- bench-press-db: 1x8 rest=1:30 superset="A\\"B" set_type=working weight=60'
      );
    });

    test('a newline in the label is escaped, keeping the document line-based', () => {
      expect(lineFor('x\ny')).toBe(
        '- bench-press-db: 1x8 rest=1:30 superset="x\\ny" set_type=working weight=60'
      );
    });

    test('set_type=working is still stated explicitly', () => {
      // `formatFlags` omits a routine's plan defaults, but a session's set type
      // is a measurement: sharing the formatter must not drop it.
      expect(lineFor(undefined)).toContain('set_type=working');
    });
  });

  /**
   * #284: an out-of-scale rpe is never written, on EITHER of the two paths
   * that build a session line.
   *
   * `buildSessionSetLine` has two call sites — the row-ordered loop and the
   * orphaned-group sweep — and #277's fix reached only one of its two paths
   * before review caught it. Both are exercised here on purpose; the guard
   * lives in `formatFlags`, which both reach, and this is what proves it.
   */
  describe('#284: out-of-scale rpe is dropped on both session-line paths', () => {
    const sessionRow = {
      id: 'sess-rpe-284',
      routineId: 'push-06-01',
      startedAt: new Date('2026-07-08T10:00:00Z'),
      endedAt: new Date('2026-07-08T10:30:00Z'),
      createdAt: new Date('2026-07-08T10:00:00Z'),
      customSyncStatus: 'local',
    };
    const rows = [
      {
        id: 're-press',
        exerciseId: 'barbell-bench-press',
        order: 0,
        supersetGroup: undefined,
        warmupSets: 0,
        targetSets: 4,
        targetReps: 6,
        targetDurationSeconds: undefined,
        restSeconds: undefined,
        notes: undefined,
      },
    ];
    const exercises = [
      { id: 'barbell-bench-press', title: 'Barbell Bench Press', kind: 'strength' as const },
      { id: 'cable-fly', title: 'Cable Fly', kind: 'strength' as const },
    ];

    test('the row-ordered path drops rpe=0 and keeps the rest of the set', () => {
      const markdown = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-press',
            exerciseId: 'barbell-bench-press',
            setType: 'working' as const,
            reps: 6,
            weightKg: 80,
            rpe: 0,
            position: 0,
          },
        ] as any,
        rows as any,
        exercises as any
      );

      expect(markdown).toContain('- barbell-bench-press: 1x6 set_type=working weight=80');
      expect(markdown).not.toContain('rpe=');
    });

    test('the orphaned-group path drops rpe=0 too', () => {
      // `re-fly`'s row was destroyed by a routine edit, so this set is only
      // reached by the second call site.
      const markdown = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-fly',
            exerciseId: 'cable-fly',
            setType: 'working' as const,
            reps: 12,
            weightKg: 15,
            rpe: 0,
            position: 0,
          },
        ] as any,
        rows as any,
        exercises as any
      );

      expect(markdown).toContain('- cable-fly: 1x12 set_type=working weight=15');
      expect(markdown).not.toContain('rpe=');
    });

    test('an in-scale rpe is still written on both paths', () => {
      // The guard must not be a blanket drop: this is the assertion that
      // fails if someone "fixes" the asymmetry by deleting the flag.
      const markdown = serializeSession(
        sessionRow as any,
        [
          {
            routineExerciseId: 're-press',
            exerciseId: 'barbell-bench-press',
            setType: 'working' as const,
            reps: 6,
            rpe: 8.5,
            position: 0,
          },
          {
            routineExerciseId: 're-fly',
            exerciseId: 'cable-fly',
            setType: 'working' as const,
            reps: 12,
            rpe: 1,
            position: 1,
          },
        ] as any,
        rows as any,
        exercises as any
      );

      expect(markdown).toContain('- barbell-bench-press: 1x6 set_type=working rpe=8.5');
      expect(markdown).toContain('- cable-fly: 1x12 set_type=working rpe=1');
    });
  });
});
