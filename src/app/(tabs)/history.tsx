import { StyleSheet, Pressable, FlatList, View, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useRef } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { database } from '@/db';
import { deleteSession } from '@/db/repository';
import {
  formatSessionDate,
  formatSetCountLabel,
  sessionHistoryPresenter,
  SessionHistoryItem,
} from '@/state/sessionHistoryPresenter';

export default function HistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
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
      <View style={styles.safeArea}>
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
              <View style={[styles.sessionItem, { borderBottomColor: theme.backgroundSelected }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.routineName} from ${formatSessionDate(item.endedAt)}`}
                  style={({ pressed }) => [styles.sessionInfo, pressed && styles.sessionInfoPressed]}
                  onPress={() => router.push(`/workout/${item.id}`)}
                >
                  <ThemedText type="subtitle">{item.routineName}</ThemedText>
                  <ThemedText type="default" style={styles.sessionMeta}>
                    {formatSessionDate(item.endedAt)} · {formatSetCountLabel(item.setCount)}
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.routineName}`}
                  hitSlop={8}
                  onPress={() => handleDelete(item)}
                  style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                >
                  <ThemedText type="default">🗑️</ThemedText>
                </Pressable>
              </View>
            )}
          />
        )}
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
    paddingBottom: Spacing.three,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    // borderBottomColor is theme-resolved inline
    borderBottomWidth: 1,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionInfoPressed: {
    opacity: 0.6,
  },
  sessionMeta: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
  deleteButton: {
    padding: Spacing.two,
  },
  deleteButtonPressed: {
    opacity: 0.6,
  },
});
