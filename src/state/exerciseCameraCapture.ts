import type { LocalExerciseImageOverrideOutcome } from './exerciseImageOverride';

export type ExerciseCameraCaptureDeps = {
  readonly takePicture: () => Promise<{ readonly uri: string } | undefined>;
  readonly save: (uri: string) => Promise<LocalExerciseImageOverrideOutcome>;
};

export type ExerciseCameraCaptureOutcome =
  | { readonly kind: 'busy' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'saved'; readonly outcome: LocalExerciseImageOverrideOutcome };

/**
 * Closing cannot cancel a photo once its local URI is being copied and saved.
 * The UI disables Close too, while this synchronous guard protects the small
 * interval before React applies that disabled state.
 */
export function closeExerciseCameraIfIdle(
  inFlight: { current: boolean },
  closeCamera: () => void
): boolean {
  if (inFlight.current) return false;
  closeCamera();
  return true;
}

/**
 * Capturing finishes asynchronously. A close increments `session`, so a photo
 * that returns after close is deliberately discarded before it can write an
 * exercise image. The synchronous ref makes rapid shutter taps single-flight.
 */
export async function captureExerciseCameraPhoto(
  deps: ExerciseCameraCaptureDeps,
  inFlight: { current: boolean },
  session: { current: number },
  expectedSession: number
): Promise<ExerciseCameraCaptureOutcome> {
  if (inFlight.current) return { kind: 'busy' };
  inFlight.current = true;
  try {
    const picture = await deps.takePicture();
    if (session.current !== expectedSession || !picture?.uri) return { kind: 'cancelled' };
    return { kind: 'saved', outcome: await deps.save(picture.uri) };
  } finally {
    inFlight.current = false;
  }
}
