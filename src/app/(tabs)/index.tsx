import { StyleSheet, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { activeSessionStore } from '@/state/activeSession';
import { database } from '@/db';
import { upsertRoutineExercise } from '@/db/repository';

export default function TodayScreen() {
  const router = useRouter();
  const sessionState = activeSessionStore((state: any) => state.sessionState);

  const handleStartSession = async () => {
    // I1a: Seed routine and routine_exercises before dispatching StartSession
    // This ensures onPersistSet can find the routine_exercises row by (routineId, order)
    await seedDemoRoutine();

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

    await activeSessionStore.getState().dispatch({
      tag: 'StartSession',
      sessionId: `session-${Date.now()}`,
      nowMs: Date.now(),
      routine: demoRoutine,
    });

    router.push('/session');
  };

  /**
   * Seed the demo routine and its exercises to the database.
   * Ensures routine_exercises rows exist for onPersistSet to find by (routineId, order).
   * Uses upsertRoutineExercise to idempotently create/update the routine_exercises rows.
   */
  async function seedDemoRoutine() {
    try {
      // Seed routine if it doesn't exist
      const existingRoutine = await database.get('routines').query().fetch();
      const demoRoutineExists = (existingRoutine as any[]).some(
        (r: any) => r._raw.id === 'demo-routine'
      );

      if (!demoRoutineExists) {
        await database.write(async () => {
          await database.get('routines').create((r: any) => {
            r._raw.id = 'demo-routine';
            r.name = 'Demo Workout';
            r._raw.created_at = Date.now();
            r._raw.updated_at = Date.now();
          });

          // Create exercise if it doesn't exist
          const exercises = await database.get('exercises').query().fetch();
          const demoExerciseExists = (exercises as any[]).some(
            (e: any) => e._raw.id === 'ex-1'
          );
          if (!demoExerciseExists) {
            await database.get('exercises').create((e: any) => {
              e._raw.id = 'ex-1';
              e.title = 'Demo Exercise';
              e.kind = 'strength';
              e._raw.created_at = Date.now();
            });
          }
        });
      }

      // Seed routine_exercises: order = idx (0-based) per engine pre-indexing
      // Entry idx 0 maps to routine_exercises.order = 0
      await upsertRoutineExercise(database, 'demo-routine', {
        exerciseId: 'ex-1',
        order: 0, // Matches entry idx
        warmupSets: 1,
        targetSets: 3,
        targetReps: 8,
        targetDurationSeconds: 0,
        restSeconds: 90,
      });
    } catch (error) {
      // Log but don't crash — if seeding fails, let the user see the error later
      console.error('Failed to seed demo routine:', error);
    }
  }

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

          <Pressable onPress={() => router.push('/history')} style={styles.historyLink}>
            <ThemedText type="linkPrimary">View History</ThemedText>
          </Pressable>
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
  historyLink: {
    padding: Spacing.two,
  },
});
