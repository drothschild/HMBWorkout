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

describe('system camera picker', () => {
  function cameraDeps(granted = true, canAskAgain = false) {
    return {
      ...deps(),
      camera: {
        requestPermission: jest.fn().mockResolvedValue({ granted, canAskAgain }),
        launch: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///camera.jpg' }] }),
      },
    };
  }

  it('requests permission and saves the system camera URI without launching the library', async () => {
    const picker = cameraDeps();
    const lock = { current: false };
    await expect(pickExercisePhoto(picker, lock)).resolves.toMatchObject({ kind: 'saved' });
    expect(picker.camera.requestPermission).toHaveBeenCalledTimes(1);
    expect(picker.camera.launch).toHaveBeenCalledTimes(1);
    expect(picker.launchLibrary).not.toHaveBeenCalled();
    expect(picker.save).toHaveBeenCalledWith('file:///camera.jpg');
    expect(lock.current).toBe(false);
  });

  it.each([true, false])('preserves canAskAgain=%s on denial without opening or saving', async (canAskAgain) => {
    const picker = cameraDeps(false, canAskAgain);
    const lock = { current: false };
    await expect(pickExercisePhoto(picker, lock)).resolves.toEqual({ kind: 'camera-denied', canAskAgain });
    expect(picker.camera.launch).not.toHaveBeenCalled();
    expect(picker.launchLibrary).not.toHaveBeenCalled();
    expect(picker.save).not.toHaveBeenCalled();
    expect(lock.current).toBe(false);
  });

  it('holds the shared lock during permission and save, blocking camera and library reentry', async () => {
    let grant!: (value: { granted: boolean; canAskAgain: boolean }) => void;
    let saved!: (value: { kind: 'saved'; imagePath: string }) => void;
    const picker = cameraDeps();
    picker.camera.requestPermission.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    picker.save = jest.fn(() => new Promise((resolve) => { saved = resolve; }));
    const lock = { current: false };
    const first = pickExercisePhoto(picker, lock);
    expect(lock.current).toBe(true);
    await expect(pickExercisePhoto(deps(), lock)).resolves.toEqual({ kind: 'busy' });
    expect(picker.camera.launch).not.toHaveBeenCalled();
    expect(picker.camera.requestPermission).toHaveBeenCalledTimes(1);
    grant({ granted: true, canAskAgain: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(picker.save).toHaveBeenCalledWith('file:///camera.jpg');
    expect(lock.current).toBe(true);
    await expect(pickExercisePhoto(picker, lock)).resolves.toEqual({ kind: 'busy' });
    saved({ kind: 'saved', imagePath: 'exercise-images/photo.jpg' });
    await first;
    expect(lock.current).toBe(false);
  });

  it('does not save a canceled camera result even when a stale URI exists', async () => {
    const picker = cameraDeps();
    picker.camera.launch.mockResolvedValue({ canceled: true, assets: [{ uri: 'file:///stale.jpg' }] });
    await expect(pickExercisePhoto(picker, { current: false })).resolves.toEqual({ kind: 'cancelled' });
    expect(picker.save).not.toHaveBeenCalled();
  });

  it.each(['permission', 'launch', 'save'] as const)('releases the lock and propagates a %s failure', async (stage) => {
    const picker = cameraDeps();
    const failure = new Error(stage);
    if (stage === 'permission') picker.camera.requestPermission.mockRejectedValue(failure);
    if (stage === 'launch') picker.camera.launch.mockRejectedValue(failure);
    if (stage === 'save') picker.save = jest.fn().mockRejectedValue(failure);
    const lock = { current: false };
    await expect(pickExercisePhoto(picker, lock)).rejects.toBe(failure);
    expect(lock.current).toBe(false);
  });
});
