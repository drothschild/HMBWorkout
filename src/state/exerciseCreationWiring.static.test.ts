import { readFileSync } from 'fs';
import { join } from 'path';

const EXERCISES_SCREEN = process.env.EXERCISES_SCREEN ?? join(__dirname, '..', 'app', '(tabs)', 'exercises.tsx');

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
    expect(source).toContain('label="Cancel"');
    expect(source).toContain('onPress={closeCreateForm}');
    expect(source).toContain('constcloseCreateForm=()=>{if(creating)return;');
    expect(source).toContain("constsheetModifiers=Platform.OS==='ios'?[interactiveDismissDisabled(creating)]:undefined;");
    expect(source).toContain('modifiers={sheetModifiers}');
    expect(source).toContain('shouldDismissOnBackPress={!creating}');
    expect(source).toContain('shouldDismissOnClickOutside={!creating}');
    expect(source).toContain("setNewTitle('');setNewKind('strength');setCreateMessage(null);setIsCreateFormVisible(false);");
  });

  it('collects a required title and explicit kind, then opens the created exercise detail', () => {
    const source = compact(readFileSync(EXERCISES_SCREEN, 'utf8'));

    expect(source).toContain("useState<ExerciseKind>('strength')");
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('constCreateFormMaxWidth=320;');
    expect(source).toContain('constcreateFormWidth=Math.min(windowWidth-Spacing.four*2,CreateFormMaxWidth);');
    expect(source).toContain('<NativeTexttextStyle={styles.createFormTitle}>Newexercise</NativeText>');
    expect(source).not.toContain('<FieldGroup');
    expect(source).toContain('<NativeTextInput');
    expect(source).toContain('testID="Newexercisetitle"');
    expect(source).toContain('defaultValue={newTitle}');
    expect(source).toContain('onChangeText={setNewTitle}');
    expect(source).toContain('autoFocus');
    expect(source).toContain('style={{width:createFormWidth,height:44');
    expect(source).toContain('<Rowstyle={{width:createFormWidth,height:44');
    expect(source).toContain('<Spacer/>');
    expect(source).toContain('<Pickerappearance="menu"selectedValue={newKind}');
    expect(source).toContain('<Picker.Itemlabel="Strength"value="strength"/>');
    expect(source).toContain('<Picker.Itemlabel="Cardio"value="cardio"/>');
    expect(source).toContain('<Picker.Itemlabel="Stretch"value="stretch"/>');
    expect(source).toContain('label={creating?\'Creating…\':\'Createexercise\'}');
    expect(source).toContain('style={{width:createFormWidth,height:44}}');
    expect(source).toContain('label="Cancel"variant="outlined"');
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
