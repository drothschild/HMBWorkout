import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TextInput, ScrollView, Pressable, Modal, Keyboard, LayoutChangeEvent, InputAccessoryView } from 'react-native';
import Slider from '@react-native-community/slider';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { ExerciseStopwatch } from './ExerciseStopwatch';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
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
  /** True when the RPE popup is open (shown after final set). */
  rpePopupOpen?: boolean;
  /** Handler to open/close the RPE popup. */
  onRpePopupOpenChange?: (open: boolean) => void;
  /** Called when RPE popup is confirmed (Done or Skip) with the final RPE value. */
  onRpePopupConfirm?: (rpe: number | undefined) => void;
  /** Optional content rendered inside this column, directly below the button row.
   *  Deliberately un-named: SetLogger renders it opaquely and knows nothing about
   *  what it is, so no decision moves out of session.tsx (FCIS). */
  belowButtonsSlot?: React.ReactNode;
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
  rpePopupOpen,
  onRpePopupOpenChange,
  onRpePopupConfirm,
  belowButtonsSlot,
}: SetLoggerProps) {
  const theme = useTheme();
  // TextInput is not a Themed* component, so its text and border colors must
  // resolve against the scheme here — a static color renders black-on-black
  // in dark mode.
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];
  const setRowStyle = [styles.setRow, { borderBottomColor: theme.backgroundSelected }];

  // Track container height and measured chrome heights to enforce minimum space
  // for buttonRow. When the keyboard opens and squeezes the layout, we constrain
  // loggedSets to ensure buttonRow stays visible. Without this, buttonRow overflows
  // the viewport. Instead of a hardcoded reserve, we measure the actual chrome
  // heights so the constraint is correct for all exercise configurations (duration
  // with ~130-150pt stopwatch vs reps/weight with ~120pt inputs).
  const [containerHeight, setContainerHeight] = useState(0);
  const [chromeHeightAboveScroller, setChromeHeightAboveScroller] = useState(0);
  const [buttonRowHeight, setButtonRowHeight] = useState(0);

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    setContainerHeight(event.nativeEvent.layout.height);
  };

  const handleChromeLayout = (event: LayoutChangeEvent) => {
    setChromeHeightAboveScroller(event.nativeEvent.layout.height);
  };

  const handleButtonRowLayout = (event: LayoutChangeEvent) => {
    setButtonRowHeight(event.nativeEvent.layout.height);
  };

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
    <ThemedView style={styles.container} onLayout={handleContainerLayout}>
      {/* Chrome above the scrolled sets (title, inputs, etc.). Measured to compute
          the scroller's maxHeight constraint: as the keyboard squeezes the layout,
          loggedSets.maxHeight must shrink to reserve space for all the fixed chrome
          and the button row, so Log Set / Skip Set stay reachable. */}
      <View onLayout={handleChromeLayout}>
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
              inputAccessoryViewID="keyboardAccessory"
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
                inputAccessoryViewID="keyboardAccessory"
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
                inputAccessoryViewID="keyboardAccessory"
              />
            </View>
          </View>
        )}
      </View>

      {/* RPE popup modal - shown after final set of each exercise */}
      <Modal
        visible={Boolean(rpePopupOpen)}
        animationType="slide"
        transparent
        onRequestClose={() => onRpePopupOpenChange?.(false)}
      >
        <View style={styles.rpeBackdrop}>
          <View style={[styles.rpeSheet, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold">Rate the last set&apos;s effort (RPE)</ThemedText>

            <View style={styles.rpeModalContent}>
              <View style={styles.rpeSliderContainer}>
                <Slider
                  style={styles.rpeSlider}
                  minimumValue={RPE_MIN}
                  maximumValue={RPE_MAX}
                  step={RPE_STEP}
                  value={currentRpe ?? RPE_MIN}
                  onValueChange={(value) => onRpeChange(snapRpe(value))}
                  minimumTrackTintColor="#007AFF"
                />
              </View>

              <View style={styles.rpeDisplay}>
                {currentRpe !== undefined ? (
                  <>
                    <ThemedText style={styles.rpeValue}>{currentRpe}</ThemedText>
                    <ThemedText style={styles.rpeHint}>{rpeHint(currentRpe)}</ThemedText>
                  </>
                ) : (
                  <ThemedText style={styles.rpeHint}>Optional</ThemedText>
                )}
              </View>
            </View>

            <View style={styles.rpeButtonContainer}>
              <Pressable
                style={[styles.button, styles.secondaryButton, styles.rowButton]}
                onPress={() => {
                  onRpePopupOpenChange?.(false);
                  onRpePopupConfirm?.(undefined);
                }}
                accessibilityRole="button"
                accessibilityLabel="Skip RPE"
              >
                <ThemedText style={styles.buttonText}>Skip</ThemedText>
              </Pressable>

              <Pressable
                style={[styles.button, styles.primaryButton, styles.rowButton]}
                onPress={() => {
                  onRpePopupOpenChange?.(false);
                  onRpePopupConfirm?.(currentRpe);
                }}
                accessibilityRole="button"
                accessibilityLabel="Confirm RPE"
              >
                <ThemedText style={styles.buttonText}>Done</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* The one scroller on the session screen: only the current exercise's
          sets, newest first, bounded by the fixed chrome around it.

          When the keyboard opens and squeezes the layout, we constrain this
          scrollview's height to ensure buttonRow stays visible. Without the
          maxHeight, loggedSets.flex: 1 takes all available space, pushing
          buttonRow below the viewport (no scroll recovery, since overflow
          paints outside the visible container). The maxHeight is computed from
          actual measured heights of the chrome above the scroller (title, inputs,
          etc.) and the button row, so it stays correct as exercise types change
          (e.g., duration ~130-150pt stopwatch vs reps/weight ~120pt inputs) and
          the component evolves. */}
      <ScrollView
        style={[
          styles.loggedSets,
          containerHeight > 0 && buttonRowHeight > 0
            ? { maxHeight: Math.max(100, containerHeight - chromeHeightAboveScroller - buttonRowHeight) }
            : {},
        ]}
      >
        <ThemedText type="smallBold">
          {`Logged sets (${presenter.currentExerciseLoggedSets.length})`}
        </ThemedText>
        {presenter.currentExerciseLoggedSets.map((set, idx) => (
          <View key={idx} style={setRowStyle}>
            <ThemedText>{formatLoggedSetLine(set)}</ThemedText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.buttonRow} onLayout={handleButtonRowLayout}>
        <Pressable
          style={[styles.button, styles.primaryButton, styles.rowButton]}
          onPress={() => {
            // If this is the last set of a non-duration exercise, open the RPE popup
            // instead of dispatching immediately. Otherwise dispatch right away.
            if (!isDurationBased && presenter.isLastSetOfExercise) {
              onRpePopupOpenChange?.(true);
            } else {
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
            }
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

      {belowButtonsSlot}

      {/* Keyboard accessory view: provides a standard iOS "Done" button above the
          numeric keypad, making keyboard dismissal discoverable. When the user taps
          a numeric input, this bar appears above the keyboard with a tap-to-dismiss
          affordance, following iOS conventions. */}
      <InputAccessoryView nativeID="keyboardAccessory" backgroundColor={theme.background}>
        <View style={styles.keyboardAccessoryView}>
          <Pressable
            onPress={() => Keyboard.dismiss()}
            style={styles.doneButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
          >
            <ThemedText style={styles.doneButtonText}>Done</ThemedText>
          </Pressable>
        </View>
      </InputAccessoryView>
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
  rpeSlider: {
    marginTop: Spacing.one,
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
    // Ensure the action zone stays visible even when layout is constrained.
    // This combined with loggedSets.maxHeight keeps buttonRow reachable at
    // all viewport heights, fixing 113/341 cases where it was off-screen.
    minHeight: 48,
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
  rpeBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  rpeSheet: {
    // backgroundColor is theme-resolved inline
    padding: Spacing.three,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    gap: Spacing.three,
  },
  rpeModalContent: {
    gap: Spacing.three,
  },
  rpeSliderContainer: {
    paddingHorizontal: Spacing.one,
  },
  rpeDisplay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  rpeValue: {
    fontSize: 28,
    lineHeight: 42,
    fontWeight: 'bold',
  },
  rpeHint: {
    fontSize: 14,
    opacity: 0.7,
  },
  rpeButtonContainer: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  secondaryButton: {
    backgroundColor: '#8E8E93',
  },
  keyboardAccessoryView: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: 1,
    borderTopColor: '#D0D0D0',
  },
  doneButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
});
