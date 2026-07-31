import { useState, useEffect } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SetLogger } from '@/components/SetLogger';
import { RestCountdown } from '@/components/RestCountdown';
import { activeSessionStore, DISCARD_FAILURE_PREFIX } from '@/state/activeSession';
import {
  computeSetPrefill,
  createSessionPresenter,
  currentExerciseHasLoggedSet,
  SetInputValues,
} from '@/state/sessionPresenter';
import { kgToLbs } from '@/state/weightUnits';
import { Spacing } from '@/constants/theme';
import { getExerciseTitles, getExerciseWorkingSetHistory } from '@/db/repository';
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

/** Render-only exercise progress bar; all numbers come from the presenter. */
function ExerciseProgress({
  completed,
  total,
  progress,
}: {
  completed: number;
  total: number;
  progress: number;
}) {
  return (
    <View style={styles.progressBlock}>
      <ThemedText style={styles.progressLabel}>
        {`${completed} of ${total} exercises`}
      </ThemedText>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
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
  const [exerciseTitles, setExerciseTitles] = useState<Record<string, string>>({});

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

  // Prefill the set inputs on exercise change (and on mount, which restores
  // them after rehydration): the exercise's own last in-session set wins, then
  // cross-session history (strength only, fetched async), then the routine
  // targets — all decided by the pure computeSetPrefill. RPE always resets.
  // Keyed on sessionId+exerciseIndex only, so it never clobbers values the
  // user types between sets of the same exercise.
  useEffect(() => {
    if (!sessionState) return;
    let cancelled = false;

    const apply = (prefill: SetInputValues | undefined) => {
      setCurrentReps(prefill?.reps);
      setCurrentWeight(prefill?.weightLbs);
      setCurrentDuration(prefill?.durationSeconds);
      setCurrentRpe(undefined);
    };

    // Synchronous prefill first (in-session sets or targets)...
    apply(computeSetPrefill(sessionState));

    // ...then upgrade with cross-session history where it applies. The async
    // continuation re-reads fresh store state before applying, so a set logged
    // while the query was in flight is never clobbered by the stale closure.
    const entry = sessionState.entries?.[sessionState.exerciseIndex];
    if (!entry || entry.kind !== 'strength') return;

    (async () => {
      try {
        const db = getDatabase();
        const history = await getExerciseWorkingSetHistory(db, entry.exerciseId);
        const latest = history[0];
        if (cancelled || !latest) return;

        const fallback: SetInputValues = {};
        if (latest.reps != null) fallback.reps = latest.reps;
        // Stored kg converts to display lbs on the way into the input
        if (latest.weightKg != null) fallback.weightLbs = kgToLbs(latest.weightKg);
        if (fallback.reps === undefined && fallback.weightLbs === undefined) return;

        // The closure's sessionState is a snapshot from when the effect ran,
        // and dispatches during the query don't re-run this effect (deps are
        // sessionId+exerciseIndex only). Bail unless fresh store state still
        // matches the effect keys and the exercise has no in-session set.
        const fresh = activeSessionStore.getState().sessionState;
        if (
          !fresh ||
          fresh.sessionId !== sessionState.sessionId ||
          fresh.exerciseIndex !== sessionState.exerciseIndex ||
          currentExerciseHasLoggedSet(fresh)
        ) {
          return;
        }

        apply(computeSetPrefill(fresh, fallback));
      } catch (error) {
        // Prefill is best-effort; empty inputs are always a valid state.
        console.error('Failed to prefill from history:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Primitive deps on purpose (see the progression-hint effect above).
  }, [sessionState?.sessionId, sessionState?.exerciseIndex]);

  // Engine state carries only exercise ids, so titles are resolved shell-side.
  // Entries are fixed for a session's lifetime, so one load per session suffices.
  useEffect(() => {
    const loadTitles = async () => {
      if (!sessionState) {
        setExerciseTitles({});
        return;
      }

      try {
        const db = getDatabase();
        const ids = (sessionState.entries ?? []).map((entry: any) => entry.exerciseId);
        setExerciseTitles(await getExerciseTitles(db, ids));
      } catch (error) {
        console.error('Failed to load exercise titles:', error);
        setExerciseTitles({});
      }
    };

    loadTitles();
  }, [sessionState?.sessionId]);

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

  const presenter = createSessionPresenter(sessionState, dispatch, progressionHint, exerciseTitles);

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
          onPress: async () => {
            // Delegate to presenter, which handles dispatch and returns the promise
            const result = await presenter.onAbandonSession();

            if (!result) {
              // Abandon failed: read store state to discriminate error type
              const postDispatchLastError = activeSessionStore.getState().lastError;

              if (postDispatchLastError?.startsWith(DISCARD_FAILURE_PREFIX)) {
                // Discard failed: session row still on disk, row is inspectable
                Alert.alert(
                  'Couldn\'t discard the workout',
                  'The workout data may reappear at next launch — you can abandon it again then.',
                  [
                    {
                      text: 'OK',
                      onPress: () => router.back(),
                    },
                  ]
                );
              } else {
                // Transition error (rejection): workout is still live in the engine, or no session existed
                // Do not navigate—let the user stay in the session if it's still live
                Alert.alert(
                  'Couldn\'t abandon the workout',
                  'Try again.',
                  [
                    {
                      text: 'OK',
                    },
                  ]
                );
              }
              return;
            }

            // Success: navigate back
            router.back();
          },
        },
      ]
    );
  };

  // Irreversible (kicks off sync, the HealthKit export, and the debrief), so
  // finishing always confirms. Not destructive — data is saved, not deleted —
  // hence no destructive button style; that stays unique to Abandon.
  const confirmFinish = () => {
    Alert.alert(presenter.finishConfirmation.title, presenter.finishConfirmation.message, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', onPress: () => presenter.onFinishSession() },
    ]);
  };

  // Resting takes over the whole screen: big countdown, skip or pause only
  if (presenter.isResting || presenter.isRestPaused) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          {lastError && (
            <View style={styles.errorBanner}>
              <ThemedText style={styles.errorText}>{lastError}</ThemedText>
            </View>
          )}
          <ExerciseProgress
            completed={presenter.completedExerciseCount}
            total={presenter.totalExerciseCount}
            progress={presenter.exerciseProgress}
          />
          <RestCountdown
            deadlineMs={presenter.restDeadlineMs}
            frozenRemainingMs={presenter.restRemainingMs}
            isPaused={presenter.isRestPaused}
            onRestElapsed={presenter.onRestElapsed}
            onSkip={presenter.onSkipRest}
            onPause={presenter.onPause}
            onResume={presenter.onResume}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Fixed column, no whole-screen scrolling: the only scroller is the
  // logged-set list inside SetLogger. Without the outer ScrollView the
  // KeyboardAvoidingView is mandatory or the keyboard covers the inputs.
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <ThemedText type="smallBold">Active Session</ThemedText>
              <View style={styles.headerControls}>
                <ThemedText type="small" style={styles.phaseText}>
                  {presenter.phase}
                </ThemedText>
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
            </View>
            <ExerciseProgress
              completed={presenter.completedExerciseCount}
              total={presenter.totalExerciseCount}
              progress={presenter.exerciseProgress}
            />
          </View>

          {lastError && (
            <View style={styles.errorBanner}>
              <ThemedText style={styles.errorText}>{lastError}</ThemedText>
            </View>
          )}

          <View style={styles.content}>
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
          </View>

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
              <View style={styles.footerRow}>
                <Pressable
                  style={[styles.button, styles.finishButton, styles.footerButton]}
                  onPress={confirmFinish}
                >
                  <ThemedText style={styles.buttonText}>Finish Session</ThemedText>
                </Pressable>
                <Pressable style={[styles.button, styles.footerButton]} onPress={confirmAbandon}>
                  <ThemedText style={styles.abandonText}>Abandon</ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
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
  flex: {
    flex: 1,
  },
  header: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  phaseText: {
    opacity: 0.7,
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
  progressBlock: {
    marginTop: Spacing.two,
  },
  progressLabel: {
    fontSize: 13,
    opacity: 0.7,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e0e0e0',
    marginTop: Spacing.one,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  resumeText: {
    color: '#34C759',
  },
  content: {
    flex: 1,
    marginVertical: Spacing.two,
  },
  footer: {
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  footerRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  footerButton: {
    flex: 1,
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
