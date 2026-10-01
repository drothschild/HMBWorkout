import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ALPHABET_INDEX_LETTERS, letterAtPosition } from '@/state/exerciseAlphabetIndex';
import { useTheme } from '@/hooks/use-theme';

/** Vertical A-Z strip; tap or drag selects a letter. */
export function ExerciseAlphabetIndex({ onSelect }: { onSelect: (letter: string) => void }) {
  const theme = useTheme();
  const heightRef = useRef(0);
  const lastRef = useRef<string | null>(null);

  const handle = (y: number) => {
    const letter = letterAtPosition(y, heightRef.current);
    if (letter !== lastRef.current) {
      lastRef.current = letter;
      onSelect(letter);
    }
  };

  return (
    <View
      accessibilityLabel="Alphabet index"
      style={styles.container}
      onLayout={(e) => {
        heightRef.current = e.nativeEvent.layout.height;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        lastRef.current = null;
        handle(e.nativeEvent.locationY);
      }}
      onResponderMove={(e) => handle(e.nativeEvent.locationY)}
      onResponderRelease={() => {
        lastRef.current = null;
      }}
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
