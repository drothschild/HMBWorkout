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
        name: 'AC9.3: RPE = 7.3 (invalid non-0.5-step) rejected',
        set: { reps: 8, weight_kg: 20.0, duration_seconds: 0, rpe: 7.3 },
        expectOk: false,
        expectErrorContains: '0.5-step',
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
        name: 'AC10.6: mid-superset (next in same group) → 0 rest',
        currentEntry: { supersetGroup: 'A', restSeconds: 90 },
        nextEntry: { supersetGroup: 'A' },
        isLastExercise: false,
        expectedRestSeconds: 0,
      },
      {
        name: 'AC10.6: end of superset (different group) → prescribed rest (90s)',
        currentEntry: { supersetGroup: 'A', restSeconds: 90 },
        nextEntry: { supersetGroup: 'B' },
        isLastExercise: false,
        expectedRestSeconds: 90,
      },
      {
        name: 'AC10.6: standalone exercise (no superset) → prescribed rest (60s)',
        currentEntry: { supersetGroup: '', restSeconds: 60 },
        nextEntry: { supersetGroup: '' },
        isLastExercise: false,
        expectedRestSeconds: 60,
      },
      {
        name: 'AC10.6: last exercise → 0 rest',
        currentEntry: { supersetGroup: '', restSeconds: 90 },
        nextEntry: { supersetGroup: '' },
        isLastExercise: true,
        expectedRestSeconds: 0,
      },
    ];

    for (const tc of testCases) {
      it(tc.name, () => {
        const result = evaluateSource(restDurationSource, {
          currentEntry: tc.currentEntry,
          nextEntry: tc.nextEntry,
          isLastExercise: tc.isLastExercise,
        });
        expect(result.success).toBe(true);
        expect(typeof result.value).toBe('number');
        // Assert the actual expected value
        expect(result.value).toBe(tc.expectedRestSeconds);
      });
    }
  });

  describe('progression_hint rule — simple heuristic', () => {
    it('all working sets with RPE ≤ 8 suggests +2.5 kg increase', () => {
      const history = [
        { reps: 10, weight_kg: 20.0, rpe: 6.5, set_type: 'working', exerciseId: 'ex1' },
        { reps: 10, weight_kg: 20.0, rpe: 7.0, set_type: 'working', exerciseId: 'ex1' },
      ];

      const result = evaluateSource(progressionHintSource, { history });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      // Should suggest to increase by 2.5 kg
      expect((result.value as string).toLowerCase()).toContain('increase');
      expect((result.value as string)).toContain('2.5');
    });

    it('working sets with RPE > 8 suggests hold', () => {
      const history = [
        { reps: 8, weight_kg: 25.0, rpe: 9.0, set_type: 'working', exerciseId: 'ex1' },
        { reps: 8, weight_kg: 25.0, rpe: 9.5, set_type: 'working', exerciseId: 'ex1' },
      ];

      const result = evaluateSource(progressionHintSource, { history });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      // Should suggest to hold current weight
      expect((result.value as string).toLowerCase()).toContain('hold');
    });

    it('mixed RPE (some ≤ 8, some > 8) suggests hold', () => {
      const history = [
        { reps: 10, weight_kg: 20.0, rpe: 7.0, set_type: 'working', exerciseId: 'ex1' },
        { reps: 10, weight_kg: 20.0, rpe: 9.0, set_type: 'working', exerciseId: 'ex1' },
      ];

      const result = evaluateSource(progressionHintSource, { history });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      // Should suggest to hold (not all low RPE)
      expect((result.value as string).toLowerCase()).toContain('hold');
    });

    it('empty history returns baseline hint', () => {
      const result = evaluateSource(progressionHintSource, { history: [] });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      expect((result.value as string).toLowerCase()).toContain('baseline');
    });

    it('only warmup sets returns baseline hint', () => {
      const history = [
        { reps: 5, weight_kg: 15.0, rpe: 4.0, set_type: 'warmup', exerciseId: 'ex1' },
      ];

      const result = evaluateSource(progressionHintSource, { history });
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      expect((result.value as string).toLowerCase()).toContain('baseline');
    });
  });
});
