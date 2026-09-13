import { Button, Host } from '@expo/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ExerciseImage } from '@/components/ExerciseImage';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import {
  ManualRoutineCreationError,
  createManualRoutine,
} from '@/state/manualRoutineCreation';
import {
  ExerciseLibraryItem,
  exerciseLibraryPresenter,
  filterExerciseLibraryItems,
} from '@/state/exerciseLibraryPresenter';
import { StatusColor } from '@/theme/actionButtonColors';
import { useTheme } from '@/hooks/use-theme';

function BackButton({ onPress, label }: { onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
    >
      <SymbolView name="chevron.left" size={18} tintColor={theme.text} weight="semibold" />
      <ThemedText type="default" style={styles.backButtonText}>{label}</ThemedText>
    </Pressable>
  );
}

export default function NewRoutineScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [selectedExercises, setSelectedExercises] = useState<ExerciseLibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const generationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const filteredExercises = useMemo(
    () => filterExerciseLibraryItems(exercises, searchQuery),
    [exercises, searchQuery]
  );

  const loadExercises = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const items = await exerciseLibraryPresenter(database);
      if (generationRef.current === generation) {
        setExercises(items);
        setLoading(false);
      }
    } catch (error) {
      console.error('Failed to load exercise picker:', error);
      if (generationRef.current === generation) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadExercises();
      return () => {
        generationRef.current += 1;
      };
    }, [loadExercises])
  );

  const saveRoutine = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const routineId = await createManualRoutine(database, {
        name,
        exerciseIds: selectedExercises.map((exercise) => exercise.id)
      });
      router.replace(`/routine/${routineId}`);
    } catch (error) {
      if (error instanceof ManualRoutineCreationError) {
        setMessage(error.message);
      } else {
        console.error('Failed to create routine:', error);
        setMessage("Couldn't create that routine. Try again.");
      }
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const selectExercise = (exercise: ExerciseLibraryItem) => {
    // Duplicates are valid routine entries. Their persisted identity is minted
    // by `upsertRoutine`; this list key only distinguishes the draft rows.
    setSelectedExercises((current) => [...current, exercise]);
    setSearchQuery('');
    Keyboard.dismiss();
    setPicking(false);
  };

  if (picking) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.safeArea, styles.pickerContent]}>
          <View style={styles.toolbar}>
            <BackButton label="Routine" onPress={() => setPicking(false)} />
            <ThemedText type="subtitle">Add exercise</ThemedText>
          </View>
          <TextInput
            accessibilityLabel="Search exercises"
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
          {loading ? (
            <ThemedText type="default">Loading exercises...</ThemedText>
          ) : filteredExercises.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText type="default" style={styles.muted}>No exercises match your search.</ThemedText>
            </View>
          ) : (
            <FlatList
              data={filteredExercises}
              style={styles.pickerList}
              keyExtractor={(exercise) => exercise.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentInsetAdjustmentBehavior="automatic"
              renderItem={({ item: exercise }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${exercise.title}, ${exercise.kind}`}
                  onPress={() => selectExercise(exercise)}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    { borderBottomColor: theme.backgroundSelected },
                    pressed && styles.pressed,
                  ]}
                >
                  <ExerciseImage imagePath={exercise.imagePath} size="row" />
                  <View style={styles.rowText}>
                    <ThemedText type="subtitle">{exercise.title}</ThemedText>
                    <ThemedText type="small" style={styles.muted}>{exercise.kind}</ThemedText>
                  </View>
                  <SymbolView name="plus" size={18} tintColor={theme.textSecondary} weight="semibold" />
                </Pressable>
              )}
            />
          )}
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scrollContent}>
        <View style={styles.safeArea}>
          <View style={styles.toolbar}>
            <BackButton label="Routines" onPress={() => router.back()} />
            <ThemedText type="subtitle">New routine</ThemedText>
          </View>
          <ThemedText type="small" style={styles.fieldLabel}>Routine name</ThemedText>
          <TextInput
            accessibilityLabel="Routine name"
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => { void saveRoutine(); }}
            placeholder="e.g. Upper body"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            autoCorrect
            returnKeyType="done"
            style={[styles.nameInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          {message && (
            <ThemedText accessibilityRole="alert" selectable type="small" style={styles.errorText}>
              {message}
            </ThemedText>
          )}
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Exercises</ThemedText>
            <ThemedText type="small" style={styles.muted}>{selectedExercises.length}</ThemedText>
          </View>
          {selectedExercises.length === 0 ? (
            <ThemedText type="default" style={styles.emptyRoutineNote}>
              This routine has no exercises and cannot be started yet.
            </ThemedText>
          ) : (
            <View style={styles.selectedList}>
              {selectedExercises.map((exercise, index) => (
                <View key={`${exercise.id}-${index}`} style={[styles.selectedRow, { borderBottomColor: theme.backgroundSelected }]}>
                  <ThemedText type="small" style={styles.order}>{index + 1}</ThemedText>
                  <ExerciseImage imagePath={exercise.imagePath} size="row" />
                  <View style={styles.rowText}>
                    <ThemedText type="default">{exercise.title}</ThemedText>
                    <ThemedText type="small" style={styles.muted}>{exercise.kind}</ThemedText>
                  </View>
                </View>
              ))}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add exercise"
            onPress={() => {
              setMessage(null);
              setPicking(true);
            }}
            style={({ pressed }) => [
              styles.addExerciseButton,
              { borderColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}
          >
            <SymbolView name="plus" size={18} tintColor={theme.text} weight="semibold" />
            <ThemedText type="default" style={styles.addExerciseText}>Add exercise</ThemedText>
          </Pressable>
          <Host matchContents={{ vertical: true }}>
            <Button
              label={saving ? 'Saving…' : 'Save routine'}
              disabled={saving}
              onPress={() => { void saveRoutine(); }}
            />
          </Host>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  safeArea: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  pickerContent: { flex: 1 },
  pickerList: { flex: 1 },
  toolbar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  backButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingRight: Spacing.two,
  },
  backButtonText: { fontWeight: '500' },
  fieldLabel: { opacity: 0.7 },
  nameInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: Spacing.three,
  },
  selectedList: { gap: Spacing.half },
  selectedRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
    paddingVertical: Spacing.one,
  },
  pickerRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
    paddingVertical: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
  order: {
    width: 20,
    textAlign: 'right',
    opacity: 0.6,
    fontVariant: ['tabular-nums'],
  },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  addExerciseButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  addExerciseText: { fontWeight: '600' },
  emptyRoutineNote: {
    opacity: 0.7,
    paddingVertical: Spacing.two,
  },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { opacity: 0.6 },
  errorText: { color: StatusColor.danger },
  pressed: { opacity: 0.6 },
});
