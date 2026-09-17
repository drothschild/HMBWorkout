import { Tabs, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Column,
  FieldGroup,
  Host,
  Picker,
  Row,
  Spacer,
  Text as NativeText,
  TextInput as NativeTextInput,
} from '@expo/ui';
import { interactiveDismissDisabled } from '@expo/ui/swift-ui/modifiers';

import { ExerciseImage } from '@/components/ExerciseImage';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import type { ExerciseKind } from '@/db/models/Exercise';
import { createExercise } from '@/state/exerciseCreation';
import { submitExerciseCreation } from '@/state/exerciseCreationSubmission';
import { StatusColor } from '@/theme/actionButtonColors';
import {
  ExerciseLibraryItem,
  exerciseLibraryPresenter,
  filterExerciseLibraryItems,
} from '@/state/exerciseLibraryPresenter';
import { useTheme } from '@/hooks/use-theme';

const CreateFormWidth = 320;

export default function ExercisesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<ExerciseKind>('strength');
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [isCreateFormVisible, setIsCreateFormVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const generationRef = useRef(0);
  const creationInFlightRef = useRef(false);
  const sheetModifiers = Platform.OS === 'ios' ? [interactiveDismissDisabled(creating)] : undefined;
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
      console.error('Failed to load exercises:', error);
      if (generationRef.current === generation) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
      return () => {
        generationRef.current += 1;
      };
    }, [loadExercises])
  );

  const submitNewExercise = async () => {
    if (creationInFlightRef.current) return;
    setCreating(true);
    setCreateMessage(null);
    try {
      await submitExerciseCreation(
        {
          create: () => createExercise(database, { title: newTitle, kind: newKind }),
          onOutcome: (outcome) => {
            if (outcome.kind === 'invalid-title') {
              setCreateMessage('Enter a letter or number in the exercise name.');
              return;
            }
            if (outcome.kind === 'invalid-kind') {
              setCreateMessage('Choose a valid exercise type.');
              return;
            }
            if (outcome.kind === 'duplicate') {
              setCreateMessage('An exercise with that name already exists. Nothing was changed.');
              return;
            }
            setNewTitle('');
            setIsCreateFormVisible(false);
            router.push(`/exercise/${outcome.exerciseId}`);
          },
          onFailure: (error) => {
            console.error('Failed to create exercise:', error);
            setCreateMessage("Couldn't create that exercise. Try again.");
          },
        },
        creationInFlightRef
      );
    } finally {
      setCreating(false);
    }
  };

  const closeCreateForm = () => {
    if (creating) return;
    setNewTitle('');
    setNewKind('strength');
    setCreateMessage(null);
    setIsCreateFormVisible(false);
  };

  const openCreateForm = () => {
    setCreateMessage(null);
    setIsCreateFormVisible(true);
  };

  return (
    <>
      <Tabs.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New exercise"
              accessibilityHint="Opens the form to create a new exercise."
              hitSlop={Spacing.two}
              onPress={openCreateForm}
              style={({ pressed }) => [styles.newExerciseButton, pressed && styles.newExerciseButtonPressed]}
            >
              <SymbolView
                name="plus"
                size={24}
                tintColor={theme.text}
                fallback={<ThemedText style={styles.newExerciseFallback}>+</ThemedText>}
              />
            </Pressable>
          ),
        }}
      />
      <ThemedView style={styles.container}>
        <View style={styles.safeArea}>
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
            style={[
              styles.searchInput,
              { color: theme.text, borderColor: theme.backgroundSelected },
            ]}
          />
          {loading ? (
            <ThemedText type="default">Loading exercises...</ThemedText>
          ) : exercises.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText type="default" style={styles.placeholder}>
                No exercises loaded yet.
              </ThemedText>
            </ThemedView>
          ) : filteredExercises.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText type="default" style={styles.placeholder}>
                No exercises match your search.
              </ThemedText>
            </ThemedView>
          ) : (
            <FlatList
              data={filteredExercises}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.title}, ${item.kind}`}
                  onPress={() => router.push(`/exercise/${item.id}`)}
                  style={({ pressed }) => [
                    styles.exerciseItem,
                    { borderBottomColor: theme.backgroundSelected },
                    pressed && styles.exerciseItemPressed,
                  ]}
                >
                  <ExerciseImage imagePath={item.imagePath} size="row" />
                  <View style={styles.exerciseInfo}>
                    <ThemedText type="subtitle">{item.title}</ThemedText>
                    <ThemedText type="default" style={styles.exerciseKind}>
                      {item.kind}
                    </ThemedText>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      </ThemedView>
      <Host matchContents={{ vertical: true }}>
        <BottomSheet
          isPresented={isCreateFormVisible}
          onDismiss={closeCreateForm}
          modifiers={sheetModifiers}
          shouldDismissOnBackPress={!creating}
          shouldDismissOnClickOutside={!creating}
          contentPadding={Spacing.four}
        >
          <Column spacing={Spacing.three} style={{ width: CreateFormWidth }}>
            <NativeText textStyle={styles.createFormTitle}>New exercise</NativeText>
            <FieldGroup style={{ width: CreateFormWidth }}>
              <FieldGroup.Section>
                <NativeTextInput
                  testID="New exercise title"
                  defaultValue={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Exercise name"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus
                  autoCapitalize="words"
                  autoCorrect
                  returnKeyType="done"
                  onSubmitEditing={() => { void submitNewExercise(); }}
                  style={{ width: CreateFormWidth, height: 44 }}
                  textStyle={{ color: theme.text }}
                />
                <Row style={{ width: CreateFormWidth, height: 44 }} alignment="center">
                  <NativeText>Type</NativeText>
                  <Spacer />
                  <Picker
                    appearance="menu"
                    selectedValue={newKind}
                    onValueChange={(value) => setNewKind(value as ExerciseKind)}
                  >
                    <Picker.Item label="Strength" value="strength" />
                    <Picker.Item label="Cardio" value="cardio" />
                    <Picker.Item label="Stretch" value="stretch" />
                  </Picker>
                </Row>
              </FieldGroup.Section>
            </FieldGroup>
            <Button
              label={creating ? 'Creating…' : 'Create exercise'}
              disabled={creating}
              onPress={() => { void submitNewExercise(); }}
              style={{ width: CreateFormWidth, height: 44 }}
            />
            <Button
              label="Cancel"
              variant="outlined"
              disabled={creating}
              onPress={closeCreateForm}
              style={{ width: CreateFormWidth, height: 44 }}
            />
            {createMessage && (
              <NativeText textStyle={styles.createMessage}>{createMessage}</NativeText>
            )}
          </Column>
        </BottomSheet>
      </Host>
    </>
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
    width: '100%',
  },
  placeholder: {
    textAlign: 'center',
    opacity: 0.6,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    flex: 1,
    width: '100%',
  },
  newExerciseButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newExerciseButtonPressed: {
    opacity: 0.6,
  },
  newExerciseFallback: {
    fontSize: 24,
    lineHeight: 24,
  },
  searchInput: {
    minHeight: 44,
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  createFormTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  createMessage: {
    color: StatusColor.danger,
  },
  exerciseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    borderBottomWidth: 1,
  },
  exerciseItemPressed: {
    opacity: 0.6,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseKind: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
    textTransform: 'capitalize',
  },
});
