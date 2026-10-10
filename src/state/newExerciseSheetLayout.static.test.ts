import { readFileSync } from 'fs';
import { join } from 'path';

import { Spacing } from '@/constants/theme';

const SHEET = process.env.NEW_EXERCISE_SHEET ?? join(__dirname, '..', 'components', 'NewExerciseSheet.tsx');
const SCREEN = process.env.EXERCISES_SCREEN ?? join(__dirname, '..', 'app', '(tabs)', 'exercises.tsx');

type Style = Record<string, unknown>;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function parseStyles(source: string): Record<string, Style> {
  const start = source.indexOf('StyleSheet.create(');
  if (start < 0) throw new Error('no StyleSheet.create in source');
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  // eslint-disable-next-line no-new-func
  return new Function('Spacing', `return (${source.slice(open, end + 1)});`)(Spacing);
}

const CONTROLS = ['nameInput', 'typeRow', 'createButton', 'cancelButton'] as const;

describe('New exercise sheet layout contract (#379)', () => {
  const source = stripComments(readFileSync(SHEET, 'utf8'));
  const styles = parseStyles(source);

  it('uses symmetrical horizontal padding on the form container and does not center-shrink its children', () => {
    const form = styles.form;
    expect(typeof form.paddingHorizontal).toBe('number');
    expect(form.paddingHorizontal as number).toBeGreaterThan(0);
    for (const key of ['paddingLeft', 'paddingRight', 'paddingStart', 'paddingEnd', 'marginLeft', 'marginRight', 'width', 'maxWidth']) {
      expect(form[key]).toBeUndefined();
    }
    expect(form.alignItems).not.toBe('center');
  });

  it.each(CONTROLS)('stretches %s to the container width with no fixed width', (name) => {
    const style = styles[name];
    expect(style).toBeDefined();
    expect(style.alignSelf === 'stretch' || style.width === '100%').toBe(true);
    for (const key of ['width', 'maxWidth', 'marginLeft', 'marginRight', 'marginHorizontal']) {
      if (key === 'width') expect([undefined, '100%']).toContain(style.width);
      else expect(style[key]).toBeUndefined();
    }
  });

  it.each(CONTROLS)('gives %s a minHeight of at least 44', (name) => {
    expect(typeof styles[name].minHeight).toBe('number');
    expect(styles[name].minHeight as number).toBeGreaterThanOrEqual(44);
  });

  it('renders each control with its stretched style, in the specified order', () => {
    const order = ['Exercise name', 'Type', 'Create exercise', 'Cancel'].map((label) => source.indexOf(`>${label}<`) >= 0 || source.indexOf(`"${label}"`) >= 0 ? label : null);
    expect(order).not.toContain(null);
    const positions = [
      source.indexOf('styles.nameInput'),
      source.indexOf('styles.typeRow'),
      source.indexOf('styles.createButton'),
      source.indexOf('styles.cancelButton'),
    ];
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toStrictEqual(positions);
    expect(source).toContain('New exercise');
    for (const kind of ['Strength', 'Cardio', 'Stretch']) expect(source).toContain(kind);
  });

  it('keeps the fields reachable with the soft keyboard up', () => {
    expect(source).toContain('KeyboardAvoidingView');
    expect(source).toContain('ScrollView');
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });

  it('is opened from the Exercises tab header plus', () => {
    const screen = stripComments(readFileSync(SCREEN, 'utf8')).replace(/\s+/g, '');
    expect(screen).toContain('<Tabs.Screenoptions={{headerRight:');
    expect(screen).toContain('accessibilityLabel="Newexercise"');
    expect(screen).toContain('<NewExerciseSheet');
    expect(screen).toContain('router.push(`/exercise/${exerciseId}`)');
  });
});
