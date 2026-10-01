import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ALPHABET_INDEX_LETTERS, createIndexTouchHandlers } from '@/state/exerciseAlphabetIndex';
import { useTheme } from '@/hooks/use-theme';

/** Vertical A-Z strip; tap or drag selects a letter. */
export function ExerciseAlphabetIndex({ onSelect }: { onSelect: (letter: string) => void }) {
  const theme = useTheme();
  const heightRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const [touch] = useState(() =>
    createIndexTouchHandlers(
      () => heightRef.current,
      (letter) => onSelectRef.current(letter)
    )
  );

  return (
    <View
      accessibilityLabel="Alphabet index"
      style={styles.container}
      onLayout={(e) => {
        heightRef.current = e.nativeEvent.layout.height;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => touch.grant(e.nativeEvent.locationY)}
      onResponderMove={(e) => touch.move(e.nativeEvent.locationY)}
      onResponderRelease={touch.release}
    >
      {ALPHABET_INDEX_LETTERS.map((letter) => (
        <Text
          key={letter}
          pointerEvents="none"
          style={[styles.letter, { color: theme.textSecondary }]}
        >
          {letter}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 28,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  letter: {
    fontSize: 11,
    fontWeight: '600',
  },
});
