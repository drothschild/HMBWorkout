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

function compactSource(): string {
  return readFileSync(COMPONENT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '');
}

describe('tiny exercise image full-size preview (#361)', () => {
  it('opens only real row and strip images while placeholders and heroes stay inert', () => {
    const source = compactSource();

    expect(source).toContain("constpreviewable=size==='row'||size==='strip';");
    expect(source).toContain(
      'if(imagePath===null||failedPath===imagePath){return<Viewstyle={frame}accessibilityLabel="Noexerciseimage"/>;}'
    );
    expect(source).toContain('if(!previewable){returnrenderedImage;}');
    expect(source).toContain(
      'onPress={(event)=>{event.stopPropagation();setPreviewVisible(true);}}'
    );
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityLabel="Openfull-sizeexerciseimage"');
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
    expect(source).toContain('accessibilityLabel="Closeexerciseimagepreview"');
    expect(source).toContain('onPress={()=>setPreviewVisible(false)}');
  });
});
