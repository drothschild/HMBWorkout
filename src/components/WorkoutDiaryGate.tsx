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
import { useTheme } from '@/hooks/use-theme';
import { WorkoutPhotoActions } from './WorkoutPhotoActions';

/** A local, resumable prelude to the coaching conversation. */
export function WorkoutDiaryGate({ sessionId, onComplete }: { sessionId: string; onComplete(): void }) {
  const store = useMemo(() => createWorkoutDiaryStore(database, sessionId, workoutSelfieFiles), [sessionId]);
  const { stage, diary, busy, error } = store();
  const [text, setText] = useState('');
  const theme = useTheme();
  const [contentWidth, setContentWidth] = useState(0);
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
    <ScrollView contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: Spacing.four, gap: Spacing.four, width: '100%', maxWidth: 600, alignSelf: 'center' }}
      automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
      <View style={{ gap: Spacing.two }}>
        <ThemedText style={{ fontSize: 28, lineHeight: 36, fontWeight: '600' }}>
          {stage === 'selfie' ? 'Add a workout photo' : 'How did it go?'}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{stage === 'selfie'
          ? 'An optional moment from your workout.'
          : 'Capture what felt good, what was hard, and what you want to remember.'}</ThemedText>
      </View>
      {stage === 'loading' && <ActivityIndicator accessibilityLabel="Loading diary" />}
      {stage === 'selfie' && <View style={{ backgroundColor: theme.backgroundElement,
        padding: Spacing.three, borderRadius: 16, gap: Spacing.two }}>
        <ThemedText type="smallBold" themeColor="textSecondary">Your journal</ThemedText>
        <ThemedText selectable>{diary}</ThemedText>
      </View>}
      {(error || pickerError) && <ThemedText accessibilityRole="alert">{pickerError ?? error}</ThemedText>}
      <View onLayout={({ nativeEvent }) => setContentWidth(nativeEvent.layout.width)}>
      {contentWidth > 0 && stage === 'diary' && <Host matchContents={{ vertical: true }} seedColor={ActionButtonColor.primary}>
        <Column spacing={Spacing.three}>
          <TextInput placeholder="My workout journal…" multiline numberOfLines={6}
            style={{ width: contentWidth, padding: 16, backgroundColor: theme.backgroundElement, borderRadius: 16 }}
            textStyle={{ fontSize: 17, color: theme.text }}
            onChangeText={setText} editable={!busy} />
          <Button label={busy ? 'Saving…' : 'Save journal'} disabled={busy || !text.trim()}
            style={{ width: contentWidth, paddingVertical: 12 }}
            onPress={() => { void store.getState().saveDiary(text); }} />
        </Column>
      </Host>}
      {contentWidth > 0 && stage === 'selfie' && <WorkoutPhotoActions width={contentWidth} disabled={busy || picking}
        onCamera={() => { void chooseSelfie(true); }}
        onLibrary={() => { void chooseSelfie(false); }}
        onSkip={() => { setPickerError(null); void store.getState().complete(null); }} />}
      {stage === 'loading' && error && <Host matchContents={{ vertical: true }} seedColor={ActionButtonColor.primary}>
        <Button label="Try again" disabled={busy} onPress={() => { void store.getState().load(); }} />
      </Host>}
      </View>
      {stage === 'selfie' && <ThemedText type="small" themeColor="textSecondary">
        Only your journal is shared with your coach. Photos stay on this device.
      </ThemedText>}
      {(busy || picking) && <ActivityIndicator accessibilityLabel="Saving workout diary" />}
    </ScrollView>
  );
}
