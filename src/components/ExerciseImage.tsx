// pattern: Imperative Shell
/**
 * One exercise image, from the file the resolver stored under the documents
 * directory (#335). Takes a RELATIVE path and builds the file:// URI at render
 * time — never store the URI, iOS moves the container on reinstall/restore.
 * expo-image's own cache is evictable, which is why the app keeps its own file
 * and why this reads that file directly. Null, or a file that fails to load,
 * renders a neutral placeholder of the same size.
 */
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type ExerciseImageSize = 'hero' | 'row' | 'strip';

interface ExerciseImageProps {
  imagePath: string | null;
  size: ExerciseImageSize;
}

export function ExerciseImage({ imagePath, size }: ExerciseImageProps) {
  const theme = useTheme();
  // Keyed on the path that failed, not a boolean: a later, different path
  // (the resolver replacing a bad file) gets its own attempt.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const frame = [styles.base, styles[size], { backgroundColor: theme.backgroundElement }];

  if (imagePath === null || failedPath === imagePath) {
    return <View style={frame} accessibilityLabel="No exercise image" />;
  }
  return (
    <Image
      style={frame}
      source={{ uri: new File(Paths.document, imagePath).uri }}
      contentFit="cover"
      recyclingKey={imagePath}
      onError={() => setFailedPath(imagePath)}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 6, overflow: 'hidden' },
  hero: { width: '100%', aspectRatio: 3 / 2 },
  row: { width: 48, height: 48 },
  strip: { width: 32, height: 32 },
});
