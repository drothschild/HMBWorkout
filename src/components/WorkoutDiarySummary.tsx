import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { database } from '@/db';
import { readWorkoutDiary, type WorkoutDiary } from '@/db/workoutDiary';
import { workoutSelfieUri } from '@/state/workoutSelfieFiles';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';

export function WorkoutDiarySummary({ sessionId }: { sessionId: string }) {
  const [diary, setDiary] = useState<WorkoutDiary | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    readWorkoutDiary(database, sessionId).then(value => {
      if (active) { setDiary(value); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [sessionId]));
  if (failed) return <ThemedText>Could not load the workout diary.</ThemedText>;
  if (!diary?.diary) return null;
  return <View style={{ gap: Spacing.two, marginBottom: Spacing.four }}>
    <ThemedText type="subtitle">Workout diary</ThemedText>
    <ThemedText selectable>{diary.diary}</ThemedText>
    {diary.selfiePath && <Image source={{ uri: workoutSelfieUri(diary.selfiePath) }}
      accessibilityLabel="Workout selfie" contentFit="contain" style={{ width: '100%', height: 300 }} />}
  </View>;
}
