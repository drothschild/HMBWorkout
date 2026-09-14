import { readFileSync } from 'fs';
import { join } from 'path';

const EXERCISES_SCREEN = join(__dirname, '..', 'app', '(tabs)', 'exercises.tsx');

function compact(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '');
}

describe('exercise creation wiring (#379)', () => {
  it('collects a required title and explicit kind, then opens the created exercise detail', () => {
    const source = compact(readFileSync(EXERCISES_SCREEN, 'utf8'));

    expect(source).toContain("useState<ExerciseKind>('strength')");
    expect(source).toContain('accessibilityLabel="Newexercisetitle"');
    expect(source).toContain('value={newTitle}');
    expect(source).toContain('onChangeText={setNewTitle}');
    expect(source).toContain('<PickerselectedValue={newKind}');
    expect(source).toContain('<Picker.Itemlabel="Strength"value="strength"/>');
    expect(source).toContain('<Picker.Itemlabel="Cardio"value="cardio"/>');
    expect(source).toContain('<Picker.Itemlabel="Stretch"value="stretch"/>');
    expect(source).toContain('createExercise(database,{title:newTitle,kind:newKind})');
    expect(source).toContain('router.push(`/exercise/${outcome.exerciseId}`)');
  });

  it('gives in-place validation and duplicate feedback without navigating', () => {
    const source = compact(readFileSync(EXERCISES_SCREEN, 'utf8'));

    expect(source).toContain("outcome.kind==='invalid-title'");
    expect(source).toContain('Enteraletterornumberintheexercisename.');
    expect(source).toContain("outcome.kind==='invalid-kind'");
    expect(source).toContain('Chooseavalidexercisetype.');
    expect(source).toContain("outcome.kind==='duplicate'");
    expect(source).toContain('Anexercisewiththatnamealreadyexists.Nothingwaschanged.');
    expect(source).toContain('Createexercise');
  });

  it('uses an immediate ref lock as well as disabled UI to prevent a duplicate submit', () => {
    const source = compact(readFileSync(EXERCISES_SCREEN, 'utf8'));

    expect(source).toContain('constcreationInFlightRef=useRef(false);');
    expect(source).toContain('if(creationInFlightRef.current)return;');
    expect(source).toContain('submitExerciseCreation(');
    expect(source).toContain('disabled={creating}');
  });
});
