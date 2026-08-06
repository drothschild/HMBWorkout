import React, { useState } from 'react';
import { View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { getAiChatStore } from '@/state/aiChatStore';
import { shouldShowOnboardingCard } from '@/state/coachOnboarding';
import { getSettings, setSettings } from '@/state/settings';

/**
 * A dismissible card component that invites users into the onboarding conversation
 * when they first have an API key configured.
 *
 * - Shows only when onboardingState is 'unseen' and a key is present
 * - Dismiss button writes 'dismissed' to settings
 * - Start button opens the onboarding conversation and navigates
 * - Renders above the main content (resume button, error, loading) without replacing them
 */
export function OnboardingCard(): React.ReactElement | null {
  const settings = getSettings();
  const router = useRouter();
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);

  // Hide if user dismissed it in this session, or if settings show it's no longer unseen
  if (dismissed || !shouldShowOnboardingCard(settings)) {
    return null;
  }

  const handleDismiss = () => {
    setSettings({ onboardingState: 'dismissed' });
    setDismissed(true);
  };

  const handleStart = async () => {
    const store = getAiChatStore();
    await store.getState().openOnboarding();
    router.push('/ai-coach?onboarding=1');
  };

  return (
    <ThemedView style={[styles.card, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="subtitle" style={styles.title}>
        Let's Get Started
      </ThemedText>
      <ThemedText style={styles.body}>
        Your coach can give better advice when they know more about you. Let's have a quick
        conversation.
      </ThemedText>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [
            styles.startButton,
            { backgroundColor: ActionButtonColor.primary },
            pressed && styles.pressed,
          ]}
          onPress={handleStart}
        >
          <ThemedText style={styles.startButtonText}>Start</ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.dismissButton,
            { borderColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}
          onPress={handleDismiss}
        >
          <ThemedText style={styles.dismissButtonText}>Dismiss</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.two,
  },
  title: {
    fontWeight: '600',
    marginBottom: Spacing.one,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.85,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  startButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  dismissButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontWeight: '600',
    fontSize: 14,
  },
  pressed: {
    opacity: 0.6,
  },
} as const);
