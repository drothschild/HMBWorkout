import type { DebriefMode } from '@/ai/contextBuilder';
import {
  DEBRIEF_OPENING_MESSAGE,
  aiCoachModeFromParams,
  debriefRouteParams,
  planPostWorkoutDebrief,
} from './postWorkoutDebrief';

describe('planPostWorkoutDebrief', () => {
  const finished = { routineId: 'routine-1', sessionId: 'session-1' };

  it('debriefs the routine and session the user just finished', () => {
    expect(planPostWorkoutDebrief(finished, { anthropicKey: 'sk-test' })).toEqual({
      kind: 'debrief',
      routineId: 'routine-1',
      sessionId: 'session-1',
    });
  });

  it('opens nothing when no Anthropic key is configured', () => {
    expect(planPostWorkoutDebrief(finished, { anthropicKey: '' })).toBeNull();
  });

  it('opens nothing when the configured key is only whitespace', () => {
    expect(planPostWorkoutDebrief(finished, { anthropicKey: '   ' })).toBeNull();
  });

  it('opens nothing without a routine to propose changes to', () => {
    expect(
      planPostWorkoutDebrief({ routineId: '', sessionId: 'session-1' }, { anthropicKey: 'sk-test' })
    ).toBeNull();
  });

  it('opens nothing without a finished session to summarise', () => {
    expect(
      planPostWorkoutDebrief({ routineId: 'routine-1', sessionId: '' }, { anthropicKey: 'sk-test' })
    ).toBeNull();
  });
});

describe('ai-coach route params', () => {
  it('carries a debrief mode through the route and back', () => {
    const mode: DebriefMode = { kind: 'debrief', routineId: 'routine-1', sessionId: 'session-1' };

    expect(aiCoachModeFromParams(debriefRouteParams(mode))).toEqual(mode);
  });

  it('reads a routine id on its own as edit mode', () => {
    expect(aiCoachModeFromParams({ routineId: 'routine-1' })).toEqual({
      kind: 'edit',
      routineId: 'routine-1',
    });
  });

  it('reads no params as create mode', () => {
    expect(aiCoachModeFromParams({})).toEqual({ kind: 'create' });
  });

  it('reads a debrief session without a routine as create mode', () => {
    expect(aiCoachModeFromParams({ debriefSessionId: 'session-1' })).toEqual({ kind: 'create' });
  });
});

describe('DEBRIEF_OPENING_MESSAGE', () => {
  it('is the user turn that opens a debrief, so it is never blank', () => {
    expect(DEBRIEF_OPENING_MESSAGE.trim()).not.toBe('');
  });
});
