import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { database } from '@/db';
import type { ExerciseKind } from '@/db/models/Exercise';
import { useTheme } from '@/hooks/use-theme';
import { createExercise, exerciseCreationMessage } from '@/state/exerciseCreation';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';

const KINDS: { value: ExerciseKind; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'stretch', label: 'Stretch' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (exerciseId: string) => void;
};

export function NewExerciseSheet({ visible, onClose, onCreated }: Props) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExerciseKind>('strength');
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inFlightRef = useRef(false);

  const reset = () => {
    setTitle('');
    setKind('strength');
    setMessage(null);
  };

  const cancel = () => {
    if (inFlightRef.current) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCreating(true);
    setMessage(null);
    try {
      const outcome = await createExercise(database, { title, kind });
      if (outcome.kind === 'created') {
        reset();
        onClose();
        onCreated(outcome.exerciseId);
      } else {
        setMessage(exerciseCreationMessage(outcome));
      }
    } catch (error) {
      console.error('Failed to create exercise:', error);
      setMessage("Couldn't create that exercise. Try again.");
    } finally {
      inFlightRef.current = false;
      setCreating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={cancel}
    >
      <KeyboardAvoidingView
        style={[styles.root, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <ThemedText type="subtitle">New exercise</ThemedText>
          <TextInput
            accessibilityLabel="Exercise name"
            value={title}
            onChangeText={setTitle}
            placeholder="Exercise name"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => {
              void submit();
            }}
            style={[styles.nameInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          <View style={[styles.typeRow, { borderColor: theme.backgroundSelected }]}>
            <ThemedText type="default">Type</ThemedText>
            <View style={styles.kindOptions}>
              {KINDS.map((option) => {
                const selected = option.value === kind;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Type ${option.label}`}
                    onPress={() => setKind(option.value)}
                    style={[
                      styles.kindOption,
                      { backgroundColor: selected ? ActionButtonColor.secondary : theme.backgroundSelected },
                    ]}
                  >
                    <ThemedText type="small" style={selected ? styles.kindOptionSelected : undefined}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {message && <ThemedText style={styles.message}>{message}</ThemedText>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create exercise"
            disabled={creating}
            onPress={() => {
              void submit();
            }}
            style={[styles.createButton, creating && styles.disabled]}
          >
            <ThemedText style={styles.createButtonText}>{creating ? 'Creating…' : 'Create exercise'}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            disabled={creating}
            onPress={cancel}
            style={[styles.cancelButton, { borderColor: theme.backgroundSelected }]}
          >
            <ThemedText>Cancel</ThemedText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  form: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  nameInput: {
    alignSelf: 'stretch',
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
  },
  typeRow: {
    alignSelf: 'stretch',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
  },
  kindOptions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  kindOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
  },
  kindOptionSelected: {
    color: 'white',
    fontWeight: 'bold',
  },
  createButton: {
    alignSelf: 'stretch',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: ActionButtonColor.primary,
  },
  createButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  cancelButton: {
    alignSelf: 'stretch',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
  },
  disabled: {
    opacity: 0.6,
  },
  message: {
    color: StatusColor.danger,
  },
});
