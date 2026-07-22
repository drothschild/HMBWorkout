import { ValidationError, validateSet } from './validation';

describe('Set Input Validation', () => {
  describe('validateSet', () => {
    it('AC1.4: rejects negative reps and throws validation error', () => {
      const input = {
        reps: -1,
        weightKg: 50,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);

      expect(() => {
        validateSet(input);
      }).toThrow('reps must be a non-negative number');
    });

    it('AC1.4: rejects NaN reps', () => {
      const input = {
        reps: NaN,
        weightKg: 50,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);
    });

    it('AC1.4: rejects negative weight', () => {
      const input = {
        reps: 10,
        weightKg: -50,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);

      expect(() => {
        validateSet(input);
      }).toThrow('weight must be a non-negative number');
    });

    it('AC1.4: rejects negative duration', () => {
      const input = {
        durationSeconds: -300,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);

      expect(() => {
        validateSet(input);
      }).toThrow('duration must be a non-negative number');
    });

    it('accepts valid set with reps and weight', () => {
      const input = {
        reps: 10,
        weightKg: 50,
      };

      expect(() => {
        validateSet(input);
      }).not.toThrow();
    });

    it('accepts valid set with only duration', () => {
      const input = {
        durationSeconds: 300,
      };

      expect(() => {
        validateSet(input);
      }).not.toThrow();
    });

    it('accepts valid set with no optional fields', () => {
      const input = {};

      expect(() => {
        validateSet(input);
      }).not.toThrow();
    });
  });
});
