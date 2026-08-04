import { useEffect, useRef } from 'react';
import { StyleSheet, View, TextInput, ScrollView, Pressable, Modal } from 'react-native';
import Slider from '@react-native-community/slider';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { ExerciseStopwatch } from './ExerciseStopwatch';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { SessionPresenterOutput, formatLoggedSetLine } from '@/state/sessionPresenter';
import { buildLogSetValues } from '@/state/setInputs';
import { isDurationBasedEntry, makeStopwatchKey } from '@/state/exerciseStopwatch';
import { snapRpe, rpeHint, RPE_MIN, RPE_MAX, RPE_STEP } from '@/state/rpe';

// The numeric inputs carry raw text; numbers exist only past
// buildLogSetValues at the Log Set boundary. Parsing keystrokes into numeric
// state and rendering `toString()` back is what produced the stuck "NaN"
// field (see src/state/setInputs.ts) — don't reintroduce it.
interface SetLoggerProps {
  presenter: SessionPresenterOutput;
  repsText: string;
  weightText: string;
  durationText: string;
  currentRpe?: number;
  onRepsTextChange: (text: string) => void;
  onWeightTextChange: (text: string) => void;
  onRpeChange: (rpe: number | undefined) => void;
  onDurationTextChange: (text: string) => void;
  /** Hidden without a configured Anthropic key — see exerciseQuestionStore.ts. */
  showQuestionButton?: boolean;
  /** True while the "?" answer block is expanded for the current exercise. */
  questionExpanded?: boolean;
  /** The fetched answer, or null while pending/absent. Render-only — never persisted. */
  questionText?: string | null;
  /** True while the one-shot answer is being fetched. */
  questionPending?: boolean;
  onToggleQuestion?: () => void;
}

