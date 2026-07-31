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
  const [startError, setStartError] = useState<string | null>(null);

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
    setStartError(null);
    setStarting(true);
    try {
      const event = await startSessionFromRoutine(database, id, `session-${Date.now()}`);
      await activeSessionStore.getState().dispatch(event);
      router.push('/session');
    } catch (error) {
      console.error('Failed to start session:', error);
      setStartError('Could not start that routine. Try again, or check it still has exercises.');
      setStarting(false);
    }
  };

  const isRoutineStartable = routine && routine.supersetGroups.length + routine.standaloneExercises.length > 0;

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
        {/* Static header: stays put while the routine content scrolls.
            Explicit destination rather than router.back(): arriving via an
            accepted AI draft puts the chat screen underneath, and popping
            there is never where the user wants to go from a routine. */}
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => router.navigate('/routines')}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ThemedText type="default" style={styles.backButtonText}>
              ← Routines
            </ThemedText>
          </Pressable>
        </View>
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
                        {exercise.targetSets != null &&
                          exercise.targetReps != null &&
                          `${exercise.targetSets}x${exercise.targetReps}`}
                        {exercise.targetDurationSeconds != null && exercise.targetDurationSeconds > 0 &&
                          `${Math.floor(exercise.targetDurationSeconds / 60)}:${String(
                            exercise.targetDurationSeconds % 60
                          ).padStart(2, '0')}`}
                        {exercise.warmupSets !== undefined && exercise.warmupSets > 0 && ` | ${exercise.warmupSets}w`}
                        {exercise.restSeconds != null && exercise.restSeconds > 0 && ` | Rest: ${exercise.restSeconds}s`}
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
                    {exercise.targetSets != null &&
                      exercise.targetReps != null &&
                      `${exercise.targetSets}x${exercise.targetReps}`}
                    {exercise.targetDurationSeconds != null && exercise.targetDurationSeconds > 0 &&
                      `${Math.floor(exercise.targetDurationSeconds / 60)}:${String(
                        exercise.targetDurationSeconds % 60
                      ).padStart(2, '0')}`}
                    {exercise.warmupSets !== undefined && exercise.warmupSets > 0 && ` | ${exercise.warmupSets}w`}
                    {exercise.restSeconds != null && exercise.restSeconds > 0 && ` | Rest: ${exercise.restSeconds}s`}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {startError && (
          <ThemedText type="default" style={styles.errorText}>
            {startError}
          </ThemedText>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.startButton,
            pressed && styles.startButtonPressed,
            (starting || !isRoutineStartable) && styles.startButtonDisabled,
          ]}
          onPress={handleStartSession}
          disabled={starting || !isRoutineStartable}
        >
          <ThemedText type="default" style={styles.startButtonText}>
            {starting ? 'Starting...' : 'Start from this routine'}
          </ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.aiEditButton,
            pressed && styles.aiEditButtonPressed,
          ]}
          onPress={() => router.push(`/ai-coach?routineId=${id}`)}
        >
          <ThemedText type="default" style={styles.aiEditButtonText}>
            Edit with AI Coach
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
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
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
  aiEditButton: {
    backgroundColor: '#007AFF',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  aiEditButtonPressed: {
    opacity: 0.7,
  },
  aiEditButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  errorText: {
    textAlign: 'center',
    color: '#FF6B6B',
    marginBottom: Spacing.two,
  },
});
