import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { WarningColors, WARNING_SURFACE_CSS } from '@/theme/warningColors';
import { useTheme } from '@/hooks/use-theme';
import { useIsDark } from '@/hooks/use-is-dark';
import {
  AI_PROVIDERS,
  PROVIDER_LABEL,
  apiKeyPatch,
  crossProviderKeyWarning,
  initialProviderSelection,
  keyPlaceholder,
  modelSelectionPatch,
  providerSwitchPlan,
  storedKeyFor,
} from '@/state/aiProviderSettings';
import { AI_MODEL_CHOICES, resolveModels } from '@/ai/provider/models';
import { getSettings, setSettings } from '@/state/settings';
import type { AiProvider } from '@/ai/provider/types';
import type { BridgeSettings } from '@/state/settings';

const AUTOSAVE_DELAY_MS = 500;

export default function AiProviderSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();

  // DISPLAY ONLY. Deriving the initial value must NOT write it — installs that
  // predate this screen have aiProvider undefined and resolve implicitly in
  // factory.ts. See AC3.2.
  const [provider, setProvider] = useState(() => initialProviderSelection(getSettings()));
  const [keyText, setKeyText] = useState(() => storedKeyFor(getSettings(), provider));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatModelPickerOpen, setChatModelPickerOpen] = useState(false);
  const [oneShotModelPickerOpen, setOneShotModelPickerOpen] = useState(false);

  const pendingRef = useRef<Partial<BridgeSettings>>({});
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

  const queueSave = (patch: Partial<BridgeSettings>) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  useEffect(() => () => flush(), [flush]);

  // Re-sync from settings on focus to pick up external changes. Flush pending
  // edits first so any unflushed changes get saved before re-reading, preventing
  // stale snapshots from reverting approved changes.
  useFocusEffect(
    useCallback(() => {
      flush();
      const settings = getSettings();
      const currentProvider = initialProviderSelection(settings);
      setProvider(currentProvider);
      setKeyText(storedKeyFor(settings, currentProvider));
    }, [flush])
  );

  function applySwitch(next: AiProvider) {
    const plan = providerSwitchPlan(getSettings(), next);

    const commit = () => {
      // CRITICAL: go through queueSave + flush, never setSettings directly.
      //
      // queueSave merges { ...pendingRef.current, ...patch }, so the patch's
      // cleared key OVERWRITES a key the user typed moments ago and has not been
      // flushed yet. A bare setSettings(plan.patch) leaves that pending patch
      // alive behind a live 500ms timer, which then fires and RESTORES the key
      // the user just destroyed — persisted, and invisible, because the field on
      // screen is empty. See AC3.3 and AC3.9.
      queueSave(plan.patch);
      flush();

      setProvider(next);
      setKeyText(storedKeyFor(getSettings(), next));
      setPickerOpen(false);
    };

    if (!plan.needsConfirmation) {
      commit();
      return;
    }

    Alert.alert(
      `Switch to ${PROVIDER_LABEL[next]}?`,
      `Your saved ${PROVIDER_LABEL[plan.outgoing]} API key will be removed. You'll need to paste it again to switch back.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPickerOpen(false) },
        { text: 'Switch', style: 'destructive', onPress: commit },
      ]
    );
  }

  function applyModelSelection(field: 'chat' | 'oneShot', modelId: string) {
    const patch = modelSelectionPatch(getSettings(), provider, field, modelId);
    queueSave(patch);
    flush();

    if (field === 'chat') {
      setChatModelPickerOpen(false);
    } else {
      setOneShotModelPickerOpen(false);
    }
  }

  const textInputColor = theme.text;
  const placeholderColor = theme.textSecondary;
  const warning = crossProviderKeyWarning(provider, keyText);
  const isDark = useIsDark();
  const models = resolveModels(provider, getSettings().aiModel);
  const availableModels = AI_MODEL_CHOICES[provider];

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

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.titleRow}>
            <ThemedText type="default" style={styles.title}>
              AI Provider
            </ThemedText>
            <ThemedText type="small" style={styles.caption}>
              Changes save automatically.
            </ThemedText>
          </View>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Provider
            </ThemedText>
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={[styles.picker, { borderColor: theme.backgroundSelected }]}
            >
              <ThemedText type="default" style={styles.pickerText}>
                {PROVIDER_LABEL[provider]}
              </ThemedText>
              <ThemedText type="default" style={styles.chevron}>
                ›
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              {PROVIDER_LABEL[provider]} API Key
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder={keyPlaceholder(provider)}
              placeholderTextColor={placeholderColor}
              value={keyText}
              onChangeText={(value) => {
                setKeyText(value);
                queueSave(apiKeyPatch(provider, value));
              }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Coach Model
            </ThemedText>
            <Pressable
              onPress={() => setChatModelPickerOpen(true)}
              style={[styles.picker, { borderColor: theme.backgroundSelected }]}
            >
              <ThemedText type="default" style={styles.pickerText}>
                {models.chat}
              </ThemedText>
              <ThemedText type="default" style={styles.chevron}>
                ›
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Quick Replies Model
            </ThemedText>
            <Pressable
              onPress={() => setOneShotModelPickerOpen(true)}
              style={[styles.picker, { borderColor: theme.backgroundSelected }]}
            >
              <ThemedText type="default" style={styles.pickerText}>
                {models.oneShot}
              </ThemedText>
              <ThemedText type="default" style={styles.chevron}>
                ›
              </ThemedText>
            </Pressable>
          </ThemedView>

          {warning && (
            <ThemedView style={[styles.formGroup, styles.warningGroup]}>
              <ThemedText style={[styles.warningText, { color: isDark ? WarningColors.textDark : WarningColors.textLight }]}>
                {warning}
              </ThemedText>
            </ThemedView>
          )}
        </ScrollView>
      </View>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            {AI_PROVIDERS.map((p) => (
              <Pressable
                key={p}
                onPress={() => applySwitch(p)}
                style={[styles.pickerOption, { backgroundColor: theme.backgroundElement }]}
              >
                <ThemedText type="default" style={styles.pickerOptionText}>
                  {PROVIDER_LABEL[p]}
                </ThemedText>
                {p === provider && (
                  <ThemedText type="default" style={styles.pickerOptionCheck}>
                    ✓
                  </ThemedText>
                )}
              </Pressable>
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerOpen(false)}
              style={styles.cancel}
            >
              <ThemedText>Cancel</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={chatModelPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setChatModelPickerOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            {availableModels.map((modelId) => (
              <Pressable
                key={modelId}
                onPress={() => applyModelSelection('chat', modelId)}
                style={[styles.pickerOption, { backgroundColor: theme.backgroundElement }]}
              >
                <ThemedText type="default" style={styles.pickerOptionText}>
                  {modelId}
                </ThemedText>
                {modelId === models.chat && (
                  <ThemedText type="default" style={styles.pickerOptionCheck}>
                    ✓
                  </ThemedText>
                )}
              </Pressable>
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={() => setChatModelPickerOpen(false)}
              style={styles.cancel}
            >
              <ThemedText>Cancel</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={oneShotModelPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setOneShotModelPickerOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            {availableModels.map((modelId) => (
              <Pressable
                key={modelId}
                onPress={() => applyModelSelection('oneShot', modelId)}
                style={[styles.pickerOption, { backgroundColor: theme.backgroundElement }]}
              >
                <ThemedText type="default" style={styles.pickerOptionText}>
                  {modelId}
                </ThemedText>
                {modelId === models.oneShot && (
                  <ThemedText type="default" style={styles.pickerOptionCheck}>
                    ✓
                  </ThemedText>
                )}
              </Pressable>
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={() => setOneShotModelPickerOpen(false)}
              style={styles.cancel}
            >
              <ThemedText>Cancel</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  headerContainer: {
    marginBottom: Spacing.three,
  },
  backButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.one,
    borderRadius: 6,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonText: {
    color: ActionButtonColor.secondary,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    width: '100%',
    flexGrow: 1,
  },
  titleRow: {
    gap: Spacing.one,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  caption: {
    opacity: 0.7,
  },
  formGroup: {
    gap: Spacing.one,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  picker: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerText: {
    fontSize: 14,
  },
  chevron: {
    fontSize: 24,
    lineHeight: 28,
    opacity: 0.4,
    paddingLeft: Spacing.two,
  },
  warningGroup: {
    backgroundColor: WARNING_SURFACE_CSS,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFC107',
  },
  warningText: {
    fontSize: 13,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    gap: Spacing.two,
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  pickerOptionText: {
    fontSize: 16,
  },
  pickerOptionCheck: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
