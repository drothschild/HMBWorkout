/**
 * Static gates on the exercise-image screen wiring (#335 Phase 5).
 *
 * `src/app` and `src/components` are invisible to every jest suite — the node
 * project cannot load a `.tsx` full of RN and expo-router imports — so the
 * screen half of AC2.9, AC3.6 and AC3.7 has no behavioural cover. These are
 * structural reads of the source, the precedent set by
 * `sessionPrefillWiring.static.test.ts`.
 *
 * Every source is read with COMMENTS STRIPPED first, so a commented-out
 * `<ExerciseImage …/>` or a `// requestExerciseImagePass()` cannot satisfy an
 * assertion. Every anchor throws "re-anchor this gate" when it is missing, so
 * a refactor that moves the code fails loudly instead of passing vacuously.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', 'app');
const COMPONENTS = join(__dirname, '..', 'components');

const FILES = {
  session: join(APP, 'session.tsx'),
  exerciseDetail: join(APP, 'exercise', '[id].tsx'),
  routineDetail: join(APP, 'routine', '[id].tsx'),
  routinesTab: join(APP, '(tabs)', 'routines.tsx'),
  setLogger: join(COMPONENTS, 'SetLogger.tsx'),
};

/**
 * Removes block comments (JSX `{/* … *\/}` included) and line comments. The
 * line-comment pattern refuses a `//` preceded by `:` so a `file://` or
 * `https://` inside a string literal is not mistaken for a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Comments stripped, every whitespace run collapsed to one space. */
function normalized(path: string): string {
  return stripComments(readFileSync(path, 'utf8')).replace(/\s+/g, ' ');
}

/** Comments stripped, all whitespace removed. */
function compact(path: string): string {
  return stripComments(readFileSync(path, 'utf8')).replace(/\s+/g, '');
}

function indexOfOrThrow(source: string, marker: string, file: string): number {
  const at = source.indexOf(marker);
  if (at === -1) {
    throw new Error(`${file} no longer contains ${marker}; re-anchor this gate`);
  }
  return at;
}

function occurrences(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

/**
 * The `useEffect` containing `marker`: its body from the marker to the first
 * `}, [ … ]);` after it, plus that dependency array's entries with whitespace
 * removed.
 */
function effectAround(source: string, marker: string, file: string): { body: string; deps: string[] } {
  const markerAt = indexOfOrThrow(source, marker, file);
  const closing = /\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/g;
  closing.lastIndex = markerAt;
  const match = closing.exec(source);
  if (!match) {
    throw new Error(`no useEffect dependency array found after ${marker} in ${file}; re-anchor this gate`);
  }
  return {
    body: source.slice(markerAt, match.index),
    deps: match[1]
      .split(',')
      .map((entry) => entry.replace(/\s+/g, ''))
      .filter((entry) => entry.length > 0),
  };
}

/** Top-level (depth-0) arguments of the first call whose text starts at `callee(`. */
function callArguments(source: string, callee: string, file: string): string[] {
  const open = indexOfOrThrow(source, `${callee}(`, file) + callee.length;
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        if (current.trim().length > 0) args.push(current.replace(/\s+/g, ''));
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(current.replace(/\s+/g, ''));
      current = '';
      continue;
    }
    current += ch;
  }
  throw new Error(`unterminated ${callee}( call in ${file}; re-anchor this gate`);
}

/** Every `<ExerciseImage … />` opening tag in the source. */
function exerciseImageTags(source: string): string[] {
  return source.match(/<ExerciseImage\b[^>]*>/g) ?? [];
}

