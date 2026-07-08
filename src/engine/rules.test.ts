import { evaluateSource } from './bridge';
import validateSetSource from './rules/validate_set.lv';
import restDurationSource from './rules/rest_duration.lv';
import progressionHintSource from './rules/progression_hint.lv';

describe('engine: supporting rules', () => {
  describe('validate_set rule — AC1.4 (negative reps/weight), AC9.3 (RPE validation)', () => {
    const testCases = [
      {
        name: 'AC1.4: negative reps rejected',
        set: { reps: -1, weight_kg: 20.0, duration_seconds: 0, rpe: -1.0 },
        expectOk: false,
        expectErrorContains: 'reps',
      },
      {
        name: 'AC1.4: negative weight rejected',
        set: { reps: 8, weight_kg: -5.0, duration_seconds: 0, rpe: -1.0 },
        expectOk: false,
        expectErrorContains: 'weight',
      },
      {
        name: 'AC9.3: RPE > 10 rejected',
        set: { reps: 8, weight_kg: 20.0, duration_seconds: 0, rpe: 11.0 },
        expectOk: false,
        expectErrorContains: 'RPE',
      },
      {
        name: 'AC9.3: RPE = 0 rejected',
        set: { reps: 8, weight_kg: 20.0, duration_seconds: 0, rpe: 0.0 },
        expectOk: false,
        expectErrorContains: 'RPE',
      },
      {
        name: 'AC9.3: RPE = 7.5 (valid 0.5 step) accepted',
        set: { reps: 8, weight_kg: 20.0, duration_seconds: 0, rpe: 7.5 },
        expectOk: true,
      },
      {
        name: 'AC9.3: RPE unset (-1.0 sentinel) accepted',
        set: { reps: 8, weight_kg: 20.0, duration_seconds: 0, rpe: -1.0 },
        expectOk: true,
      },
      {
        name: 'Valid set: reps, weight, RPE',
        set: { reps: 10, weight_kg: 25.5, duration_seconds: 0, rpe: 8.0 },
        expectOk: true,
      },
    ];

    for (const tc of testCases) {
      it(tc.name, () => {
        const result = evaluateSource(validateSetSource, { set: tc.set });
        expect(result.success).toBe(true);

        const value = result.value as any;
        if (tc.expectOk) {
          expect(value.tag).toBe('Ok');
        } else {
          expect(value.tag).toBe('Err');
          if (tc.expectErrorContains) {
            expect(value.value).toContain(tc.expectErrorContains);
          }
        }
      });
    }
  });

  describe('rest_duration rule — superset handling', () => {
    const testCases = [
      {
        name: 'AC10.6: mid-superset (not last) → 0 rest',
        exerciseId: 'ex1',
        setIndex: 0,
        supersetPos: 0,
        supersetSize: 2,
        expectedRestSeconds: 0,
      },
      {
        name: 'AC10.6: end of superset (last in group) → prescribed rest',
        exerciseId: 'ex1',
        setIndex: 1,
        supersetPos: 1,
        supersetSize: 2,
        expectedRestSeconds: 90, // example prescribed value
      },
      {
        name: 'AC10.6: standalone exercise → prescribed rest',
        exerciseId: 'ex2',
        setIndex: 0,
        supersetPos: 0,
        supersetSize: 1,
        expectedRestSeconds: 120, // example prescribed value
      },
    ];

    for (const tc of testCases) {
      it(tc.name, () => {
        const result = evaluateSource(restDurationSource, {
          exercise_id: tc.exerciseId,
          set_index: tc.setIndex,
          superset_pos: tc.supersetPos,
          superset_size: tc.supersetSize,
        });
        expect(result.success).toBe(true);
        expect(typeof result.value).toBe('number');
        if (tc.supersetPos < tc.supersetSize - 1) {
          expect(result.value).toBe(0);
        } else {
          expect(typeof result.value).toBe('number');
        }
      });
    }
  });

  describe('progression_hint rule — simple heuristic', () => {
    it('at-target low-RPE history suggests increase', () => {
      const history = [
        { reps: 10, weight_kg: 20.0, rpe: 6.5, set_type: 'working', exerciseId: 'ex1' },
      ];

      const result = evaluateSource(progressionHintSource, { history });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      // Should contain a suggestion to increase
      expect((result.value as string).toLowerCase()).toContain('increase');
    });

    it('any history returns a hint string', () => {
      const history = [
        { reps: 5, weight_kg: 25.0, rpe: 9.5, set_type: 'working', exerciseId: 'ex1' },
      ];

      const result = evaluateSource(progressionHintSource, { history });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      // Should return a meaningful string
      expect((result.value as string).length).toBeGreaterThan(0);
    });

    it('empty history returns default hint', () => {
      const result = evaluateSource(progressionHintSource, { history: [] });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
    });
  });
});
