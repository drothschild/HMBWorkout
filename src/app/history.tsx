import { StyleSheet, Pressable, FlatList, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import { deleteSession } from '@/db/repository';
import { sessionHistoryPresenter, SessionHistoryItem } from '@/state/sessionHistoryPresenter';

function formatSessionDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const items = await sessionHistoryPresenter(database);
      setSessions(items);
    } catch (error) {
      console.error('Failed to load session history:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ThemedText type="default" style={styles.backButtonText}>
              ← Today
            </ThemedText>
          </Pressable>
        </View>

        <ThemedText type="title" style={styles.title}>
          History
        </ThemedText>

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
                  {formatSessionDate(item.endedAt)} · {item.setCount} logged sets
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
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: Spacing.two,
    marginLeft: -Spacing.two,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonText: {
    color: '#007AFF',
    fontWeight: '500',
  },
  title: {
    marginTop: Spacing.two,
    marginBottom: Spacing.four,
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
