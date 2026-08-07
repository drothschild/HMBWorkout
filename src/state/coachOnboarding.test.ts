import type { BridgeSettings } from '@/state/settings';

import { aiCoachModeFromParams } from './postWorkoutDebrief';
import {
  shouldShowOnboardingCard,
  ONBOARDING_OPENING_MESSAGE,
  ONBOARDING_ROUTE,
  dismissOnboardingPatch,
  optOutPatch,
} from './coachOnboarding';

describe('coach-onboarding.AC4.6: onboarding constants', () => {
  test('ONBOARDING_OPENING_MESSAGE is a non-empty string', () => {
    expect(typeof ONBOARDING_OPENING_MESSAGE).toBe('string');
    // .trim() — a whitespace-only message survived the bare length check,
    // and would reach the wire as an empty user turn.
    expect(ONBOARDING_OPENING_MESSAGE.trim().length).toBeGreaterThan(0);
  });

  test('shouldShowOnboardingCard: true when onboardingState is unseen and key present', () => {
    const settings: BridgeSettings = {
      baseUrl: '',
      token: '',
      anthropicKey: 'sk-ant-test',
      aiGoals: '',
      aiEquipment: '',
      aiPersonality: '',
      profileAge: '',
      profileExperience: '',
      onboardingState: 'unseen',
    };
    expect(shouldShowOnboardingCard(settings)).toBe(true);
  });

  test('shouldShowOnboardingCard: false when onboardingState is dismissed', () => {
    const settings: BridgeSettings = {
      baseUrl: '',
      token: '',
      anthropicKey: 'sk-ant-test',
      aiGoals: '',
      aiEquipment: '',
      aiPersonality: '',
      profileAge: '',
      profileExperience: '',
      onboardingState: 'dismissed',
    };
    expect(shouldShowOnboardingCard(settings)).toBe(false);
  });

  test('shouldShowOnboardingCard: false when onboardingState is completed', () => {
    const settings: BridgeSettings = {
      baseUrl: '',
      token: '',
      anthropicKey: 'sk-ant-test',
      aiGoals: '',
      aiEquipment: '',
      aiPersonality: '',
      profileAge: '',
      profileExperience: '',
      onboardingState: 'completed',
    };
    expect(shouldShowOnboardingCard(settings)).toBe(false);
  });

  test('shouldShowOnboardingCard: false when no key present', () => {
    const settings: BridgeSettings = {
      baseUrl: '',
      token: '',
      anthropicKey: '',
      aiGoals: '',
      aiEquipment: '',
      aiPersonality: '',
      profileAge: '',
      profileExperience: '',
      onboardingState: 'unseen',
    };
    expect(shouldShowOnboardingCard(settings)).toBe(false);
  });

  test('shouldShowOnboardingCard: false when key is whitespace only', () => {
    const settings: BridgeSettings = {
      baseUrl: '',
      token: '',
      anthropicKey: '   ',
      aiGoals: '',
      aiEquipment: '',
      aiPersonality: '',
      profileAge: '',
      profileExperience: '',
      onboardingState: 'unseen',
    };
    expect(shouldShowOnboardingCard(settings)).toBe(false);
  });

  describe('coach-onboarding: the decisions the screens delegate here', () => {
    // src/app has no jest coverage, so anything decided inside a screen is
    // decided where no suite can see it. These are the pieces that can live in
    // the state layer, so they do.

    test('coach-onboarding.AC5.2 Success: the dismiss patch turns the card off, and it stays off', () => {
      const settings = {
        anthropicKey: 'sk-ant-test',
        onboardingState: 'unseen',
      } as unknown as Parameters<typeof shouldShowOnboardingCard>[0];

      expect(shouldShowOnboardingCard(settings)).toBe(true);

      const after = { ...settings, ...dismissOnboardingPatch() };
      expect(after.onboardingState).toBe('dismissed');
      expect(shouldShowOnboardingCard(after)).toBe(false);
    });

    test('coach-onboarding.AC5.2 Success: dismissing writes only onboardingState', () => {
      // A patch that carried anything else would blank a real profile field,
      // since setSettings spreads the patch over the cache.
      expect(Object.keys(dismissOnboardingPatch())).toEqual(['onboardingState']);
    });

    test('coach-onboarding.AC5.5 Success: the route round-trips to onboarding mode', () => {
      // Asserts the MECHANISM, not two substrings of the literal. The previous
      // version (`toContain('onboarding=1')` + `startsWith('/ai-coach')`) was
      // shown by review to survive both `onboarding=10` and `/ai-coachX` — so it
      // would have stayed green through the exact bug it names, which is #189:
      // the param never reaching aiCoachModeFromParams and the user silently
      // getting an ordinary chat instead of the interview.
      const [path, query] = ONBOARDING_ROUTE.split('?');
      expect(path).toBe('/ai-coach');

      const params = Object.fromEntries(new URLSearchParams(query));
      const mode = aiCoachModeFromParams(params as Parameters<typeof aiCoachModeFromParams>[0]);
      expect(mode).toEqual({ kind: 'onboarding' });
    });

    test('coach-onboarding.AC5.5 Success: onboarding wins over a routineId in the same params', () => {
      const mode = aiCoachModeFromParams({ onboarding: '1', routineId: 'routine-1' });
      expect(mode).toEqual({ kind: 'onboarding' });
    });

    test('coach-onboarding.AC5.6 Success: opting out does not walk completed backwards', () => {
      // If the coach already recorded something this session the state is
      // 'completed'; writing 'dismissed' over it would move the lifecycle
      // backwards. Nothing reads 'completed' today, so this is state-machine
      // correctness rather than a live bug — but the tri-state is documented as
      // a lifecycle and a future reader of it would be misled.
      const completed = { onboardingState: 'completed' } as unknown as Parameters<typeof optOutPatch>[0];
      expect(optOutPatch(completed)).toEqual({});

      for (const state of ['unseen', 'dismissed'] as const) {
        const settings = { onboardingState: state } as unknown as Parameters<typeof optOutPatch>[0];
        expect(optOutPatch(settings)).toEqual({ onboardingState: 'dismissed' });
      }
    });

    test('coach-onboarding.AC7.3 Failure: with no key the card is absent whatever the state', () => {
      for (const onboardingState of ['unseen', 'dismissed', 'completed'] as const) {
        const settings = { anthropicKey: '', onboardingState } as unknown as Parameters<
          typeof shouldShowOnboardingCard
        >[0];
        expect(shouldShowOnboardingCard(settings)).toBe(false);
      }
    });
  });
});
