import { createTimerSoundExecutor, TimerSoundAPIs, playBeepSequence } from './timerSounds';

describe('timerSounds', () => {
  let mockApis: TimerSoundAPIs;

  beforeEach(() => {
    mockApis = {
      playOne: jest.fn().mockResolvedValue(undefined),
      delay: jest.fn().mockResolvedValue(undefined),
      recordWarning: jest.fn(),
    };
  });

  describe('playMinuteMilestone', () => {
    it('plays 2 beeps on call', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();

      // Minute milestone: 2 beeps
      expect(mockApis.playOne).toHaveBeenCalledTimes(2);
    });

    it('calls each pattern once per call', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();
      await executor.playMinuteMilestone();

      // Each call plays 2 beeps independently
      expect(mockApis.playOne).toHaveBeenCalledTimes(4);
    });

    it('logs and continues if a beep fails', async () => {
      (mockApis.playOne as jest.Mock).mockRejectedValueOnce(new Error('Play failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playMinuteMilestone();

      // Should still attempt the second beep despite first one failing
      expect(mockApis.playOne).toHaveBeenCalledTimes(2);
      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play beep 1/2:',
        expect.any(Error)
      );
    });
  });

  describe('playStopwatchZero', () => {
    it('plays 3 beeps on call', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playStopwatchZero();

      // Stopwatch zero: 3 beeps
      expect(mockApis.playOne).toHaveBeenCalledTimes(3);
    });

    it('logs and continues if a beep fails', async () => {
      (mockApis.playOne as jest.Mock).mockRejectedValueOnce(new Error('Play failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playStopwatchZero();

      // Should attempt all 3 beeps despite first one failing
      expect(mockApis.playOne).toHaveBeenCalledTimes(3);
      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play beep 1/3:',
        expect.any(Error)
      );
    });
  });

  describe('playRestComplete', () => {
    it('plays 4 beeps on call', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playRestComplete();

      // Rest complete: 4 beeps
      expect(mockApis.playOne).toHaveBeenCalledTimes(4);
    });

    it('logs and continues if a beep fails', async () => {
      (mockApis.playOne as jest.Mock).mockRejectedValueOnce(new Error('Play failed'));
      const executor = createTimerSoundExecutor(mockApis);

      await executor.playRestComplete();

      // Should attempt all 4 beeps despite first one failing
      expect(mockApis.playOne).toHaveBeenCalledTimes(4);
      expect(mockApis.recordWarning).toHaveBeenCalledWith(
        'Failed to play beep 1/4:',
        expect.any(Error)
      );
    });
  });

  describe('pattern beep counts', () => {
    it('generates a minute milestone sound with two beeps', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();

      expect(mockApis.playOne).toHaveBeenCalledTimes(2);
    });

    it('generates a stopwatch zero sound with three beeps', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playStopwatchZero();

      expect(mockApis.playOne).toHaveBeenCalledTimes(3);
    });

    it('generates a rest complete sound with four beeps', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playRestComplete();

      expect(mockApis.playOne).toHaveBeenCalledTimes(4);
    });
  });

  describe('pattern timing', () => {
    it('plays delays between beeps for minute milestone', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playMinuteMilestone();

      // 2 beeps = 1 delay between them
      expect(mockApis.delay).toHaveBeenCalledTimes(1);
      expect(mockApis.delay).toHaveBeenCalledWith(150);
    });

    it('plays delays between beeps for stopwatch zero', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playStopwatchZero();

      // 3 beeps = 2 delays between them
      expect(mockApis.delay).toHaveBeenCalledTimes(2);
      expect(mockApis.delay).toHaveBeenCalledWith(150);
    });

    it('plays delays between beeps for rest complete', async () => {
      const executor = createTimerSoundExecutor(mockApis);
      await executor.playRestComplete();

      // 4 beeps = 3 delays between them
      expect(mockApis.delay).toHaveBeenCalledTimes(3);
      expect(mockApis.delay).toHaveBeenCalledWith(150);
    });
  });

  describe('playBeepSequence', () => {
    let playOneMock: jest.Mock;
    let delayMock: jest.Mock;

    beforeEach(() => {
      playOneMock = jest.fn().mockResolvedValue(undefined);
      delayMock = jest.fn().mockResolvedValue(undefined);
    });

    it('plays the correct number of beeps for minute milestone (2 beeps)', async () => {
      await playBeepSequence(2, playOneMock, delayMock);

      // Must call playOne exactly 2 times, not 1
      expect(playOneMock).toHaveBeenCalledTimes(2);
    });

    it('plays the correct number of beeps for stopwatch zero (3 beeps)', async () => {
      await playBeepSequence(3, playOneMock, delayMock);

      expect(playOneMock).toHaveBeenCalledTimes(3);
    });

    it('plays the correct number of beeps for rest complete (4 beeps)', async () => {
      await playBeepSequence(4, playOneMock, delayMock);

      expect(playOneMock).toHaveBeenCalledTimes(4);
    });

    it('includes delays between beeps but not after the last beep', async () => {
      await playBeepSequence(3, playOneMock, delayMock);

      // 3 beeps = 2 gaps between them (gap after beep 1, gap after beep 2, no gap after beep 3)
      expect(delayMock).toHaveBeenCalledTimes(2);
      expect(delayMock).toHaveBeenCalledWith(150);
    });

    it('calls delay with 150ms between beeps', async () => {
      await playBeepSequence(2, playOneMock, delayMock);

      // For 2 beeps, there's 1 delay
      expect(delayMock).toHaveBeenCalledTimes(1);
      expect(delayMock).toHaveBeenCalledWith(150);
    });

    it('logs and continues if a beep fails', async () => {
      const recordWarning = jest.fn();
      playOneMock.mockRejectedValueOnce(new Error('Beep 1 failed'));

      await playBeepSequence(3, playOneMock, delayMock, recordWarning);

      // Should still attempt all 3 beeps despite first one failing
      expect(playOneMock).toHaveBeenCalledTimes(3);
      expect(recordWarning).toHaveBeenCalledWith(
        'Failed to play beep 1/3:',
        expect.any(Error)
      );
    });

    it('mutation test: must fail if beep count collapses to 1', async () => {
      // This test explicitly verifies that if playBeepSequence is broken
      // to always play 1 beep instead of the requested count, this test fails.
      // This catches the exact regression the card is designed to prevent.
      const sequence4 = playBeepSequence(4, playOneMock, delayMock);
      await sequence4;

      // If beep count silently collapsed to 1 (the bug), this assertion catches it
      expect(playOneMock).toHaveBeenCalledTimes(4);
      expect(delayMock).toHaveBeenCalledTimes(3); // 3 gaps for 4 beeps
    });
  });
});
