import { StyleSheet, View, TextInput, ScrollView, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '@/constants/theme';
import { SessionPresenterOutput, formatLoggedSetLine } from '@/state/sessionPresenter';
import { snapRpe, rpeHint, RPE_MIN, RPE_MAX, RPE_STEP } from '@/state/rpe';

interface SetLoggerProps {
  presenter: SessionPresenterOutput;
  currentReps?: number;
  currentWeight?: number;
  currentRpe?: number;
  currentDuration?: number;
  onRepsChange: (reps: number) => void;
  onWeightChange: (weight: number) => void;
  onRpeChange: (rpe: number | undefined) => void;
  onDurationChange: (duration: number) => void;
}

export function SetLogger({
  presenter,
  currentReps,
  currentWeight,
  currentRpe,
  currentDuration,
  onRepsChange,
  onWeightChange,
  onRpeChange,
  onDurationChange,
}: SetLoggerProps) {
  const isDurationBased = presenter.currentEntry?.kind === 'stretch' || presenter.currentEntry?.kind === 'cardio';

  // Free-form stretch cool-down: conditional rendering only — the engine
  // rejects LogSet/SetDone in this phase, so nothing can advance mid-stretch.
  // Finish Session stays available in the session screen's footer.
  if (presenter.isStretching) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.exerciseTitle}>Stretching</ThemedText>
        <ThemedText style={styles.stretchingHint}>
          Take your time — the workout is paused where you left it.
        </ThemedText>

        <ScrollView style={styles.loggedSets}>
          <ThemedText type="smallBold">{`Logged sets (${presenter.loggedSetCount})`}</ThemedText>
          {presenter.loggedSets.map((set, idx) => (
            <View key={idx} style={styles.setRow}>
              <ThemedText>{formatLoggedSetLine(set)}</ThemedText>
            </View>
          ))}
        </ScrollView>

        <View style={styles.buttonGroup}>
          <Pressable
            style={[styles.button, styles.primaryButton]}
            onPress={() => presenter.onStopStretching()}
          >
            <ThemedText style={styles.buttonText}>Done Stretching</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText style={styles.exerciseTitle}>
        {presenter.currentExerciseTitle || 'Exercise'}
      </ThemedText>

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
          <ThemedText>Duration (sec)</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Duration"
            keyboardType="decimal-pad"
            value={currentDuration?.toString() || ''}
            onChangeText={(text) => {
              const value = text ? parseInt(text, 10) : 0;
              onDurationChange(value);
            }}
          />
        </View>
      ) : (
        // Side-by-side to keep the fixed chrome inside one phone screen
        <View style={styles.inputRow}>
          <View style={[styles.inputGroup, styles.inputRowItem]}>
            <ThemedText>Reps</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Reps"
              keyboardType="decimal-pad"
              value={currentReps?.toString() || ''}
              onChangeText={(text) => {
                const value = text ? parseInt(text, 10) : 0;
                onRepsChange(value);
              }}
            />
          </View>

          <View style={[styles.inputGroup, styles.inputRowItem]}>
            <ThemedText>Weight (lbs)</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Weight"
              keyboardType="decimal-pad"
              value={currentWeight?.toString() || ''}
              onChangeText={(text) => {
                const value = text ? parseFloat(text) : 0;
                onWeightChange(value);
              }}
            />
          </View>
        </View>
      )}

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

      {/* The one scroller on the session screen: only the current exercise's
          sets, newest first, bounded by the fixed chrome around it. */}
      <ScrollView style={styles.loggedSets}>
        <ThemedText type="smallBold">
          {`Logged sets (${presenter.currentExerciseLoggedSets.length})`}
        </ThemedText>
        {presenter.currentExerciseLoggedSets.map((set, idx) => (
          <View key={idx} style={styles.setRow}>
            <ThemedText>{formatLoggedSetLine(set)}</ThemedText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.buttonGroup}>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, styles.primaryButton, styles.rowButton]}
            onPress={() => {
              const values: any = {};
              if (!isDurationBased) {
                if (currentReps !== undefined) values.reps = currentReps;
                // Display unit: the presenter converts lbs to canonical kg
                if (currentWeight !== undefined) values.weightLbs = currentWeight;
              } else {
                if (currentDuration !== undefined) values.durationSeconds = currentDuration;
              }
              if (currentRpe !== undefined && currentRpe > 0) values.rpe = currentRpe;
              presenter.onLogSet(values);
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

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, styles.warningButton, styles.rowButton]}
            onPress={() => presenter.onSkipExercise()}
          >
            <ThemedText style={styles.buttonText}>Skip Exercise</ThemedText>
          </Pressable>

          {(presenter.phase === 'working' || presenter.phase === 'resting') && (
            <Pressable
              style={[styles.button, styles.successButton, styles.rowButton]}
              onPress={() => presenter.onStartStretching()}
            >
              <ThemedText style={styles.buttonText}>Stretch</ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    // The screen already pads horizontally; extra padding here would double up
    flex: 1,
  },
  exerciseTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  setPositionText: {
    marginTop: Spacing.one,
    opacity: 0.7,
  },
  stretchingHint: {
    marginTop: Spacing.two,
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
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: Spacing.two,
    marginTop: Spacing.one,
    color: '#000',
  },
  rpeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rpeClearText: {
    color: '#FF3B30',
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
    paddingVertical: Spacing.one,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  buttonGroup: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
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
    backgroundColor: '#007AFF',
  },
  successButton: {
    backgroundColor: '#34C759',
  },
  warningButton: {
    backgroundColor: '#FF9500',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
