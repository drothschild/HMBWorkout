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

    it('AC9.3: rejects rpe > 10', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: 11,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);

      expect(() => {
        validateSet(input);
      }).toThrow('rpe must be between 1 and 10 in 0.5 step increments');
    });

    it('AC9.3: rejects rpe < 1', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: 0.5,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);

      expect(() => {
        validateSet(input);
      }).toThrow('rpe must be between 1 and 10 in 0.5 step increments');
    });

    it('AC9.3: rejects rpe that is not in 0.5 step increments', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: 7.3,
      };

      expect(() => {
        validateSet(input);
      }).toThrow(ValidationError);

      expect(() => {
        validateSet(input);
      }).toThrow('rpe must be between 1 and 10 in 0.5 step increments');
    });

    it('accepts valid rpe at 0.5 increments (1.0)', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: 1,
      };

      expect(() => {
        validateSet(input);
      }).not.toThrow();
    });

    it('accepts valid rpe at 0.5 increments (7.5)', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: 7.5,
      };

      expect(() => {
        validateSet(input);
      }).not.toThrow();
    });

    it('accepts valid rpe at 0.5 increments (10)', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: 10,
      };

      expect(() => {
        validateSet(input);
      }).not.toThrow();
    });

    it('accepts undefined rpe', () => {
      const input = {
        reps: 8,
        weightKg: 60,
        rpe: undefined,
      };

      expect(() => {
        validateSet(input);
      }).not.toThrow();
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
