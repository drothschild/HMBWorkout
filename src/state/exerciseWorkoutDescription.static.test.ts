import fs from 'fs';
import path from 'path';

import { firstExerciseDescriptionLine } from './exerciseDescriptionSummary';

const ROOT = path.resolve(__dirname, '..');

function compact(source: string): string {
  return source.replace(/\s+/g, '');
}

function hasAllKindsDescriptionGate(source: string): boolean {
  return compact(source).includes(
    '{presenter.exerciseDescriptionLine&&(<Pressablestyle={styles.hintContainer}'
  );
}

function hasRejectedReadCancellationGuard(source: string): boolean {
  return compact(source).includes(
    "}catch(error){if(cancelled)return;console.error('Failedtoloadexercisedisplayfields:',error);"
  );
}

function hasBoundedDescriptionCue(source: string): boolean {
  return compact(source).includes(
    '<ThemedTextstyle={styles.hintText}numberOfLines={2}ellipsizeMode="tail">{presenter.exerciseDescriptionLine}</ThemedText>'
  );
}

function letsLoggedSetsYieldToDescriptionChrome(source: string): boolean {
  return compact(source).includes(
    'style={[styles.loggedSets,!keyboardVisible&&!presenter.exerciseDescriptionLine&&styles.loggedSetsFloor]}'
  );
}

function hasDismissibleFloatingDescriptionPopup(source: string): boolean {
  const compactSource = compact(source);
  return [
    'const[descriptionPopupOpen,setDescriptionPopupOpen]=useState(false);',
    'onPress={()=>setDescriptionPopupOpen(true)}',
    'accessibilityLabel="Showfullexercisedescription"',
    '<Modalvisible={descriptionPopupOpen}animationType="fade"transparentonRequestClose={()=>setDescriptionPopupOpen(false)}>',
    '<Pressablestyle={styles.descriptionPopupBackdrop}onPress={()=>setDescriptionPopupOpen(false)}accessible={false}>',
    '<Viewstyle={[styles.descriptionPopupCard,{backgroundColor:theme.background}]}accessibilityViewIsModalonAccessibilityEscape={()=>setDescriptionPopupOpen(false)}>',
    '<ScrollViewstyle={styles.descriptionPopupScroll}>',
    '{presenter.exerciseDescription}',
  ].every((fragment) => compactSource.includes(fragment));
}

describe('issue #357 active-workout exercise description cue', () => {
  test('uses only the first trimmed physical line of the stored description', () => {
    expect(firstExerciseDescriptionLine('  Brace hard, then squat.\nKeep the knees tracking over toes.  '))
      .toBe('Brace hard, then squat.');
    expect(firstExerciseDescriptionLine('Drive through the floor.\r\nPause at lockout.'))
      .toBe('Drive through the floor.');
  });

  test('treats a missing or whitespace-only description as no cue', () => {
    expect(firstExerciseDescriptionLine(null)).toBeUndefined();
    expect(firstExerciseDescriptionLine(undefined)).toBeUndefined();
    expect(firstExerciseDescriptionLine('  \n  ')).toBeUndefined();
  });

  test('wires the description cue into the existing blue callout for every exercise kind', () => {
    const sessionSource = fs.readFileSync(path.join(ROOT, 'app/session.tsx'), 'utf8');
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');

    expect(sessionSource).toContain('getExerciseDescriptions');
    expect(sessionSource).toContain('exerciseDescriptions');
    expect(hasAllKindsDescriptionGate(setLoggerSource)).toBe(true);
    expect(setLoggerSource).not.toContain('presenter.progressionHint');
  });

  test('rejects suppression of the description cue for duration-based exercises', () => {
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');
    const durationSuppressionMutant = setLoggerSource.replace(
      '{presenter.exerciseDescriptionLine && (',
      '{(isDurationBased ? undefined : presenter.exerciseDescriptionLine) && ('
    );

    expect(durationSuppressionMutant).not.toBe(setLoggerSource);
    expect(hasAllKindsDescriptionGate(durationSuppressionMutant)).toBe(false);
  });

  test('bounds a long cue before it can displace the workout controls', () => {
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');
    const unboundedCueMutant = setLoggerSource.replace(
      ' numberOfLines={2} ellipsizeMode="tail"',
      ''
    );

    expect(hasBoundedDescriptionCue(setLoggerSource)).toBe(true);
    expect(unboundedCueMutant).not.toBe(setLoggerSource);
    expect(hasBoundedDescriptionCue(unboundedCueMutant)).toBe(false);
  });

  test('lets the logged-set scroller yield when description chrome is present', () => {
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');
    const alwaysFlooredMutant = setLoggerSource.replace(
      '!keyboardVisible && !presenter.exerciseDescriptionLine && styles.loggedSetsFloor',
      '!keyboardVisible && styles.loggedSetsFloor'
    );

    expect(letsLoggedSetsYieldToDescriptionChrome(setLoggerSource)).toBe(true);
    expect(alwaysFlooredMutant).not.toBe(setLoggerSource);
    expect(letsLoggedSetsYieldToDescriptionChrome(alwaysFlooredMutant)).toBe(false);
  });

  test('discards a stale title/description read after Replace changes the exercise ids', () => {
    const sessionSource = fs.readFileSync(path.join(ROOT, 'app/session.tsx'), 'utf8');
    const effectStart = sessionSource.indexOf('// Engine state carries only exercise ids');
    const effectEnd = sessionSource.indexOf('// Exercise images (#335)', effectStart);
    const effect = sessionSource.slice(effectStart, effectEnd);
    const compactEffect = compact(effect);

    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(compactEffect).toContain('constids:string[]=JSON.parse(entryExerciseIdsKey);');
    expect(compactEffect).toContain('letcancelled=false;');
    expect(compactEffect).toContain(
      'if(cancelled)return;setExerciseTitles(titles);setExerciseDescriptions(descriptions);'
    );
    expect(compactEffect).toContain('return()=>{cancelled=true;};');
  });

  test('rejects a late failed read clearing the newer exercise display maps', () => {
    const sessionSource = fs.readFileSync(path.join(ROOT, 'app/session.tsx'), 'utf8');
    const rejectedReadMutant = sessionSource.replace(
      '} catch (error) {\n        if (cancelled) return;',
      '} catch (error) {'
    );

    expect(hasRejectedReadCancellationGuard(sessionSource)).toBe(true);
    expect(rejectedReadMutant).not.toBe(sessionSource);
    expect(hasRejectedReadCancellationGuard(rejectedReadMutant)).toBe(false);
  });

  test('opens the full description in a floating popup that dismisses from any modal tap', () => {
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');

    expect(hasDismissibleFloatingDescriptionPopup(setLoggerSource)).toBe(true);
  });

  test('uses the current native shadow and continuous-corner styling for the floating card', () => {
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');
    const compactSource = compact(setLoggerSource);

    expect(compactSource).toContain("borderCurve:'continuous'");
    expect(compactSource).toContain('boxShadow:');
    expect(setLoggerSource).not.toContain('shadowOpacity:');
    expect(setLoggerSource).not.toContain('elevation:');
  });

  test('keeps the popup small and centered while long descriptions scroll', () => {
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');
    const compactSource = compact(setLoggerSource);

    expect(compactSource).toContain(
      "descriptionPopupBackdrop:{flex:1,alignItems:'center',justifyContent:'center'"
    );
    expect(compactSource).toContain("descriptionPopupCard:{width:'84%',maxWidth:360,maxHeight:'70%'");
    expect(compactSource).toContain('descriptionPopupScroll:{flexShrink:1}');
  });
});
