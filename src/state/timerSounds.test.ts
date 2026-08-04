import { createTimerSoundExecutor, TimerSoundAPIs } from './timerSounds';

describe('timerSounds', () => {
  let mockApis: TimerSoundAPIs;
  let mockSoundInstance: any;

  beforeEach(() => {
    mockSoundInstance = {
      loadAsync: jest.fn().mockResolvedValue(undefined),
      playAsync: jest.fn().mockResolvedValue(undefined),
      unloadAsync: jest.fn().mockResolvedValue(undefined),
    };

    mockApis = {
      createSoundInstance: jest.fn().mockReturnValue(mockSoundInstance),
      recordWarning: jest.fn(),
    };
  });

  describe('playMinuteMilestone', () => {
    it('creates a sound, loads and plays it on first call', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();

      expect(mockApis.createSoundInstance).toHaveBeenCalledTimes(1);
      expect(mockSoundInstance.loadAsync).toHaveBeenCalledTimes(1);
      expect(mockSoundInstance.playAsync).toHaveBeenCalledTimes(1);
    });

    it('creates a fresh sound instance for each call (not cached across calls)', async () => {
      // C3/C4 behavior: fresh wrapper per call, but underlying beepSound in timerSoundPlayer is cached
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();
      await executor.playMinuteMilestone();

      // Each call creates a fresh wrapper via createSoundInstance
      expect(mockApis.createSoundInstance).toHaveBeenCalledTimes(2);
      // Each wrapper calls playAsync once (not multiple beeps on the mock)
      expect(mockSoundInstance.playAsync).toHaveBeenCalledTimes(2);
    });

    it('logs and continues if loading fails', async () => {
      mockSoundInstance.loadAsync.mockRejectedValueOnce(new Error('Load failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playMinuteMilestone();

      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play minute milestone sound:',
        expect.any(Error)
      );
    });

    it('logs and continues if playback fails', async () => {
      mockSoundInstance.playAsync.mockRejectedValueOnce(new Error('Play failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playMinuteMilestone();

      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play minute milestone sound:',
        expect.any(Error)
      );
    });
  });

  describe('playStopwatchZero', () => {
    it('plays the zero sound', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playStopwatchZero();

      expect(mockApis.createSoundInstance).toHaveBeenCalledTimes(1);
      expect(mockSoundInstance.loadAsync).toHaveBeenCalledTimes(1);
      expect(mockSoundInstance.playAsync).toHaveBeenCalledTimes(1);
    });

    it('logs and continues if playback fails', async () => {
      mockSoundInstance.playAsync.mockRejectedValueOnce(new Error('Play failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playStopwatchZero();

      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play stopwatch zero sound:',
        expect.any(Error)
      );
    });
  });

  describe('playRestComplete', () => {
    it('plays the rest complete sound', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playRestComplete();

      expect(mockApis.createSoundInstance).toHaveBeenCalledTimes(1);
      expect(mockSoundInstance.loadAsync).toHaveBeenCalledTimes(1);
      expect(mockSoundInstance.playAsync).toHaveBeenCalledTimes(1);
    });

    it('logs and continues if playback fails', async () => {
      mockSoundInstance.playAsync.mockRejectedValueOnce(new Error('Play failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playRestComplete();

      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play rest complete sound:',
        expect.any(Error)
      );
    });
  });

  describe('sound generation', () => {
    it('generates a minute milestone sound with two beeps', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();

      // Verify that a sound instance was created with audio context configuration
      expect(mockApis.createSoundInstance).toHaveBeenCalled();
      const callArg = (mockApis.createSoundInstance as jest.Mock).mock.calls[0][0];
      expect(callArg).toEqual({
        tones: [
          { frequency: 800, durationMs: 100 },
          { frequency: 800, durationMs: 100 },
        ],
      });
    });

    it('generates a stopwatch zero sound with three beeps', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playStopwatchZero();

      const callArg = (mockApis.createSoundInstance as jest.Mock).mock.calls[0][0];
      expect(callArg).toEqual({
        tones: [
          { frequency: 800, durationMs: 150 },
          { frequency: 800, durationMs: 150 },
          { frequency: 800, durationMs: 150 },
        ],
      });
    });

    it('generates a rest complete sound with four beeps', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playRestComplete();

      const callArg = (mockApis.createSoundInstance as jest.Mock).mock.calls[0][0];
      expect(callArg).toEqual({
        tones: [
          { frequency: 800, durationMs: 100 },
          { frequency: 800, durationMs: 100 },
          { frequency: 800, durationMs: 100 },
          { frequency: 800, durationMs: 100 },
        ],
      });
    });
  });

  describe('I4 regression: different patterns on same executor', () => {
    it('must pass correct pattern config to each sound instance', async () => {
      // I4 Fix: This test catches the C3 caching bug where patterns would reuse
      // the first pattern's configuration. Each pattern must receive the correct
      // config with the right number of tones.
      const executor = createTimerSoundExecutor(mockApis);

      // Call three different patterns on the same executor
      await executor.playMinuteMilestone();
      await executor.playStopwatchZero();
      await executor.playRestComplete();

      // Each pattern should call createSoundInstance with correct tone count
      expect(mockApis.createSoundInstance).toHaveBeenCalledTimes(3);

      const calls = (mockApis.createSoundInstance as jest.Mock).mock.calls;

      // First call: minute milestone with 2 tones
      expect(calls[0][0].tones.length).toBe(2);

      // Second call: stopwatch zero with 3 tones
      expect(calls[1][0].tones.length).toBe(3);

      // Third call: rest complete with 4 tones
      expect(calls[2][0].tones.length).toBe(4);
    });
  });
});
