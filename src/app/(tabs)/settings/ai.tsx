import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { getSettings, setSettings } from '@/state/settings';
import { ONBOARDING_ROUTE } from '@/state/coachOnboarding';

type AiSettingsPatch = Partial<{
  anthropicKey: string;
  aiGoals: string;
  aiEquipment: string;
  aiPersonality: string;
  profileAge: string;
  profileGender: string;
  profileExperience: string;
}>;

const AUTOSAVE_DELAY_MS = 500;

export default function AiCoachSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [anthropicKey, setAnthropicKey] = useState(() => getSettings().anthropicKey);
  const [aiGoals, setAiGoals] = useState(() => getSettings().aiGoals);
  const [aiEquipment, setAiEquipment] = useState(() => getSettings().aiEquipment);
  const [aiPersonality, setAiPersonality] = useState(() => getSettings().aiPersonality);
  const [profileAge, setProfileAge] = useState(() => getSettings().profileAge);
  const [profileGender, setProfileGender] = useState(() => getSettings().profileGender);
  const [profileExperience, setProfileExperience] = useState(() => getSettings().profileExperience);

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
      setProfileAge(settings.profileAge);
      setProfileGender(settings.profileGender);
      setProfileExperience(settings.profileExperience);
    }, [flush])
  );

  const textInputColor = theme.text;
  const placeholderColor = theme.textSecondary;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
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
        {/* This screen SCROLLS, and no longer fits on one screen by construction.
            It used to: the three free-text boxes took flex:1 and split the
            leftover space exactly. Phase 5 added three more label+input groups
            and a button row — roughly 260pt of fixed content — so the column now
            overflows the viewport on every phone (measured in yoga-layout: 752pt
            of content in a 482pt ScrollView on an iPhone SE, clean at 1x-3x
            Dynamic Type).
            What `minHeight: 88` on multilineInput actually buys: with the column
            overflowing, `flex: 1` never receives any free space to distribute, so
            the three free-text boxes fall back to their intrinsic single-line
            height — about 35pt, measured — on EVERY iPhone. They do not collapse
            to zero; an earlier version of this comment said they did, and anyone
            testing that claim would fail to reproduce it and reasonably delete
            the constant. The floor is what keeps them ~6 lines tall.
            Corollary from the same model: `flex: 1` on multilineInput is inert at
            phone sizes — the boxes sit at exactly minHeight and only grow on
            ~1000pt+ (iPad) layouts.
            The ScrollView earns its keep only when the keyboard is up:
            automaticallyAdjustKeyboardInsets insets the bottom and scrolls the
            focused field into view. A KeyboardAvoidingView was tried first and
            verified broken here — nested under the tab navigator's header and
            tab bar it shrank the column by only ~12%, leaving the bottom-most
            field stranded behind the keyboard. (Contrast session.tsx's
            KeyboardAvoidingView + MODAL_CARD_TOP_OFFSET fix for the same class
            of bug: that screen has no outer ScrollView to fall back to, and
            is a modal-presented route rather than nested under tab chrome, so
            the two screens' constraints — and fixes — genuinely differ.) */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.titleRow}>
            <ThemedText type="default" style={styles.title}>
              AI Coach
            </ThemedText>
            <ThemedText type="small" style={styles.caption}>
              Changes save automatically.
            </ThemedText>
          </View>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Anthropic API Key
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
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

          <ThemedView style={[styles.formGroup, styles.flexGroup]}>
            <ThemedText type="default" style={styles.label}>
              Your Goals
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. Build strength, stay mobile, 3 sessions/week"
              placeholderTextColor={placeholderColor}
              value={aiGoals}
              onChangeText={(value) => {
                setAiGoals(value);
                queueSave({ aiGoals: value });
              }}
              multiline
            />
          </ThemedView>

          <ThemedView style={[styles.formGroup, styles.flexGroup]}>
            <ThemedText type="default" style={styles.label}>
              Available Equipment
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. Dumbbells up to 50lb, pull-up bar, bands"
              placeholderTextColor={placeholderColor}
              value={aiEquipment}
              onChangeText={(value) => {
                setAiEquipment(value);
                queueSave({ aiEquipment: value });
              }}
              multiline
            />
          </ThemedView>

          <ThemedView style={[styles.formGroup, styles.flexGroup]}>
            <ThemedText type="default" style={styles.label}>
              Coaching Style
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. Direct and no-nonsense; celebrate PRs"
              placeholderTextColor={placeholderColor}
              value={aiPersonality}
              onChangeText={(value) => {
                setAiPersonality(value);
                queueSave({ aiPersonality: value });
              }}
              multiline
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Age
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. 41 or early 40s"
              placeholderTextColor={placeholderColor}
              value={profileAge}
              onChangeText={(value) => {
                setProfileAge(value);
                queueSave({ profileAge: value });
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Gender
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. Male, Female, or prefer not to say"
              placeholderTextColor={placeholderColor}
              value={profileGender}
              onChangeText={(value) => {
                setProfileGender(value);
                queueSave({ profileGender: value });
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Experience
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. Beginner, strong squat, terrible overhead"
              placeholderTextColor={placeholderColor}
              value={profileExperience}
              onChangeText={(value) => {
                setProfileExperience(value);
                queueSave({ profileExperience: value });
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ThemedView>

          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
              onPress={() => {
                // Flush before navigating. router.push leaves this screen
                // MOUNTED, so neither the unmount effect nor useFocusEffect
                // fires — unlike the back button at the top, which unmounts.
                // Without this, an edit made in the last 500ms is still sitting
                // in pendingRef: the interview starts blind to it, and worse,
                // when the user comes back useFocusEffect flushes that stale
                // patch OVER whatever the coach wrote during the conversation.
                flush();
                router.push(ONBOARDING_ROUTE);
              }}
            >
              <ThemedText style={styles.startButtonText}>Start/Redo</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  // The tabs navigator already draws the header and tab bar and reserves the
  // safe area for both, so screens inside it must not wrap in a SafeAreaView:
  // doing so re-applied the top inset under an existing header and cost ~125pt.
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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
    color: ActionButtonColor.secondary,
    fontWeight: '500',
  },
  scroll: {
    width: '100%',
  },
  content: {
    flexGrow: 1,
    alignItems: 'stretch',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  title: {
    fontWeight: '600',
  },
  caption: {
    opacity: 0.6,
    flexShrink: 1,
  },
  formGroup: {
    gap: Spacing.one,
  },
  flexGroup: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    // borderColor is theme-resolved inline
    borderRadius: 6,
    fontSize: 14,
  },
  multilineInput: {
    flex: 1,
    // Floor for the free-text boxes. Without it they render at their intrinsic
    // single-line height (~35pt, measured in yoga-layout) on every phone-sized
    // viewport, because the column overflows and `flex: 1` gets no free space.
    minHeight: 88,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  startButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: 6,
    backgroundColor: ActionButtonColor.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  startButtonPressed: {
    opacity: 0.6,
  },
  startButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});
