import { StyleSheet, Pressable, FlatList, ActivityIndicator, View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { database } from '@/db';
import { deleteRoutine, RoutineHasUnsyncedSessionsError } from '@/db/repository';
import { routineListPresenter, RoutineListItem } from '@/state/routineListPresenter';
import { getSettings } from '@/state/settings';
import { createBridgeClient } from '@/sync/bridgeClient';
import { createSyncService } from '@/sync/syncService';
import { runImportRoutines } from '@/helpers/settingsActions';

interface EntryPointButtonsProps {
  importLabel: string;
  importing: boolean;
  importMessage: string | null;
  onImport: () => void;
  onAiCoach: () => void;
}

function EntryPointButtons({ importLabel, importing, importMessage, onImport, onAiCoach }: EntryPointButtonsProps) {
  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.importButton,
          importing && styles.importButtonDisabled,
          pressed && styles.importButtonPressed,
        ]}
        onPress={onImport}
        disabled={importing}
      >
        {importing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <ThemedText type="default" style={styles.importButtonText}>
            {importLabel}
          </ThemedText>
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.importButton, pressed && styles.importButtonPressed]}
        onPress={onAiCoach}
      >
        <ThemedText type="default" style={styles.importButtonText}>AI Coach</ThemedText>
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
    </>
  );
}

export default function RoutinesScreen() {
  const router = useRouter();
  const theme = useTheme();
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

  const handleDelete = (routine: RoutineListItem) => {
    Alert.alert(
      'Delete routine?',
      `This removes "${routine.name}" from this device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRoutine(database, routine.id);
              await loadRoutines();
            } catch (error) {
              if (error instanceof RoutineHasUnsyncedSessionsError) {
                Alert.alert(
                  'Cannot delete routine',
                  'This routine has a workout that hasn\'t synced to your vault yet. Sync first, then delete.'
                );
              } else {
                console.error('Failed to delete routine:', error);
                Alert.alert(
                  'Could not delete routine',
                  'Please try again.'
                );
              }
            }
          },
        },
      ]
    );
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
      <View style={styles.safeArea}>
        <ThemedView style={styles.content}>
          {loading ? (
            <ThemedText type="default">Loading routines...</ThemedText>
          ) : routines.length === 0 ? (
            <ThemedView style={styles.emptyState}>
              <ThemedText type="default" style={styles.placeholder}>
                No routines found. Import routines to get started.
              </ThemedText>
              <EntryPointButtons
                importLabel="Import Routines"
                importing={importing}
                importMessage={importMessage}
                onImport={handleImportRoutines}
                onAiCoach={() => router.push('/ai-coach')}
              />
            </ThemedView>
          ) : (
            <>
              <EntryPointButtons
                importLabel="Import More Routines"
                importing={importing}
                importMessage={importMessage}
                onImport={handleImportRoutines}
                onAiCoach={() => router.push('/ai-coach')}
              />
              <FlatList
                data={routines}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [
                      styles.routineItem,
                      { borderBottomColor: theme.backgroundSelected },
                      pressed && styles.routineItemPressed,
                    ]}
                    onPress={() => handleRoutinePress(item.id)}
                  >
                    <View style={styles.routineInfo}>
                      <ThemedText type="subtitle">{item.name}</ThemedText>
                      <ThemedText type="default" style={styles.exerciseCount}>
                        {item.exerciseCount} exercises
                      </ThemedText>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${item.name}`}
                      hitSlop={8}
                      onPress={() => handleDelete(item)}
                      style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                    >
                      <ThemedText type="default">🗑️</ThemedText>
                    </Pressable>
                  </Pressable>
                )}
                scrollEnabled={true}
                style={styles.list}
              />
            </>
          )}
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
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    flex: 1,
    gap: Spacing.four,
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
  importButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: ActionButtonColor.secondary,
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
  importButtonPressed: {
    opacity: 0.6,
  },
  statusText: {
    fontSize: 13,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  successText: {
    color: StatusColor.success,
  },
  errorText: {
    color: StatusColor.danger,
  },
  list: {
    flex: 1,
    width: '100%',
  },
  routineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    // borderBottomColor is theme-resolved inline
    borderBottomWidth: 1,
  },
  routineItemPressed: {
    opacity: 0.6,
  },
  routineInfo: {
    flex: 1,
  },
  exerciseCount: {
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
