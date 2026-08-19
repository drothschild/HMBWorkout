import { StyleSheet, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface SectionRow {
  title: string;
  description: string;
  // Widened for the Data route (#267 Phase 1). expo-router types `router.push`
  // to the known static routes, so a new destination must be admitted here or
  // the screen does not compile — the phase-greenness trap.
  href: '/settings/ai' | '/settings/ai-provider' | '/settings/data';
}

const SECTIONS: SectionRow[] = [
  {
    title: 'AI Provider',
    description: 'Provider, API key, models',
    href: '/settings/ai-provider',
  },
  {
    title: 'AI Coach',
    description: 'Goals, equipment, coaching style',
    href: '/settings/ai',
  },
  {
    title: 'Data',
    description: 'Export routines and history',
    href: '/settings/data',
  },
];

export default function SettingsIndexScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
        {SECTIONS.map((section) => (
          <Pressable
            key={section.href}
            onPress={() => router.push(section.href)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.rowPressed,
            ]}
          >
            <View style={styles.rowText}>
              <ThemedText type="subtitle">{section.title}</ThemedText>
              <ThemedText type="small" style={styles.rowDescription}>
                {section.description}
              </ThemedText>
            </View>
            <ThemedText type="default" style={styles.chevron}>
              ›
            </ThemedText>
          </Pressable>
        ))}
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
    gap: Spacing.three,
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
  rowDescription: {
    opacity: 0.7,
  },
  chevron: {
    fontSize: 24,
    // 28 is 0.27pt short of LINE_HEIGHT_FLOOR × 24 (28.27). Exempted as an
    // element-specific glyph exception: the chevron character (›) contains no
    // descenders, so the shortfall lands in the unused descent band. If this
    // ever renders a different glyph, raise to 29.
    lineHeight: 28,
    opacity: 0.4,
    paddingLeft: Spacing.two,
  },
});
