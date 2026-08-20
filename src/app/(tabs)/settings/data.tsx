import { StyleSheet, Pressable, ScrollView, View } from 'react-native';
import { useState, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { database } from '@/db';
import { routineListPresenter, RoutineListItem } from '@/state/routineListPresenter';
import {
  exportRoutine,
  exportSessionHistory,
  getRoutineExportName,
  getSessionHistoryExportName,
} from '@/export/exportService';
import { exportOutcome } from '@/export/exportOutcome';
import { importRoutine } from '@/interop/importRoutine';
import { applyRoutineImport } from '@/state/applyRoutineImport';
import { routineImportOutcome } from '@/state/routineImportOutcome';

/**
 * Settings → Data. The first production caller of `src/export` (AGENTS.md: this
 * screen is what makes "src/export is not yet wired to any screen" false).
 *
 * The share flow is: serialize with the existing `exportRoutine` /
 * `exportSessionHistory`, write the markdown into the cache directory with
 * expo-file-system's object API, then hand the file's `uri` to
 * `Sharing.shareAsync`. The user-facing message is decided by the pure
 * `exportOutcome` (jest-covered), never inline here — a screen-only branch
 * would drop `SessionHistoryExport.failures` and reinstate the #212 silent
 * partial-export bug (AGENTS.md). `src/app` has no jest project, so the wiring
 * this screen owns is pinned structurally in
 * `src/state/dataExportWiring.static.test.ts`.
 *
 * The import direction (#267 Phase 2) follows the same shape and holds even
 * less: `DocumentPicker` and `File` fetch a string, the pure `importRoutine`
 * decides whether it is a routine, `applyRoutineImport` writes it and
 * `routineImportOutcome` words the banner. The ONE rule this file owns is the
 * ordering — `applyRoutineImport` runs only on `parsed.ok`, so a refused
 * document writes nothing (AC2.5).
 */

/**
 * Write `markdown` to a cache file named `filename` and open the share sheet.
 * Returns whether sharing was available; when it is not, nothing is written or
 * shared and the caller reports that through `exportOutcome`.
 */
async function shareMarkdown(filename: string, markdown: string): Promise<boolean> {
  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) {
    return false;
  }
  const file = new File(Paths.cache, filename);
  // overwrite: a deterministic per-routine / per-day filename means a re-export
  // targets an existing file; create-then-write would otherwise throw.
  file.create({ overwrite: true });
  file.write(markdown);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/markdown',
    UTI: 'net.daringfireball.markdown',
  });
  return true;
}

