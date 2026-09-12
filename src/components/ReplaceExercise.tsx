import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { exerciseReplaceStore, replaceExerciseTarget, canOfferReplace } from '@/state/exerciseReplaceStore';
import { getSettings } from '@/state/settings';
import {
  exerciseLibraryPresenter,
  filterExerciseLibraryItems,
  type ExerciseLibraryItem,
} from '@/state/exerciseLibraryPresenter';
import { database } from '@/db';
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
 * Coach alternatives need an AI key, but the inline local-library picker does
 * not: every replacement still goes through the engine guard either way.
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
  const [pickingAny, setPickingAny] = useState(false);
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const target = replaceExerciseTarget(sessionState, exerciseTitles);
  const canReplace = canOfferReplace(sessionState, getSettings());

  const busy = status === 'loading' || status === 'swapping';
  const open = status !== 'idle';
  const filteredExercises = useMemo(
    () => filterExerciseLibraryItems(exercises, searchQuery),
    [exercises, searchQuery]
  );

  useEffect(() => {
    if (!open) setPickingAny(false);
  }, [open]);

  useEffect(() => {
    if (!pickingAny) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);

    exerciseLibraryPresenter(database)
      .then((items) => {
        if (cancelled) return;
        setExercises(items);
        setCatalogLoading(false);
      })
      .catch((loadError) => {
        console.error('Failed to load exercises for replacement:', loadError);
        if (cancelled) return;
        setCatalogError('Couldn’t load your exercise library. Try again, or keep this exercise.');
        setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pickingAny]);

  const close = () => {
    setPickingAny(false);
    exerciseReplaceStore.getState().cancel();
  };

  // Nothing to replace (a set is logged, or no exercise is in progress) and
  // nothing open: render nothing at all. This remains below every hook so the
  // component has one stable hook order as a session starts or ends.
  if ((!target || !canReplace) && status === 'idle') return null;

  return (
    <View>
      {target && canReplace && (
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
        onRequestClose={close}
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

            {pickingAny ? (
              <>
                <TextInput
                  accessibilityLabel="Search exercises to replace with"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search exercises"
                  placeholderTextColor={theme.textSecondary}
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.searchInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
                {catalogLoading ? (
                  <ThemedText type="small">Loading exercises…</ThemedText>
                ) : catalogError ? (
                  <ThemedText style={styles.error}>{catalogError}</ThemedText>
                ) : filteredExercises.length === 0 ? (
                  <ThemedText type="small">No exercises match your search.</ThemedText>
                ) : (
                  <FlatList
                    data={filteredExercises}
                    keyExtractor={(item) => item.id}
                    keyboardShouldPersistTaps="handled"
                    style={styles.list}
                    renderItem={({ item }) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Replace with ${item.title}`}
                        disabled={status === 'swapping'}
                        onPress={() => exerciseReplaceStore.getState().chooseExisting(item.id, item.kind)}
                        style={[styles.option, { backgroundColor: theme.backgroundElement }]}
                      >
                        <ThemedText type="smallBold">{item.title}</ThemedText>
                        <ThemedText type="small" style={{ color: theme.textSecondary }}>
                          {item.kind}
                        </ThemedText>
                      </Pressable>
                    )}
                  />
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={status === 'swapping'}
                  onPress={() => setPickingAny(false)}
                  style={styles.cancel}
                >
                  <ThemedText>Back to alternatives</ThemedText>
                </Pressable>
              </>
            ) : (
              <>
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
                  disabled={status === 'swapping'}
                  onPress={() => {
                    setSearchQuery('');
                    setPickingAny(true);
                  }}
                  style={[styles.option, styles.anyOption, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText type="smallBold">Pick any exercise</ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>
                    Search your exercise library instead.
                  </ThemedText>
                </Pressable>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={close}
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
  anyOption: {
    borderWidth: 1,
    borderColor: ActionButtonColor.secondary,
  },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
  },
  error: {
    color: StatusColor.danger,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
