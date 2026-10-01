import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ALPHABET_INDEX_LETTERS,
  indexLetterForTitle,
  letterAtPosition,
  targetIndexForLetter,
} from './exerciseAlphabetIndex';

const titles = (...t: string[]) => t.map((title) => ({ title }));
const screen = readFileSync(join(__dirname, '../app/(tabs)/exercises.tsx'), 'utf8');

describe('exercise alphabet index', () => {
  test('shows an A-Z letter index with # last, in place of the vertical scroll indicator', () => {
    expect(ALPHABET_INDEX_LETTERS).toHaveLength(27);
    expect(ALPHABET_INDEX_LETTERS[0]).toBe('A');
    expect(ALPHABET_INDEX_LETTERS[25]).toBe('Z');
    expect(ALPHABET_INDEX_LETTERS[26]).toBe('#');
    expect(screen).toContain('ExerciseAlphabetIndex');
    expect(screen).toContain('showsVerticalScrollIndicator={false}');
  });

  test('tapping a letter scrolls to the first exercise starting with that letter, case-insensitive', () => {
    const items = titles('Apple', 'bench press', 'Bicep Curl', 'Squat');
    expect(targetIndexForLetter(items, 'B')).toBe(1);
    expect(targetIndexForLetter(items, 'S')).toBe(3);
    expect(indexLetterForTitle('bench')).toBe('B');
  });

  test('tapping a letter with no exercises scrolls to the next letter with exercises, else the last exercise', () => {
    const items = titles('Apple', 'Curl', 'Squat');
    expect(targetIndexForLetter(items, 'B')).toBe(1);
    expect(targetIndexForLetter(items, 'T')).toBe(2);
    expect(targetIndexForLetter(items, '#')).toBe(2);
  });

  test('exercises starting with a digit or symbol are grouped under #, shown last', () => {
    const items = titles('21s Curl', 'Apple', '_odd');
    expect(indexLetterForTitle('21s Curl')).toBe('#');
    expect(indexLetterForTitle('_odd')).toBe('#');
    expect(targetIndexForLetter(items, '#')).toBe(0);
    expect(targetIndexForLetter(items, 'A')).toBe(1);
  });

  test('dragging a finger along the index maps the position to the letter under the finger', () => {
    expect(letterAtPosition(0, 270)).toBe('A');
    expect(letterAtPosition(269, 270)).toBe('#');
    expect(letterAtPosition(-50, 270)).toBe('A');
    expect(letterAtPosition(900, 270)).toBe('#');
    expect(letterAtPosition(135, 270)).toBe('N');
    const component = readFileSync(join(__dirname, '../components/ExerciseAlphabetIndex.tsx'), 'utf8');
    expect(component).toContain('onResponderMove');
  });

  test('the index is hidden while the search box has text and reappears when cleared', () => {
    expect(screen).toMatch(/searchQuery\.trim\(\)\s*===\s*''|!searchQuery\.trim\(\)/);
    expect(screen).toMatch(/showIndex/);
  });
});
