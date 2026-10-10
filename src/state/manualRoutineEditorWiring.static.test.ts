import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', 'app');
const ROUTINES_SCREEN = join(APP, '(tabs)', 'routines.tsx');
const EDITOR_SCREEN = join(APP, 'routine', 'new.tsx');

function compact(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '');
}

describe('manual routine editor wiring (#388)', () => {
  it('opens the routine editor from the Routines tab', () => {
    const source = compact(ROUTINES_SCREEN);

    expect(source).toContain('Newroutine');
    expect(source).toContain("router.push('/routine/new')");
    expect(source).toContain('accessibilityLabel="Newroutine"');
  });

  it('collects a routine name and saves the selected catalog ids through the creation boundary', () => {
    expect(existsSync(EDITOR_SCREEN)).toBe(true);
    if (!existsSync(EDITOR_SCREEN)) return;

    const source = compact(EDITOR_SCREEN);

    expect(source).toContain('accessibilityLabel="Routinename"');
    expect(source).toContain('value={name}');
    expect(source).toContain('onChangeText={setName}');
    expect(source).toContain('createManualRoutine(database,{name,exerciseIds:selectedExercises.map((exercise)=>exercise.id)})');
    expect(source).toContain('router.replace(`/routine/${routineId}`)');
    expect(source).toContain('constsaveInFlightRef=useRef(false);');
    expect(source).toContain('if(saveInFlightRef.current)return;');
  });

  it('provides an ordered, searchable local picker that appends duplicates and returns to the editor', () => {
    expect(existsSync(EDITOR_SCREEN)).toBe(true);
    if (!existsSync(EDITOR_SCREEN)) return;

    const source = compact(EDITOR_SCREEN);

    expect(source).toContain('exerciseLibraryPresenter(database)');
    expect(source).toContain('filterExerciseLibraryItems(exercises,searchQuery)');
    expect(source).toContain('accessibilityLabel="Searchexercises"');
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
    expect(source).toContain('keyboardDismissMode="on-drag"');
    expect(source).toContain('setSelectedExercises((current)=>[...current,exercise])');
    expect(source).toContain('setPicking(false)');
    expect(source).toContain('key={`${exercise.id}-${index}`}');
    expect(source).toContain('Thisroutinehasnoexercisesandcannotbestartedyet.');
  });

  it('closes the picker from the selection handler itself', () => {
    const source = compact(EDITOR_SCREEN);
    const start = source.indexOf('constselectExercise=');
    const end = source.indexOf('if(picking)', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toContain('setPicking(false)');
  });

  it('bounds the catalog list to the picker viewport so every catalog row remains scrollable', () => {
    const source = compact(EDITOR_SCREEN);

    expect(source).toContain('style={[styles.safeArea,styles.pickerContent]}');
    expect(source).toContain('pickerContent:{flex:1}');
    expect(source).toContain('style={styles.pickerList}');
    expect(source).toContain('pickerList:{flex:1}');
  });

  it('applies the top safe-area inset to the picker header so it clears the status bar and Dynamic Island', () => {
    const source = compact(EDITOR_SCREEN);

    expect(source).toContain("from'react-native-safe-area-context'");
    expect(source).toContain('constinsets=useSafeAreaInsets();');
    const start = source.indexOf('if(picking)');
    const end = source.indexOf('return(<ThemedViewstyle={styles.container}><ScrollView', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const pickerBranch = source.slice(start, end);
    expect(pickerBranch).toContain('paddingTop:insets.top');
    // The inset must be applied above (or on) the header toolbar, not below it.
    expect(pickerBranch.indexOf('paddingTop:insets.top')).toBeLessThan(
      pickerBranch.indexOf('Addexercise</ThemedText>')
    );
  });

  it('keeps the picker row "+" inside the row pressable and not touch-intercepting', () => {
    const source = compact(EDITOR_SCREEN);
    const start = source.indexOf('renderItem=');
    expect(start).toBeGreaterThanOrEqual(0);
    const rowStart = source.indexOf('<Pressable', start);
    const rowEnd = source.indexOf('</Pressable>', rowStart);
    const row = source.slice(rowStart, rowEnd);

    expect(row).toContain('onPress={()=>selectExercise(exercise)}');
    const plus = row.indexOf('name="plus"');
    expect(plus).toBeGreaterThan(0);
    // The native glyph must not swallow touches; the pressable receives them.
    const glyphStart = row.lastIndexOf('<', plus);
    const glyphEnd = row.indexOf('/>', plus);
    expect(row.slice(glyphStart, glyphEnd)).toContain('pointerEvents="none"');
  });
});
