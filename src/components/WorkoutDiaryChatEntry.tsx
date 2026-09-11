import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { database } from '@/db';
import { readWorkoutDiary, type WorkoutDiary } from '@/db/workoutDiary';
import { workoutSelfieUri } from '@/state/workoutSelfieFiles';
import { Spacing } from '@/constants/theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { ThemedText } from './themed-text';

/** Before the first follow-up, the saved journal is the conversation opening. */
export function shouldKeepDiaryEntryVisible(messages: { role: string; hidden?: boolean }[]): boolean {
  return !messages.some(message => message.role === 'user' && !message.hidden);
}

/** A local display entry; the photo is never appended to provider messages. */
export function WorkoutDiaryChatEntry({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<{ sessionId: string; diary: WorkoutDiary | null; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    readWorkoutDiary(database, sessionId).then(diary => {
      if (active) setResult({ sessionId, diary, failed: false });
    }).catch(() => {
      if (active) setResult({ sessionId, diary: null, failed: true });
    });
    return () => { active = false; };
  }, [sessionId, retry]);

  if (!result || result.sessionId !== sessionId) return null;
  if (result.failed) return <View style={styles.container}>
    <ThemedText>Could not load your journal.</ThemedText>
    <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.retry}>
      <ThemedText>Try again</ThemedText>
    </Pressable>
  </View>;
  if (!result.diary?.diary) return null;
  const { diary, selfiePath } = result.diary;
  return <View style={styles.container}>
    <View style={styles.entry}>
      <View style={styles.bubble}>
        <ThemedText selectable style={styles.journal}>{diary}</ThemedText>
      </View>
      {selfiePath && (failedPhoto === selfiePath
        ? <ThemedText type="small">Photo unavailable on this device.</ThemedText>
        : <Image source={{ uri: workoutSelfieUri(selfiePath) }}
          accessibilityLabel="Your workout selfie" contentFit="contain"
          onError={() => setFailedPhoto(selfiePath)} style={styles.photo} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', paddingHorizontal: Spacing.two, marginVertical: Spacing.one },
  entry: { maxWidth: '80%', gap: Spacing.two },
  bubble: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 12, backgroundColor: ActionButtonColor.primary },
  journal: { color: '#fff' },
  photo: { width: 240, maxWidth: '100%', height: 280, borderRadius: 16, alignSelf: 'flex-end' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
});
