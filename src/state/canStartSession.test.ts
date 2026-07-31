import { canStartSession } from './canStartSession';
import { mockSessionState } from './test-helpers';

describe('canStartSession', () => {
  it('returns true when sessionState is null (no active session)', () => {
    expect(canStartSession(null)).toBe(true);
  });

  it('returns true when sessionState is done (workout finished)', () => {
    expect(canStartSession(mockSessionState('done'))).toBe(true);
  });

  it('returns false when sessionState is in warmup phase', () => {
    expect(canStartSession(mockSessionState('warmup'))).toBe(false);
  });

  it('returns false when sessionState is in working phase', () => {
    expect(canStartSession(mockSessionState('working'))).toBe(false);
  });

  it('returns false when sessionState is in resting phase', () => {
    expect(canStartSession(mockSessionState('resting'))).toBe(false);
  });

  it('returns false when sessionState is in stretching phase', () => {
    expect(canStartSession(mockSessionState('stretching'))).toBe(false);
  });

  it('returns false when sessionState is in paused phase', () => {
    expect(canStartSession(mockSessionState('paused'))).toBe(false);
  });
});
