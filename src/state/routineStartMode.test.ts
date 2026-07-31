import { routineStartMode } from './routineStartMode';
import { mockSessionState } from './test-utils';

describe('routineStartMode', () => {

  it('resumes when a session is in-progress, even if this routine is startable', () => {
    const result = routineStartMode({ sessionState: mockSessionState('working'), isRoutineStartable: true });

    expect(result).toEqual({ kind: 'resume' });
  });

  it('resumes when a session is in-progress and this routine has no exercises', () => {
    // An active session always wins over this routine's own startability —
    // resuming the in-progress workout is the only honest option to offer.
    const result = routineStartMode({ sessionState: mockSessionState('warmup'), isRoutineStartable: false });

    expect(result).toEqual({ kind: 'resume' });
  });

  it('offers an enabled start when no session is active and this routine is startable', () => {
    const result = routineStartMode({ sessionState: null, isRoutineStartable: true });

    expect(result).toEqual({ kind: 'start', enabled: true });
  });

  it('offers a disabled start when no session is active and this routine has no exercises', () => {
    const result = routineStartMode({ sessionState: null, isRoutineStartable: false });

    expect(result).toEqual({ kind: 'start', enabled: false });
  });

  it('offers an enabled start when a workout is done, even if this routine is startable', () => {
    const result = routineStartMode({ sessionState: mockSessionState('done'), isRoutineStartable: true });

    expect(result).toEqual({ kind: 'start', enabled: true });
  });

  it('offers a disabled start when a workout is done and this routine has no exercises', () => {
    const result = routineStartMode({ sessionState: mockSessionState('done'), isRoutineStartable: false });

    expect(result).toEqual({ kind: 'start', enabled: false });
  });
});
