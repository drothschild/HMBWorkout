import { readFileSync } from 'fs';
import { join } from 'path';

import {
  createPageYTouchHandlers,
  letterAtPageY,
  scrollOffsetForFailedIndex,
} from './exerciseAlphabetIndex';

const componentSrc = readFileSync(join(__dirname, '../components/ExerciseAlphabetIndex.tsx'), 'utf8');
const screenSrc = readFileSync(join(__dirname, '../app/(tabs)/exercises.tsx'), 'utf8');

describe('alphabet index uses page position, not child-relative locationY', () => {
  test('letterAtPageY resolves the letter from pageY minus the strip top', () => {
    // strip starts at page y=200, 270pt tall, 27 slots of 10pt
    expect(letterAtPageY(200, 200, 270)).toBe('A');
    expect(letterAtPageY(200 + 125, 200, 270)).toBe('M');
    expect(letterAtPageY(200 + 269, 200, 270)).toBe('#');
    // finger dragged past the ends clamps
    expect(letterAtPageY(50, 200, 270)).toBe('A');
    expect(letterAtPageY(900, 200, 270)).toBe('#');
  });

  test('tapping near M selects M (not A) even though the touched child reports locationY near 0', () => {
    const picked: string[] = [];
    const h = createPageYTouchHandlers(() => 200, () => 270, (l) => picked.push(l));
    h.grant(200 + 125);
    expect(picked).toEqual(['M']);
  });

  test('dragging changes the letter continuously from pageY', () => {
    const picked: string[] = [];
    const h = createPageYTouchHandlers(() => 200, () => 270, (l) => picked.push(l));
    h.grant(205);
    h.move(235);
    h.move(335);
    h.move(469);
    expect(picked).toEqual(['A', 'D', 'N', '#']);
  });

  test('the component feeds pageY and the measured strip position, never locationY', () => {
    expect(componentSrc).not.toContain('locationY');
    expect(componentSrc).toContain('nativeEvent.pageY');
    expect(componentSrc).toContain('createPageYTouchHandlers');
    expect(componentSrc).toMatch(/\.measure\(/);
  });

  test('the strip keeps the responder while dragging', () => {
    expect(componentSrc).toContain('onResponderTerminationRequest={() => false}');
  });
});

describe('scrolling to a far letter with variable-height rows', () => {
  test('failed scrollToIndex falls back to the measured average row height, not index*100', () => {
    expect(scrollOffsetForFailedIndex({ index: 40, averageItemLength: 130 })).toBe(5200);
    expect(scrollOffsetForFailedIndex({ index: 0, averageItemLength: 130 })).toBe(0);
    expect(scrollOffsetForFailedIndex({ index: 10, averageItemLength: 0 })).toBe(1000);
  });

  test('the screen uses the helper and retries scrollToIndex after the fallback jump', () => {
    expect(screenSrc).not.toContain('offset: index * 100');
    expect(screenSrc).toContain('scrollOffsetForFailedIndex');
    expect(screenSrc).toMatch(/onScrollToIndexFailed=\{\(info\)/);
    expect(screenSrc).toMatch(/setTimeout\(/);
  });
});
