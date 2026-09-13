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
import { bundledCatalogImageModule } from '@/state/bundledCatalogImages';
import { isBundledCatalogImagePath } from '@/state/exerciseImageState';

export type ExerciseImageSize = 'hero' | 'fit' | 'row' | 'strip';

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
  const bundledImage = bundledCatalogImageModule(imagePath);
  if (bundledImage === null && isBundledCatalogImagePath(imagePath)) {
    return <View style={frame} accessibilityLabel="No exercise image" />;
  }
  return (
    <Image
      style={frame}
      source={bundledImage ?? { uri: new File(Paths.document, imagePath).uri }}
      contentFit="cover"
      recyclingKey={imagePath}
      onError={() => setFailedPath(imagePath)}
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * Width over height of the 'fit' box. SetLogger derives its hero's full-size
 * height from it, so the space it reserves and the image it draws agree.
 */
export const EXERCISE_IMAGE_ASPECT_RATIO = 3 / 2;

const styles = StyleSheet.create({
  base: { borderRadius: 6, overflow: 'hidden' },
  hero: { width: '100%', aspectRatio: 3 / 2 },
  // Sized from the parent's HEIGHT, width from the ratio, so a parent that
  // shrinks gets a smaller whole image rather than a crop (SetLogger's hero).
  // maxWidth keeps it inside the parent's width whatever height it is given.
  fit: { height: '100%', maxWidth: '100%', aspectRatio: EXERCISE_IMAGE_ASPECT_RATIO },
  row: { width: 48, height: 48 },
  strip: { width: 32, height: 32 },
});
