/**
 * Validation error for set input
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Set input to validate
 */
export interface SetInput {
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceM?: number;
  rpe?: number;
}

/**
 * Validate set input before persisting to database.
 * Throws ValidationError if any field is invalid.
 *
 * @param input The set input to validate
 * @throws ValidationError if validation fails
 */
export function validateSet(input: SetInput): void {
  // Validate reps
  if (input.reps !== undefined) {
    if (isNaN(input.reps) || input.reps < 0) {
      throw new ValidationError('reps must be a non-negative number');
    }
  }

  // Validate weight
  if (input.weightKg !== undefined) {
    if (isNaN(input.weightKg) || input.weightKg < 0) {
      throw new ValidationError('weight must be a non-negative number');
    }
  }

  // Validate duration
  if (input.durationSeconds !== undefined) {
    if (isNaN(input.durationSeconds) || input.durationSeconds < 0) {
      throw new ValidationError('duration must be a non-negative number');
    }
  }

  // Validate distance
  if (input.distanceM !== undefined) {
    if (isNaN(input.distanceM) || input.distanceM < 0) {
      throw new ValidationError('distance must be a non-negative number');
    }
  }

  // Validate RPE
  if (input.rpe !== undefined) {
    // RPE must be between 1 and 10 in 0.5 increments
    // Valid values: 1, 1.5, 2, 2.5, ..., 9.5, 10
    if (isNaN(input.rpe) || input.rpe < 1 || input.rpe > 10) {
      throw new ValidationError(
        'rpe must be between 1 and 10 in 0.5 step increments'
      );
    }

    // Check if it's a valid 0.5 increment
    const scaledRpe = input.rpe * 2; // Convert to integer scale (0.5 -> 1, 1.0 -> 2, etc.)
    if (!Number.isInteger(scaledRpe)) {
      throw new ValidationError(
        'rpe must be between 1 and 10 in 0.5 step increments'
      );
    }
  }
}