describe('session.tsx exercise-image effect (#335 AC3.7)', () => {
  const MARKER = "withChangesForTables(['exercises'])";

  it('re-reads image paths on every exercises change and cleans up its subscription', () => {
    const { body } = effectAround(normalized(FILES.session), MARKER, 'session.tsx');

    expect(body).toContain('getExerciseImagePaths(');
    expect(body).toContain('setExerciseImagePaths(');
    expect(body).toContain('.unsubscribe()');
  });

  it('keeps the stale-read guard: only the newest read may write the map', () => {
    // Reads resolve out of order. Without the guard an older read (taken
    // before the resolver finished) can land last and blank an image that
    // resolved mid-workout, with no later emission to correct it (AC3.7).
    // Asserted on the effect body alone, whitespace removed, so the pins
    // cannot be satisfied by text elsewhere in the file.
    const body = effectAround(normalized(FILES.session), MARKER, 'session.tsx').body.replace(/\s+/g, '');
    const guardAt = indexOfOrThrow(body, 'read!==latestRead', 'session.tsx image effect');

    expect(body).toContain('constread=++latestRead;');
    expect(body).toContain('cancelled||read!==latestRead');
    expect(guardAt).toBeLessThan(indexOfOrThrow(body, 'setExerciseImagePaths(', 'session.tsx image effect'));
    expect(body).toContain('cancelled=true;');
  });

  it('latches the first-view pass request once per effect run', () => {
    // Resolver writes re-fire the subscription; without the latch every one of
    // them would request another pass. The latch must be tested, then set,
    // then the pass requested — in that order, inside this effect.
    const body = effectAround(normalized(FILES.session), MARKER, 'session.tsx').body.replace(/\s+/g, '');
    const testAt = indexOfOrThrow(body, 'if(!requestedPass&&', 'session.tsx image effect');
    const setAt = indexOfOrThrow(body, 'requestedPass=true;', 'session.tsx image effect');
    const requestAt = indexOfOrThrow(body, 'requestExerciseImagePass()', 'session.tsx image effect');

    expect(testAt).toBeLessThan(setAt);
    expect(setAt).toBeLessThan(requestAt);
    expect(occurrences(body, 'requestExerciseImagePass()')).toBe(1);
  });

  it('depends on exactly the session and the entry exercise ids, compared as a set', () => {
    // A set, not toContain: dropping entryExerciseIdsKey would strand a
    // Replace-swapped exercise on the outgoing exercise's image (the ids the
    // subscription reads are captured per effect run).
    const { deps } = effectAround(normalized(FILES.session), MARKER, 'session.tsx');

    expect(new Set(deps)).toEqual(new Set(['sessionState?.sessionId', 'entryExerciseIdsKey']));
  });
});

describe('session.tsx passes the image map to the presenter (#335 AC3.6)', () => {
  it('passes exerciseImagePaths as the 6th positional argument of createSessionPresenter', () => {
    const args = callArguments(normalized(FILES.session), 'createSessionPresenter', 'session.tsx');

    expect(args).toHaveLength(6);
    expect(args[5]).toBe('exerciseImagePaths');
  });
});

describe('first-view retry (#335 AC2.9)', () => {
  it('session.tsx requests a pass from inside the image effect', () => {
    const { body } = effectAround(
      normalized(FILES.session),
      "withChangesForTables(['exercises'])",
      'session.tsx'
    );

    expect(body).toContain('requestExerciseImagePass()');
  });

  it('exercise/[id].tsx requests a pass only when the loaded exercise has no image', () => {
    expect(compact(FILES.exerciseDetail)).toContain('if(!found.imagePath)requestExerciseImagePass();');
  });
});

describe('exercise/[id].tsx hook placement (Rules of Hooks stand-in)', () => {
  // A hook after an early return crashes the screen with "Rendered more hooks
  // than during the previous render", and no test can render the screen. Anchor
  // on the new hooks' OWN text: `useState<string|null>(null)` already exists
  // for saveError, so anchoring on it would pass wherever the new hook went.
  const HOOKS = [
    'const[imagePath,setImagePath]=useState',
    'exercise.observe()',
    // #335 Phase 6 — the paste-URL override's three hooks.
    'const[imageUrl,setImageUrl]=useState',
    'const[imageMessage,setImageMessage]=useState',
    'const[savingImage,setSavingImage]=useState',
  ];

  it.each(HOOKS)('%s occurs exactly once, above the first early return', (hook) => {
    const source = compact(FILES.exerciseDetail);
    const earlyReturn = indexOfOrThrow(source, 'if(!id||loading)', 'exercise/[id].tsx');

    expect(occurrences(source, hook)).toBe(1);
    expect(indexOfOrThrow(source, hook, 'exercise/[id].tsx')).toBeLessThan(earlyReturn);
  });
});

describe('exercise/[id].tsx paste-URL override wiring (#335 AC4.2, AC4.4)', () => {
  // The screen is the only caller of overrideExerciseImage, and nothing can
  // render it. These pins stop it silently dropping the delete-after-write
  // path or showing a hand-written message instead of the pinned copy.
  it('calls overrideExerciseImage with the real delete dep', () => {
    const source = normalized(FILES.exerciseDetail);

    expect(source).toContain('overrideExerciseImage(');
    expect(source).toContain('deleteFile: deleteExerciseImage');
  });

  it('words the outcome with exerciseImageOverrideMessage', () => {
    expect(normalized(FILES.exerciseDetail)).toContain('text: exerciseImageOverrideMessage(outcome)');
  });

  it('refuses a second save while one is in flight', () => {
    // The button's `disabled` covers taps, but onSubmitEditing reaches the
    // handler directly; the handler's own guard is what stops two overrides
    // racing to download and delete each other's files.
    expect(compact(FILES.exerciseDetail)).toContain('if(!id||savingImage)return;');
  });
});

