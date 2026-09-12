import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Column, Host, Picker } from '@expo/ui';

import { ExerciseImage } from '@/components/ExerciseImage';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import type { ExerciseKind } from '@/db/models/Exercise';
import { createExercise } from '@/state/exerciseCreation';
import { StatusColor } from '@/theme/actionButtonColors';
import {
  ExerciseLibraryItem,
  exerciseLibraryPresenter,
  filterExerciseLibraryItems,
} from '@/state/exerciseLibraryPresenter';
import { useTheme } from '@/hooks/use-theme';

export default function ExercisesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<ExerciseKind>('strength');
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const generationRef = useRef(0);
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
    if (creating) return;
    setCreating(true);
    setCreateMessage(null);
    try {
      const outcome = await createExercise(database, { title: newTitle, kind: newKind });
      if (outcome.kind === 'invalid-title') {
        setCreateMessage('Enter a letter or number in the exercise name.');
        return;
      }
      if (outcome.kind === 'duplicate') {
        setCreateMessage('An exercise with that name already exists. Nothing was changed.');
        return;
      }
      setNewTitle('');
      router.push(`/exercise/${outcome.exerciseId}`);
    } catch (error) {
      console.error('Failed to create exercise:', error);
      setCreateMessage("Couldn't create that exercise. Try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
        <ThemedView style={[styles.createForm, { borderColor: theme.backgroundSelected }]}>
          <ThemedText type="subtitle">New exercise</ThemedText>
          <TextInput
            accessibilityLabel="New exercise title"
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Exercise name"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            autoCorrect
            returnKeyType="done"
            onSubmitEditing={() => { void submitNewExercise(); }}
            style={[
              styles.searchInput,
              styles.newTitleInput,
              { color: theme.text, borderColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" style={styles.kindLabel}>Type</ThemedText>
          <Host matchContents={{ vertical: true }}>
            <Column spacing={Spacing.two}>
              <Picker selectedValue={newKind} onValueChange={(value) => setNewKind(value as ExerciseKind)}>
                <Picker.Item label="Strength" value="strength" />
                <Picker.Item label="Cardio" value="cardio" />
                <Picker.Item label="Stretch" value="stretch" />
              </Picker>
              <Button
                label={creating ? 'Creating…' : 'Create exercise'}
                onPress={() => { void submitNewExercise(); }}
              />
            </Column>
          </Host>
          {createMessage && (
            <ThemedText type="small" style={styles.createMessage}>{createMessage}</ThemedText>
          )}
        </ThemedView>
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
  searchInput: {
    minHeight: 44,
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  createForm: {
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  newTitleInput: {
    marginBottom: 0,
  },
  kindLabel: {
    opacity: 0.7,
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
