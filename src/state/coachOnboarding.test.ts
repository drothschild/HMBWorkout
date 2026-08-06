import type { BridgeSettings } from '@/state/settings';

import {
  shouldShowOnboardingCard,
  ONBOARDING_OPENING_MESSAGE,
  ONBOARDING_ROUTE,
  dismissOnboardingPatch,
} from './coachOnboarding';

describe('coach-onboarding.AC4.6: onboarding constants', () => {
  test('ONBOARDING_OPENING_MESSAGE is a non-empty string', () => {
    expect(typeof ONBOARDING_OPENING_MESSAGE).toBe('string');
    expect(ONBOARDING_OPENING_MESSAGE.length).toBeGreaterThan(0);
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
      profileGender: '',
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
      profileGender: '',
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
      profileGender: '',
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
      profileGender: '',
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
      profileGender: '',
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

    test('coach-onboarding.AC5.5 Success: the route carries the onboarding param', () => {
      // Without the param aiCoachModeFromParams returns create mode and the user
      // silently gets an ordinary chat instead of the interview — issue #189.
      expect(ONBOARDING_ROUTE).toContain('onboarding=1');
      expect(ONBOARDING_ROUTE.startsWith('/ai-coach')).toBe(true);
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
