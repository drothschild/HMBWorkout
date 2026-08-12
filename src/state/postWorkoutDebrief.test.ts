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

  it('C1.3: opens debrief with OpenAI-only key and valid workout', () => {
    // Mutation test: if the gate checks only anthropicKey, this fails
    const result = planPostWorkoutDebrief(finished, { openaiKey: 'sk-test' });
    expect(result).toEqual({
      kind: 'debrief',
      routineId: 'routine-1',
      sessionId: 'session-1',
    });
  });

  it('C1.4: opens nothing when both keys are empty', () => {
    // Mutation test: required negative case for no-key discrimination
    expect(planPostWorkoutDebrief(finished, { anthropicKey: '', openaiKey: '' })).toBeNull();
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

  describe('coach-onboarding.AC3.5: onboarding param mapping', () => {
    it('coach-onboarding.AC3.5 Success: onboarding param (string "1") yields onboarding mode', () => {
      const mode = aiCoachModeFromParams({ onboarding: '1' });
      expect(mode).toEqual({ kind: 'onboarding' });
    });

    it('coach-onboarding.AC3.5 Success: onboarding param (boolean true) yields onboarding mode', () => {
      const mode = aiCoachModeFromParams({ onboarding: true });
      expect(mode).toEqual({ kind: 'onboarding' });
    });

    it('coach-onboarding.AC3.5 Success: onboarding param takes priority over edit mode', () => {
      const mode = aiCoachModeFromParams({ onboarding: '1', routineId: 'routine-123' });
      expect(mode).toEqual({ kind: 'onboarding' });
    });

    it('coach-onboarding.AC3.5 Success: onboarding param takes priority over debrief params', () => {
      const mode = aiCoachModeFromParams({
        onboarding: '1',
        routineId: 'routine-123',
        debriefSessionId: 'session-456',
      });
      expect(mode).toEqual({ kind: 'onboarding' });
    });

    it('coach-onboarding.AC3.6 Failure: no onboarding param yields create mode', () => {
      const mode = aiCoachModeFromParams({});
      expect(mode).toEqual({ kind: 'create' });
    });

    it('coach-onboarding.AC3.6 Failure: routineId alone still yields edit mode (unchanged)', () => {
      const mode = aiCoachModeFromParams({ routineId: 'routine-123' });
      expect(mode).toEqual({ kind: 'edit', routineId: 'routine-123' });
    });

    it('M4 Failure: onboarding param (string "0") does NOT yield onboarding mode', () => {
      const mode = aiCoachModeFromParams({ onboarding: '0' } as any);
      expect(mode).not.toEqual({ kind: 'onboarding' });
      expect(mode).toEqual({ kind: 'create' });
    });

    it('M4 Failure: onboarding param (boolean false) does NOT yield onboarding mode', () => {
      const mode = aiCoachModeFromParams({ onboarding: false } as any);
      expect(mode).not.toEqual({ kind: 'onboarding' });
      expect(mode).toEqual({ kind: 'create' });
    });
  });
});

describe('DEBRIEF_OPENING_MESSAGE', () => {
  it('is the user turn that opens a debrief, so it is never blank', () => {
    expect(DEBRIEF_OPENING_MESSAGE.trim()).not.toBe('');
  });
});
