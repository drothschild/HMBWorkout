import type { CreateExerciseOutcome } from './exerciseCreation';

export type ExerciseCreationSubmissionDeps = {
  readonly create: () => Promise<CreateExerciseOutcome>;
  readonly onOutcome: (outcome: CreateExerciseOutcome) => void;
  readonly onFailure: (error: unknown) => void;
};

export type ExerciseCreationSubmissionOutcome = CreateExerciseOutcome | { readonly kind: 'busy' } | { readonly kind: 'failed' };

/**
 * Serializes the create action before React has a chance to render disabled
 * controls. The caller maps the one resulting outcome to navigation or
 * feedback; a rapid second press gets no outcome and cannot overwrite it.
 */
export async function submitExerciseCreation(
  deps: ExerciseCreationSubmissionDeps,
  inFlight: { current: boolean }
): Promise<ExerciseCreationSubmissionOutcome> {
  if (inFlight.current) return { kind: 'busy' };
  inFlight.current = true;
  try {
    const outcome = await deps.create();
    deps.onOutcome(outcome);
    return outcome;
  } catch (error) {
    deps.onFailure(error);
    return { kind: 'failed' };
  } finally {
    inFlight.current = false;
  }
}
