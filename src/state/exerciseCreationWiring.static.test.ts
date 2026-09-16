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
  it('keeps the library focused until the header plus opens a native creation sheet', () => {
    const source = compact(readFileSync(EXERCISES_SCREEN, 'utf8'));

    expect(source).toContain('const[isCreateFormVisible,setIsCreateFormVisible]=useState(false);');
    expect(source).toContain('<Tabs.Screenoptions={{headerRight:()=>(');
    expect(source).toContain('accessibilityLabel="Newexercise"');
    expect(source).toContain('name="plus"');
    expect(source).toContain('fallback={<ThemedTextstyle={styles.newExerciseFallback}>+</ThemedText>}');
    expect(source).toContain('minWidth:44');
    expect(source).toContain('minHeight:44');
    expect(source).toContain('setIsCreateFormVisible(true)');
    expect(source).toContain('<BottomSheetisPresented={isCreateFormVisible}onDismiss={closeCreateForm}');
    expect(source).not.toContain('styles.actionsRow');
    expect(source).not.toContain('styles.createForm');
    expect(source).toContain('label="Cancel"');
    expect(source).toContain('onPress={closeCreateForm}');
    expect(source).toContain("setNewTitle('');setNewKind('strength');setCreateMessage(null);setIsCreateFormVisible(false);");
  });

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
