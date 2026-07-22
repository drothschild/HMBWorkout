/**
 * Tests for parse.ts (Task 3).
 * AC3.3, AC3.4, AC8.1, AC8.3: parser validates and extracts structured data.
 */

import { parseRoutine, parseSession } from '../parse';
import { ContractError } from '../format';

describe('parse', () => {
  describe('AC3.3: Malformed block raises error', () => {
    test('throws ContractError on malformed workout block', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 @bad rest=invalid
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('throws ContractError on missing closing fence', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('throws ContractError on invalid sets×reps format', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('ignores deprecated rpe flag (historic vault files)', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 rpe=8
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(1);
      expect((result.exercises[0] as any).rpe).toBeUndefined();
    });
  });

  describe('AC3.4: Prose outside block ignored', () => {
    test('ignores prose before and after workout block', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

This is a warm-up routine for chest day.

\`\`\`workout
- bench-press-db: 4x6
\`\`\`

Notes: This is optional coaching text. The parser should ignore it.
`;

      const result = parseRoutine(markdown);
      expect(result).toBeTruthy();
      expect(result.exercises).toHaveLength(1);
      expect(result.exercises[0]).toHaveProperty('exerciseId', 'bench-press-db');
    });

    test('extracts frontmatter correctly', () => {
      const markdown = `---
type: workout-routine
id: my-routine
created: 2026-07-08
updated: 2026-07-07
tags: [strength]
---

\`\`\`workout
- bench-press-db: 4x6
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.frontmatter.type).toBe('workout-routine');
      expect(result.frontmatter.id).toBe('my-routine');
      expect(result.frontmatter.created).toBe('2026-07-08');
      expect(result.frontmatter.updated).toBe('2026-07-07');
    });
  });

  describe('AC8.1: Superset grouping', () => {
    test('adjacent superset=A lines form one group', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 superset=A
- rear-delt-fly-db: 3x12 superset=A
- lateral-raise-db: 4x10
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(2);

      // First should be a superset group
      const firstExercise = result.exercises[0];
      expect(firstExercise).toHaveProperty('supersetLabel', 'A');
      expect(firstExercise).toHaveProperty('exercises');
      expect((firstExercise as any).exercises).toHaveLength(2);
      expect((firstExercise as any).exercises[0].exerciseId).toBe('bench-press-db');
      expect((firstExercise as any).exercises[1].exerciseId).toBe('rear-delt-fly-db');

      // Second should be standalone
      const secondExercise = result.exercises[1];
      expect(secondExercise).toHaveProperty('exerciseId', 'lateral-raise-db');
    });

    test('non-adjacent superset=A lines do not group', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 superset=A
- lateral-raise-db: 4x10
- rear-delt-fly-db: 3x12 superset=A
\`\`\`
`;

      const result = parseRoutine(markdown);
      // Should have 3 separate entries (no grouping since they're not adjacent)
      expect(result.exercises).toHaveLength(3);
    });
  });

  describe('AC8.3: Cardio/stretch with duration', () => {
    test('parses kind=cardio with duration', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- cycling: kind=cardio duration=5:00
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(1);
      const exercise = result.exercises[0] as any;
      expect(exercise.exerciseId).toBe('cycling');
      expect(exercise.kind).toBe('cardio');
      expect(exercise.targetDurationSeconds).toBe(300);
      expect(exercise.targetSets).toBeUndefined();
      expect(exercise.targetReps).toBeUndefined();
    });

    test('parses kind=stretch with duration', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- chest-stretch: kind=stretch duration=0:30
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(1);
      const exercise = result.exercises[0] as any;
      expect(exercise.exerciseId).toBe('chest-stretch');
      expect(exercise.kind).toBe('stretch');
      expect(exercise.targetDurationSeconds).toBe(30);
      expect(exercise.targetSets).toBeUndefined();
      expect(exercise.targetReps).toBeUndefined();
    });

    test('rejects cardio/stretch with sets×reps', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- cycling: 5x1 kind=cardio duration=5:00
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });
  });

  describe('Task 3: Flag parsing', () => {
    test('parses warmup flag', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 warmup=2
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.warmupSets).toBe(2);
    });

    test('parses rest with seconds', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 rest=90
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.restSeconds).toBe(90);
    });

    test('parses rest with m:ss format', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 rest=1:30
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.restSeconds).toBe(90);
    });

    test('parses hint (@text)', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 @progressive
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('progressive');
    });

    test('parses multiple flags', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x6 warmup=2 rest=1:30 superset=A @progressive
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.warmupSets).toBe(2);
      expect(exercise.restSeconds).toBe(90);
      expect(exercise.supersetLabel).toBe('A');
      expect(exercise.hint).toBe('progressive');
    });
  });

  describe('Session parsing', () => {
    test('parseSession parses session with set_type (deprecated rpe ignored)', () => {
      const markdown = `---
type: workout-session
id: sess-001
date: 2026-07-08
created: 2026-07-08
tags: []
---

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 1x6 set_type=warmup
- bench-press-db: 1x6 set_type=working rpe=8
\`\`\`
`;

      const result = parseSession(markdown);
      expect(result).toBeTruthy();
      expect(result.exercises).toHaveLength(2);

      const first = result.exercises[0] as any;
      expect(first.exerciseId).toBe('bench-press-db');
      expect(first.setType).toBe('warmup');

      const second = result.exercises[1] as any;
      expect(second.exerciseId).toBe('bench-press-db');
      expect(second.setType).toBe('working');
      expect(second.rpe).toBeUndefined();
    });

    test('parseSession preserves superset grouping', () => {
      const markdown = `---
type: workout-session
id: sess-002
date: 2026-07-08
created: 2026-07-08
tags: []
---

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 1x6 set_type=working superset=A
- rear-delt-fly-db: 1x12 set_type=working superset=A
\`\`\`
`;

      const result = parseSession(markdown);
      expect(result.exercises).toHaveLength(1);
      expect((result.exercises[0] as any).supersetLabel).toBe('A');
    });
  });

  describe('I1: unknown flags fail loud', () => {
    test('an unrecognized key=value flag throws ContractError', () => {
      const markdown = `---
type: workout-routine
id: typo-01
updated: 2026-07-08
---
\`\`\`workout
- bench-press-db: 4x6 resr=90
\`\`\`
`;
      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });
  });

  describe('M1: block-style YAML tags list (vault convention)', () => {
    test('tags as a block list parse, and following keys still parse', () => {
      const markdown = `---
type: workout-routine
id: block-tags-01
tags:
  - project
  - react-native
created: 2026-07-08
updated: 2026-07-08
---
\`\`\`workout
- bench-press-db: 4x6 rest=90
\`\`\`
`;
      const result = parseRoutine(markdown);
      expect(result.frontmatter.tags).toContain('project');
      expect(result.frontmatter.tags).toContain('react-native');
      expect(result.frontmatter.created).toBe('2026-07-08');
      expect(result.frontmatter.id).toBe('block-tags-01');
      expect(result.exercises).toHaveLength(1);
    });
  });
});
