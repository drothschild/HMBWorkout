import { StyleSheet, TextInput, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ExerciseImage } from '@/components/ExerciseImage';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { database } from '@/db';
import Exercise from '@/db/models/Exercise';
import { updateExerciseDescription } from '@/db/repository';
import { requestExerciseImagePass } from '@/state/exerciseImageResolverRegistry';
import { exerciseImageOverrideMessage, overrideExerciseImage } from '@/state/exerciseImageOverride';
import { deleteExerciseImage, downloadExerciseImage, makeExerciseImageSuffix } from '@/state/exerciseImageFiles';

const AUTOSAVE_DELAY_MS = 500;

export default function ExerciseDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  // Every hook in this screen sits ABOVE the `if (!id || loading)` early
  // return: a hook after it crashes the screen ("Rendered more hooks than
  // during the previous render"), and no test can render this screen.
  // exerciseImageWiring.static.test.ts gates the placement.
  const [imagePath, setImagePath] = useState<string | null>(null);
  // The paste-URL override (#335 Phase 6).
  const [imageUrl, setImageUrl] = useState('');
  const [imageMessage, setImageMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [savingImage, setSavingImage] = useState(false);

  useEffect(() => {
    const loadExercise = async () => {
      if (!id) return;
      try {
        const found = (await database.get('exercises').find(id)) as Exercise;
        setExercise(found);
        setImagePath(found.imagePath ?? null);
        // First-view retry (#335 AC2.9): opening an exercise with no image
        // asks the background resolver for a pass. No-op until it has started.
        if (!found.imagePath) requestExerciseImagePass();
        setDescription(found.description ?? '');
      } catch (error) {
        console.error('Failed to load exercise:', error);
      } finally {
        setLoading(false);
      }
    };

    loadExercise();
  }, [id]);

  // Keeps the hero live while the screen is open: the resolver may finish (or
  // the image may be replaced) after mount.
  useEffect(() => {
    if (!exercise) return;
    const subscription = exercise.observe().subscribe((record) => setImagePath(record.imagePath ?? null));
    return () => subscription.unsubscribe();
  }, [exercise]);

  const pendingValueRef = useRef('');
  const hasPendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save: debounce keystrokes, and flush anything pending on unmount so
  // navigating away never loses an edit. The repository normalizes empty/whitespace
  // to null, so we pass the raw value and let the backend handle normalization.
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!hasPendingRef.current || !id) return;
    const value = pendingValueRef.current;
    updateExerciseDescription(database, id, value)
      .then(() => {
        // Only this save's value being current makes the clear (and the
        // banner reset) truthful — an older save resolving late must not
        // wipe a newer failure's state.
        if (pendingValueRef.current === value) {
          hasPendingRef.current = false;
          setSaveError(null);
        }
      })
      .catch((error) => {
        // Re-mark pending so the next flush (typing or unmount) will retry the same value
        hasPendingRef.current = true;
        console.error('Failed to save exercise description:', error);
        setSaveError('Couldn\'t save — will retry with your next change');
      });
  }, [id]);

  const queueSave = (value: string) => {
    pendingValueRef.current = value;
    hasPendingRef.current = true;
    setSaveError(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  // Plain function, not a hook. The hero updates by itself: the
  // exercise.observe() effect above picks up the row write. Message copy comes
  // only from exerciseImageOverrideMessage, except a thrown row write (e.g. the
  // exercise was deleted), which overrideExerciseImage deliberately propagates.
  const applyImageUrl = async () => {
    if (!id || savingImage || imageUrl.trim() === '') return;
    setSavingImage(true);
    try {
      const outcome = await overrideExerciseImage(
        {
          database,
          download: downloadExerciseImage,
          deleteFile: deleteExerciseImage,
          makeImageSuffix: makeExerciseImageSuffix,
          log: (message, error) => console.warn(message, error),
        },
        id,
        imageUrl
      );
      setImageMessage({ text: exerciseImageOverrideMessage(outcome), isError: outcome.kind !== 'saved' });
      if (outcome.kind === 'saved') setImageUrl('');
    } catch (error) {
      console.error('Failed to save exercise image:', error);
      setImageMessage({ text: "Couldn't save that image. Try again.", isError: true });
    } finally {
      setSavingImage(false);
    }
  };

  // Flush any pending changes on unmount. If the flush fails mid-flight and setState
  // is called on an unmounted component, it's a no-op (React ignores it), so hasPendingRef
  // may remain true. This is a tiny race window and acceptable: the next session load
  // will see the value in the component and can save again if needed.
  useEffect(() => () => flush(), [flush]);

  const textInputColor = theme.text;
  const placeholderColor = theme.textSecondary;

  if (!id || loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Loading exercise...</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!exercise) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Exercise not found</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/routines'))}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ThemedText type="default" style={styles.backButtonText}>
              ← Back
            </ThemedText>
          </Pressable>
        </View>
        {/* automaticallyAdjustKeyboardInsets insets the content by the keyboard
            and scrolls the focused field into view. The #335 hero and Image URL
            field push both inputs to the bottom, where the keyboard covered
            them (device-verified). Same fix as Settings → AI / AI Provider;
            gated by exerciseImageWiring.static.test.ts. */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <ThemedText type="title" style={styles.title}>
            {exercise.title}
          </ThemedText>
          <ExerciseImage imagePath={imagePath} size="hero" />
          <ThemedText type="small" style={styles.kind}>
            {exercise.kind}
          </ThemedText>
          <ThemedText type="small" style={styles.caption}>
            Changes save automatically.
          </ThemedText>
          {saveError && (
            <ThemedText type="small" style={styles.errorMessage}>
              {saveError}
            </ThemedText>
          )}

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Image URL
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="https://… (paste an image link to replace the picture)"
              placeholderTextColor={placeholderColor}
              value={imageUrl}
              onChangeText={setImageUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={applyImageUrl}
            />
            <Pressable
              disabled={savingImage || imageUrl.trim() === ''}
              onPress={applyImageUrl}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                (savingImage || imageUrl.trim() === '') && styles.buttonDisabled,
              ]}
            >
              <ThemedText type="default" style={styles.buttonText}>
                {savingImage ? 'Saving…' : 'Use this image'}
              </ThemedText>
            </Pressable>
            {imageMessage && (
              <ThemedText type="small" style={imageMessage.isError ? styles.errorMessage : styles.caption}>
                {imageMessage.text}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Description
            </ThemedText>
            <TextInput
              style={[styles.input, styles.multilineInput, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. Bar on traps, brace, break at the hips and knees together."
              placeholderTextColor={placeholderColor}
              value={description}
              onChangeText={(value) => {
                setDescription(value);
                queueSave(value);
              }}
              multiline
              numberOfLines={6}
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
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
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
    color: ActionButtonColor.secondary,
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
  title: {
    marginBottom: 0,
  },
  kind: {
    opacity: 0.6,
    textTransform: 'capitalize',
  },
  caption: {
    opacity: 0.6,
  },
  errorMessage: {
    color: StatusColor.danger,
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
    // borderColor is theme-resolved inline
    borderRadius: 6,
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  // Same shape as the Settings → Data screen's primary buttons.
  button: {
    backgroundColor: ActionButtonColor.primary,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
