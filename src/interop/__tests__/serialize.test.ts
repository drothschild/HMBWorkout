/**
 * Tests for serialize.ts (Task 2).
 * AC3.2: output conforms to vault conventions (frontmatter, ✅ token).
 */

import {
  serializeSession,
  serializeRoutine,
} from '../serialize';

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
});
