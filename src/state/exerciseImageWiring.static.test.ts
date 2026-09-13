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
  exerciseImage: join(COMPONENTS, 'ExerciseImage.tsx'),
  // src/hooks is outside jest's testMatch, so the hook is gated structurally too.
  keyboardVisibleHook: join(__dirname, '..', 'hooks', 'use-keyboard-visible.ts'),
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

    expect(args).toHaveLength(7);
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

  it('refuses a second save while one is in flight, and a blank field', () => {
    // The button's `disabled` covers taps, but onSubmitEditing reaches the
    // handler directly, so the handler must carry both of the button's
    // conditions itself. `savingImage` stops two overrides racing to download
    // and delete each other's files; the blank check stops a return on an
    // empty field from running the override and showing the red "Enter an
    // image URL that starts with http:// or https://." error.
    expect(compact(FILES.exerciseDetail)).toContain(
      "if(!id||savingImage||imageUrl.trim()==='')return;",
    );
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

describe('SetLogger hides the hero while the keyboard is open (#335 Phase 7)', () => {
  // On an iPhone 15 Pro Release build the full-width 3:2 hero pushed the
  // Reps/Weight/Duration inputs so far down that the keyboard covered them.
  // The session screen is deliberately a fixed column with no outer
  // ScrollView (its buttons stay pinned above the keyboard by a
  // KeyboardAvoidingView — see session.tsx), so the user chose to drop the
  // hero entirely while the keyboard is up: without it the layout is the
  // pre-#335 one. (This read "which fit" until a device test showed that
  // column overflowing on timed exercises with long routine notes or a
  // Replace button; see the session.tsx keyboard gates below.) Nothing can
  // render SetLogger or the hook, so all three halves are pinned structurally.
  const HERO_WRAPPER =
    '<Viewstyle={[styles.exerciseHero,{height:heroColumnWidth/EXERCISE_IMAGE_ASPECT_RATIO}]}' +
    'onLayout={(event)=>setHeroColumnWidth(event.nativeEvent.layout.width)}>' +
    '<ExerciseImageimagePath={presenter.currentExerciseImagePath}size="fit"/></View>';
  const HOOK_CALL = 'constkeyboardVisible=useKeyboardVisible();';

  it('renders the hero wrapper only when the keyboard is NOT visible', () => {
    const source = compact(FILES.setLogger);
    indexOfOrThrow(source, HERO_WRAPPER, 'SetLogger.tsx');

    expect(occurrences(source, HERO_WRAPPER)).toBe(1);
    expect(source).toContain(`{!keyboardVisible&&(${HERO_WRAPPER})}`);
  });

  it('reads keyboardVisible from the shared hook, called once, above the first return', () => {
    // A hook below an early return crashes with "Rendered more hooks than
    // during the previous render". SetLogger has no early return today; the
    // first `return` inside the component is its JSX return, and any early
    // return added later lands above that — so the hook must precede it.
    const source = compact(FILES.setLogger);
    const componentAt = indexOfOrThrow(source, 'exportfunctionSetLogger(', 'SetLogger.tsx');
    const body = source.slice(componentAt);
    const hookAt = indexOfOrThrow(body, HOOK_CALL, 'SetLogger.tsx');
    const firstReturnAt = indexOfOrThrow(body, 'return', 'SetLogger.tsx');

    expect(source).toContain("import{useKeyboardVisible}from'@/hooks/use-keyboard-visible';");
    expect(occurrences(source, HOOK_CALL)).toBe(1);
    expect(hookAt).toBeLessThan(firstReturnAt);
  });

  it('the hook listens on the platform-correct events and removes both subscriptions', () => {
    // iOS: the Will events, so the hero collapses while the keyboard animates
    // in rather than after it has already covered the focused field. Android
    // never fires the Will events, so it must use the Did ones.
    const source = compact(FILES.keyboardVisibleHook);

    expect(source).toContain("constSHOW_EVENT=Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow';");
    expect(source).toContain("constHIDE_EVENT=Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide';");
    expect(occurrences(source, 'Keyboard.addListener(')).toBe(2);

    // Anchored on `useEffect(` (the hook's only one), not on the listener: the
    // body starts AT the marker, so the `const show =` binding must follow it.
    const { body, deps } = effectAround(
      normalized(FILES.keyboardVisibleHook),
      'useEffect(',
      'use-keyboard-visible.ts'
    );
    const effect = body.replace(/\s+/g, '');
    expect(effect).toContain('constshow=Keyboard.addListener(SHOW_EVENT,()=>setVisible(true));');
    expect(effect).toContain('consthide=Keyboard.addListener(HIDE_EVENT,()=>setVisible(false));');
    expect(effect).toContain('return()=>{show.remove();hide.remove();};');
    // Subscribed once per mount, not re-subscribed on every render.
    expect(deps).toEqual([]);
  });
});

describe('session.tsx sheds non-essentials while the keyboard is open (#335 Phase 7)', () => {
  // Device test, iPhone 15 Pro Release build, decimal pad up (~290pt), hero
  // already hidden: on "Stationary Bike" (six-line routine notes, timer card)
  // Finish Session / Abandon drew over the Duration input and Log Set / Skip
  // Set went behind the keyboard; on "Forearm Plank" (no notes, AI key) the
  // footer overlapped the Replace button. With the hero gone the column is the
  // pre-#335 one, so the overflow likely predates #335. The user chose: while
  // typing, hide the footer and the Replace button and clamp the routine notes
  // to two lines; the timer card, the focused input and Log Set / Skip Set
  // stay, and the column still does not scroll. Nothing can render
  // session.tsx, so every half is pinned as an exact string.
  const HOOK_CALL = 'constkeyboardVisible=useKeyboardVisible();';
  const FOOTER_OPEN = '<Viewstyle={[styles.footer,{borderTopColor:theme.backgroundSelected}]}>';

  it('reads keyboardVisible from the shared hook, called once, above the early return', () => {
    // A hook below the `if (!sessionState) return` crashes the screen with
    // "Rendered more hooks than during the previous render" the moment a
    // session starts or ends under it.
    const source = compact(FILES.session);
    const body = source.slice(indexOfOrThrow(source, 'exportdefaultfunctionSessionScreen(', 'session.tsx'));
    const EARLY_RETURN = 'if(!sessionState){return(';

    expect(source).toContain("import{useKeyboardVisible}from'@/hooks/use-keyboard-visible';");
    expect(occurrences(source, 'useKeyboardVisible()')).toBe(1);
    expect(occurrences(source, HOOK_CALL)).toBe(1);
    expect(occurrences(body, EARLY_RETURN)).toBe(1);
    expect(indexOfOrThrow(body, HOOK_CALL, 'session.tsx')).toBeLessThan(
      indexOfOrThrow(body, EARLY_RETURN, 'session.tsx')
    );
  });

  it('renders the whole footer block, Close variant included, only when the keyboard is NOT visible', () => {
    const source = compact(FILES.session);
    expect(occurrences(source, FOOTER_OPEN)).toBe(1);
    const gateAt = indexOfOrThrow(source, `{!keyboardVisible&&(${FOOTER_OPEN}`, 'session.tsx');
    // The conditional wraps the footer and nothing else: its `)}` follows the
    // footer's own close and precedes the KeyboardAvoidingView's.
    const closeAt = indexOfOrThrow(source, '</View>)}</KeyboardAvoidingView>', 'session.tsx');
    expect(closeAt).toBeGreaterThan(gateAt);
    const block = source.slice(gateAt, closeAt);

    // With the keyboard closed nothing changes: Close at phase 'done',
    // otherwise Finish Session and Abandon.
    expect(block).toContain("{presenter.phase==='done'?(");
    expect(block).toContain('>Close</ThemedText>');
    expect(block).toContain('onPress={confirmFinish}');
    expect(block).toContain('>FinishSession</ThemedText>');
    expect(block).toContain('onPress={confirmAbandon}');
    expect(block).toContain('>Abandon</ThemedText>');
  });

  it('gates the Replace slot where session.tsx decides it, and renders Replace nowhere else', () => {
    const source = compact(FILES.session);

    expect(occurrences(source, '<ReplaceExercise')).toBe(1);
    expect(source).toContain(
      'belowButtonsSlot={<ReplaceExercisesessionState={sessionState}exerciseTitles={exerciseTitles}keyboardVisible={keyboardVisible}/>}'
    );
  });

  it('clamps the routine notes to two lines only while the keyboard is visible', () => {
    const source = compact(FILES.session);

    expect(occurrences(source, 'style={styles.routineNotes}')).toBe(1);
    expect(source).toContain(
      '<ThemedTexttype="small"style={styles.routineNotes}numberOfLines={keyboardVisible?2:undefined}>'
    );
  });

  it('keeps SetLogger and its inputs visible while forwarding keyboard state to Replace', () => {
    // The declaration plus the notes, Replace's trigger policy, and footer.
    // The extra Replace prop keeps its open Modal mounted when that Modal's
    // search field is responsible for the visible keyboard.
    expect(occurrences(compact(FILES.session), 'keyboardVisible')).toBe(5);
  });
});

/**
 * The top-level `key: value` pairs of one `StyleSheet.create` entry, whitespace
 * removed. The key must follow `{` or `,` so `hero` never matches `exerciseHero`.
 */
function styleEntry(source: string, name: string, file: string): string[] {
  const sheetAt = indexOfOrThrow(source, 'StyleSheet.create({', file);
  const key = new RegExp(`[{,]${name}:\\{`, 'g');
  key.lastIndex = sheetAt;
  const found = key.exec(source);
  if (!found) {
    throw new Error(`${file} StyleSheet has no ${name} entry; re-anchor this gate`);
  }
  const open = found.index + found[0].length - 1;
  const props: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (depth === 0) {
        if (current.length > 0) props.push(current);
        return props;
      }
    } else if (ch === ',' && depth === 1) {
      if (current.length > 0) props.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  throw new Error(`unterminated ${name} style in ${file}; re-anchor this gate`);
}

describe('the workout hero shrinks to fit instead of overlapping the buttons (#335 Phase 7)', () => {
  // On an iPhone 15 Pro Release build, real routines overflowed the session
  // screen's fixed column: a 6-line routine description plus the stopwatch card
  // put "Finish Session / Abandon" on top of "Log Set / Skip Set", and with the
  // Replace button present the logged-sets list was squeezed to nothing. The
  // user chose: the image is big when there is room and shrinks when there
  // isn't, the list keeps a small minimum, and the column still does not scroll.
  //
  //
  // The user then ruled out the first version's centered crop: a shrunk image
  // must keep its 3:2 proportions, scaled down and centered, never cropped into
  // a banner. So the wrapper's full size is an explicit height derived from the
  // column width it measures (width / 3:2), it yields height under flexShrink,
  // and the image fills that HEIGHT with its width derived by aspectRatio. Nothing
  // can render SetLogger, so the mechanism is pinned structurally, as exact
  // strings and exact prop sets.
  const LAYOUT_PROPS_THAT_FIX_SIZE = ['height', 'aspectRatio', 'flex', 'flexGrow', 'flexBasis'];
  const CROP_PROPS = ['overflow', 'justifyContent', 'borderRadius'];
  const keysOf = (props: string[]) => props.map((prop) => prop.slice(0, prop.indexOf(':')));

  it('the hero wrapper shrinks and centers the image, and does not clip it', () => {
    const props = styleEntry(compact(FILES.setLogger), 'exerciseHero', 'SetLogger.tsx');

    expect(new Set(props)).toEqual(
      new Set(['marginTop:Spacing.two', 'flexShrink:1', 'minHeight:0', "alignItems:'center'"])
    );
    // The full-size height is the measured one, inline; a static height, basis,
    // grow or aspect lock here would override it, and a clip means a crop.
    for (const key of [...LAYOUT_PROPS_THAT_FIX_SIZE, ...CROP_PROPS]) {
      expect(keysOf(props)).not.toContain(key);
    }
  });

  it("the wrapper's full height is the measured column width over the 3:2 ratio", () => {
    // Exact string: the inline height is width / ratio (a 3:2 box at full
    // width), and onLayout does nothing but record the width, which comes from
    // the column's stretch, never from the image, so it cannot loop.
    const source = compact(FILES.setLogger);
    const measuredHeight = 'style={[styles.exerciseHero,{height:heroColumnWidth/EXERCISE_IMAGE_ASPECT_RATIO}]}';

    expect(occurrences(source, measuredHeight)).toBe(1);
    expect(occurrences(source, 'onLayout={(event)=>setHeroColumnWidth(event.nativeEvent.layout.width)}')).toBe(1);
    expect(occurrences(source, 'setHeroColumnWidth(')).toBe(1);
    expect(source).toContain("import{ExerciseImage,EXERCISE_IMAGE_ASPECT_RATIO}from'./ExerciseImage';");
  });

  it('the measured width is a hook above the first return, starting at zero', () => {
    const source = compact(FILES.setLogger);
    const body = source.slice(indexOfOrThrow(source, 'exportfunctionSetLogger(', 'SetLogger.tsx'));
    const hook = 'const[heroColumnWidth,setHeroColumnWidth]=useState(0);';

    expect(source).toContain("import{useEffect,useRef,useState}from'react';");
    expect(occurrences(source, hook)).toBe(1);
    expect(indexOfOrThrow(body, hook, 'SetLogger.tsx')).toBeLessThan(indexOfOrThrow(body, 'return', 'SetLogger.tsx'));
  });

  it('the image fills the wrapper height and takes its width from 3:2, capped at the column', () => {
    const image = compact(FILES.exerciseImage);

    expect(image).toContain('exportconstEXERCISE_IMAGE_ASPECT_RATIO=3/2;');
    expect(image).toContain("exporttypeExerciseImageSize='hero'|'fit'|'row'|'strip';");
    expect(styleEntry(image, 'fit', 'ExerciseImage.tsx')).toEqual([
      "height:'100%'",
      "maxWidth:'100%'",
      'aspectRatio:EXERCISE_IMAGE_ASPECT_RATIO',
    ]);
    // The image rounds and clips its own corners, so no wrapper has to.
    expect(styleEntry(image, 'base', 'ExerciseImage.tsx')).toEqual(['borderRadius:6', "overflow:'hidden'"]);
  });

  it('the exercise detail hero is unchanged: full width, 3:2', () => {
    // The exercise detail screen scrolls and keeps the fixed 3:2 hero; the
    // shrink lives on the session screen's 'fit' variant only.
    expect(styleEntry(compact(FILES.exerciseImage), 'hero', 'ExerciseImage.tsx')).toEqual([
      "width:'100%'",
      'aspectRatio:3/2',
    ]);
  });

  it('the logged-sets list keeps a floor of two rows, derived from the row style', () => {
    const source = compact(FILES.setLogger);

    expect(source).toContain(
      'constLOGGED_SET_ROW_HEIGHT=TypeRamp.default.lineHeight+2*Spacing.one+SET_ROW_BORDER_WIDTH;'
    );
    expect(source).toContain('constLOGGED_SETS_MIN_HEIGHT=2*LOGGED_SET_ROW_HEIGHT;');
    expect(new Set(styleEntry(source, 'setRow', 'SetLogger.tsx'))).toEqual(
      new Set(['paddingVertical:Spacing.one', 'borderBottomWidth:SET_ROW_BORDER_WIDTH'])
    );
    expect(styleEntry(source, 'loggedSetsFloor', 'SetLogger.tsx')).toEqual(['minHeight:LOGGED_SETS_MIN_HEIGHT']);
  });

  it('the floor applies only while the hero is shown and no description chrome competes', () => {
    // With the keyboard up the hero is gone and nothing else in the column can
    // yield, so a floor there could only push the buttons down; the list goes
    // back to being the elastic element, as it was before #335.
    const source = compact(FILES.setLogger);
    const tag = '<ScrollViewstyle={[styles.loggedSets,!keyboardVisible&&!presenter.exerciseDescriptionLine&&styles.loggedSetsFloor]}';

    expect(occurrences(source, tag)).toBe(1);
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

    // Full column width at 3:2 when there is room, like the exercise detail
    // hero (user request on #335), not the 48pt "row" thumbnail it started as;
    // "fit" rather than "hero" so it can scale down whole (see the shrink gates).
    expect(heroTag).toContain('size="fit"');
    // Under the title row, not inside it: exerciseTitleRow is a
    // flexDirection 'row' container, so a 100%-wide image anywhere inside it —
    // before the title or between the title and the `?` button — crushes the
    // title. Anchor on the hero's own wrapper, and require that wrapper to open
    // after the title row closes. The row holds no nested View (the `?` is a
    // Pressable), so its first `</View>` is its own close.
    const heroWrapperAt = indexOfOrThrow(source, '<View style={[styles.exerciseHero,', 'SetLogger.tsx');
    expect(heroWrapperAt).toBeLessThan(source.indexOf(heroTag));
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

  it('routine detail rows align the image with the top of the exercise content (#356)', () => {
    // Exercises with varying prescribed sets or a description are taller than
    // the 48pt image. Center alignment leaves the image floating halfway down
    // that content instead of beside the exercise title.
    expect(styleEntry(compact(FILES.routineDetail), 'exerciseItem', 'routine/[id].tsx')).toContain(
      "alignItems:'flex-start'"
    );
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
