import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TABS = join(__dirname, '..', 'app', '(tabs)');
const TAB_LAYOUT = join(TABS, '_layout.tsx');
const EXERCISES_SCREEN = join(TABS, 'exercises.tsx');

function compact(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '');
}

describe('Exercises tab wiring (#358)', () => {
  it('registers an Exercises tab in the tab layout', () => {
    const source = compact(TAB_LAYOUT);

    expect(source).toContain('<Tabs.Screenname="exercises"');
    expect(source).toContain("title:'Exercises'");
    expect(source).toContain("headerTitle:'Exercises'");
  });

  it('renders the local library, reloads on focus, and opens existing exercise detail', () => {
    expect(existsSync(EXERCISES_SCREEN)).toBe(true);
    if (!existsSync(EXERCISES_SCREEN)) return;

    const source = compact(EXERCISES_SCREEN);
    expect(source).toContain('useFocusEffect(');
    expect(source).toContain('exerciseLibraryPresenter(database)');
    expect(source).toContain('data={exercises}');
    expect(source).toContain('<ExerciseImageimagePath={item.imagePath}size="row"/>');
    expect(source).toContain('router.push(`/exercise/${item.id}`)');
    expect(source).toContain('accessibilityLabel={`View${item.title}`}');
  });
});
