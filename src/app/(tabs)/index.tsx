import { StyleSheet, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { activeSessionStore } from '@/state/activeSession';

export default function TodayScreen() {
  const router = useRouter();
  const sessionState = activeSessionStore((state: any) => state.sessionState);

  const handleStartSession = () => {
    // Demo routine for now (Phase 9 adds real routine import)
    const demoRoutine = {
      id: 'demo-routine',
      name: 'Demo Workout',
      entries: [
        {
          exerciseId: 'ex-1',
          kind: 'strength' as const,
          warmupSets: 1,
          targetSets: 3,
          targetReps: 8,
          targetDurationSeconds: 0,
          restSeconds: 90,
          supersetGroup: '',
        },
      ],
    };

    activeSessionStore.getState().dispatch({
      tag: 'StartSession',
      sessionId: `session-${Date.now()}`,
      nowMs: Date.now(),
      routine: demoRoutine,
    });

    router.push('/session');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="title" style={styles.title}>
            Today
          </ThemedText>

          {sessionState ? (
            <View style={styles.buttonContainer}>
              <Pressable style={[styles.button, styles.resumeButton]} onPress={() => router.push('/session')}>
                <ThemedText style={styles.buttonText}>Resume Session</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.buttonContainer}>
              <Pressable style={[styles.button, styles.startButton]} onPress={handleStartSession}>
                <ThemedText style={styles.buttonText}>Start Session</ThemedText>
              </Pressable>
              <ThemedText type="default" style={styles.placeholder}>
                Begin logging a new workout
              </ThemedText>
            </View>
          )}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  buttonContainer: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
  },
  startButton: {
    backgroundColor: '#007AFF',
  },
  resumeButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  placeholder: {
    textAlign: 'center',
    opacity: 0.6,
  },
});
