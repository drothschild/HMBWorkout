import { StyleSheet, Pressable, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, useRef } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import { deleteSession } from '@/db/repository';
import {
  formatSessionDate,
  formatSetCountLabel,
  sessionHistoryPresenter,
  SessionHistoryItem,
} from '@/state/sessionHistoryPresenter';

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const generationRef = useRef(0);

  const loadHistory = useCallback(async () => {
    // Monotonic counter: bump generation each time, never reset.
    // Stale loads with older generation will be ignored.
    const generation = ++generationRef.current;
    try {
      const items = await sessionHistoryPresenter(database);
      if (generationRef.current === generation) {
        setSessions(items);
        setLoading(false);
      }
    } catch (error) {
      console.error('Failed to load session history:', error);
      if (generationRef.current === generation) {
        setLoading(false);
      }
    }
  }, []);

  // Reload on focus rather than once on mount: a tab screen stays mounted, and
  // a workout finished after the first visit must still appear here.
  useFocusEffect(
    useCallback(() => {
      loadHistory();
      // Return cleanup to invalidate any in-flight request on blur
      return () => {
        generationRef.current += 1;
      };
    }, [loadHistory])
  );

  const handleDelete = (session: SessionHistoryItem) => {
    Alert.alert(
      'Delete workout?',
      `This removes "${session.routineName}" from ${formatSessionDate(session.endedAt)} from this device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSession(database, session.id);
              await loadHistory();
            } catch (error) {
              console.error('Failed to delete session:', error);
              Alert.alert('Could not delete workout', 'Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {loading ? (
          <ThemedText type="default">Loading history...</ThemedText>
        ) : sessions.length === 0 ? (
          <ThemedView style={styles.emptyState}>
            <ThemedText type="default" style={styles.placeholder}>
              No finished workouts yet.
            </ThemedText>
          </ThemedView>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.sessionItem, pressed && styles.sessionItemPressed]}
                onLongPress={() => handleDelete(item)}
                delayLongPress={400}
              >
                <ThemedText type="subtitle">{item.routineName}</ThemedText>
                <ThemedText type="default" style={styles.sessionMeta}>
                  {formatSessionDate(item.endedAt)} · {formatSetCountLabel(item.setCount)}
                </ThemedText>
                <ThemedText type="small" style={styles.sessionHint}>
                  Long-press to delete
                </ThemedText>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  placeholder: {
    textAlign: 'center',
    opacity: 0.6,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  list: {
    flex: 1,
    width: '100%',
  },
  sessionItem: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  sessionItemPressed: {
    opacity: 0.6,
  },
  sessionMeta: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
  sessionHint: {
    opacity: 0.4,
    marginTop: Spacing.one,
  },
});
