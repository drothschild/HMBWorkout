import type { LocalExerciseImageOverrideOutcome } from './exerciseImageOverride';

type CaptureResult = { readonly uri: string } | undefined;
type CaptureDeps = {
  readonly takePicture: () => Promise<CaptureResult>;
  readonly save: (uri: string) => Promise<LocalExerciseImageOverrideOutcome>;
};

function captureEntryPoint(
  deps: CaptureDeps,
  inFlight: { current: boolean },
  session: { current: number },
  expectedSession: number
) {
  // The first red run intentionally has no implementation module. Turning that
  // absence into a rejected promise makes the expected behavioural failure
  // explicit rather than letting module resolution abort this suite.
  let implementation: undefined | ((
    captureDeps: CaptureDeps,
    captureInFlight: { current: boolean },
    captureSession: { current: number },
    expected: number
  ) => Promise<unknown>);
  try {
    implementation = require('./exerciseCameraCapture').captureExerciseCameraPhoto;
  } catch {
    implementation = undefined;
  }
  if (!implementation) return Promise.resolve({ kind: 'not-implemented' });
  return implementation(deps, inFlight, session, expectedSession);
}

function closeEntryPoint(inFlight: { current: boolean }, close: () => void): boolean | 'not-implemented' {
  let implementation: undefined | ((
    captureInFlight: { current: boolean },
    closeCamera: () => void
  ) => boolean);
  try {
    implementation = require('./exerciseCameraCapture').closeExerciseCameraIfIdle;
  } catch {
    implementation = undefined;
  }
  if (!implementation) return 'not-implemented';
  return implementation(inFlight, close);
}

describe('captureExerciseCameraPhoto', () => {
  it('does not save when closing the camera invalidates an in-flight capture', async () => {
    let releasePicture!: (result: CaptureResult) => void;
    const takePicture = jest.fn(
      () => new Promise<CaptureResult>((resolve) => { releasePicture = resolve; })
    );
    const save = jest.fn();
    const inFlight = { current: false };
    const session = { current: 1 };

    const capture = captureEntryPoint({ takePicture, save }, inFlight, session, 1);
    await Promise.resolve();
    session.current += 1;
    releasePicture({ uri: 'file:///cache/camera.jpg' });

    await expect(capture).resolves.toEqual({ kind: 'cancelled' });
    expect(save).not.toHaveBeenCalled();
    expect(inFlight.current).toBe(false);
  });

  it('allows only one capture and forwards the successful local URI to the existing save boundary', async () => {
    let releasePicture!: (result: CaptureResult) => void;
    const takePicture = jest.fn(
      () => new Promise<CaptureResult>((resolve) => { releasePicture = resolve; })
    );
    const save = jest.fn().mockResolvedValue({ kind: 'saved', imagePath: 'exercise-images/squat.jpg' });
    const inFlight = { current: false };
    const session = { current: 1 };

    const first = captureEntryPoint({ takePicture, save }, inFlight, session, 1);
    await Promise.resolve();
    await expect(captureEntryPoint({ takePicture, save }, inFlight, session, 1)).resolves.toEqual({ kind: 'busy' });
    expect(takePicture).toHaveBeenCalledTimes(1);

    releasePicture({ uri: 'file:///cache/camera.jpg' });
    await expect(first).resolves.toEqual({
      kind: 'saved',
      outcome: { kind: 'saved', imagePath: 'exercise-images/squat.jpg' },
    });
    expect(save).toHaveBeenCalledWith('file:///cache/camera.jpg');
    expect(inFlight.current).toBe(false);
  });

  it('does not execute Close while a captured photo is still saving', async () => {
    let releaseSave!: (outcome: LocalExerciseImageOverrideOutcome) => void;
    const save = jest.fn(
      () => new Promise<LocalExerciseImageOverrideOutcome>((resolve) => { releaseSave = resolve; })
    );
    const inFlight = { current: false };
    const session = { current: 1 };

    const capture = captureEntryPoint(
      { takePicture: jest.fn().mockResolvedValue({ uri: 'file:///cache/camera.jpg' }), save },
      inFlight,
      session,
      1
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith('file:///cache/camera.jpg');

    const close = jest.fn();
    expect(closeEntryPoint(inFlight, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();

    releaseSave({ kind: 'saved', imagePath: 'exercise-images/camera.jpg' });
    await expect(capture).resolves.toEqual({
      kind: 'saved',
      outcome: { kind: 'saved', imagePath: 'exercise-images/camera.jpg' },
    });

    expect(closeEntryPoint(inFlight, close)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
