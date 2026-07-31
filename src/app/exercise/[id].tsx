import { StyleSheet, TextInput, Pressable, ScrollView, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import Exercise from '@/db/models/Exercise';
import { updateExerciseDescription } from '@/db/repository';

const AUTOSAVE_DELAY_MS = 500;

export default function ExerciseDetailScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const loadExercise = async () => {
      if (!id) return;
      try {
        const found = (await database.get('exercises').find(id)) as Exercise;
        setExercise(found);
        setDescription(found.description ?? '');
      } catch (error) {
        console.error('Failed to load exercise:', error);
      } finally {
        setLoading(false);
      }
    };

    loadExercise();
  }, [id]);

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
    hasPendingRef.current = false;
    const value = pendingValueRef.current;
    updateExerciseDescription(database, id, value)
      .then(() => {
        setSaveError(null);
      })
      .catch((error) => {
        console.error('Failed to save exercise description:', error);
        setSaveError('Couldn\'t save — retry');
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

  useEffect(() => () => flush(), [flush]);

  const textInputColor = colorScheme === 'dark' ? '#fff' : '#000';
  const placeholderColor = colorScheme === 'dark' ? '#999' : '#ccc';

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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="title" style={styles.title}>
            {exercise.title}
          </ThemedText>
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
              style={[styles.input, styles.multilineInput, { color: textInputColor }]}
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
    paddingBottom: BottomTabInset + Spacing.three,
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
    color: '#ff4444',
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
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
