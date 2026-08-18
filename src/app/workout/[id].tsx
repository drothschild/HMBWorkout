import { StyleSheet, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { database } from '@/db';
import { sessionDetailPresenter, SessionDetail } from '@/state/sessionDetailPresenter';
import { formatSessionDate } from '@/state/sessionHistoryPresenter';
import { formatPlannedSetsSummary } from '@/state/plannedSetsFormat';


export default function SessionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        setError(null);
        setLoading(false);
        return;
      }

      let cancelled = false;

      (async () => {
        try {
          const result = await sessionDetailPresenter(database, id);
          if (!cancelled) {
            setDetail(result);
            setError(null);
          }
        } catch (err) {
          console.error('Failed to load session detail:', err);
          if (!cancelled) {
            setError('Failed to load workout. Please try again.');
          }
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

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Loading workout...</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!id) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Workout ID not found</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>{error}</ThemedText>
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

  if (detail.endedAt === null) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>This workout is still in progress</ThemedText>
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

          {detail.exercises.map((exercise) => {
            // The plan is the routine's set list (#276); '' when the row
            // prescribes nothing, which hides the label rather than showing
            // "0 sets".
            const targetLabel = formatPlannedSetsSummary(exercise.plannedSets);
            return (
              // The pair, not the row id alone: one routine entry can carry
              // sets from more than one exercise once it has been swapped.
              <View
                key={`${exercise.routineExerciseId}:${exercise.exerciseId}`}
                style={styles.exerciseSection}
              >
                {/*
                  Stacked, not a shared row (#296). The title is `subtitle` —
                  fontSize 32 — so a real Hevy title ("Bench Press (Dumbbell)")
                  is wider than the content column by itself, and a label
                  beside it was squeezed down to its first character. Given the
                  whole width the title wraps and the label always renders in
                  full. Truncating the title instead would have been worse:
                  Hevy names exercises `<Movement> (<Equipment>)`, so the
                  distinguishing token is the one at the end.
                */}
                <ThemedText type="subtitle" style={styles.exerciseName}>
                  {exercise.title}
                </ThemedText>
                {targetLabel !== '' && (
                  <ThemedText type="default" style={styles.exerciseTarget}>
                    {targetLabel}
                  </ThemedText>
                )}
                {exercise.sets.length === 0 ? (
                  <ThemedText type="default" style={styles.skippedText}>
                    No sets logged
                  </ThemedText>
                ) : (
                  exercise.sets.map((set) => (
                    <View key={set.id} style={styles.setRow}>
                      <ThemedText type="default" style={styles.setLine}>
                        {set.label}: {set.line}
                      </ThemedText>
                    </View>
                  ))
                )}
              </View>
            );
          })}

          {detail.otherSets.length > 0 && (
            <View style={styles.exerciseSection}>
              <ThemedText type="subtitle" style={styles.exerciseName}>
                Other logged sets
              </ThemedText>
              <ThemedText type="default" style={styles.skippedText}>
                Logged against an exercise since removed from this routine.
              </ThemedText>
              {detail.otherSets.map((set) => (
                <View key={set.id} style={styles.setRow}>
                  <ThemedText type="default" style={styles.setLine}>
                    {set.label}. {set.line}
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
    color: ActionButtonColor.secondary,
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
  exerciseName: {
    fontWeight: '600',
    marginBottom: Spacing.one,
  },
  exerciseTarget: {
    opacity: 0.6,
    fontSize: 12,
    marginBottom: Spacing.one,
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
