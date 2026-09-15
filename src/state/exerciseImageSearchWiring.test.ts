import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

type Node = { type: string; props: Record<string, any> };
function harness(source?: string) {
  const values: any[] = [{ title: 'Custom row', kind: 'strength' }, false];
  const refs: any[] = [];
  let stateIndex = 0, refIndex = 0;
  const refresh = jest.fn().mockResolvedValue({ kind: 'no-match' });
  const override = jest.fn().mockResolvedValue({ kind: 'saved', imagePath: 'exercise-images/new.jpg' });
  const download = jest.fn();
  const modules: Record<string, any> = {
    react: { useState: (initial: any) => { const i = stateIndex++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; }, useRef: (v: any) => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: v }); }, useEffect: () => {}, useCallback: (f: any) => f },
    'react/jsx-runtime': { jsx: (type: string, props: any) => ({ type, props }), jsxs: (type: string, props: any) => ({ type, props }) },
    'react-native': { ...Object.fromEntries(['TextInput', 'Pressable', 'ScrollView', 'View'].map(n => [n, n])), StyleSheet: { create: (s: any) => s }, AccessibilityInfo: {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({ id: 'row-id' }), useFocusEffect: () => {} },
    'expo-image-picker': {}, 'expo-glass-effect': { isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false, GlassView: 'GlassView' }, 'expo-symbols': { SymbolView: 'SymbolView' },
    '@/components/themed-text': { ThemedText: 'ThemedText' }, '@/components/themed-view': { ThemedView: 'ThemedView' }, '@/components/ExerciseImage': { ExerciseImage: 'ExerciseImage' }, '@/components/ExerciseImageSearch': { ExerciseImageSearch: 'ExerciseImageSearch' },
    '@/constants/theme': { Spacing: {}, MaxContentWidth: 600 }, '@/hooks/use-theme': { useTheme: () => ({}) }, '@/theme/actionButtonColors': { ActionButtonColor: {}, StatusColor: {} }, '@/db': { database: {} }, '@/db/repository': {},
    '@/state/exerciseImageResolverRegistry': { refreshExerciseImage: refresh }, '@/state/exerciseImageOverride': { overrideExerciseImage: override }, '@/state/exerciseImageFiles': { downloadExerciseImage: download }, '@/state/exercisePhotoPicker': {}, '@/state/exerciseHistoryPresenter': {},
  };
  const output = ts.transpileModule(source ?? fs.readFileSync(path.join(__dirname, '../app/exercise/[id].tsx'), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, console, require: (name: string) => { if (!(name in modules)) throw Error(name); return modules[name]; } });
  function render() { stateIndex = 0; refIndex = 0; const nodes: Node[] = []; function walk(n: any) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); nodes.push(n); walk(n.props?.children); } walk(exports.default()); return nodes; }
  const find = (label: string) => render().find(n => n.props?.accessibilityLabel === label);
  return { render, find, refresh, override, download };
}
async function open(h: ReturnType<typeof harness>, kind = 'no-match') {
  h.refresh.mockResolvedValue({ kind });
  h.find('Refresh exercise image')!.props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  const action = h.find('Search exercise images');
  expect(action).toBeDefined();
  action!.props.onPress();
  return h.render().find(n => n.type === 'ExerciseImageSearch')!;
}

it.each(['updated', 'no-match', 'failed', 'unavailable', 'unchanged', 'busy'])('offers editable image search after refresh %s without saving on open or close', async kind => {
  const h = harness(); expect(h.find('Search exercise images')).toBeDefined();
  const screen = await open(h, kind); expect(screen.props.initialQuery).toBe('Custom row exercise');
  expect(h.override).not.toHaveBeenCalled(); screen.props.onClose();
  expect(h.render().some(n => n.type === 'ExerciseImageSearch')).toBe(false); expect(h.override).not.toHaveBeenCalled();
});
it('saves the explicitly selected original URL through validated download and blocks reentry', async () => {
  const h = harness(); const screen = await open(h);
  let finish!: (v: any) => void; h.override.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const saving = screen.props.onSelect('https://example.org/original.jpg');
  await expect(screen.props.onSelect('https://example.org/second.jpg')).resolves.toBe(false);
  expect(h.override).toHaveBeenCalledTimes(1); expect(h.override.mock.calls[0][0].download).toBe(h.download);
  expect(h.override.mock.calls[0].slice(1)).toEqual(['row-id', 'https://example.org/original.jpg']);
  screen.props.onClose(); expect(h.render().some(n => n.type === 'ExerciseImageSearch')).toBe(true);
  finish({ kind: 'saved', imagePath: 'exercise-images/new.jpg' }); await expect(saving).resolves.toBe(true);
  screen.props.onClose(); expect(h.render().some(n => n.type === 'ExerciseImageSearch')).toBe(false);
});
it('keeps search open after failed save and releases the lock for another choice', async () => {
  const h = harness(); const screen = await open(h); h.override.mockResolvedValueOnce({ kind: 'download-failed' });
  await expect(screen.props.onSelect('https://example.org/bad.jpg')).resolves.toBe(false);
  expect(h.render().some(n => n.type === 'ExerciseImageSearch')).toBe(true);
  await expect(screen.props.onSelect('https://example.org/good.jpg')).resolves.toBe(true);
});

it('opens search before refreshing without changing the exercise image', () => {
  const h = harness();
  const action = h.find('Search exercise images');
  expect(action).toBeDefined();
  action!.props.onPress();
  const screen = h.render().find(n => n.type === 'ExerciseImageSearch')!;
  expect(screen.props.initialQuery).toBe('Custom row exercise');
  expect(h.refresh).not.toHaveBeenCalled();
  expect(h.override).not.toHaveBeenCalled();
  screen.props.onClose();
  expect(h.find('Search exercise images')).toBeDefined();
});
it('keeps search visible but blocks opening while refresh is saving', async () => {
  const h = harness();
  let finish!: (v: any) => void;
  h.refresh.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  h.find('Refresh exercise image')!.props.onPress();
  const action = h.find('Search exercise images');
  expect(action).toBeDefined();
  expect(action!.props.disabled).toBe(true);
  action!.props.onPress();
  expect(h.render().some(n => n.type === 'ExerciseImageSearch')).toBe(false);
  finish({ kind: 'updated' });
  await new Promise(resolve => setImmediate(resolve));
  expect(h.find('Search exercise images')!.props.disabled).toBe(false);
});
