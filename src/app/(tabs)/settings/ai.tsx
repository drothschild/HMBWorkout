import { StyleSheet, TextInput, Pressable, ScrollView, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getSettings, setSettings } from '@/state/settings';

type AiSettingsPatch = Partial<{
  anthropicKey: string;
  aiGoals: string;
  aiEquipment: string;
  aiPersonality: string;
}>;

const AUTOSAVE_DELAY_MS = 500;

export default function AiCoachSettingsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const [anthropicKey, setAnthropicKey] = useState(() => getSettings().anthropicKey);
  const [aiGoals, setAiGoals] = useState(() => getSettings().aiGoals);
  const [aiEquipment, setAiEquipment] = useState(() => getSettings().aiEquipment);
  const [aiPersonality, setAiPersonality] = useState(() => getSettings().aiPersonality);

  const pendingRef = useRef<AiSettingsPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save: debounce keystrokes, and flush anything pending on unmount so
  // navigating away never loses an edit. flush is stable — it touches only
  // refs and the settings module, never render state.
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (Object.keys(pendingRef.current).length > 0) {
      setSettings(pendingRef.current);
      pendingRef.current = {};
    }
  }, []);

  const queueSave = (patch: AiSettingsPatch) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  useEffect(() => () => flush(), [flush]);

  // Re-sync from settings on focus to pick up external changes (e.g., approved
  // proposals from AI Coach). Flush pending edits first so any unflushed changes
  // get saved before re-reading, preventing stale snapshots from reverting approved changes.
  useFocusEffect(
    useCallback(() => {
      flush();
      const settings = getSettings();
      setAnthropicKey(settings.anthropicKey);
      setAiGoals(settings.aiGoals);
      setAiEquipment(settings.aiEquipment);
      setAiPersonality(settings.aiPersonality);
    }, [flush])
  );

  const textInputColor = colorScheme === 'dark' ? '#fff' : '#000';
  const placeholderColor = colorScheme === 'dark' ? '#999' : '#ccc';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/settings'))}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ThemedText type="default" style={styles.backButtonText}>
              ← Settings
            </ThemedText>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">AI Coach</ThemedText>
          <ThemedText type="small" style={styles.caption}>
            Changes save automatically.
          </ThemedText>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Anthropic API Key
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor }]}
              placeholder="sk-ant-..."
              placeholderTextColor={placeholderColor}
              value={anthropicKey}
              onChangeText={(value) => {
                setAnthropicKey(value);
                queueSave({ anthropicKey: value });
              }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Your Goals
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor }]}
              placeholder="e.g. Build strength, stay mobile, 3 sessions/week"
              placeholderTextColor={placeholderColor}
              value={aiGoals}
              onChangeText={(value) => {
                setAiGoals(value);
                queueSave({ aiGoals: value });
              }}
              multiline
              numberOfLines={4}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Available Equipment
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor }]}
              placeholder="e.g. Dumbbells up to 50lb, pull-up bar, bands"
              placeholderTextColor={placeholderColor}
              value={aiEquipment}
              onChangeText={(value) => {
                setAiEquipment(value);
                queueSave({ aiEquipment: value });
              }}
              multiline
              numberOfLines={4}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Coaching Style
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor }]}
              placeholder="e.g. Direct and no-nonsense; celebrate PRs"
              placeholderTextColor={placeholderColor}
              value={aiPersonality}
              onChangeText={(value) => {
                setAiPersonality(value);
                queueSave({ aiPersonality: value });
              }}
              multiline
              numberOfLines={4}
            />
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: Spacing.two,
    marginLeft: -Spacing.two,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonText: {
    color: '#007AFF',
    fontWeight: '500',
  },
  scroll: {
    width: '100%',
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  caption: {
    opacity: 0.6,
  },
  formGroup: {
    gap: Spacing.one,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
