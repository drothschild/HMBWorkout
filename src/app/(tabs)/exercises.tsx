import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ExerciseImage } from '@/components/ExerciseImage';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import {
  ExerciseLibraryItem,
  exerciseLibraryPresenter,
} from '@/state/exerciseLibraryPresenter';
import { useTheme } from '@/hooks/use-theme';

export default function ExercisesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const generationRef = useRef(0);

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

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
        {loading ? (
          <ThemedText type="default">Loading exercises...</ThemedText>
        ) : exercises.length === 0 ? (
          <ThemedView style={styles.emptyState}>
            <ThemedText type="default" style={styles.placeholder}>
              No exercises loaded yet.
            </ThemedText>
          </ThemedView>
        ) : (
          <FlatList
            data={exercises}
            keyExtractor={(item) => item.id}
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
