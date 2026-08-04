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

    it('reuses the same sound instance on subsequent calls', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();
      await executor.playMinuteMilestone();

      expect(mockApis.createSoundInstance).toHaveBeenCalledTimes(1);
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
});
