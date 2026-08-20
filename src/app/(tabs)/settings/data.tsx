import { StyleSheet, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
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
import type { ImportedRoutine } from '@/interop/importRoutine';
import { applyRoutineImport } from '@/state/applyRoutineImport';
import { routineImportOutcome } from '@/state/routineImportOutcome';
import { HevyHttpError, HevyUnreachable, createHevyClient } from '@/hevy/hevyClient';
import type { HevyRoutine } from '@/hevy/types';
import { mapHevyRoutine } from '@/hevy/hevyRoutineMap';
import { hevyImportOutcome, hevyLossinessSummary } from '@/hevy/hevyImportOutcome';
import { hasHevyApiKey, hevyApiKeyPatch } from '@/state/hevySettings';
import { getSettings, setSettings } from '@/state/settings';
import type { BridgeSettings } from '@/state/settings';

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
 *
 * The Hevy direction (#267 Phase 3) is the same again, with one extra beat:
 * `createHevyClient` fetches, `mapHevyRoutine` decides, and then the flow
 * **stops** and shows the lossiness summary. `applyRoutineImport` runs only
 * after the user confirms. That pause is not decoration — it is the design's
 * whole answer to "we could not represent X", and it is what makes demoting a
 * non-contiguous superset (the 2026-08-19 decision on #267) acceptable rather
 * than silent. The split into `handleHevyRoutineSelected` (maps and stages,
 * never writes) and `handleConfirmHevyImport` (writes what was staged) is what
 * `src/state/hevyImportWiring.static.test.ts` reads to prove the ordering, so
 * folding them back into one function fails that gate.
 *
 * Nothing here builds a Hevy URL or names the `api-key` header: the key goes
 * from `getSettings()` into `createHevyClient` and no further (AC3.9).
 */

const AUTOSAVE_DELAY_MS = 500;

/**
 * A hard ceiling on the routine-list paging loop. `pageSize` is capped at 10 by
 * the API, so this is 500 routines — far past any real account, and enough that
 * a wrong `page_count` cannot spin forever.
 */
const MAX_HEVY_PAGES = 50;

/** A mapping the user has been shown and has not yet accepted. */
interface PendingHevyImport {
  routine: ImportedRoutine;
  /** `null` when nothing was lost; the confirmation then shows no summary. */
  summary: string | null;
}

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
  const [hevyKeyText, setHevyKeyText] = useState(() => getSettings().hevyApiKey ?? '');
  const [hevyRoutines, setHevyRoutines] = useState<HevyRoutine[] | null>(null);
  const [pendingHevy, setPendingHevy] = useState<PendingHevyImport | null>(null);

  const pendingRef = useRef<Partial<BridgeSettings>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave, flushed on unmount so navigating away never loses a
  // half-typed key. Copied in shape from `settings/ai-provider.tsx`, which is
  // the screen this one is the sibling of.
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (Object.keys(pendingRef.current).length > 0) {
      setSettings(pendingRef.current);
      pendingRef.current = {};
    }
  }, []);

  const queueSave = (patch: Partial<BridgeSettings>) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  };

  useEffect(() => () => flush(), [flush]);

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

  /**
   * Fetch the account's routines. Read-only, and the only network call here.
   *
   * Pages until Hevy says there are no more; `pageSize` is capped at 10 by the
   * API, so a real account needs several requests. The bound stops a bad
   * `page_count` from looping forever.
   */
  const handleLoadHevyRoutines = async () => {
    setStatus(null);
    setPendingHevy(null);
    flush();

    const settings = getSettings();
    if (!hasHevyApiKey(settings)) {
      setStatus(hevyImportOutcome({ kind: 'no-key' }));
      return;
    }

    setBusy(true);
    try {
      const client = createHevyClient({ apiKey: settings.hevyApiKey ?? '' });
      const collected: HevyRoutine[] = [];
      let page = 1;
      let pageCount = 1;
      while (page <= pageCount && page <= MAX_HEVY_PAGES) {
        const result = await client.listRoutines({ page });
        collected.push(...result.routines);
        pageCount = result.pageCount;
        page += 1;
      }

      setHevyRoutines(collected);
      if (collected.length === 0) {
        setStatus(hevyImportOutcome({ kind: 'no-routines' }));
      }
    } catch (error) {
      // Both arms word themselves from the pure presenter, which never
      // interpolates the raw error message (AC3.9).
      if (error instanceof HevyUnreachable) {
        setStatus(hevyImportOutcome({ kind: 'unreachable', error }));
      } else if (error instanceof HevyHttpError) {
        setStatus(hevyImportOutcome({ kind: 'http-error', error }));
      } else {
        console.error('Hevy routine list failed:', error);
        setStatus('Could not load routines from Hevy. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Map one Hevy routine and STAGE it. Writes nothing.
   *
   * The absence of `applyRoutineImport` in this function is the invariant
   * `hevyImportWiring.static.test.ts` reads: the user must see what the
   * mapping cost before anything reaches the database.
   */
  const handleHevyRoutineSelected = async (hevyRoutine: HevyRoutine) => {
    setStatus(null);
    const mapped = mapHevyRoutine(hevyRoutine);
    if (!mapped.ok) {
      setStatus(hevyImportOutcome({ kind: 'refused', error: mapped.error }));
      return;
    }
    setPendingHevy({
      routine: mapped.routine,
      summary: hevyLossinessSummary(mapped.lossiness),
    });
  };

  /** Accept the staged mapping. The only place the Hevy path writes. */
  const handleConfirmHevyImport = async () => {
    const staged = pendingHevy;
    if (!staged) return;

    setBusy(true);
    try {
      await applyRoutineImport(database, staged.routine);
      setPendingHevy(null);
      setStatus(hevyImportOutcome({ kind: 'imported', name: staged.routine.name }));
      setRoutines(await routineListPresenter(database));
    } catch (error) {
      console.error('Hevy routine import failed:', error);
      setStatus('Could not save that routine. Please try again.');
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
            Import from Hevy
          </ThemedText>
          <ThemedText type="small" style={styles.caption}>
            Read-only. Your key is stored on this device and sent only to Hevy.
          </ThemedText>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Hevy API key"
            placeholderTextColor={theme.textSecondary}
            value={hevyKeyText}
            onChangeText={(value) => {
              // The state stays RAW so the cursor does not jump while typing;
              // only the patch is trimmed, and only by the pure builder.
              setHevyKeyText(value);
              queueSave(hevyApiKeyPatch(value));
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            disabled={busy}
            onPress={handleLoadHevyRoutines}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: ActionButtonColor.primary },
              pressed && styles.buttonPressed,
              busy && styles.buttonDisabled,
            ]}
          >
            <ThemedText type="default" style={styles.buttonText}>
              Load Hevy Routines
            </ThemedText>
          </Pressable>

          {pendingHevy ? (
            <ThemedView
              style={[styles.statusBanner, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="default">Import “{pendingHevy.routine.name}”?</ThemedText>
              {pendingHevy.summary && (
                // The lossiness summary, BEFORE the write. Held in state and
                // never rendered is the failure the static gate catches.
                <ThemedText type="small" style={styles.caption}>
                  {pendingHevy.summary}
                </ThemedText>
              )}
              <View style={styles.confirmRow}>
                <Pressable
                  disabled={busy}
                  onPress={handleConfirmHevyImport}
                  style={({ pressed }) => [
                    styles.button,
                    styles.confirmButton,
                    { backgroundColor: ActionButtonColor.primary },
                    pressed && styles.buttonPressed,
                    busy && styles.buttonDisabled,
                  ]}
                >
                  <ThemedText type="default" style={styles.buttonText}>
                    Import
                  </ThemedText>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => setPendingHevy(null)}
                  style={({ pressed }) => [
                    styles.button,
                    styles.confirmButton,
                    { backgroundColor: theme.backgroundSelected },
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <ThemedText type="default">Cancel</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ) : (
            hevyRoutines?.map((hevyRoutine) => (
              <Pressable
                key={hevyRoutine.id}
                disabled={busy}
                onPress={() => handleHevyRoutineSelected(hevyRoutine)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.rowPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <View style={styles.rowText}>
                  <ThemedText type="default">{hevyRoutine.title}</ThemedText>
                  <ThemedText type="small" style={styles.caption}>
                    {hevyRoutine.exercises.length} exercises
                  </ThemedText>
                </View>
                <ThemedText type="default" style={styles.chevron}>
                  ›
                </ThemedText>
              </Pressable>
            ))
          )}

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
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  confirmButton: {
    flex: 1,
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
