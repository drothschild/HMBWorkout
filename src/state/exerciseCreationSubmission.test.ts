import { submitExerciseCreation } from './exerciseCreationSubmission';

describe('submitExerciseCreation', () => {
  it('does not report a stale duplicate after the first rapid submit navigates to its created exercise', async () => {
    let resolveCreate!: (value: { readonly kind: 'created'; readonly exerciseId: string }) => void;
    const create = jest.fn(
      () => new Promise<{ readonly kind: 'created'; readonly exerciseId: string }>((resolve) => (resolveCreate = resolve))
    );
    const navigate = jest.fn();
    const reportRejected = jest.fn();
    const reportFailure = jest.fn();
    const inFlight = { current: false };
    const deps = { create, navigate, reportRejected, reportFailure };

    const first = submitExerciseCreation(deps, inFlight);
    await Promise.resolve();
    await expect(submitExerciseCreation(deps, inFlight)).resolves.toEqual({ kind: 'busy' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(reportRejected).not.toHaveBeenCalled();

    resolveCreate({ kind: 'created', exerciseId: 'kettlebell-swing' });
    await expect(first).resolves.toEqual({ kind: 'created', exerciseId: 'kettlebell-swing' });
    expect(navigate).toHaveBeenCalledWith('kettlebell-swing');
    expect(reportRejected).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(inFlight.current).toBe(false);
  });
});
