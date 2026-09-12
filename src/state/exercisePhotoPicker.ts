import type { LocalExerciseImageOverrideOutcome } from './exerciseImageOverride';

type PickerResult = {
  readonly canceled: boolean;
  readonly assets?: readonly { readonly uri: string }[] | null;
};

export type ExercisePhotoPickerDeps = {
  readonly requestCameraPermission: () => Promise<{ readonly granted: boolean }>;
  readonly launchCamera: () => Promise<PickerResult>;
  readonly launchLibrary: () => Promise<PickerResult>;
  readonly save: (uri: string) => Promise<LocalExerciseImageOverrideOutcome>;
};

export type ExercisePhotoPickerOutcome =
  | { readonly kind: 'busy' }
  | { readonly kind: 'camera-denied' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'saved'; readonly outcome: LocalExerciseImageOverrideOutcome };

/**
 * Runs one picker operation under a synchronous ref lock. State-based button
 * disabling only reaches the next React render, so it cannot prevent two rapid
 * presses from starting two native pickers before that render.
 */
export async function pickExercisePhoto(
  deps: ExercisePhotoPickerDeps,
  camera: boolean,
  inFlight: { current: boolean }
): Promise<ExercisePhotoPickerOutcome> {
  if (inFlight.current) return { kind: 'busy' };
  inFlight.current = true;
  try {
    if (camera && !(await deps.requestCameraPermission()).granted) return { kind: 'camera-denied' };

    const result = camera ? await deps.launchCamera() : await deps.launchLibrary();
    const uri = result.assets?.[0]?.uri;
    if (result.canceled || !uri) return { kind: 'cancelled' };

    return { kind: 'saved', outcome: await deps.save(uri) };
  } finally {
    inFlight.current = false;
  }
}
