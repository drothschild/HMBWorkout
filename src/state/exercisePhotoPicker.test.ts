import { pickExercisePhoto, type ExercisePhotoPickerDeps } from './exercisePhotoPicker';

function deps(overrides: Partial<ExercisePhotoPickerDeps> = {}): ExercisePhotoPickerDeps {
  return {
    launchLibrary: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library.jpg' }] }),
    save: jest.fn().mockResolvedValue({ kind: 'saved', imagePath: 'exercise-images/squat.jpg' }),
    ...overrides,
  };
}

describe('pickExercisePhoto', () => {
  it('does nothing when the picker is cancelled, even if a stale asset is present', async () => {
    const save = jest.fn();
    const picker = deps({
      launchLibrary: jest.fn().mockResolvedValue({ canceled: true, assets: [{ uri: 'file:///stale.jpg' }] }),
      save,
    });
    const lock = { current: false };

    await expect(pickExercisePhoto(picker, lock)).resolves.toEqual({ kind: 'cancelled' });
    expect(save).not.toHaveBeenCalled();
    expect(lock.current).toBe(false);
  });

  it('uses the ref lock immediately, before React can publish saving state', async () => {
    let releaseLibrary!: (result: { canceled: boolean; assets: { uri: string }[] }) => void;
    const launchLibrary = jest.fn(
      () => new Promise<{ canceled: boolean; assets: { uri: string }[] }>((resolve) => (releaseLibrary = resolve))
    );
    const save = jest.fn().mockResolvedValue({ kind: 'saved', imagePath: 'exercise-images/squat.jpg' });
    const picker = deps({ launchLibrary, save });
    const lock = { current: false };

    const first = pickExercisePhoto(picker, lock);
    await Promise.resolve();
    await expect(pickExercisePhoto(picker, lock)).resolves.toEqual({ kind: 'busy' });
    expect(launchLibrary).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();

    releaseLibrary({ canceled: false, assets: [{ uri: 'file:///library.jpg' }] });
    await expect(first).resolves.toEqual({
      kind: 'saved',
      outcome: { kind: 'saved', imagePath: 'exercise-images/squat.jpg' },
    });
    expect(save).toHaveBeenCalledWith('file:///library.jpg');
    expect(lock.current).toBe(false);
  });
});
