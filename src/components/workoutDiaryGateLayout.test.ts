import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type Node = { type: string; props: Record<string, any> };
function nodes(tree: any): Node[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function gate(stage: 'diary' | 'selfie', busy = false) {
  const source = fs.readFileSync(path.join(__dirname, 'WorkoutDiaryGate.tsx'), 'utf8');
  const values: any[] = [];
  let index = 0;
  const saveDiary = jest.fn();
  const store = Object.assign(() => ({ stage, diary: 'Saved journal', busy, error: null }), {
    getState: () => ({ busy, load() {}, saveDiary }),
  });
  const element = (type: string, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    react: {
      useEffect() {}, useMemo: (fn: () => any) => fn(), useRef: (current: any) => ({ current }),
      useState(initial: any) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], (value: any) => { values[slot] = value; }]; },
    },
    'react-native': { ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', View: 'View', useWindowDimensions: () => ({ width: 393 }) },
    '@expo/ui': { Host: 'Host', Column: 'Column', Button: 'Button', TextInput: 'TextInput' },
    'expo-image-picker': {}, '@/db': { database: {} },
    '@/state/workoutDiary': { createWorkoutDiaryStore: () => store },
    '@/state/workoutSelfieFiles': { workoutSelfieFiles: {} },
    './themed-text': { ThemedText: 'ThemedText' },
    '@/constants/theme': { Spacing: { two: 8, three: 16, four: 24 } },
    '@/theme/actionButtonColors': { ActionButtonColor: { primary: '#0071EB' } },
    '@/hooks/use-theme': { useTheme: () => ({ text: '#000', backgroundElement: '#eee' }) },
    './WorkoutPhotoActions': { WorkoutPhotoActions: 'WorkoutPhotoActions' },
  };
  const exports: any = {};
  new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText)(
    (name: string) => { if (!(name in modules)) throw new Error(name); return modules[name]; }, exports);
  return { saveDiary, render() { index = 0; return nodes(exports.WorkoutDiaryGate({ sessionId: 'session', onComplete() {} })); } };
}

it.each(['diary', 'selfie'] as const)('sizes %s controls from their measured parent instead of the screen', stage => {
  const h = gate(stage);
  let tree = h.render();
  const controlType = stage === 'diary' ? 'TextInput' : 'WorkoutPhotoActions';
  expect(tree.some(node => node.type === controlType)).toBe(false);
  const wrapper = tree.find(node => node.type === 'View' && node.props.onLayout);
  expect(wrapper).toBeDefined();
  for (const width of [279, 227, 504]) {
    wrapper!.props.onLayout({ nativeEvent: { layout: { width } } });
    tree = h.render();
    const control = tree.find(node => node.type === controlType)!;
    expect(control).toBeDefined();
    expect(stage === 'diary' ? control.props.style.width : control.props.width).toBe(width);
    if (stage === 'diary') expect(tree.find(node => node.type === 'Button')!.props.style.width).toBe(width);
  }
  wrapper!.props.onLayout({ nativeEvent: { layout: { width: 0 } } });
  expect(h.render().some(node => node.type === controlType)).toBe(false);
});

it('keeps save disabled while busy after the measured editor mounts', () => {
  const h = gate('diary', true);
  const wrapper = h.render().find(node => node.type === 'View' && node.props.onLayout);
  expect(wrapper).toBeDefined(); wrapper!.props.onLayout({ nativeEvent: { layout: { width: 279 } } });
  const tree = h.render();
  expect(tree.find(node => node.type === 'TextInput')!.props.editable).toBe(false);
  expect(tree.find(node => node.type === 'Button')!.props.disabled).toBe(true);
});
