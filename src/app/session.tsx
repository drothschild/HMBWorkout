import { useState, useEffect } from 'react';
import { Alert, StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SetLogger } from '@/components/SetLogger';
import { RestCountdown } from '@/components/RestCountdown';
import { activeSessionStore } from '@/state/activeSession';
import { createSessionPresenter } from '@/state/sessionPresenter';
import { Spacing } from '@/constants/theme';
import { getExerciseWorkingSetHistory } from '@/db/repository';
import { computeProgressionHint } from '@/state/progressionHintHelper';

// Defer import until needed to avoid loading database singleton at module load time
let database: any = null;

function getDatabase() {
  if (!database) {
    const mod = require('@/db');
    database = mod.database;
  }
  return database;
}

/**
 * Session screen - modal route for active workout logging.
 * Pure rendering; all logic delegated to presenter.
 */
export default function SessionScreen() {
  const router = useRouter();
  const [currentReps, setCurrentReps] = useState<number | undefined>();
  const [currentWeight, setCurrentWeight] = useState<number | undefined>();
  const [currentRpe, setCurrentRpe] = useState<number | undefined>();
  const [currentDuration, setCurrentDuration] = useState<number | undefined>();
  const [progressionHint, setProgressionHint] = useState<string | undefined>();

  const sessionState = activeSessionStore((state: any) => state.sessionState);
  const lastError = activeSessionStore((state: any) => state.lastError);
  const dispatch = activeSessionStore((state: any) => state.dispatch);

  // Compute progression hint when exercise changes
  useEffect(() => {
    const computeHint = async () => {
      if (!sessionState) {
        setProgressionHint(undefined);
        return;
      }

      const currentEntry = sessionState.entries?.[sessionState.exerciseIndex];
      if (!currentEntry || currentEntry.kind !== 'strength') {
        setProgressionHint(undefined);
        return;
      }

      try {
        // Query DB for prior working sets for this exercise
        const db = getDatabase();
        const history = await getExerciseWorkingSetHistory(db, currentEntry.exerciseId);

        // Convert SessionSet records to LoggedSet format for the rule
        const loggedSets = history.map((set: any) => ({
          exerciseId: currentEntry.exerciseId,
          reps: set.reps ?? 0,
          weightKg: set.weightKg ?? 0,
          rpe: set.rpe ?? 0,
          setType: set.setType,
          durationSeconds: set.durationSeconds,
        }));

        // Compute the hint
        const hint = computeProgressionHint(currentEntry.exerciseId, loggedSets, 'strength');
        setProgressionHint(hint);
      } catch (error) {
        console.error('Failed to compute progression hint:', error);
        setProgressionHint(undefined);
      }
    };

    computeHint();
    // Recompute only when the current exercise changes (primitive dep — the
    // hint is per-exercise; depending on the entries array reference re-ran it
    // on every dispatch).
  }, [sessionState?.exerciseIndex]);

  if (!sessionState) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>No active session</ThemedText>
          <Pressable onPress={() => router.back()}>
            <ThemedText>Close</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const presenter = createSessionPresenter(sessionState, dispatch, progressionHint);

  // Destructive and unrecoverable: the workout and its logged sets are deleted
  // and never reach the vault, so it takes an explicit confirmation.
  const confirmAbandon = () => {
    Alert.alert(
      'Abandon workout?',
      'This workout and every set you have logged will be deleted. It will not be saved to your vault.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Abandon',
          style: 'destructive',
          onPress: () => {
            presenter.onAbandonSession();
            router.back();
          },
        },
      ]
    );
  };

  // Resting takes over the whole screen: big countdown, cancel or pause only
  if (presenter.isResting || presenter.isRestPaused) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          {lastError && (
            <View style={styles.errorBanner}>
              <ThemedText style={styles.errorText}>{lastError}</ThemedText>
            </View>
          )}
          <RestCountdown
            deadlineMs={presenter.restDeadlineMs}
            frozenRemainingMs={presenter.restRemainingMs}
            isPaused={presenter.isRestPaused}
            onRestElapsed={presenter.onRestElapsed}
            onCancel={presenter.onSkipRest}
            onPause={presenter.onPause}
            onResume={presenter.onResume}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">Active Session</ThemedText>
          <ThemedText type="default">{presenter.phase}</ThemedText>
          {presenter.isPaused && (
            <Pressable onPress={() => presenter.onResume()}>
              <ThemedText style={styles.resumeText}>Resume</ThemedText>
            </Pressable>
          )}
          {!presenter.isPaused && presenter.phase !== 'done' && (
            <Pressable onPress={() => presenter.onPause()}>
              <ThemedText style={styles.pauseText}>Pause</ThemedText>
            </Pressable>
          )}
        </View>

        {lastError && (
          <View style={styles.errorBanner}>
            <ThemedText style={styles.errorText}>{lastError}</ThemedText>
          </View>
        )}

        <ScrollView style={styles.content}>
          {presenter.phase !== 'done' && (
            <SetLogger
              presenter={presenter}
              currentReps={currentReps}
              currentWeight={currentWeight}
              currentRpe={currentRpe}
              currentDuration={currentDuration}
              onRepsChange={setCurrentReps}
              onWeightChange={setCurrentWeight}
              onRpeChange={setCurrentRpe}
              onDurationChange={setCurrentDuration}
            />
          )}
        </ScrollView>

        <View style={styles.footer}>
          {presenter.phase === 'done' ? (
            <Pressable
              style={[styles.button, styles.finishButton]}
              onPress={() => {
                router.back();
              }}
            >
              <ThemedText style={styles.buttonText}>Close</ThemedText>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={[styles.button, styles.finishButton]}
                onPress={() => presenter.onFinishSession()}
              >
                <ThemedText style={styles.buttonText}>Finish Session</ThemedText>
              </Pressable>
              <Pressable style={styles.button} onPress={confirmAbandon}>
                <ThemedText style={styles.abandonText}>Abandon workout</ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  header: {
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  errorBanner: {
    backgroundColor: '#FF3B30',
    padding: Spacing.two,
    borderRadius: 4,
    marginVertical: Spacing.two,
  },
  errorText: {
    color: 'white',
  },
  pauseText: {
    color: '#FF9500',
  },
  resumeText: {
    color: '#34C759',
  },
  content: {
    flex: 1,
    marginVertical: Spacing.three,
  },
  footer: {
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  button: {
    paddingVertical: Spacing.two,
    borderRadius: 4,
    alignItems: 'center',
  },
  finishButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  abandonText: {
    color: '#FF3B30',
  },
});