describe('exercise/[id].tsx keeps its inputs above the keyboard (#335 Phase 7)', () => {
  // #335 put a full-width 3:2 hero under the title and an Image URL field above
  // Description, pushing both inputs to the bottom of the screen; on an iPhone
  // 15 Pro Release build the keyboard covered whichever one was focused. The
  // fix is the Settings → AI / AI Provider pattern: the screen's ScrollView
  // insets its content by the keyboard and scrolls the focused field into
  // view. Nothing can render this screen, so the prop is pinned structurally,
  // together with the two things it depends on: there is ONE ScrollView, and
  // both inputs sit inside it (an input moved outside it gets no inset).
  function scrollViewTags(source: string): string[] {
    return source.match(/<ScrollView\b[^>]*>/g) ?? [];
  }

  it('the single ScrollView sets automaticallyAdjustKeyboardInsets', () => {
    const tags = scrollViewTags(normalized(FILES.exerciseDetail));
    if (tags.length === 0) {
      throw new Error('exercise/[id].tsx no longer renders a <ScrollView>; re-anchor this gate');
    }

    expect(tags).toHaveLength(1);
    // Bare (or ={true}), never ={false}.
    expect(tags[0]).toMatch(/\sautomaticallyAdjustKeyboardInsets(?:=\{true\})?[\s/>]/);
  });

  it('both text inputs are inside that ScrollView', () => {
    const source = normalized(FILES.exerciseDetail);
    const open = indexOfOrThrow(source, '<ScrollView', 'exercise/[id].tsx');
    const close = indexOfOrThrow(source, '</ScrollView>', 'exercise/[id].tsx');
    const imageUrlInput = indexOfOrThrow(source, 'onChangeText={setImageUrl}', 'exercise/[id].tsx');
    const descriptionInput = indexOfOrThrow(source, 'queueSave(value);', 'exercise/[id].tsx');

    for (const at of [imageUrlInput, descriptionInput]) {
      expect(at).toBeGreaterThan(open);
      expect(at).toBeLessThan(close);
    }
  });
});

describe('every display site renders ExerciseImage (#335 AC3.8 wiring)', () => {
  it('SetLogger renders the current exercise image as a full-width hero under the title', () => {
    const source = normalized(FILES.setLogger);
    const heroTag = exerciseImageTags(source).find((tag) =>
      tag.includes('imagePath={presenter.currentExerciseImagePath}')
    );
    if (heroTag === undefined) {
      throw new Error('SetLogger no longer renders <ExerciseImage> for the current exercise; re-anchor this gate');
    }

    // The same size as the exercise detail hero (user request on #335), not
    // the 48pt "row" thumbnail it started as.
    expect(heroTag).toContain('size="hero"');
    // Under the title row, not inside it: exerciseTitleRow is a
    // flexDirection 'row' container, so a 100%-wide image anywhere inside it —
    // before the title or between the title and the `?` button — crushes the
    // title. Anchor on the hero's own wrapper, and require that wrapper to open
    // after the title row closes. The row holds no nested View (the `?` is a
    // Pressable), so its first `</View>` is its own close.
    const heroWrapperAt = indexOfOrThrow(
      source,
      '<View style={styles.exerciseHero}> <ExerciseImage imagePath={presenter.currentExerciseImagePath} size="hero" />',
      'SetLogger.tsx'
    );
    const titleRowAt = indexOfOrThrow(source, 'styles.exerciseTitleRow', 'SetLogger.tsx');
    const titleRowCloseAt = indexOfOrThrow(source.slice(titleRowAt), '</View>', 'SetLogger.tsx') + titleRowAt;
    expect(heroWrapperAt).toBeGreaterThan(titleRowCloseAt);
    const titleAt = indexOfOrThrow(source, 'presenter.currentExerciseTitle', 'SetLogger.tsx');
    expect(source.indexOf(heroTag)).toBeGreaterThan(titleAt);
  });

  it('routine detail rows render each exercise image', () => {
    const tags = exerciseImageTags(normalized(FILES.routineDetail));

    expect(tags.some((tag) => tag.includes('imagePath={exercise.imagePath}'))).toBe(true);
  });

  it('routine cards render a thumbnail strip from thumbnailPaths', () => {
    const source = normalized(FILES.routinesTab);
    const tags = exerciseImageTags(source);

    expect(source).toContain('item.thumbnailPaths.map(');
    expect(tags.some((tag) => tag.includes('imagePath={path}') && tag.includes('size="strip"'))).toBe(true);
  });

  it('exercise detail renders the live imagePath as the hero', () => {
    const tags = exerciseImageTags(normalized(FILES.exerciseDetail));

    expect(tags.some((tag) => tag.includes('imagePath={imagePath}') && tag.includes('size="hero"'))).toBe(true);
  });
});
