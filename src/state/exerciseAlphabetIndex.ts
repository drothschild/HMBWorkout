/** Pure helpers for the Exercises tab A-Z side index (letters A-Z, then # for digits/symbols). */
export const ALPHABET_INDEX_LETTERS: readonly string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '#',
];

export function indexLetterForTitle(title: string): string {
  const first = title.trim().charAt(0).toLocaleUpperCase();
  return first.length === 1 && first >= 'A' && first <= 'Z' ? first : '#';
}

/**
 * Index of the exercise to scroll to for a letter: the first exercise in that bucket,
 * else the first in the next later bucket that has one, else the last exercise.
 * Returns -1 for an empty list.
 */
export function targetIndexForLetter(items: { title: string }[], letter: string): number {
  if (items.length === 0) return -1;
  const start = Math.max(ALPHABET_INDEX_LETTERS.indexOf(letter), 0);
  for (let i = start; i < ALPHABET_INDEX_LETTERS.length; i++) {
    const bucket = ALPHABET_INDEX_LETTERS[i];
    const found = items.findIndex((item) => indexLetterForTitle(item.title) === bucket);
    if (found >= 0) return found;
  }
  return items.length - 1;
}

/** Letter under a touch at vertical offset `y` within an index column of `height`. */
export function letterAtPosition(y: number, height: number): string {
  const count = ALPHABET_INDEX_LETTERS.length;
  if (height <= 0) return ALPHABET_INDEX_LETTERS[0];
  const i = Math.floor((y / height) * count);
  return ALPHABET_INDEX_LETTERS[Math.min(count - 1, Math.max(0, i))];
}

/**
 * Touch handlers for the index strip: grant/move select the letter under the finger
 * (only when it changes), release resets so the next touch re-selects.
 */
export function createIndexTouchHandlers(
  getHeight: () => number,
  onSelect: (letter: string) => void
) {
  let last: string | null = null;
  const handle = (y: number) => {
    const letter = letterAtPosition(y, getHeight());
    if (letter !== last) {
      last = letter;
      onSelect(letter);
    }
  };
  return {
    grant: (y: number) => {
      last = null;
      handle(y);
    },
    move: handle,
    release: () => {
      last = null;
    },
  };
}

/** Letter under a touch at screen position `pageY`, for a strip whose top is at `top` (page coords). */
export function letterAtPageY(pageY: number, top: number, height: number): string {
  return letterAtPosition(pageY - top, height);
}

/**
 * Like createIndexTouchHandlers but driven by page coordinates, so the result does not depend
 * on which child view of the strip the touch event targets.
 */
export function createPageYTouchHandlers(
  getTop: () => number,
  getHeight: () => number,
  onSelect: (letter: string) => void
) {
  const inner = createIndexTouchHandlers(getHeight, onSelect);
  return {
    grant: (pageY: number) => inner.grant(pageY - getTop()),
    move: (pageY: number) => inner.move(pageY - getTop()),
    release: inner.release,
  };
}

/** Offset to jump to when scrollToIndex fails on unmeasured rows (average row height * index). */
export function scrollOffsetForFailedIndex(info: {
  index: number;
  averageItemLength: number;
}): number {
  const rowHeight = info.averageItemLength > 0 ? info.averageItemLength : 100;
  return info.index * rowHeight;
}
