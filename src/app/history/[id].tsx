import { StyleSheet, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import { sessionDetailPresenter, SessionDetail } from '@/state/sessionDetailPresenter';
import { formatSessionDate } from '@/state/sessionHistoryPresenter';

function formatTargetLabel(targetSets?: number, targetReps?: number, targetDurationSeconds?: number): string {
  const parts: string[] = [];
  if (targetSets != null && targetReps != null) {
    parts.push(`${targetSets}x${targetReps}`);
  }
  if (targetDurationSeconds != null && targetDurationSeconds > 0) {
    const minutes = Math.floor(targetDurationSeconds / 60);
    const seconds = String(targetDurationSeconds % 60).padStart(2, '0');
    parts.push(`${minutes}:${seconds}`);
  }
  return parts.join(' | ');
}

export default function SessionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        if (!id) return;
        try {
          const result = await sessionDetailPresenter(database, id);
          if (!cancelled) {
            setDetail(result);
          }
        } catch (error) {
          console.error('Failed to load session detail:', error);
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [id])
  );

  if (!id || loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Loading workout...</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!detail) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Workout not found</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/history'))}
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
        >
          <ThemedText type="title" style={styles.title}>
            {detail.routineName}
          </ThemedText>
          <ThemedText type="default" style={styles.dateText}>
            {formatSessionDate(detail.endedAt)}
          </ThemedText>

          {detail.exercises.map((exercise) => (
            <View key={exercise.routineExerciseId} style={styles.exerciseSection}>
              <View style={styles.exerciseHeaderRow}>
                <ThemedText type="subtitle" style={styles.exerciseName}>
                  {exercise.title}
                </ThemedText>
                {formatTargetLabel(exercise.targetSets, exercise.targetReps, exercise.targetDurationSeconds) !== '' && (
                  <ThemedText type="default" style={styles.exerciseTarget}>
                    {formatTargetLabel(exercise.targetSets, exercise.targetReps, exercise.targetDurationSeconds)}
                  </ThemedText>
                )}
              </View>
              {exercise.sets.length === 0 ? (
                <ThemedText type="default" style={styles.skippedText}>
                  Planned, not logged
                </ThemedText>
              ) : (
                exercise.sets.map((set, idx) => (
                  <View key={set.id} style={styles.setRow}>
                    <ThemedText type="default" style={styles.setLine}>
                      {set.setType === 'warmup' ? `Warmup ${idx + 1}: ` : `${idx + 1}. `}
                      {set.line}
                    </ThemedText>
                  </View>
                ))
              )}
            </View>
          ))}

          {detail.otherSets.length > 0 && (
            <View style={styles.exerciseSection}>
              <ThemedText type="subtitle" style={styles.exerciseName}>
                Other logged sets
              </ThemedText>
              <ThemedText type="default" style={styles.skippedText}>
                Logged against an exercise since removed from this routine.
              </ThemedText>
              {detail.otherSets.map((set, idx) => (
                <View key={set.id} style={styles.setRow}>
                  <ThemedText type="default" style={styles.setLine}>
                    {idx + 1}. {set.line}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
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
    color: '#007AFF',
    fontWeight: '500',
  },
  scroll: {
    width: '100%',
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.one,
  },
  dateText: {
    textAlign: 'center',
    opacity: 0.6,
    marginBottom: Spacing.four,
  },
  exerciseSection: {
    marginBottom: Spacing.four,
  },
  exerciseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: Spacing.one,
  },
  exerciseName: {
    fontWeight: '600',
  },
  exerciseTarget: {
    opacity: 0.6,
    fontSize: 12,
  },
  skippedText: {
    opacity: 0.5,
    fontStyle: 'italic',
  },
  setRow: {
    paddingVertical: Spacing.one,
    paddingLeft: Spacing.two,
  },
  setLine: {
    fontSize: 14,
  },
});