export default function DataSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [routines, setRoutines] = useState<RoutineListItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          setRoutines(await routineListPresenter(database));
        } catch (error) {
          console.error('Failed to load routines for export:', error);
        }
      };
      load();
    }, [])
  );

  const handleExportRoutine = async (routine: RoutineListItem) => {
    setStatus(null);
    setBusy(true);
    try {
      const markdown = await exportRoutine(database, routine.id);
      const shared = await shareMarkdown(getRoutineExportName(routine as any), markdown);
      // A single-routine export cannot produce serialization failures, so the
      // failure list is empty by construction here; the message still routes
      // through the same pure presenter for the sharing-unavailable case.
      setStatus(exportOutcome({ failures: [], sharingAvailable: shared }));
    } catch (error) {
      console.error('Routine export failed:', error);
      setStatus('Could not export that routine. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportHistory = async () => {
    setStatus(null);
    setBusy(true);
    try {
      // `history.failures` MUST reach the user (#212, AGENTS.md). It is passed
      // straight into `exportOutcome` — dropping it here is the data-loss bug.
      const history = await exportSessionHistory(database);
      const shared = await shareMarkdown(getSessionHistoryExportName(), history.markdown);
      setStatus(exportOutcome({ failures: history.failures, sharingAvailable: shared }));
    } catch (error) {
      console.error('Session history export failed:', error);
      setStatus('Could not export session history. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleImportRoutine = async () => {
    setStatus(null);
    setBusy(true);
    try {
      // `*/*` alongside the markdown UTIs: iOS types a `.md` file inconsistently
      // (often `public.plain-text`, sometimes nothing at all), and a picker that
      // greys out the file the app itself just exported is worse than one that
      // shows everything and refuses what it cannot read.
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['net.daringfireball.markdown', 'public.plain-text', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || picked.assets.length === 0) {
        setStatus(routineImportOutcome({ kind: 'cancelled' }));
        return;
      }

      let markdown: string;
      try {
        markdown = await new File(picked.assets[0].uri).text();
      } catch (error) {
        console.error('Could not read the picked file:', error);
        setStatus(routineImportOutcome({ kind: 'unreadable' }));
        return;
      }

      const parsed = importRoutine(markdown);
      if (!parsed.ok) {
        // Nothing is written on this path — the DB half is below the guard.
        setStatus(routineImportOutcome({ kind: 'refused', error: parsed.error }));
        return;
      }

      await applyRoutineImport(database, parsed.routine);
      setStatus(routineImportOutcome({ kind: 'imported', name: parsed.routine.name }));
      setRoutines(await routineListPresenter(database));
    } catch (error) {
      console.error('Routine import failed:', error);
      setStatus('Could not import that routine. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/settings'))}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ThemedText type="default" style={styles.backButtonText}>
              ← Settings
            </ThemedText>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleRow}>
            <ThemedText type="default" style={styles.title}>
              Data
            </ThemedText>
            <ThemedText type="small" style={styles.caption}>
              Export routines and history as markdown files, or import a routine
              file back in.
            </ThemedText>
          </View>

          {status && (
            <ThemedView
              style={[styles.statusBanner, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="small">{status}</ThemedText>
            </ThemedView>
          )}

          <ThemedText type="subtitle" style={styles.sectionHeading}>
            Session History
          </ThemedText>
          <Pressable
            disabled={busy}
            onPress={handleExportHistory}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: ActionButtonColor.primary },
              pressed && styles.buttonPressed,
              busy && styles.buttonDisabled,
            ]}
          >
            <ThemedText type="default" style={styles.buttonText}>
              Export Session History
            </ThemedText>
          </Pressable>

          <ThemedText type="subtitle" style={styles.sectionHeading}>
            Routines
          </ThemedText>
          <Pressable
            disabled={busy}
            onPress={handleImportRoutine}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: ActionButtonColor.primary },
              pressed && styles.buttonPressed,
              busy && styles.buttonDisabled,
            ]}
          >
            <ThemedText type="default" style={styles.buttonText}>
              Import Routine
            </ThemedText>
          </Pressable>
          {routines.length === 0 ? (
            <ThemedText type="small" style={styles.caption}>
              No routines yet.
            </ThemedText>
          ) : (
            routines.map((routine) => (
              <Pressable
                key={routine.id}
                disabled={busy}
                onPress={() => handleExportRoutine(routine)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.rowPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <View style={styles.rowText}>
                  <ThemedText type="default">{routine.name}</ThemedText>
                  <ThemedText type="small" style={styles.caption}>
                    Export routine
                  </ThemedText>
                </View>
                <ThemedText type="default" style={styles.chevron}>
                  ›
                </ThemedText>
              </Pressable>
            ))
          )}
        </ScrollView>
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
  },
  headerContainer: {
    marginBottom: Spacing.three,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonText: {
    opacity: 0.7,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  titleRow: {
    gap: Spacing.one,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  caption: {
    opacity: 0.7,
  },
  sectionHeading: {
    marginTop: Spacing.two,
  },
  statusBanner: {
    borderRadius: 10,
    padding: Spacing.three,
  },
  button: {
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    gap: Spacing.one,
    flexShrink: 1,
  },
  chevron: {
    fontSize: 24,
    lineHeight: 28,
    opacity: 0.4,
    paddingLeft: Spacing.two,
  },
});
