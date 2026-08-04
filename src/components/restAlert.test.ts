/**
 * Pins the two properties that make a finished rest reach the athlete on a
 * silenced phone. Both are one-token settings that read as harmless and are
 * not: flipping either silently removes the only signal on that path.
 *
 * These are testable at all only because PR #113 added `components` to
 * jest's testMatch — before that, this file's behaviour was unpinnable.
 *
 * KNOWN GAP, stated rather than glossed. Mutation-tested both changes:
 *   playsInSilentMode: true -> false   CAUGHT (1 test fails)
 *   delete RestCountdown's vibrateAtRestComplete() call   SURVIVES
 *
 * The second survives because these tests exercise `vibrateAtRestComplete`
 * directly, not the *wiring* in RestCountdown — and RestCountdown is a React
 * component, which the node jest project cannot render (react-native is
 * untransformed ESM here; note the mock below). So "the buzz helper works" is
 * pinned, "the buzz is actually called on rest completion" is not.
 *
 * Closing it properly means the move PR #107 made for the beep loop: lift the
 * composition into a pure module under src/state behind injected deps, leaving
 * only glue in the component. Filed as a follow-up rather than done here,
 * because restructuring this component is what introduced PR #103's
 * workout-stranding Critical, and this change is meant to be small.
 */
// react-native is untransformed ESM in the node jest project, so it must be
// mocked rather than imported — adding `components` to testMatch (PR #113)
// makes these files *reachable*, it does not make RN itself loadable.
const vibrate = jest.fn();
jest.mock('react-native', () => ({ Vibration: { vibrate } }));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    seekTo: jest.fn().mockResolvedValue(undefined),
    play: jest.fn(),
  })),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: each
   module must load *after* its mocks are installed, so these cannot be
   hoisted static imports. */
describe('rest-complete alert', () => {
  it('plays through the mute switch, and mixes rather than interrupting', async () => {
    const { setAudioModeAsync } = require('expo-audio');
    const { createDefaultTimerSoundAPIs } = require('./timerSoundPlayer');

    await createDefaultTimerSoundAPIs().prepare();

    // playsInSilentMode:true is the whole point — a rest timer is an alarm,
    // and honouring the mute switch made the feature look broken in a gym.
    // mixWithOthers keeps it polite against the athlete's music.
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
  });

  it('buzzes on rest completion — the signal that survives a silenced phone', () => {
    vibrate.mockClear();
    const { vibrateAtRestComplete } = require('./minuteVibration');

    vibrateAtRestComplete();

    // The rest path had no non-audio signal at all before this. If the buzz
    // goes away, a muted phone with the app open gets nothing.
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('swallows a vibration failure rather than taking down the workout', () => {
    vibrate.mockImplementationOnce(() => {
      throw new Error('no haptics');
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { vibrateAtRestComplete } = require('./minuteVibration');

    expect(() => vibrateAtRestComplete()).not.toThrow();

    errSpy.mockRestore();
  });
});
