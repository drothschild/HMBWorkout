import { StyleSheet, Pressable, FlatList, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useRef } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { activeSessionStore } from '@/state/activeSession';
import { database } from '@/db';
import { todayStartPresenter, TodayRoutineChoice, TodayStartOptions } from '@/state/todayStartPresenter';
import { startSessionFromRoutine } from '@/state/startSessionFromRoutine';
import { todayViewState } from '@/state/todayViewState';

export default function TodayScreen() {
  const router = useRouter();
  const theme = useTheme();
  const sessionState = activeSessionStore((state: any) => state.sessionState);
  const [startOptions, setStartOptions] = useState<TodayStartOptions | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generationRef = useRef(0);

  const loadRoutines = useCallback(async () => {
    // Monotonic counter: bump generation each time, never reset.
    // Stale loads with older generation will be ignored.
    const generation = ++generationRef.current;

    // Keep any previous error visible while any load is in flight — a Retry
    // tap or the automatic focus reload (the error branch renders a disabled
    // Retry button). It clears only when a load succeeds.
    setLoading(true);

    try {
      const options = await todayStartPresenter(database);
      // Only update state if this request is still current
      if (generationRef.current === generation) {
        setStartOptions(options);
        setLoadError(null);
        setLoading(false);
      }
    } catch (error) {
      console.error('Failed to load routines for Today:', error);
      // Only update state if this request is still current
      if (generationRef.current === generation) {
        setLoadError('Could not load routines. Please try again.');
        setStartOptions(null);
        setLoading(false);
      }
    }
  }, []);

  // Reload on focus rather than once on mount: routines arrive from the AI
  // Coach, the vault import, and the Routines tab, all of which the user
  // reaches and returns from without this screen unmounting.
  useFocusEffect(
    useCallback(() => {
      setStartError(null);
      loadRoutines();
      // Return cleanup to invalidate any in-flight request on blur
      return () => {
        generationRef.current += 1;
      };
    }, [loadRoutines])
  );

  const handleStartRoutine = async (routineId: string) => {
    setStartError(null);
    setStartingId(routineId);
    try {
      const event = await startSessionFromRoutine(database, routineId, `session-${Date.now()}`);
      const next = await activeSessionStore.getState().dispatch(event);
      // dispatch returns null when the engine rejected the event or when
      // persisting the accepted transition failed. A successful StartSession
      // always resolves to the new in-progress state, so null here means the
      // start did not take effect — do not navigate.
      if (!next) {
        setStartError('Could not start that routine. Try another one.');
        return;
      }
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
        { borderBottomColor: theme.backgroundSelected },
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
            : item.exerciseCount === 0
              ? 'No exercises yet'
              : 'No sets planned'}
      </ThemedText>
    </Pressable>
  );

  const viewState = todayViewState({
    sessionState,
    loading,
    loadError,
    startOptions,
  });

  const renderContent = () => {
    switch (viewState.kind) {
      case 'resume':
        return (
          <View style={styles.centered}>
            <Pressable
              style={({ pressed }) => [styles.resumeButton, pressed && styles.pressed]}
              onPress={() => router.push('/session')}
            >
              <ThemedText style={styles.buttonText}>Resume Session</ThemedText>
            </Pressable>
          </View>
        );

      case 'error':
        return (
          <View style={styles.centered}>
            <ThemedText type="default" style={styles.errorText}>
              {viewState.error}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed, loading && styles.buttonDisabled]}
              onPress={() => loadRoutines()}
              disabled={loading}
            >
              <ThemedText style={styles.buttonText}>Retry</ThemedText>
            </Pressable>
          </View>
        );

      case 'loading':
        return (
          <View style={styles.centered}>
            <ThemedText type="default">Loading routines...</ThemedText>
          </View>
        );

      case 'no-routines':
        return (
          <View style={styles.centered}>
            <ThemedText type="default" style={styles.placeholder}>
              No routines yet. Build one with the AI Coach, or import your routines from
              the vault.
            </ThemedText>
            <View style={styles.buttonRow}>
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
          </View>
        );

      case 'routines-need-exercises':
        return (
          <View style={styles.centered}>
            <ThemedText type="default" style={styles.placeholder}>
              Your routines aren’t ready to start — add exercises, or make sure each one
              plans some sets, using the AI Coach or the Routines tab.
            </ThemedText>
            <FlatList
              data={viewState.routines}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => renderRoutine(item)}
              style={styles.list}
            />
            <View style={styles.buttonRow}>
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
          </View>
        );

      case 'choose-routine':
        return (
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
              data={viewState.routines}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => renderRoutine(item)}
              style={styles.list}
            />
          </>
        );

      default: {
        const _never: never = viewState;
        return _never;
      }
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
        <ThemedView style={styles.content}>
          {renderContent()}
        </ThemedView>
      </View>
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
    paddingTop: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.three,
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
    backgroundColor: ActionButtonColor.finish,
  },
  linkButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 6,
    backgroundColor: ActionButtonColor.secondary,
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
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  list: {
    flex: 1,
    width: '100%',
  },
  routineItem: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    // borderBottomColor is theme-resolved inline
    borderBottomWidth: 1,
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
