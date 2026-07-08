import { StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import { routineListPresenter, RoutineListItem } from '@/state/routineListPresenter';

export default function RoutinesScreen() {
  const router = useRouter();
  const [routines, setRoutines] = useState<RoutineListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRoutines = async () => {
      try {
        const items = await routineListPresenter(database);
        setRoutines(items);
      } catch (error) {
        console.error('Failed to load routines:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRoutines();

    // Set up polling for routine changes
    const interval = setInterval(loadRoutines, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleRoutinePress = (routineId: string) => {
    router.push(`/routine/${routineId}`);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="title" style={styles.title}>
            Routines
          </ThemedText>
          {loading ? (
            <ThemedText type="default">Loading routines...</ThemedText>
          ) : routines.length === 0 ? (
            <ThemedText type="default" style={styles.placeholder}>
              No routines found. Import routines to get started.
            </ThemedText>
          ) : (
            <FlatList
              data={routines}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.routineItem}
                  onPress={() => handleRoutinePress(item.id)}
                >
                  <ThemedText type="subtitle">{item.name}</ThemedText>
                  <ThemedText type="default" style={styles.exerciseCount}>
                    {item.exerciseCount} exercises
                  </ThemedText>
                </Pressable>
              )}
              scrollEnabled={true}
              style={styles.list}
            />
          )}
        </ThemedView>
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
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    flex: 1,
    gap: Spacing.four,
    width: '100%',
  },
  title: {
    textAlign: 'center',
  },
  placeholder: {
    textAlign: 'center',
    opacity: 0.6,
  },
  list: {
    flex: 1,
    width: '100%',
  },
  routineItem: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  exerciseCount: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
});
