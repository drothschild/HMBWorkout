import { useState, useEffect } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SetLogger } from '@/components/SetLogger';
import { RestCountdown } from '@/components/RestCountdown';
import { ReplaceExercise } from '@/components/ReplaceExercise';
import { WorkoutStopwatch } from '@/components/WorkoutStopwatch';
import { activeSessionStore, DISCARD_FAILURE_PREFIX } from '@/state/activeSession';
import {
  computeSetPrefill,
  createSessionPresenter,
  currentExerciseId,
  historyPrefillStillApplies,
  SetInputValues,
} from '@/state/sessionPresenter';
import { formatSetInputValue } from '@/state/setInputs';
import { restCommentaryStore, restCommentaryTarget } from '@/state/restCommentaryStore';
import { exerciseQuestionStore, exerciseQuestionTarget, exerciseQuestionKey, hasAnthropicKey } from '@/state/exerciseQuestionStore';
import { getSettings } from '@/state/settings';
import { kgToLbs } from '@/state/weightUnits';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getExerciseTitles, getExerciseWorkingSetHistory, getRoutineDisplay } from '@/db/repository';
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
  const theme = useTheme();
  return (
    <View style={styles.progressBlock}>
      <ThemedText style={styles.progressLabel}>
        {`${completed} of ${total} exercises`}
      </ThemedText>
      <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
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
  const theme = useTheme();
  // Raw text state for the numeric inputs: what the user typed is what
  // renders. Numbers exist only past buildLogSetValues in SetLogger — a
  // parse-per-keystroke here is what produced the stuck "NaN" field
  // (see src/state/setInputs.ts).
  const [repsText, setRepsText] = useState('');
  const [weightText, setWeightText] = useState('');
  const [currentRpe, setCurrentRpe] = useState<number | undefined>();
  const [durationText, setDurationText] = useState('');
  const [progressionHint, setProgressionHint] = useState<string | undefined>();
  const [exerciseTitles, setExerciseTitles] = useState<Record<string, string>>({});
  const [routineDisplay, setRoutineDisplay] = useState<
    { name: string; notes: string | null } | undefined
  >();

  const sessionState = activeSessionStore((state: any) => state.sessionState);
  const lastError = activeSessionStore((state: any) => state.lastError);
  const dispatch = activeSessionStore((state: any) => state.dispatch);

  const restCommentary = restCommentaryStore((state) => state.text);
  const restCommentaryPending = restCommentaryStore((state) => state.pending);
  const restCommentaryAttempted = restCommentaryStore((state) => state.attempted);

  const questionExpandedKey = exerciseQuestionStore((state) => state.expandedKey);
  const questionText = exerciseQuestionStore((state) => state.text);
  const questionPending = exerciseQuestionStore((state) => state.pending);

  // The exercise being performed, as a primitive effect key. Every per-exercise
  // effect below depends on this rather than on exerciseIndex alone:
  // ReplaceExercise rewrites entries[exerciseIndex].exerciseId in place, so the
  // index can stay put while the exercise underneath it changes.
  const currentEntryExerciseId = currentExerciseId(sessionState);

  // Compute progression hint when the exercise changes
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
    // Recompute only when the current exercise changes (primitive deps — the
    // hint is per-exercise; depending on the entries array reference re-ran it
    // on every dispatch). The exercise id is part of that: a swap changes the
    // exercise without changing the index.
  }, [sessionState?.exerciseIndex, currentEntryExerciseId]);

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
      // Prefill numbers become the input's text state here; absent prefills
      // render as empty fields (placeholder), never "0" or "NaN".
      setRepsText(formatSetInputValue(prefill?.reps));
      setWeightText(formatSetInputValue(prefill?.weightLbs));
      setDurationText(formatSetInputValue(prefill?.durationSeconds));
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

        // The closure's sessionState is a snapshot from when the effect ran, so
        // the result is applied only if fresh store state still matches every
        // effect key — including the exercise id, which a swap changes without
        // touching the session or the index.
        const fresh = activeSessionStore.getState().sessionState;
        if (
          !fresh ||
          !historyPrefillStillApplies(fresh, {
            sessionId: sessionState.sessionId,
            exerciseIndex: sessionState.exerciseIndex,
            exerciseId: entry.exerciseId,
          })
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
    // Primitive deps on purpose (see the progression-hint effect above). The
    // exercise id is one of them, so a swap re-prefills for the substitute
    // instead of leaving the replaced exercise's numbers in the inputs.
  }, [sessionState?.sessionId, sessionState?.exerciseIndex, currentEntryExerciseId]);

  // Engine state carries only exercise ids, so titles are resolved shell-side.
  // Entries are otherwise fixed for a session's lifetime, but ReplaceExercise
  // rewrites one entry's exerciseId mid-session — so the reload is keyed on the
  // ids themselves, not just the session, or the swapped exercise would render
  // as its raw slug until the next launch.
  const entryExerciseIdsKey = (sessionState?.entries ?? [])
    .map((entry: any) => entry.exerciseId)
    .join('|');

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
  }, [sessionState?.sessionId, entryExerciseIdsKey]);

  // Engine state carries only routineId, so the routine's name and description
  // are resolved shell-side too. The routine row is fixed for a session's
  // lifetime, so one load per session suffices (and survives rehydration).
  useEffect(() => {
    const loadRoutine = async () => {
      if (!sessionState) {
        setRoutineDisplay(undefined);
        return;
      }

      try {
        const db = getDatabase();
        setRoutineDisplay((await getRoutineDisplay(db, sessionState.routineId)) ?? undefined);
      } catch (error) {
        console.error('Failed to load routine display:', error);
        setRoutineDisplay(undefined);
      }
    };

    loadRoutine();
  }, [sessionState?.sessionId]);

  // Rest-screen coach commentary. The engine owns when rest happens; this only
  // mirrors the upcoming exercise into the commentary store, which caches one
  // comment per entry and swallows every failure — the rest screen renders the
  // same with or without it.
  const commentaryTarget = restCommentaryTarget(sessionState, exerciseTitles);
  // Identity, not the object: the target is rebuilt every render, and the store
  // no-ops on a repeat of the same entry. Titles are async-loaded; skip the show
  // if the title hasn't resolved yet to avoid caching a comment keyed by raw id.
  // The effect will re-fire once titles load and commentaryKey includes the real
  // title. (Titles resolve at session start, so the id fallback here is the same
  // one currentExerciseTitle already has once resolved.)
  const commentaryKey = commentaryTarget
    ? `${commentaryTarget.sessionId}#${commentaryTarget.entryIdx}`
    : null;
  const shouldShowCommentary =
    commentaryTarget &&
    // Skip if title hasn't resolved yet (async load in flight at rehydration)
    !(
      commentaryTarget.exerciseTitle === commentaryTarget.exerciseId &&
      Object.keys(exerciseTitles).length === 0
    );

  useEffect(() => {
    if (shouldShowCommentary) {
      restCommentaryStore.getState().show(commentaryTarget!).catch(() => {});
    } else {
      restCommentaryStore.getState().hide();
    }
    // Primitive dep on purpose (see the effects above).
  }, [commentaryKey, shouldShowCommentary]);

  // Clean up the rest commentary store on unmount to avoid stale state if the
  // screen is ever unmounted and remounted (e.g., navigation away and back).
  useEffect(() => {
    return () => {
      restCommentaryStore.getState().hide();
    };
  }, []);

  // Exercise-question "?" button: tap-to-expand detailed how-to for the
  // current exercise (see exerciseQuestionStore.ts). The store owns the
  // ephemeral cache and fetch; this only derives which entry the button
  // currently applies to and collapses the block whenever that changes —
  // never on every render, only on an actual exercise change or unmount.
  const questionTarget = exerciseQuestionTarget(sessionState, exerciseTitles);
  const questionKey = questionTarget ? exerciseQuestionKey(questionTarget) : null;
  const isQuestionExpanded = questionKey !== null && questionExpandedKey === questionKey;
  // Non-reactive read: the button is hidden if no key is set at this moment, but
  // adding a key mid-session won't reveal it until an unrelated re-render happens.
  // This is accepted behavior — the primary flow is to configure the key before starting.
  const canAskQuestion = questionTarget !== null && hasAnthropicKey(getSettings());

  useEffect(() => {
    return () => {
      exerciseQuestionStore.getState().collapse();
    };
    // Primitive dep on purpose (see the effects above).
  }, [questionKey]);

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

  const presenter = createSessionPresenter(
    sessionState,
    dispatch,
    progressionHint,
    exerciseTitles,
    routineDisplay
  );

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
            commentary={restCommentary}
            commentaryPending={restCommentaryPending}
            commentaryAttempted={restCommentaryAttempted}
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
          <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
            <View style={styles.headerRow}>
              <ThemedText type="smallBold" style={styles.routineNameText} numberOfLines={1}>
                {presenter.routineName ?? 'Active Session'}
              </ThemedText>
              <View style={styles.headerControls}>
                <WorkoutStopwatch startedAtMs={presenter.startedAtMs} isDone={presenter.phase === 'done'} />
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
            {presenter.routineNotes && (
              <ThemedText type="small" style={styles.routineNotes}>
                {presenter.routineNotes}
              </ThemedText>
            )}
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
            {/* Renders nothing on its own when there is no entry to replace —
                'done' included, since replaceExerciseTarget rejects that phase. */}
            <ReplaceExercise sessionState={sessionState} exerciseTitles={exerciseTitles} />
            {presenter.phase !== 'done' && (
              <SetLogger
                presenter={presenter}
                repsText={repsText}
                weightText={weightText}
                currentRpe={currentRpe}
                durationText={durationText}
                onRepsTextChange={setRepsText}
                onWeightTextChange={setWeightText}
                onRpeChange={setCurrentRpe}
                onDurationTextChange={setDurationText}
                showQuestionButton={canAskQuestion}
                questionExpanded={isQuestionExpanded}
                questionText={questionText}
                questionPending={questionPending}
                onToggleQuestion={() => {
                  if (questionTarget) {
                    exerciseQuestionStore.getState().toggle(questionTarget).catch(() => {});
                  }
                }}
              />
            )}
          </View>

          <View style={[styles.footer, { borderTopColor: theme.backgroundSelected }]}>
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
    // borderBottomColor is theme-resolved inline
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // A long routine name must truncate rather than push headerControls
  // (stopwatch, Pause/Resume) off-screen — confirmed by simulator
  // check that it otherwise does exactly that (Pause becomes unreachable).
  routineNameText: {
    flexShrink: 1,
    marginRight: Spacing.two,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 0,
  },
  routineNotes: {
    opacity: 0.7,
    marginTop: Spacing.one,
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
    // backgroundColor is theme-resolved inline
    height: 6,
    borderRadius: 3,
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
    // borderTopColor is theme-resolved inline
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
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
