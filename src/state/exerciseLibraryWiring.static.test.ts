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

function readCallArgument(source: string, callee: string): string {
  const open = source.indexOf(`${callee}(`);
  if (open < 0) return '';

  let depth = 0;
  for (let index = open + callee.length; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + callee.length + 1, index);
    }
  }

  return '';
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
    const focusEffect = readCallArgument(source, 'useFocusEffect');
    expect(focusEffect).toContain('useCallback(');
    expect(focusEffect).toContain('loadExercises();');
    expect(source).toContain('exerciseLibraryPresenter(database)');
    expect(source).toContain('data={filteredExercises}');
    expect(source).toContain('<ExerciseImageimagePath={item.imagePath}size="row"/>');
    expect(source).toContain(
      '<ThemedTexttype="default"style={styles.exerciseKind}>{item.kind}</ThemedText>'
    );
    expect(source).toContain('router.push(`/exercise/${item.id}`)');
    expect(source).toContain('accessibilityLabel={`View${item.title},${item.kind}`}');
  });

  it('renders a controlled exercise search field above the filtered list', () => {
    expect(existsSync(EXERCISES_SCREEN)).toBe(true);
    if (!existsSync(EXERCISES_SCREEN)) return;

    const source = compact(EXERCISES_SCREEN);
    expect(source).toContain('filterExerciseLibraryItems(exercises,searchQuery)');
    expect(source).toContain('value={searchQuery}');
    expect(source).toContain('onChangeText={setSearchQuery}');
    expect(source).toContain('accessibilityLabel="Searchexercises"');
    expect(source).toContain('placeholder="Searchexercises"');
    expect(source).toContain('clearButtonMode="while-editing"');
    expect(source).toContain('Noexercisesmatchyoursearch.');
    expect(source.indexOf('<TextInput')).toBeLessThan(source.indexOf('<FlatList'));
  });
});
