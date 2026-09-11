/**
 * Static interaction gate for issue #361.
 *
 * React Native screens/components are outside this Jest project's runtime, so
 * this test pins the preview's render wiring without importing Expo native
 * modules. Comments are stripped so prose cannot satisfy an assertion.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const COMPONENT = join(__dirname, '..', 'components', 'ExerciseImage.tsx');
const IMAGE_GUIDE = join(__dirname, '..', '..', 'docs', 'project-context', 'exercise-images.md');
const ROUTINE_DETAIL = join(__dirname, '..', 'app', 'routine', '[id].tsx');
const ROUTINES_TAB = join(__dirname, '..', 'app', '(tabs)', 'routines.tsx');

function compactSource(): string {
  return readFileSync(COMPONENT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '');
}

describe('tiny exercise image full-size preview (#361)', () => {
  it('opens only real row and strip images while placeholders and heroes stay inert', () => {
    const source = compactSource();

    expect(source).toContain('const[loadedPath,setLoadedPath]=useState<string|null>(null);');
    expect(source).toContain(
      "constpreviewable=loadedPath===imagePath&&(size==='row'||size==='strip');"
    );
    expect(source).toContain(
      'if(imagePath===null||failedPath===imagePath){return<Viewstyle={frame}accessibilityLabel="Noexerciseimage"/>;}'
    );
    expect(source).toContain('onLoad={()=>setLoadedPath(imagePath)}');
    expect(source).toContain(
      'onError={()=>{setLoadedPath(null);setFailedPath(imagePath);}}'
    );
    expect(source).toContain('if(!previewable){returnrenderedImage;}');
    expect(source).toContain(
      '<Pressablestyle={size===\'strip\'?styles.stripPreviewTrigger:undefined}' +
      'onPress={(event)=>{event.stopPropagation();setPreviewVisible(true);}}' +
      'accessibilityRole="button"accessibilityLabel="Openfull-sizeexerciseimage">'
    );
    expect(source).toContain("stripPreviewTrigger:{width:44,height:44,alignItems:'center',justifyContent:'center'}");
  });

  it('shows the same local file in an accessible contain-fit modal that can be dismissed', () => {
    const source = compactSource();

    expect(source).toContain('const[previewVisible,setPreviewVisible]=useState(false);');
    expect(source).toContain('constimageUri=newFile(Paths.document,imagePath).uri;');
    expect(source).toContain('<Modalvisible={previewVisible}transparentanimationType="fade"');
    expect(source).toContain('onRequestClose={()=>setPreviewVisible(false)}');
    expect(source).toContain('accessibilityViewIsModal');
    expect(source).toContain('source={{uri:imageUri}}contentFit="contain"');
    expect(source).toContain('accessibilityLabel="Full-sizeexerciseimage"');
    expect(source.match(/onError=\{\(\)=>\{setLoadedPath\(null\);setFailedPath\(imagePath\);\}\}/g) ?? [])
      .toHaveLength(2);
    expect(source).toContain(
      '<Pressablestyle={styles.previewCloseButton}onPress={()=>setPreviewVisible(false)}' +
      'accessibilityRole="button"accessibilityLabel="Closeexerciseimagepreview">'
    );
  });

  it('keeps image preview buttons as siblings of row and card navigation buttons', () => {
    const routineDetail = readFileSync(ROUTINE_DETAIL, 'utf8').replace(/\s+/g, ' ');
    const rowStart = routineDetail.indexOf('function ExerciseRow(');
    const rowEnd = routineDetail.indexOf('export default function', rowStart);
    const row = routineDetail.slice(rowStart, rowEnd);
    const rowImage = row.indexOf('<ExerciseImage');
    const rowNavigation = row.indexOf('<Pressable');

    expect(rowStart).toBeGreaterThanOrEqual(0);
    expect(rowImage).toBeGreaterThanOrEqual(0);
    expect(rowImage).toBeLessThan(rowNavigation);
    expect(row).toContain('accessibilityLabel={`Edit ${exercise.title}`}');

    const routines = readFileSync(ROUTINES_TAB, 'utf8').replace(/\s+/g, ' ');
    const routinesCompact = routines.replace(/\s+/g, '');
    const stripAt = routines.indexOf('styles.thumbnailStrip');
    const navigationOpen = routines.lastIndexOf('<Pressable', stripAt);
    const navigationClose = routines.lastIndexOf('</Pressable>', stripAt);

    expect(stripAt).toBeGreaterThanOrEqual(0);
    expect(routinesCompact).toContain(
      'renderItem={({item})=>(<Viewstyle={[styles.routineItem,{borderBottomColor:theme.backgroundSelected},]}>'
    );
    expect(routinesCompact).toContain(
      '<Viewstyle={styles.routineInfo}><Pressablestyle={({pressed})=>pressed&&styles.routineItemPressed}'
    );
    expect(navigationClose).toBeGreaterThan(navigationOpen);
    expect(routines).toContain('accessibilityLabel={`Open ${item.name}`}');
  });

  it('documents the preview boundary in the owning image contract', () => {
    const guide = readFileSync(IMAGE_GUIDE, 'utf8');
    const contractStart = guide.indexOf('- **Tiny `row` and `strip` images');
    const contractEnd = guide.indexOf('\n- **', contractStart + 1);
    const contract = guide.slice(contractStart, contractEnd).replace(/\s+/g, ' ');

    expect(contractStart).toBeGreaterThanOrEqual(0);
    expect(contractEnd).toBeGreaterThan(contractStart);
    expect(contract).toContain('Tiny `row` and `strip` images open a contain-fit preview (#361)');
    expect(contract).toContain('Placeholders and the `hero` / `fit` variants stay non-interactive');
    expect(contract).toContain(
      'Image preview, row navigation, and delete actions are sibling accessibility elements'
    );
    expect(contract).toContain('44-point press target');
    expect(contract).toContain('`src/components/ExerciseImage.tsx`');
  });
});
