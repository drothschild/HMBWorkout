import { StyleSheet, Pressable, FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { activeSessionStore } from '@/state/activeSession';
import { database } from '@/db';
import {
  todayStartPresenter,
  TodayRoutineChoice,
  TodayStartOptions,
} from '@/state/todayStartPresenter';
import { startSessionFromRoutine } from '@/state/startSessionFromRoutine';

export default function TodayScreen() {
  const router = useRouter();
  const sessionState = activeSessionStore((state: any) => state.sessionState);
  const [startOptions, setStartOptions] = useState<TodayStartOptions | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Reload on focus rather than once on mount: routines arrive from the AI
  // Coach, the vault import, and the Routines tab, all of which the user
  // reaches and returns from without this screen unmounting.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      todayStartPresenter(database)
        .then((options) => {
          if (!cancelled) setStartOptions(options);
        })
        .catch((error) => {
          console.error('Failed to load routines for Today:', error);
        });

      return () => {
        cancelled = true;
      };
    }, [])
  );

  const handleStartRoutine = async (routineId: string) => {
    setStartError(null);
    setStartingId(routineId);
    try {
      const event = await startSessionFromRoutine(database, routineId, `session-${Date.now()}`);
      await activeSessionStore.getState().dispatch(event);
      router.push('/session');
    } catch (error) {
      console.error('Failed to start session:', error);
      setStartError('Could not start that routine. Try another one.');
    } finally {
      setStartingId(null);
    }
  };

  const renderRoutine = (item: TodayRoutineChoice) => (
    <Pressable
      style={({ pressed }) => [
        styles.routineItem,
        !item.startable && styles.routineItemDisabled,
        pressed && item.startable && styles.pressed,
      ]}
      onPress={() => handleStartRoutine(item.id)}
      disabled={!item.startable || startingId !== null}
    >
      <ThemedText type="subtitle">{item.name}</ThemedText>
      <ThemedText type="default" style={styles.routineDetail}>
        {startingId === item.id
          ? 'Starting...'
          : item.startable
            ? `${item.exerciseCount} exercises`
            : 'No exercises yet'}
      </ThemedText>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="title" style={styles.title}>
            Today
          </ThemedText>

          {sessionState ? (
            <View style={styles.centered}>
              <Pressable
                style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}
                onPress={() => router.push('/session')}
              >
                <ThemedText style={styles.buttonText}>Resume Session</ThemedText>
              </Pressable>
            </View>
          ) : startOptions === null ? (
            <View style={styles.centered}>
              <ThemedText type="default">Loading routines...</ThemedText>
            </View>
          ) : startOptions.kind === 'no-routines' ? (
            <View style={styles.centered}>
              <ThemedText type="default" style={styles.placeholder}>
                No routines yet. Build one with the AI Coach, or import your routines from
                the vault.
              </ThemedText>
              <Pressable
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                onPress={() => router.push('/ai-coach')}
              >
                <ThemedText style={styles.buttonText}>AI Coach</ThemedText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                onPress={() => router.navigate('/routines')}
              >
                <ThemedText style={styles.buttonText}>Go to Routines</ThemedText>
              </Pressable>
            </View>
          ) : (
            <>
              <ThemedText type="default" style={styles.placeholder}>
                Choose a routine to start
              </ThemedText>
              {startError && (
                <ThemedText type="default" style={styles.errorText}>
                  {startError}
                </ThemedText>
              )}
              <FlatList
                data={startOptions.routines}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => renderRoutine(item)}
                style={styles.list}
              />
            </>
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
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    flex: 1,
    gap: Spacing.three,
    width: '100%',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  placeholder: {
    textAlign: 'center',
    opacity: 0.6,
  },
  errorText: {
    textAlign: 'center',
    color: '#FF6B6B',
  },
  resumeButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    backgroundColor: '#34C759',
  },
  linkButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 6,
    backgroundColor: '#208AEF',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  pressed: {
    opacity: 0.6,
  },
  list: {
    flex: 1,
    width: '100%',
  },
  routineItem: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  routineItemDisabled: {
    opacity: 0.4,
  },
  routineDetail: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
});
