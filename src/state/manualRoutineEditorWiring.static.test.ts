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
});
