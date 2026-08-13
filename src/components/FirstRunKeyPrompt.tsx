import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { WarningColors, WARNING_SURFACE_CSS } from '@/theme/warningColors';
import {
  AI_PROVIDERS,
  PROVIDER_LABEL,
  apiKeyPatch,
  keyPlaceholder,
} from '@/state/aiProviderSettings';
import { validateProviderKey, type KeyValidation } from '@/ai/provider/validateKey';
import { setSettings } from '@/state/settings';
import type { AiProvider } from '@/ai/provider/types';
import { ActionButtonColor } from '@/theme/actionButtonColors';

/**
 * First-run API key prompt (#168).
 *
 * Holds NO provider/key decisions: the provider list, labels, placeholder and
 * the storage patch all come from `aiProviderSettings`, and the key check from
 * `validateProviderKey`. Both are in jest's testMatch; this file is not.
 *
 * The key is tested but never blocks (#168's stated behaviour): a failed check
 * warns and still saves. Blocking would trap a user behind a flaky network or a
 * rate limit with no way to finish setup, and the same "warn, never block"
 * reasoning already governs `crossProviderKeyWarning`.
 *
 * Skipping writes nothing at all, which is what makes "ask again next launch"
 * true without any extra state: `shouldShowFirstRunKeyPrompt` re-evaluates on
 * the next boot and sees the same missing key.
 */
export function FirstRunKeyPrompt({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [keyText, setKeyText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const save = async () => {
    setChecking(true);
    setWarning(null);
    let result: KeyValidation;
    try {
      result = await validateProviderKey(provider, keyText);
    } catch {
      // Never let the check itself strand the user on this screen.
      result = { ok: false, reason: 'unreachable' };
    }
    setChecking(false);

    setSettings({ ...apiKeyPatch(provider, keyText), aiProvider: provider });

    if (result.ok) {
      onDone();
      return;
    }
    setWarning(
      result.reason === 'unauthorized'
        ? `${PROVIDER_LABEL[provider]} rejected that key. It has been saved — you can fix it in Settings.`
        : `Couldn't reach ${PROVIDER_LABEL[provider]} to check the key. It has been saved — you can fix it in Settings.`
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Add an AI key
        </ThemedText>
        <ThemedText type="default" style={styles.blurb}>
          The coach writes routines, answers questions and comments between sets. It runs on your
          own API key, which stays on this device. You can skip this and add one later in Settings.
        </ThemedText>

        <ThemedText type="default" style={styles.label}>
          Provider
        </ThemedText>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={[styles.picker, { borderColor: theme.backgroundSelected }]}>
          <ThemedText type="default">{PROVIDER_LABEL[provider]}</ThemedText>
          <ThemedText type="default" style={styles.chevron}>
            ›
          </ThemedText>
        </Pressable>

        <ThemedText type="default" style={styles.label}>
          {PROVIDER_LABEL[provider]} API Key
        </ThemedText>
        <TextInput
          value={keyText}
          onChangeText={setKeyText}
          placeholder={keyPlaceholder(provider)}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
        />

        {warning && (
          <ThemedView style={styles.warningBox}>
            <ThemedText style={styles.warningText}>{warning}</ThemedText>
          </ThemedView>
        )}

        <View style={styles.spacer} />

        <Pressable
          accessibilityRole="button"
          disabled={checking || keyText.trim().length === 0}
          onPress={save}
          style={[
            styles.primary,
            { backgroundColor: ActionButtonColor.primary },
            (checking || keyText.trim().length === 0) && styles.disabled,
          ]}>
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.primaryText}>Save and continue</ThemedText>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={onDone} style={styles.skip}>
          <ThemedText type="default">I don&apos;t have a key</ThemedText>
        </Pressable>
      </SafeAreaView>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            {AI_PROVIDERS.map((p) => (
              <Pressable
                key={p}
                onPress={() => {
                  setProvider(p);
                  setPickerOpen(false);
                }}
                style={[styles.sheetRow, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="default">{PROVIDER_LABEL[p]}</ThemedText>
                {p === provider && <ThemedText type="default">✓</ThemedText>}
              </Pressable>
            ))}
            {/* Every sheet needs its own dismiss: onRequestClose does not fire on
                iOS without allowSwipeDismissal, and the backdrop is a plain View.
                A picker with no exit shipped as a Critical in #122 Phase 3. */}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerOpen(false)}
              style={styles.cancel}>
              <ThemedText>Cancel</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: 24, gap: 12 },
  title: { marginTop: 32 },
  blurb: { marginBottom: 12 },
  label: { fontWeight: '600', marginTop: 8 },
  picker: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chevron: { fontSize: 20 },
  input: { borderWidth: 1, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 12 },
  warningBox: {
    backgroundColor: WARNING_SURFACE_CSS,
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
    borderRadius: 6,
    padding: 12,
  },
  warningText: { color: WarningColors.textLight },
  spacer: { flex: 1 },
  primary: { borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  skip: { paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' },
  sheet: { padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 8 },
  sheetRow: {
    padding: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: { padding: 16, alignItems: 'center' },
});
