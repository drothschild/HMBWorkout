import { saveWorkout, SessionCompleteSummary } from './saveWorkout';

describe('saveWorkout', () => {
  const mockHealthKit = {
    ensureAuthorized: jest.fn().mockResolvedValue('authorized'),
    requestAuthorization: jest.fn().mockResolvedValue(true),
    saveWorkoutSample: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AC6.1: calls saveWorkoutSample with correct start/end dates and activity type', async () => {
    const summary: SessionCompleteSummary = {
      startMs: 1609459200000, // 2021-01-01 00:00:00 UTC
      endMs: 1609462800000,   // 2021-01-01 01:00:00 UTC
      exercisesCompleted: 5,
      setsLogged: 15,
      loggedSets: [],
    };

    await saveWorkout(summary, mockHealthKit);

    expect(mockHealthKit.saveWorkoutSample).toHaveBeenCalledWith(
      20, // WorkoutActivityType.functionalStrengthTraining
      [], // quantities (empty for now)
      new Date(summary.startMs),
      new Date(summary.endMs),
      expect.any(Object), // totals
      undefined // metadata
    );
  });

  it('AC6.1: passes energyBurned in totals when available', async () => {
    const summary: SessionCompleteSummary = {
      startMs: 1609459200000,
      endMs: 1609462800000,
      exercisesCompleted: 5,
      setsLogged: 15,
      loggedSets: [],
      energyBurned: 250, // 250 kcal
    };

    await saveWorkout(summary, mockHealthKit);

    expect(mockHealthKit.saveWorkoutSample).toHaveBeenCalledWith(
      20,
      [],
      expect.any(Date),
      expect.any(Date),
      { energyBurned: 250 },
      undefined
    );
  });

  it('AC6.1: does not throw on success', async () => {
    const summary: SessionCompleteSummary = {
      startMs: 1609459200000,
      endMs: 1609462800000,
      exercisesCompleted: 5,
      setsLogged: 15,
      loggedSets: [],
    };

    await expect(saveWorkout(summary, mockHealthKit)).resolves.not.toThrow();
  });

  it('AC6.2: logs and swallows HealthKit write errors', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockHealthKit.saveWorkoutSample.mockRejectedValueOnce(new Error('Write failed'));

    const summary: SessionCompleteSummary = {
      startMs: 1609459200000,
      endMs: 1609462800000,
      exercisesCompleted: 5,
      setsLogged: 15,
      loggedSets: [],
    };

    await expect(saveWorkout(summary, mockHealthKit)).resolves.not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('HealthKit'),
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('AC6.2: logs and swallows authorization denial', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockHealthKit.ensureAuthorized.mockResolvedValueOnce('denied');

    const summary: SessionCompleteSummary = {
      startMs: 1609459200000,
      endMs: 1609462800000,
      exercisesCompleted: 5,
      setsLogged: 15,
      loggedSets: [],
    };

    await expect(saveWorkout(summary, mockHealthKit)).resolves.not.toThrow();
    expect(mockHealthKit.saveWorkoutSample).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('AC6.1: calls ensureAuthorized before saveWorkoutSample', async () => {
    const summary: SessionCompleteSummary = {
      startMs: 1609459200000,
      endMs: 1609462800000,
      exercisesCompleted: 5,
      setsLogged: 15,
      loggedSets: [],
    };

    const callOrder: string[] = [];
    mockHealthKit.ensureAuthorized.mockImplementation(async () => {
      callOrder.push('ensureAuthorized');
      return 'authorized';
    });
    mockHealthKit.saveWorkoutSample.mockImplementation(async () => {
      callOrder.push('saveWorkoutSample');
      return {};
    });

    await saveWorkout(summary, mockHealthKit);

    expect(callOrder).toEqual(['ensureAuthorized', 'saveWorkoutSample']);
  });
});
