// pattern: Functional Core
import { shouldWarnBeforeLeaving } from './coachNavGuard';
import type { RoutineDraft, SettingsProposal } from '@/ai/draftSchema';

const DRAFT: RoutineDraft = {
  name: 'Leg Day',
  exercises: [
    {
      title: 'Back Squat',
      kind: 'strength',
      sets: [{ type: 'normal', reps: 5 }],
    },
  ],
};

const PROPOSAL: SettingsProposal = {
  goals: 'Get stronger',
};

describe('shouldWarnBeforeLeaving', () => {
  it('returns false when neither a draft nor a settings proposal is pending', () => {
    // The discriminating case: no dialog, no delay, when there is nothing to lose.
    expect(shouldWarnBeforeLeaving(null, null)).toBe(false);
  });

  it('returns true when a routine draft is pending', () => {
    expect(shouldWarnBeforeLeaving(DRAFT, null)).toBe(true);
  });

  it('returns true when a settings proposal is pending', () => {
    expect(shouldWarnBeforeLeaving(null, PROPOSAL)).toBe(true);
  });

  it('returns true when both a draft and a settings proposal are pending', () => {
    expect(shouldWarnBeforeLeaving(DRAFT, PROPOSAL)).toBe(true);
  });
});
