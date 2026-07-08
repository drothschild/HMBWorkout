import { StyleSheet, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import { routineDetailPresenter, RoutineDetail } from '@/state/routineDetailPresenter';
import { startSessionFromRoutine } from '@/state/startSessionFromRoutine';
import { activeSessionStore } from '@/state/activeSession';

export default function RoutineDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [routine, setRoutine] = useState<RoutineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const loadRoutine = async () => {
      if (!id) return;
      try {
        const detail = await routineDetailPresenter(database, id);
        setRoutine(detail);
      } catch (error) {
        console.error('Failed to load routine detail:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRoutine();
  }, [id]);

  const handleStartSession = async () => {
    if (!id) return;
    setStarting(true);
    try {
      const event = await startSessionFromRoutine(database, id, `session-${Date.now()}`);
      await activeSessionStore.getState().dispatch(event);
      router.push('/session');
    } catch (error) {
      console.error('Failed to start session:', error);
      setStarting(false);
    }
  };

  if (!id || loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Loading routine...</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!routine) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Routine not found</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <ThemedText type="title" style={styles.title}>
            {routine.name}
          </ThemedText>

          {routine.supersetGroups.length > 0 && (
            <View style={styles.section}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                Supersets
              </ThemedText>
              {routine.supersetGroups.map((group, idx) => (
                <View key={`${group.label}-${idx}`} style={styles.supersetGroup}>
                  <ThemedText type="default" style={styles.supersetLabel}>
                    Superset: {group.label}
                  </ThemedText>
                  {group.exercises.map((exercise) => (
                    <View key={exercise.exerciseId} style={styles.exerciseItem}>
                      <ThemedText type="default" style={styles.exerciseName}>
                        {exercise.title}
                      </ThemedText>
                      <ThemedText type="default" style={styles.exerciseDetails}>
                        {exercise.targetSets &&
                          exercise.targetReps &&
                          `${exercise.targetSets}x${exercise.targetReps}`}
                        {exercise.targetDurationSeconds &&
                          `${Math.floor(exercise.targetDurationSeconds / 60)}:${String(
                            exercise.targetDurationSeconds % 60
                          ).padStart(2, '0')}`}
                        {exercise.warmupSets !== undefined && exercise.warmupSets > 0 && ` | ${exercise.warmupSets}w`}
                        {exercise.restSeconds && ` | Rest: ${exercise.restSeconds}s`}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {routine.standaloneExercises.length > 0 && (
            <View style={styles.section}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                Exercises
              </ThemedText>
              {routine.standaloneExercises.map((exercise) => (
                <View key={exercise.exerciseId} style={styles.exerciseItem}>
                  <ThemedText type="default" style={styles.exerciseName}>
                    {exercise.title}
                  </ThemedText>
                  <ThemedText type="default" style={styles.exerciseDetails}>
                    {exercise.targetSets &&
                      exercise.targetReps &&
                      `${exercise.targetSets}x${exercise.targetReps}`}
                    {exercise.targetDurationSeconds &&
                      `${Math.floor(exercise.targetDurationSeconds / 60)}:${String(
                        exercise.targetDurationSeconds % 60
                      ).padStart(2, '0')}`}
                    {exercise.warmupSets !== undefined && exercise.warmupSets > 0 && ` | ${exercise.warmupSets}w`}
                    {exercise.restSeconds && ` | Rest: ${exercise.restSeconds}s`}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <Pressable
          style={({ pressed }) => [
            styles.startButton,
            pressed && styles.startButtonPressed,
            starting && styles.startButtonDisabled,
          ]}
          onPress={handleStartSession}
          disabled={starting}
        >
          <ThemedText type="default" style={styles.startButtonText}>
            {starting ? 'Starting...' : 'Start from this routine'}
          </ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
  section: {
    marginBottom: Spacing.four,
  },
  sectionTitle: {
    marginBottom: Spacing.two,
    fontWeight: '600',
  },
  supersetGroup: {
    marginBottom: Spacing.three,
    paddingLeft: Spacing.two,
    borderLeftWidth: 2,
    borderLeftColor: '#888',
  },
  supersetLabel: {
    fontStyle: 'italic',
    opacity: 0.7,
    marginBottom: Spacing.one,
  },
  exerciseItem: {
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  exerciseName: {
    fontWeight: '500',
  },
  exerciseDetails: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
  startButton: {
    backgroundColor: '#007AFF',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  startButtonPressed: {
    opacity: 0.7,
  },
  startButtonDisabled: {
    opacity: 0.5,
  },
  startButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
