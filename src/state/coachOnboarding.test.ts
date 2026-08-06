import type { BridgeSettings } from '@/state/settings';

// These will be imported from the actual module once created
import { shouldShowOnboardingCard, ONBOARDING_OPENING_MESSAGE } from './coachOnboarding';

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
});
