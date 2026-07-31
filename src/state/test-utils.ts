/**
 * Test utilities for state tests.
 * Shared fixtures and helpers to avoid duplication.
 */

import type { SessionState, SessionPhase } from '@/engine/types';

/**
 * Create a minimal SessionState with optional phase override.
 * Used by multiple test suites (canStartSession, routineStartMode, todayViewState).
 */
export function mockSessionState(phase: SessionPhase): SessionState {
  return {
    sessionId: 'test-session',
    routineId: 'test-routine',
    phase,
    exerciseIndex: 0,
    setIndex: 0,
    loggedSets: [],
    startedAtMs: 0,
    entries: [],
  };
}
