import { AccessibilityInfo, StyleSheet, TextInput, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ExerciseImage } from '@/components/ExerciseImage';
import { ExerciseImageSearch } from '@/components/ExerciseImageSearch';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { database } from '@/db';
import Exercise from '@/db/models/Exercise';
import { updateExerciseDescription } from '@/db/repository';
import { requestExerciseImagePass, refreshExerciseImage } from '@/state/exerciseImageResolverRegistry';
import { overrideExerciseImage, replaceExerciseImageFromLocalUri } from '@/state/exerciseImageOverride';
import { copyExerciseImage, downloadExerciseImage, deleteExerciseImage, makeExerciseImageSuffix } from '@/state/exerciseImageFiles';
import { pickExercisePhoto } from '@/state/exercisePhotoPicker';
import {
  exerciseHistoryPresenter,
  type ExerciseHistoryWorkout,
} from '@/state/exerciseHistoryPresenter';

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
  const [imageMessage, setImageMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [glassEffectAvailable] = useState(() => {
    const liquidGlassAvailable = isLiquidGlassAvailable();
    const glassEffectAPIAvailable = isGlassEffectAPIAvailable();
    return liquidGlassAvailable && glassEffectAPIAvailable;
  });
  const imagePickerInFlightRef = useRef(false);
  const [history, setHistory] = useState<ExerciseHistoryWorkout[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [canSearchImages, setCanSearchImages] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        setHistoryLoading(false);
        return;
      }

      let cancelled = false;
      setHistoryLoading(true);
      (async () => {
        try {
          const result = await exerciseHistoryPresenter(database, id);
          if (!cancelled) {
            setHistory(result);
            setHistoryError(null);
          }
        } catch (error) {
          console.error('Failed to load exercise history:', error);
          if (!cancelled) setHistoryError("Couldn't load exercise history.");
        } finally {
          if (!cancelled) setHistoryLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [id])
  );

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

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (active) setReduceTransparency(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

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
  // exercise.observe() effect above picks up the row write.
  const chooseExercisePhoto = async (camera: boolean) => {
    if (!id || imagePickerInFlightRef.current) return;
    setSavingImage(true);
    setImageMessage(null);
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.8,
        exif: false,
        base64: false,
      };
      const pickerOutcome = await pickExercisePhoto(
        {
          camera: camera ? {
            requestPermission: ImagePicker.requestCameraPermissionsAsync,
            launch: () => ImagePicker.launchCameraAsync({
              ...options,
              presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
            }),
          } : undefined,
          launchLibrary: () => ImagePicker.launchImageLibraryAsync(options),
          save: (uri) =>
            replaceExerciseImageFromLocalUri(
              {
                database,
                copy: copyExerciseImage,
                deleteFile: deleteExerciseImage,
                makeImageSuffix: makeExerciseImageSuffix,
                log: (message, error) => console.warn(message, error),
              },
              id,
              uri
            ),
        },
        imagePickerInFlightRef
      );
      if (pickerOutcome.kind === 'camera-denied') {
        setImageMessage({
          text: pickerOutcome.canAskAgain
            ? 'Camera access has not been granted. Tap the camera button to request access again.'
            : 'Camera access is off. Enable camera access in Settings, then return here.',
          isError: true,
        });
        return;
      }
      if (pickerOutcome.kind === 'cancelled' || pickerOutcome.kind === 'busy') return;

      const outcome = pickerOutcome.outcome;
      if (outcome.kind === 'saved') setCanSearchImages(false);
      setImageMessage({
        text: outcome.kind === 'saved' ? 'Image updated.' : "Couldn't save that photo. Try again.",
        isError: outcome.kind !== 'saved',
      });
    } catch (error) {
      console.error('Failed to save exercise image:', error);
      setImageMessage({ text: "Couldn't open or save that photo. Try again.", isError: true });
    } finally {
      setSavingImage(false);
    }
  };

  const closeImageSearch = () => {
    if (!imagePickerInFlightRef.current) setImageSearchOpen(false);
  };

  const selectSearchImage = async (url: string): Promise<boolean> => {
    if (!id || imagePickerInFlightRef.current) return false;
    imagePickerInFlightRef.current = true;
    setSavingImage(true);
    try {
      const outcome = await overrideExerciseImage({
        database,
        download: downloadExerciseImage,
        deleteFile: deleteExerciseImage,
        makeImageSuffix: makeExerciseImageSuffix,
        log: (message, error) => console.warn(message, error),
      }, id, url);
      const saved = outcome.kind === 'saved';
      if (saved) setCanSearchImages(false);
      setImageMessage({
        text: saved ? 'Image updated.' : "Couldn't save that image. Existing image kept.",
        isError: !saved,
      });
      return saved;
    } catch (error) {
      console.error('Failed to save selected exercise image:', error);
      setImageMessage({ text: "Couldn't save that image. Existing image kept.", isError: true });
      return false;
    } finally {
      imagePickerInFlightRef.current = false;
      setSavingImage(false);
    }
  };

  const refreshExerciseImageAction = () => {
    if (!id || imagePickerInFlightRef.current) return;
    imagePickerInFlightRef.current = true;
    setSavingImage(true);
    setImageMessage(null);
    setCanSearchImages(false);
    void refreshExerciseImage(id)
      .then((outcome) => {
        switch (outcome.kind) {
          case 'updated':
            setImageMessage({ text: 'Image refreshed.', isError: false });
            return;
          case 'no-match':
            setCanSearchImages(true);
            setImageMessage({ text: 'No new matching image found. Existing image kept.', isError: false });
            return;
          case 'unchanged':
            setImageMessage({ text: 'Image changed elsewhere. Existing image kept.', isError: false });
            return;
          case 'busy':
            setImageMessage({ text: 'An image refresh is already in progress.', isError: false });
            return;
          case 'unavailable':
          case 'failed':
            setCanSearchImages(true);
            setImageMessage({ text: "Couldn't refresh the image. Existing image kept.", isError: true });
            return;
        }
      })
      .catch((error) => {
        console.error('Failed to refresh exercise image:', error);
        setCanSearchImages(true);
        setImageMessage({ text: "Couldn't refresh the image. Existing image kept.", isError: true });
      })
      .finally(() => {
        imagePickerInFlightRef.current = false;
        setSavingImage(false);
      });
  };

  // Flush any pending changes on unmount. If the flush fails mid-flight and setState
  // is called on an unmounted component, it's a no-op (React ignores it), so hasPendingRef
  // may remain true. This is a tiny race window and acceptable: the next session load
  // will see the value in the component and can save again if needed.
  useEffect(() => () => flush(), [flush]);

  const textInputColor = theme.text;
  const placeholderColor = theme.textSecondary;
  const useGlassEffect = glassEffectAvailable && !reduceTransparency;

  const photoAction = (kind: 'camera' | 'library' | 'refresh') => {
    const label = kind === 'camera' ? 'Take exercise photo' : kind === 'library' ? 'Choose exercise photo' : 'Refresh exercise image';
    const hint = kind === 'camera'
      ? 'Opens the camera to replace this exercise image.'
      : kind === 'library'
        ? 'Opens your photo library to replace this exercise image.'
        : 'Finds the best matching exercise image without removing the current image first.';
    const control = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: savingImage, busy: savingImage }}
        disabled={savingImage}
        onPress={() => {
          if (kind === 'refresh') refreshExerciseImageAction();
          else void chooseExercisePhoto(kind === 'camera');
        }}
        style={({ pressed }) => [styles.photoAction, pressed && !savingImage && styles.photoActionPressed]}
      >
        <SymbolView
          accessible={false}
          name={kind === 'camera'
            ? { ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }
            : kind === 'library'
              ? { ios: 'photo', android: 'photo', web: 'photo' }
              : { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
          size={22}
          tintColor="#ffffff"
          weight="semibold"
        />
      </Pressable>
    );

    return useGlassEffect ? (
      <GlassView
        style={styles.photoActionGlass}
        glassEffectStyle="regular"
        tintColor="rgba(0, 0, 0, 0.24)"
        isInteractive
      >
        {control}
      </GlassView>
    ) : (
      <View style={styles.photoActionFallback}>{control}</View>
    );
  };

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
        {/* automaticallyAdjustKeyboardInsets keeps the description input visible
            above the keyboard; gated by exerciseImageWiring.static.test.ts. */}
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
          <View style={styles.heroWithPhotoActions}>
            <ExerciseImage imagePath={imagePath} size="hero" />
            <View style={styles.photoActions}>
              {photoAction('camera')}
              {photoAction('library')}
              {photoAction('refresh')}
            </View>
          </View>
          {imageMessage && (
            <ThemedText type="small" style={imageMessage.isError ? styles.errorMessage : styles.caption}>
              {imageMessage.text}
            </ThemedText>
          )}
          {canSearchImages && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search exercise images"
              accessibilityState={{ disabled: savingImage }}
              disabled={savingImage}
              style={styles.searchImagesButton}
              onPress={() => {
                if (!imagePickerInFlightRef.current) setImageSearchOpen(true);
              }}
            >
              <ThemedText style={styles.backButtonText}>Search images</ThemedText>
            </Pressable>
          )}
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

          <ThemedView style={styles.historySection}>
            <ThemedText type="subtitle">History</ThemedText>
            {historyLoading ? (
              <ThemedText type="small" style={styles.caption}>Loading history…</ThemedText>
            ) : historyError ? (
              <ThemedText type="small" style={styles.errorMessage}>{historyError}</ThemedText>
            ) : history.length === 0 ? (
              <ThemedText type="small" style={styles.caption}>No completed workouts yet.</ThemedText>
            ) : (
              history.map((workout) => (
                <ThemedView
                  key={workout.sessionId}
                  style={[styles.historyCard, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText type="default" style={styles.historyDate}>
                    {workout.dateLabel}
                  </ThemedText>
                  {workout.sets.map((set) => (
                    <View key={set.id} style={styles.historySetRow}>
                      <ThemedText type="small" style={styles.historySetLabel}>{set.label}</ThemedText>
                      <ThemedText type="small" style={styles.historySetValue}>{set.line}</ThemedText>
                    </View>
                  ))}
                </ThemedView>
              ))
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
      {imageSearchOpen && (
        <ExerciseImageSearch
          initialQuery={`${exercise.title} exercise`.slice(0, 200)}
          onClose={closeImageSearch}
          onSelect={selectSearchImage}
        />
      )}
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
  heroWithPhotoActions: {
    position: 'relative',
  },
  photoActions: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    flexDirection: 'row',
    gap: Spacing.one,
  },
  photoActionGlass: {
    borderRadius: 22,
    borderCurve: 'continuous',
  },
  photoActionFallback: {
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: '#1c1c1e',
  },
  photoAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActionPressed: {
    transform: [{ scale: 0.94 }],
  },
  searchImagesButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
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
  historySection: {
    gap: Spacing.two,
  },
  historyCard: {
    borderRadius: 10,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  historyDate: {
    fontWeight: '600',
  },
  historySetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  historySetLabel: {
    opacity: 0.6,
  },
  historySetValue: {
    flexShrink: 1,
    textAlign: 'right',
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
});
