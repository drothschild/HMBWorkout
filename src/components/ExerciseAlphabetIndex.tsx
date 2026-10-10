import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ALPHABET_INDEX_LETTERS, createPageYTouchHandlers } from '@/state/exerciseAlphabetIndex';
import { useTheme } from '@/hooks/use-theme';

/** Vertical A-Z strip; tap or drag selects a letter. */
export function ExerciseAlphabetIndex({ onSelect }: { onSelect: (letter: string) => void }) {
  const theme = useTheme();
  const heightRef = useRef(0);
  const topRef = useRef(0);
  const containerRef = useRef<View>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Refs are read only inside touch callbacks, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [touch] = useState(() =>
    createPageYTouchHandlers(
      () => topRef.current,
      () => heightRef.current,
      (letter) => onSelectRef.current(letter)
    )
  );

  return (
    <View
      ref={containerRef}
      accessibilityLabel="Alphabet index"
      style={styles.container}
      onLayout={(e) => {
        heightRef.current = e.nativeEvent.layout.height;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        // pageY and the strip's measured page position do not depend on which child was hit.
        const pageY = e.nativeEvent.pageY;
        containerRef.current?.measure((_x, _y, _w, height, _px, py) => {
          topRef.current = py;
          heightRef.current = height;
          touch.grant(pageY);
        });
      }}
      onResponderMove={(e) => touch.move(e.nativeEvent.pageY)}
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
