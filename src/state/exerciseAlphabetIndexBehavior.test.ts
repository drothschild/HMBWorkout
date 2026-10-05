import { readFileSync } from 'fs';
import { join } from 'path';

import { createIndexTouchHandlers } from './exerciseAlphabetIndex';

describe('alphabet index behavior', () => {
  test('dragging along the index selects the letter under the finger continuously', () => {
    const picked: string[] = [];
    const h = createIndexTouchHandlers(() => 270, (l) => picked.push(l));
    h.grant(0);
    h.move(5);
    h.move(35);
    h.move(135);
    h.move(269);
    expect(picked).toEqual(['A', 'D', 'N', '#']);
    h.release();
    h.grant(269);
    expect(picked).toEqual(['A', 'D', 'N', '#', '#']);
  });

  test('the component wires move/grant/release to the touch handlers', () => {
    const src = readFileSync(join(__dirname, '../components/ExerciseAlphabetIndex.tsx'), 'utf8');
    expect(src).toContain('onResponderMove={(e) => touch.move(e.nativeEvent.locationY)}');
    expect(src).toContain('onResponderGrant={(e) => touch.grant(e.nativeEvent.locationY)}');
    expect(src).toContain('onResponderRelease={touch.release}');
  });

  test('index is rendered only when showIndex, derived from an empty trimmed search', () => {
    const screen = readFileSync(join(__dirname, '../app/(tabs)/exercises.tsx'), 'utf8');
    expect(screen).toContain("const showIndex = searchQuery.trim() === '';");
    expect(screen).toContain('{showIndex ? <ExerciseAlphabetIndex');
  });
});
