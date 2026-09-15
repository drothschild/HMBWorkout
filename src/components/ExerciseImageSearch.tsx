import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor, StatusColor } from '@/theme/actionButtonColors';
import { searchExerciseImageChoices, type ExerciseImageChoice } from '@/state/exerciseWebImages';

type Props = {
  initialQuery: string;
  onClose: () => void;
  onSelect: (url: string) => Promise<boolean>;
};

function sourceLabel(choice: ExerciseImageChoice): string {
  try { return new URL(choice.sourceUrl ?? choice.url).hostname; }
  catch { return 'Image source'; }
}

export function ExerciseImageSearch({ initialQuery, onClose, onSelect }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState(() => initialQuery.slice(0, 200));
  const [choices, setChoices] = useState<readonly ExerciseImageChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const closedRef = useRef(false);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancelSearch = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const search = useCallback(async (requestedQuery: string) => {
    if (savingRef.current || closedRef.current) return;
    cancelSearch();
    if (!requestedQuery.trim()) {
      setLoading(false);
      setError('Enter an exercise or image description, then tap Search.');
      return;
    }
    const generation = generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const results = await searchExerciseImageChoices(requestedQuery, controller.signal);
      if (!mountedRef.current || generation !== generationRef.current) return;
      setChoices(results);
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setError("Couldn't search for images. Try Search again or change the query.");
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [cancelSearch]);

  useEffect(() => {
    mountedRef.current = true;
    closedRef.current = false;
    void search(initialQuery.slice(0, 200));
    return () => {
      mountedRef.current = false;
      cancelSearch();
    };
  }, [initialQuery, search, cancelSearch]);

  const close = () => {
    if (savingRef.current || closedRef.current) return;
    closedRef.current = true;
    cancelSearch();
    onClose();
  };

  const select = async (url: string) => {
    if (savingRef.current || closedRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    cancelSearch();
    setLoading(false);
    Keyboard.dismiss();
    try {
      const saved = await onSelect(url);
      if (!mountedRef.current || closedRef.current) return;
      if (saved) {
        closedRef.current = true;
        onClose();
      } else {
        setError("Couldn't save that image. Try it again or choose another image.");
      }
    } catch {
      if (mountedRef.current && !closedRef.current) {
        setError("Couldn't save that image. Try it again or choose another image.");
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current && !closedRef.current) setSaving(false);
    }
  };

  const submit = () => {
    if (savingRef.current || closedRef.current) return;
    Keyboard.dismiss();
    void search(query);
  };

  return (
    <Modal visible presentationStyle="fullScreen" onRequestClose={close}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>Search images</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close image search" disabled={saving}
            accessibilityState={{ disabled: saving }} onPress={close} style={styles.button}>
            <Text style={styles.actionText}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.searchRow}>
          <TextInput accessibilityLabel="Image search query" value={query} onChangeText={setQuery}
            editable={!saving} maxLength={200} returnKeyType="search" onSubmitEditing={submit}
            placeholder="Exercise or image description" placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Search images" disabled={saving}
            accessibilityState={{ disabled: saving }} onPress={submit} style={styles.button}>
            <Text style={styles.actionText}>Search</Text>
          </Pressable>
        </View>
        <FlatList data={choices} numColumns={2} keyExtractor={(item) => item.url}
          style={styles.list} contentContainerStyle={styles.results} columnWrapperStyle={styles.columns}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
          ListHeaderComponent={
            <View style={styles.status}>
              <Text style={{ color: theme.textSecondary }}>Tap an image to use it for this exercise.</Text>
              {(loading || saving) && <View style={styles.activity}>
                <ActivityIndicator accessibilityLabel={saving ? 'Saving image' : 'Searching images'} />
                <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>{saving ? 'Saving image…' : 'Searching…'}</Text>
              </View>}
              {error && <Text accessibilityRole="alert" selectable style={{ color: StatusColor.danger }}>{error}</Text>}
            </View>
          }
          ListEmptyComponent={!loading && !error ?
            <Text style={{ color: theme.textSecondary }}>No images found. Change the query and tap Search.</Text> : null}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Use image: ${item.title}`}
              accessibilityHint={`Saves this image from ${sourceLabel(item)} for the exercise.`}
              accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
              onPress={() => { void select(item.url); }} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <Image accessible={false} source={{ uri: item.thumbnailUrl }} recyclingKey={item.url}
                contentFit="contain" style={styles.thumbnail} />
              <Text numberOfLines={3} style={[styles.caption, { color: theme.text }]}>{item.title}</Text>
              <Text numberOfLines={1} style={[styles.caption, { color: theme.textSecondary }]}>{sourceLabel(item)}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.three },
  heading: { flex: 1, fontSize: 22, fontWeight: '600' },
  button: { minHeight: 44, minWidth: 44, padding: Spacing.one, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: ActionButtonColor.primary, fontSize: 17, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  input: { flex: 1, minWidth: 0, minHeight: 44, padding: Spacing.one, borderRadius: 10, fontSize: 17 },
  list: { flex: 1 },
  results: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  columns: { gap: Spacing.two },
  status: { gap: Spacing.one, paddingVertical: Spacing.one },
  activity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  card: { flex: 1, maxWidth: '50%', minWidth: 0, minHeight: 44, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden', paddingBottom: Spacing.one },
  thumbnail: { width: '100%', aspectRatio: 1 },
  caption: { paddingHorizontal: Spacing.one, paddingTop: Spacing.one, fontSize: 14 },
});
