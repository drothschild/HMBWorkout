import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { exerciseReplaceStore, replaceExerciseTarget } from '@/state/exerciseReplaceStore';
import { getSettings } from '@/state/settings';
import type { SessionState } from '@/engine/types';

/**
 * The Replace affordance: a button on the exercise in progress, and the picker
 * it opens.
 *
 * Self-contained on purpose — the session screen renders this one element (into
 * SetLogger's `belowButtonsSlot`, so it sits inside that column rather than
 * beside it) and holds none of the flow. Every decision lives in tested modules:
 * `replaceExerciseTarget` says whether there is anything to replace, the store
 * runs the request and the swap, and the engine's ReplaceExercise rule is the
 * authority on whether the swap is legal.
 *
 * The button is hidden, not disabled, when no Anthropic key is configured: a
 * disabled control advertises a feature the athlete cannot reach from here.
 */
export function ReplaceExercise({
  sessionState,
  exerciseTitles,
}: {
  sessionState: SessionState | null;
  exerciseTitles?: Record<string, string>;
}) {
  const theme = useTheme();
  const status = exerciseReplaceStore((state) => state.status);
  const alternates = exerciseReplaceStore((state) => state.alternates);
  const error = exerciseReplaceStore((state) => state.error);

  const target = replaceExerciseTarget(sessionState, exerciseTitles);
  const hasKey = Boolean(getSettings().anthropicKey?.trim());

  // Nothing to replace (a set is logged, or no exercise is in progress) and
  // nothing open: render nothing at all.
  if ((!target || !hasKey) && status === 'idle') return null;

  const busy = status === 'loading' || status === 'swapping';
  const open = status !== 'idle';

  return (
    <View>
      {target && hasKey && (
        <View style={styles.triggerWrapper}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => exerciseReplaceStore.getState().open(target)}
            style={[styles.button, styles.secondaryButton]}
          >
            <ThemedText style={styles.buttonText}>
              {busy ? 'Finding alternatives…' : 'Replace exercise'}
            </ThemedText>
          </Pressable>
        </View>
      )}

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => exerciseReplaceStore.getState().cancel()}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold">
              {target ? `Instead of ${target.exerciseTitle}` : 'Replace exercise'}
            </ThemedText>

            {status === 'loading' && (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Asking your coach for alternatives…
              </ThemedText>
            )}

            {status === 'swapping' && (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Swapping…
              </ThemedText>
            )}

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            <ScrollView style={styles.list}>
              {alternates.map((alternate) => (
                <Pressable
                  // Safe as a key because validateExerciseAlternates rejects
                  // duplicate titles — the athlete picks by title, so two
                  // options sharing one would not be two options anyway.
                  key={alternate.title}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    // The store swallows every failure and reports it through
                    // `error`; nothing here can reject.
                    exerciseReplaceStore.getState().choose(alternate);
                  }}
                  style={[styles.option, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText type="smallBold">{alternate.title}</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    {alternate.description}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={() => exerciseReplaceStore.getState().cancel()}
              style={styles.cancel}
            >
              <ThemedText>Keep this exercise</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  triggerWrapper: {
    marginTop: Spacing.two,
  },
  button: {
    paddingVertical: Spacing.two,
    borderRadius: 4,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: ActionButtonColor.secondary,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    // backgroundColor is theme-resolved inline
    padding: Spacing.three,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    gap: Spacing.two,
    maxHeight: '80%',
  },
  list: {
    flexGrow: 0,
  },
  option: {
    // backgroundColor is theme-resolved inline
    padding: Spacing.three,
    borderRadius: 8,
    marginBottom: Spacing.two,
    gap: Spacing.one,
  },
  error: {
    color: StatusColor.danger,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
