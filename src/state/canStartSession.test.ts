import { canStartSession } from './canStartSession';

describe('canStartSession', () => {
  it('is false when a session is already active', () => {
    expect(canStartSession(true)).toBe(false);
  });

  it('is true when no session is active', () => {
    expect(canStartSession(false)).toBe(true);
  });
});
