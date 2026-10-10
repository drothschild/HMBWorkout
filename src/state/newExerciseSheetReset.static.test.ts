import { readFileSync } from 'fs';
import { join } from 'path';

const SHEET = join(__dirname, '..', 'components', 'NewExerciseSheet.tsx');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function body(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`missing ${header}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

describe('New exercise sheet default and reset (#379)', () => {
  const source = stripComments(readFileSync(SHEET, 'utf8'));

  it('defaults Type to Strength', () => {
    expect(source).toMatch(/const INITIAL_KIND: ExerciseKind = 'strength';/);
    expect(source).toMatch(/useState<ExerciseKind>\(INITIAL_KIND\)/);
  });

  it('resets to an empty name, Strength and no message', () => {
    const reset = body(source, 'const reset = ()');
    expect(reset).toContain("setTitle('')");
    expect(reset).toContain('setKind(INITIAL_KIND)');
    expect(reset).toContain('setMessage(null)');
  });

  it('Cancel resets the form and closes the sheet', () => {
    const cancel = body(source, 'const cancel = ()');
    expect(cancel).toMatch(/reset\(\);\s*onClose\(\);/);
    expect(source).toMatch(/onPress=\{cancel\}/);
    expect(source).toMatch(/onRequestClose=\{cancel\}/);
  });
});
