import { StyleSheet, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { database } from '@/db';
import { routineDetailPresenter, RoutineDetail, ExerciseDetail } from '@/state/routineDetailPresenter';
import { startSessionFromRoutine } from '@/state/startSessionFromRoutine';
import { activeSessionStore } from '@/state/activeSession';
import { routineStartMode } from '@/state/routineStartMode';

/**
 * A single exercise row, shared by both the standalone and superset render
 * paths so the two can't drift — the markup used to be duplicated verbatim
 * in each branch.
 */
function ExerciseRow({ exercise, onPress }: { exercise: ExerciseDetail; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.exerciseItem, pressed && styles.exerciseItemPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${exercise.title}`}
    >
      <View style={styles.exerciseInfo}>
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
        {exercise.description && (
          <ThemedText type="small" style={styles.exerciseDescription}>
            {exercise.description}
          </ThemedText>
        )}
      </View>
      <ThemedText type="default" style={styles.exerciseChevron}>
        ›
      </ThemedText>
    </Pressable>
  );
}

export default function RoutineDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionState = activeSessionStore((state: any) => state.sessionState);
  const [routine, setRoutine] = useState<RoutineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
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
    }, [id])
  );

  const handleStartSession = async () => {
    if (!id) return;
    setStartError(null);
    setStarting(true);
    try {
      const event = await startSessionFromRoutine(database, id, `session-${Date.now()}`);
      const next = await activeSessionStore.getState().dispatch(event);
      // dispatch returns null when the engine rejected the event or when
      // persisting the accepted transition failed. A successful StartSession
      // always resolves to the new in-progress state, so null here means the
      // start did not take effect — do not navigate.
      if (!next) {
        setStartError('Could not start that routine. Try again, or check it still plans some sets.');
        return;
      }
      router.push('/session');
    } catch (error) {
      console.error('Failed to start session:', error);
      setStartError('Could not start that routine. Try again, or check it still plans some sets.');
    } finally {
      setStarting(false);
    }
  };

  // hasActiveExercise is false both when there are no exercises at all and
  // when every one plans zero total sets (warmupSets + targetSets === 0) —
  // startSessionFromRoutine refuses both the same way.
  const isRoutineStartable = !!routine && routine.hasActiveExercise;
  const startMode = routineStartMode({ sessionState, isRoutineStartable });

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

          {routine.notes && (
            <ThemedText type="default" style={styles.routineNotes}>
              {routine.notes}
            </ThemedText>
          )}

          {routine.items.length > 0 && (
            <View style={styles.section}>
              {routine.items.map((item) =>
                item.type === 'superset' ? (
                  <View key={item.exercises[0].routineExerciseId} style={styles.supersetGroup}>
                    <ThemedText type="default" style={styles.supersetLabel}>
                      Superset: {item.label}
                    </ThemedText>
                    {item.exercises.map((exercise) => (
                      <ExerciseRow
                        key={exercise.routineExerciseId}
                        exercise={exercise}
                        onPress={() => router.push(`/exercise/${exercise.exerciseId}`)}
                      />
                    ))}
                  </View>
                ) : (
                  <ExerciseRow
                    key={item.exercise.routineExerciseId}
                    exercise={item.exercise}
                    onPress={() => router.push(`/exercise/${item.exercise.exerciseId}`)}
                  />
                )
              )}
            </View>
          )}
        </ScrollView>

        {startError && (
          <ThemedText type="default" style={styles.errorText}>
            {startError}
          </ThemedText>
        )}
        {startMode.kind === 'resume' ? (
          // A session is already active: offering "Start from this routine" here
          // would only be rejected by the engine, so this screen tells the truth
          // and offers to resume instead — same destination as Today's resume.
          <Pressable
            style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
            onPress={() => router.push('/session')}
          >
            <ThemedText type="default" style={styles.startButtonText}>
              Resume Session
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.startButton,
              pressed && styles.startButtonPressed,
              (starting || !startMode.enabled) && styles.startButtonDisabled,
            ]}
            onPress={handleStartSession}
            disabled={starting || !startMode.enabled}
          >
            <ThemedText type="default" style={styles.startButtonText}>
              {starting ? 'Starting...' : 'Start from this routine'}
            </ThemedText>
          </Pressable>
        )}
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
    paddingBottom: Spacing.three,
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
    color: ActionButtonColor.secondary,
    fontWeight: '500',
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
  routineNotes: {
    textAlign: 'center',
    opacity: 0.7,
    marginTop: -Spacing.two,
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseItemPressed: {
    opacity: 0.6,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseDescription: {
    opacity: 0.6,
    marginTop: Spacing.one,
  },
  exerciseName: {
    fontWeight: '500',
  },
  exerciseDetails: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
  exerciseChevron: {
    fontSize: 20,
    opacity: 0.4,
    marginLeft: Spacing.two,
  },
  startButton: {
    backgroundColor: ActionButtonColor.primary,
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
    backgroundColor: ActionButtonColor.primary,
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
    color: StatusColor.danger,
    marginBottom: Spacing.two,
  },
});