export function SetLogger({
  presenter,
  repsText,
  weightText,
  durationText,
  currentRpe,
  onRepsTextChange,
  onWeightTextChange,
  onRpeChange,
  onDurationTextChange,
  showQuestionButton,
  questionExpanded,
  questionText,
  questionPending,
  onToggleQuestion,
}: SetLoggerProps) {
  const theme = useTheme();
  // TextInput is not a Themed* component, so its text and border colors must
  // resolve against the scheme here — a static color renders black-on-black
  // in dark mode.
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];
  const setRowStyle = [styles.setRow, { borderBottomColor: theme.backgroundSelected }];

  // iOS's scroll indicator only appears during an actual scroll gesture, so a
  // freshly-opened modal gives no hint the answer continues past the fold.
  // Flash it once real content lands (not during "Loading…", which never
  // needs to scroll) so the user has a reason to try.
  const answerScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (questionExpanded && questionText) {
      answerScrollRef.current?.flashScrollIndicators();
    }
  }, [questionExpanded, questionText]);

  const isDurationBased = isDurationBasedEntry(presenter.currentEntry);

  // Identity of the stopwatch run: the current entry plus its set position, so
  // it restarts when the exercise changes or a set is logged or skipped. Pure
  // and undefined for anything that isn't duration-based, which switches the
  // stopwatch off. Display only — it never decides what the session does next.
  const stopwatchKey = makeStopwatchKey(presenter.currentEntry, {
    isWarmupSet: presenter.isWarmupSet,
    setNumber: presenter.setNumber,
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.exerciseTitleRow}>
        <ThemedText style={styles.exerciseTitle}>
          {presenter.currentExerciseTitle || 'Exercise'}
        </ThemedText>
        {showQuestionButton && (
          <Pressable
            style={[styles.questionButton, { borderColor: theme.text }]}
            onPress={onToggleQuestion}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Ask about this exercise"
          >
            <ThemedText style={styles.questionButtonText}>?</ThemedText>
          </Pressable>
        )}
      </View>

      {/* A real Modal, not an inline expand/collapse: RN blocks touches to
          the screen behind a visible Modal by default, so Close (or the
          Android back button, via onRequestClose) is the only way past it —
          which is the point. Always rendered and gated by `visible`, the
          same way ReplaceExercise.tsx — this screen's other Modal — does it,
          rather than conditionally mounting/unmounting the Modal itself.
          Structure (backdrop + rounded sheet) mirrors that component too. */}
      <Modal
        visible={Boolean(questionExpanded && (questionPending || questionText))}
        animationType="slide"
        transparent
        onRequestClose={onToggleQuestion}
      >
        <View style={styles.questionBackdrop}>
          <View style={[styles.questionSheet, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold">
              {presenter.currentExerciseTitle || 'Exercise'}
            </ThemedText>

            <ScrollView
              ref={answerScrollRef}
              style={styles.questionAnswerScroll}
              contentContainerStyle={styles.questionAnswerContent}
            >
              {questionPending ? (
                <ThemedText type="small" style={styles.questionPendingText}>
                  Loading…
                </ThemedText>
              ) : (
                <ThemedText type="small" style={styles.questionAnswerText}>
                  {questionText}
                </ThemedText>
              )}
            </ScrollView>

            <Pressable
              style={[styles.button, styles.primaryButton]}
              onPress={onToggleQuestion}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <ThemedText style={styles.buttonText}>Close</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {presenter.setPositionLabel !== '' && (
        <ThemedText style={styles.setPositionText}>{presenter.setPositionLabel}</ThemedText>
      )}

      {!isDurationBased && presenter.progressionHint && (
        <View style={styles.hintContainer}>
          <ThemedText style={styles.hintText}>{presenter.progressionHint}</ThemedText>
        </View>
      )}

      {isDurationBased ? (
        <View style={styles.inputGroup}>
          {/* Counts down from the entry's target duration once one is set, so
              the user can see time remaining; entries with no target keep
              counting up. Either way its stop button (manual, or the
              countdown reaching 0:00 on its own) writes the elapsed seconds
              into the Duration field below; the field stays theirs to edit
              either way, and Log Set records it through the same path as a
              typed value. */}
          <ExerciseStopwatch
            stopwatchKey={stopwatchKey}
            running={!presenter.isPaused}
            targetDurationSeconds={presenter.currentEntry?.targetDurationSeconds}
            onStop={(elapsedSeconds) => onDurationTextChange(String(elapsedSeconds))}
          />
          <ThemedText>Duration (sec)</ThemedText>
          <TextInput
            style={inputStyle}
            placeholder="Duration"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            value={durationText}
            onChangeText={onDurationTextChange}
          />
        </View>
      ) : (
        // Side-by-side to keep the fixed chrome inside one phone screen
        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, styles.inputRowItem]}>
            <ThemedText>Reps</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="Reps"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              value={repsText}
              onChangeText={onRepsTextChange}
            />
          </View>

          <View style={[styles.inputGroup, styles.inputRowItem]}>
            <ThemedText>Weight (lbs)</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="Weight"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              value={weightText}
              onChangeText={onWeightTextChange}
            />
          </View>
        </View>
      )}

      {!isDurationBased && (
        <View style={styles.inputGroup}>
          <View style={styles.rpeHeader}>
            <ThemedText>{currentRpe !== undefined ? `RPE: ${currentRpe}` : 'RPE (optional)'}</ThemedText>
            {currentRpe !== undefined && (
              <Pressable onPress={() => onRpeChange(undefined)} hitSlop={8}>
                <ThemedText style={styles.rpeClearText}>Clear</ThemedText>
              </Pressable>
            )}
          </View>
          <Slider
            style={styles.rpeSlider}
            minimumValue={RPE_MIN}
            maximumValue={RPE_MAX}
            step={RPE_STEP}
            value={currentRpe ?? RPE_MIN}
            onValueChange={(value) => onRpeChange(snapRpe(value))}
            minimumTrackTintColor="#007AFF"
          />
          {currentRpe !== undefined && (
            <ThemedText style={styles.rpeHintText}>{rpeHint(currentRpe)}</ThemedText>
          )}
        </View>
      )}

      {/* The one scroller on the session screen: only the current exercise's
          sets, newest first, bounded by the fixed chrome around it. */}
      <ScrollView style={styles.loggedSets}>
        <ThemedText type="smallBold">
          {`Logged sets (${presenter.currentExerciseLoggedSets.length})`}
        </ThemedText>
        {presenter.currentExerciseLoggedSets.map((set, idx) => (
          <View key={idx} style={setRowStyle}>
            <ThemedText>{formatLoggedSetLine(set)}</ThemedText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, styles.primaryButton, styles.rowButton]}
          onPress={() => {
            // Raw text becomes numbers exactly here; invalid or empty
            // fields are omitted (never NaN, never a coerced 0). The
            // weight stays display lbs — the presenter converts to kg.
            presenter.onLogSet(
              buildLogSetValues({
                isDurationBased,
                repsText,
                weightText,
                durationText,
                rpe: currentRpe,
              })
            );
          }}
        >
          <ThemedText style={styles.buttonText}>Log Set</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.button, styles.warningButton, styles.rowButton]}
          onPress={() => presenter.onSkipSet()}
        >
          <ThemedText style={styles.buttonText}>Skip Set</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    // The screen already pads horizontally; extra padding here would double up
    flex: 1,
  },
  exerciseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseTitle: {
    flexShrink: 1,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  questionButton: {
    // borderColor is theme-resolved inline
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.two,
  },
  questionButtonText: {
    fontWeight: '600',
  },
  questionBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  questionSheet: {
    // backgroundColor is theme-resolved inline
    padding: Spacing.three,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    gap: Spacing.two,
    maxHeight: '80%',
  },
  questionAnswerScroll: {
    // questionSheet's maxHeight: '80%' is the real bound (see below) — once
    // a long answer forces the sheet against that cap, Yoga resolves the
    // sheet to a definite height and flexShrink lets this ScrollView give up
    // exactly the space the title and Close button need, rather than the
    // fixed 220 this used to carry over from the pre-Modal inline layout
    // (where it existed to keep the block from crowding the screen's other
    // fixed chrome — a constraint that doesn't apply inside a Modal sheet).
    flexShrink: 1,
  },
  questionAnswerContent: {
    paddingVertical: Spacing.two,
  },
  questionPendingText: {
    opacity: 0.7,
  },
  questionAnswerText: {
    opacity: 0.85,
    lineHeight: 20,
  },
  setPositionText: {
    marginTop: Spacing.one,
    opacity: 0.7,
  },
  hintContainer: {
    backgroundColor: '#E3F2FD',
    borderLeftWidth: 4,
    borderLeftColor: '#1976D2',
    padding: Spacing.two,
    marginVertical: Spacing.two,
    borderRadius: 4,
  },
  hintText: {
    color: '#1565C0',
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  inputRowItem: {
    flex: 1,
  },
  inputGroup: {
    marginVertical: Spacing.one,
  },
  input: {
    // color and borderColor are theme-resolved inline (inputStyle)
    borderWidth: 1,
    borderRadius: 4,
    padding: Spacing.two,
    marginTop: Spacing.one,
  },
  rpeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rpeClearText: {
    color: StatusColor.danger,
  },
  rpeSlider: {
    marginTop: Spacing.one,
  },
  rpeHintText: {
    marginTop: Spacing.one,
    fontSize: 13,
    opacity: 0.7,
  },
  loggedSets: {
    flex: 1,
    marginVertical: Spacing.two,
  },
  setRow: {
    // borderBottomColor is theme-resolved inline (setRowStyle)
    paddingVertical: Spacing.one,
    borderBottomWidth: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  rowButton: {
    flex: 1,
  },
  button: {
    paddingVertical: Spacing.two,
    borderRadius: 4,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: ActionButtonColor.primary,
  },
  warningButton: {
    backgroundColor: ActionButtonColor.warning,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
