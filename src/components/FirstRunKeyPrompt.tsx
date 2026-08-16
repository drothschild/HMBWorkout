import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
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
      {/* Two layers, each doing a different job. The KeyboardAvoidingView
          SHRINKS the column so the buttons rise above the keyboard — that is
          what #259 is actually about, and it works here for the reason it
          failed in settings/ai.tsx: this screen renders instead of the Stack,
          with no tab-navigator header or tab bar to absorb the compression
          (that screen measured only ~12%). Same situation as session.tsx,
          minus the modal offset, since this is not a modal-presented route.
          The ScrollView underneath is the overflow net: shrinking cannot help
          when the rigid content is simply taller than what is left, and
          `automaticallyAdjustKeyboardInsets` scrolls the focused field into
          view. Verified in the simulator — the ScrollView ALONE left the
          button behind the keyboard (insets the content, does not shrink the
          frame), which is why both layers are here. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.safeArea}>
        {/* The keyboard used to cover "Save and continue" outright (#259), and
            this screen's rigid content (title, blurb, picker, field) can exceed
            a small phone once the keyboard is up — so a KeyboardAvoidingView
            alone would not be enough even where it works.

            `automaticallyAdjustKeyboardInsets` is the pattern already proven for
            a form in this app (settings/ai.tsx): it insets the bottom and scrolls
            the focused field into view. A KeyboardAvoidingView was rejected there
            because tab-navigator chrome shrank the column by only ~12%; this
            screen has no tab chrome, but it does have the content-overflow
            problem a KAV cannot solve, so the ScrollView is the better fit here
            for a different reason.

            `flexGrow: 1` on the content container is load-bearing: `flex: 1` on
            a ScrollView CHILD is inert, so without it the spacer collapses and
            the buttons ride up under the blurb. That exact shape shipped once
            already in PR #66. */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}>
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
            // The keyboard covers "Save and continue" while this field is
            // focused, so return is the way out. "done" says so; the default
            // glyph does not. Deliberately NOT a KeyboardAvoidingView — that is
            // #130's territory, where PR #109 failed three approaches.
            returnKeyType="done"
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
        </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

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
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  // flexGrow (not flex) — see the ScrollView comment above.
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, gap: 12 },
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
