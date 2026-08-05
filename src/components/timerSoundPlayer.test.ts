/**
 * Test for timerSoundPlayer.ts
 *
 * Critical invariant: playRestCompleteSound() must suspend at its first await
 * before any native call. This prevents the engine dispatch from being delayed
 * by audio initialization work.
 *
 * PR #103 Critical: A workout stranded at 0:00 because a callback awaited
 * beeps before dispatching. This test pins that invariant.
 */

import { playRestCompleteSound } from './timerSoundPlayer';

// Track calls to setAudioModeAsync
let setAudioModeAsyncCalled = false;

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => {
    return {
      seekTo: jest.fn().mockResolvedValue(undefined),
      play: jest.fn(),
    };
  }),
  setAudioModeAsync: jest.fn(async () => {
    setAudioModeAsyncCalled = true;
  }),
}));

describe('timerSoundPlayer', () => {
  beforeEach(() => {
    setAudioModeAsyncCalled = false;
    jest.clearAllMocks();
  });

  test('playRestCompleteSound() suspends at first await before calling native audio APIs', async () => {
    // I1 Fix: Structural deferral ensures the engine dispatch completes before
    // any native call. Start the sound playback but don't await yet.
    const soundPromise = playRestCompleteSound();

    // Synchronously after calling playRestCompleteSound(), the native API
    // setAudioModeAsync must NOT have been called. The I1 Fix uses
    // Promise.resolve().then(...) to defer the native work, so the dispatch
    // can complete while this promise is still pending.
    expect(setAudioModeAsyncCalled).toBe(false);

    // Now await the promise. This allows the microtask queue to run,
    // which triggers the deferred setAudioModeAsync call.
    await soundPromise;

    // After awaiting, the native call should have been made.
    expect(setAudioModeAsyncCalled).toBe(true);
  });
});
