import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Host, Column, Button, TextInput } from '@expo/ui';
import * as ImagePicker from 'expo-image-picker';
import { database } from '@/db';
import { createWorkoutDiaryStore } from '@/state/workoutDiary';
import { workoutSelfieFiles } from '@/state/workoutSelfieFiles';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';

/** A local, resumable prelude to the coaching conversation. */
export function WorkoutDiaryGate({ sessionId, onComplete }: { sessionId: string; onComplete(): void }) {
  const store = useMemo(() => createWorkoutDiaryStore(database, sessionId, workoutSelfieFiles), [sessionId]);
  const { stage, diary, busy, error } = store();
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickingRef = useRef(false);
  const completedRef = useRef(false);
  useEffect(() => { void store.getState().load(); }, [store]);
  useEffect(() => {
    if (stage === 'ready' && !completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }, [stage, onComplete]);

  const chooseSelfie = async (camera: boolean) => {
    if (pickingRef.current || store.getState().busy) return;
    pickingRef.current = true;
    setPicking(true);
    setPickerError(null);
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        setPickerError('Camera access is off. You can choose a photo instead, enable access in Settings, or skip.');
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false, base64: false };
      const result = camera
        ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]?.uri) {
        await store.getState().complete(result.assets[0].uri);
      }
    } catch {
      setPickerError('Could not open your photo. Please try again or skip.');
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three }}
      automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
      <ThemedText type="subtitle">Workout diary</ThemedText>
      {stage === 'loading' ? <ActivityIndicator accessibilityLabel="Loading diary" /> : (
        <ThemedText>{stage === 'diary'
          ? 'What would you like to remember about this workout? How did it feel?'
          : 'Your diary is saved. Would you like to add an optional selfie?'}</ThemedText>
      )}
      {stage === 'selfie' && <ThemedText selectable>{diary}</ThemedText>}
      {(error || pickerError) && <ThemedText accessibilityRole="alert">{pickerError ?? error}</ThemedText>}
      <Host matchContents={{ vertical: true }} seedColor={ActionButtonColor.primary}>
        <Column spacing={Spacing.three}>
          {stage === 'diary' && <>
            <TextInput placeholder="My workout diary…" multiline numberOfLines={6}
              onChangeText={setText} editable={!busy} />
            <Button label={busy ? 'Saving…' : 'Save diary'} disabled={busy || !text.trim()}
              onPress={() => { void store.getState().saveDiary(text); }} />
          </>}
          {stage === 'selfie' && <>
            <Button label="Take a selfie" disabled={busy || picking} onPress={() => { void chooseSelfie(true); }} />
            <Button label="Choose a photo" variant="outlined" disabled={busy || picking} onPress={() => { void chooseSelfie(false); }} />
            <Button label="Skip selfie and continue" variant="text" disabled={busy || picking}
              onPress={() => { setPickerError(null); void store.getState().complete(null); }} />
          </>}
          {stage === 'loading' && error && <Button label="Try again" disabled={busy} onPress={() => { void store.getState().load(); }} />}
        </Column>
      </Host>
      {stage === 'selfie' && <ThemedText>Your selfie stays with this workout on your device and is never sent to the coach. Your diary will help guide the conversation.</ThemedText>}
      {busy || picking ? <ActivityIndicator accessibilityLabel="Saving workout diary" /> : <View />}
    </ScrollView>
  );
}
