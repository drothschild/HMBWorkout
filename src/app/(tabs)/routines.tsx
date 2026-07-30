import { StyleSheet, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { database } from '@/db';
import { routineListPresenter, RoutineListItem } from '@/state/routineListPresenter';
import { getSettings } from '@/state/settings';
import { createBridgeClient } from '@/sync/bridgeClient';
import { createSyncService } from '@/sync/syncService';
import { runImportRoutines } from '@/helpers/settingsActions';

export default function RoutinesScreen() {
  const router = useRouter();
  const [routines, setRoutines] = useState<RoutineListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const loadRoutines = async () => {
    try {
      const items = await routineListPresenter(database);
      setRoutines(items);
    } catch (error) {
      console.error('Failed to load routines:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutines();

    // Set up polling for routine changes
    const interval = setInterval(loadRoutines, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleRoutinePress = (routineId: string) => {
    router.push(`/routine/${routineId}`);
  };

  const handleImportRoutines = async () => {
    const settings = getSettings();
    if (!settings.baseUrl) {
      setImportMessage('Please configure bridge URL in Settings');
      return;
    }

    setImporting(true);
    setImportMessage(null);
    try {
      const bridgeClient = createBridgeClient(settings);
      const syncService = createSyncService(database, bridgeClient);
      const result = await runImportRoutines(syncService);
      setImportMessage(
        result.status === 'success'
          ? `✓ ${result.message}`
          : `✗ ${result.message}`
      );
      // Trigger immediate reload if successful
      if (result.status === 'success') {
        await loadRoutines();
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedText type="title" style={styles.title}>
            Routines
          </ThemedText>
          {loading ? (
            <ThemedText type="default">Loading routines...</ThemedText>
          ) : routines.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText type="default" style={styles.placeholder}>
                No routines found. Import routines to get started.
              </ThemedText>
              <Pressable
                style={[styles.importButton, importing && styles.importButtonDisabled]}
                onPress={handleImportRoutines}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="default" style={styles.importButtonText}>
                    Import Routines
                  </ThemedText>
                )}
              </Pressable>
              {importMessage && (
                <ThemedText
                  type="default"
                  style={[
                    styles.statusText,
                    importMessage.startsWith('✓')
                      ? styles.successText
                      : styles.errorText,
                  ]}
                >
                  {importMessage}
                </ThemedText>
              )}
            </ThemedView>
          ) : (
            <>
              <Pressable
                style={[styles.importButton, importing && styles.importButtonDisabled]}
                onPress={handleImportRoutines}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="default" style={styles.importButtonText}>
                    Import More Routines
                  </ThemedText>
                )}
              </Pressable>
              {importMessage && (
                <ThemedText
                  type="default"
                  style={[
                    styles.statusText,
                    importMessage.startsWith('✓')
                      ? styles.successText
                      : styles.errorText,
                  ]}
                >
                  {importMessage}
                </ThemedText>
              )}
              <Pressable
                style={styles.aiCoachButton}
                onPress={() => router.push('/ai-coach')}
              >
                <ThemedText type="default" style={styles.aiCoachButtonText}>AI Coach</ThemedText>
              </Pressable>
              <FlatList
                data={routines}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.routineItem}
                    onPress={() => handleRoutinePress(item.id)}
                  >
                    <ThemedText type="subtitle">{item.name}</ThemedText>
                    <ThemedText type="default" style={styles.exerciseCount}>
                      {item.exerciseCount} exercises
                    </ThemedText>
                  </Pressable>
                )}
                scrollEnabled={true}
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
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    flex: 1,
    gap: Spacing.four,
    width: '100%',
  },
  title: {
    textAlign: 'center',
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
  importButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: '#208AEF',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  importButtonDisabled: {
    opacity: 0.6,
  },
  importButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  statusText: {
    fontSize: 13,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  successText: {
    color: '#4CAF50',
  },
  errorText: {
    color: '#FF6B6B',
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
  exerciseCount: {
    opacity: 0.6,
    fontSize: 12,
    marginTop: Spacing.one,
  },
  aiCoachButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: '#208AEF',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  aiCoachButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
