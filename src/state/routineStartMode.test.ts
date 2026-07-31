import { routineStartMode } from './routineStartMode';

describe('routineStartMode', () => {
  it('resumes when a session is active, even if this routine is startable', () => {
    const result = routineStartMode({ hasActiveSession: true, isRoutineStartable: true });

    expect(result).toEqual({ kind: 'resume' });
  });

  it('resumes when a session is active and this routine has no exercises', () => {
    // An active session always wins over this routine's own startability —
    // resuming the in-progress workout is the only honest option to offer.
    const result = routineStartMode({ hasActiveSession: true, isRoutineStartable: false });

    expect(result).toEqual({ kind: 'resume' });
  });

  it('offers an enabled start when no session is active and this routine is startable', () => {
    const result = routineStartMode({ hasActiveSession: false, isRoutineStartable: true });

    expect(result).toEqual({ kind: 'start', enabled: true });
  });

  it('offers a disabled start when no session is active and this routine has no exercises', () => {
    const result = routineStartMode({ hasActiveSession: false, isRoutineStartable: false });

    expect(result).toEqual({ kind: 'start', enabled: false });
  });
});
