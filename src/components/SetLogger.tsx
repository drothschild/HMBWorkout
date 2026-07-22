import { StyleSheet, View, TextInput, ScrollView, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '@/constants/theme';
import { SessionPresenterOutput } from '@/state/sessionPresenter';
import { snapRpe, RPE_MIN, RPE_MAX, RPE_STEP } from '@/state/rpe';

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

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">
        {presenter.currentEntry?.exerciseId || 'Exercise'}
      </ThemedText>

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
        <>
          <View style={styles.inputGroup}>
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

          <View style={styles.inputGroup}>
            <ThemedText>Weight (kg)</ThemedText>
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
        </>
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
      </View>

      <ScrollView style={styles.loggedSets}>
        <ThemedText type="subtitle">Logged Sets</ThemedText>
        {presenter.loggedSets.map((set, idx) => (
          <View key={idx} style={styles.setRow}>
            <ThemedText>
              {isDurationBased ? `${set.durationSeconds}s` : `${set.reps} x ${set.weightKg}kg`}
              {set.rpe !== null && set.rpe !== undefined ? ` RPE: ${set.rpe}` : ''}
            </ThemedText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.buttonGroup}>
        <Pressable
          style={[styles.button, styles.primaryButton]}
          onPress={() => {
            const values: any = {};
            if (!isDurationBased) {
              if (currentReps !== undefined) values.reps = currentReps;
              if (currentWeight !== undefined) values.weightKg = currentWeight;
            } else {
              if (currentDuration !== undefined) values.durationSeconds = currentDuration;
            }
            if (currentRpe !== undefined && currentRpe > 0) values.rpe = currentRpe;
            presenter.onLogSet(values);
          }}
        >
          <ThemedText style={styles.buttonText}>Log Set</ThemedText>
        </Pressable>

        <Pressable style={[styles.button, styles.successButton]} onPress={() => presenter.onSetDone()}>
          <ThemedText style={styles.buttonText}>Set Done</ThemedText>
        </Pressable>

        <Pressable style={[styles.button, styles.warningButton]} onPress={() => presenter.onSkipExercise()}>
          <ThemedText style={styles.buttonText}>Skip Exercise</ThemedText>
        </Pressable>

        {(presenter.phase === 'working' || presenter.phase === 'resting') && (
          <Pressable style={[styles.button, styles.successButton]} onPress={() => presenter.onStartStretching()}>
            <ThemedText style={styles.buttonText}>Stretch</ThemedText>
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
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
  inputGroup: {
    marginVertical: Spacing.two,
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
  loggedSets: {
    flex: 1,
    marginVertical: Spacing.three,
  },
  setRow: {
    paddingVertical: Spacing.one,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  buttonGroup: {
    gap: Spacing.two,
    marginTop: Spacing.three,
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
