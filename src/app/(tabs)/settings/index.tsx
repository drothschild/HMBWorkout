import { StyleSheet, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface SectionRow {
  title: string;
  description: string;
  href: '/settings/ai' | '/settings/bridge';
}

const SECTIONS: SectionRow[] = [
  {
    title: 'AI Coach',
    description: 'Anthropic API key, goals, equipment',
    href: '/settings/ai',
  },
  {
    title: 'Bridge & Sync',
    description: 'Bridge connection, import, session sync',
    href: '/settings/bridge',
  },
];

export default function SettingsIndexScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
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
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
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
    opacity: 0.4,
    paddingLeft: Spacing.two,
  },
});
