import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

type Node = { type: string; props: Record<string, any> };
const choice = { url: 'https://original.test/a.jpg', thumbnailUrl: 'https://thumb.test/a.jpg', title: 'Goblet squat', sourceUrl: 'https://source.test/article' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function render(source?: string) {
  const output = ts.transpileModule(source ?? fs.readFileSync(path.join(__dirname, 'ExerciseImageSearch.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const search = jest.fn();
  const requests: ReturnType<typeof deferred<typeof choice[]>>[] = [];
  search.mockImplementation(() => { const request = deferred<typeof choice[]>(); requests.push(request); return request.promise; });
  const onClose = jest.fn();
  const onSelect = jest.fn().mockResolvedValue(true);
  const slots: any[] = [];
  let cursor = 0;
  let queued: (() => void)[] = [];
  let nodes: Node[] = [];
  let writesAfterUnmount = 0;
  let unmounted = false;
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value: any) => { if (unmounted) writesAfterUnmount++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial: any) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) { const prev = slots[i]; slots[i] = { deps }; queued.push(() => { prev?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const modules: Record<string, any> = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type: string, props: any) => ({ type, props }), jsxs: (type: string, props: any) => ({ type, props }) },
    'react-native': { ...Object.fromEntries(['Modal', 'View', 'Text', 'TextInput', 'Pressable', 'FlatList', 'ActivityIndicator'].map(x => [x, x])), StyleSheet: { create: (s: any) => s }, Keyboard: { dismiss: jest.fn() } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-image': { Image: 'Image' },
    '@/hooks/use-theme': { useTheme: () => ({ text: '#111111', textSecondary: '#444444', background: '#ffffff', backgroundElement: '#eeeeee' }) },
    '@/constants/theme': { Spacing: { one: 8, two: 16, three: 24, four: 32 } },
    '@/theme/actionButtonColors': { ActionButtonColor: { primary: '#0071EB' }, StatusColor: { danger: '#EA0C00' } },
    '@/state/exerciseWebImages': { searchExerciseImageChoices: search },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(output, { exports: module.exports, AbortController, URL, require: (name: string) => { if (!(name in modules)) throw Error(`Unexpected import ${name}`); return modules[name]; } });
  function walk(node: any) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    nodes.push(node); walk(node.props?.children);
    if (node.type === 'FlatList') { walk(node.props.ListHeaderComponent); if (!node.props.data.length) walk(node.props.ListEmptyComponent); node.props.data.forEach((item: any, index: number) => walk(node.props.renderItem({ item, index }))); }
  }
  function rerender() { cursor = 0; nodes = []; walk(module.exports.ExerciseImageSearch({ initialQuery: '  goblet squat  ', onClose, onSelect })); const effects = queued; queued = []; effects.forEach(effect => effect()); }
  rerender();
  const api = {
    search, requests, onClose, onSelect, rerender,
    get nodes() { return nodes; },
    get writesAfterUnmount() { return writesAfterUnmount; },
    node(type: string) { return nodes.find(n => n.type === type)!; },
    button(label: string) { return nodes.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label)!; },
    text() { return nodes.filter(n => n.type === 'Text').map(n => n.props.children).flat().join(' '); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); rerender(); },
    unmount() { unmounted = true; slots.forEach(slot => slot?.cleanup?.()); },
  };
  return api;
}

describe('exercise image search dialog', () => {
  it('searches the exact editable query, distinguishes loading and empty, and uses a safe full-screen grid', async () => {
    const ui = render();
    expect(ui.search).toHaveBeenCalledWith('  goblet squat  ', expect.any(AbortSignal));
    ui.rerender();
    expect(ui.text()).toContain('Searching');
    expect(ui.text()).not.toContain('No images');
    expect(ui.node('Modal').props.presentationStyle).toBe('fullScreen');
    expect(ui.node('SafeAreaView')).toBeDefined();
    expect(ui.node('TextInput').props.maxLength).toBe(200);
    expect(ui.node('FlatList').props.numColumns).toBe(2);
    expect(ui.node('FlatList').props.keyboardShouldPersistTaps).toBe('handled');
    ui.requests[0].resolve([]); await ui.flush();
    expect(ui.text()).toContain('No images');
    ui.node('TextInput').props.onChangeText('single arm row'); ui.rerender();
    ui.button('Search images').props.onPress();
    expect(ui.search.mock.calls[1][0]).toBe('single arm row');
    expect(ui.onSelect).not.toHaveBeenCalled();
  });

  it('aborts superseded requests and rejects stale results even if the transport ignores abort', async () => {
    const ui = render();
    ui.node('TextInput').props.onChangeText('new query'); ui.rerender();
    ui.node('TextInput').props.onSubmitEditing();
    expect(ui.search.mock.calls[0][1].aborted).toBe(true);
    ui.requests[1].resolve([choice]); await ui.flush();
    ui.requests[0].resolve([{ ...choice, title: 'Stale result' }]); await ui.flush();
    expect(ui.text()).toContain('Goblet squat');
    expect(ui.text()).not.toContain('Stale result');
    expect(ui.node('Image').props.source).toEqual({ uri: choice.thumbnailUrl });
    expect(ui.text()).toContain('source.test');
  });

  it('retains results on refetch failure and clears the error on a successful retry', async () => {
    const ui = render(); ui.requests[0].resolve([choice]); await ui.flush();
    ui.button('Search images').props.onPress(); ui.requests[1].reject(Error('offline')); await ui.flush();
    expect(ui.text()).toContain('Goblet squat'); expect(ui.text()).toContain('Try');
    ui.button('Search images').props.onPress(); ui.requests[2].resolve([choice]); await ui.flush();
    expect(ui.text()).not.toContain("Couldn't search");
  });

  it('saves only the selected original URL, locks actions synchronously, and closes only after success', async () => {
    const ui = render(); ui.requests[0].resolve([choice]); await ui.flush();
    const save = deferred<boolean>(); ui.onSelect.mockReturnValue(save.promise);
    const selected = ui.button('Use image: Goblet squat');
    selected.props.onPress(); selected.props.onPress();
    ui.button('Close image search').props.onPress(); ui.button('Search images').props.onPress();
    expect(ui.onSelect).toHaveBeenCalledTimes(1); expect(ui.onSelect).toHaveBeenCalledWith(choice.url);
    expect(ui.onClose).not.toHaveBeenCalled(); expect(ui.search).toHaveBeenCalledTimes(1);
    ui.rerender(); expect(ui.node('TextInput').props.editable).toBe(false);
    expect(ui.nodes.filter(n => n.type === 'Pressable').every(n => n.props.disabled)).toBe(true);
    save.resolve(true); await ui.flush(); expect(ui.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['false', 'throw'])('preserves results and permits retry after a %s save failure', async (failure) => {
    const ui = render(); ui.requests[0].resolve([choice]); await ui.flush();
    if (failure === 'false') ui.onSelect.mockResolvedValueOnce(false); else ui.onSelect.mockRejectedValueOnce(Error('save failed'));
    ui.button('Use image: Goblet squat').props.onPress(); await ui.flush();
    expect(ui.onClose).not.toHaveBeenCalled(); expect(ui.text()).toContain('Goblet squat'); expect(ui.text()).toContain('Try');
    ui.button('Use image: Goblet squat').props.onPress(); await ui.flush(); expect(ui.onClose).toHaveBeenCalledTimes(1);
  });

  it('close and unmount abort search without saving or publishing late results', async () => {
    const ui = render(); ui.button('Close image search').props.onPress();
    expect(ui.search.mock.calls[0][1].aborted).toBe(true); expect(ui.onClose).toHaveBeenCalledTimes(1);
    expect(ui.onSelect).not.toHaveBeenCalled();
    ui.unmount(); ui.requests[0].resolve([choice]); await ui.flush(); expect(ui.writesAfterUnmount).toBe(0);
    const second = render(); second.unmount();
    expect(second.search.mock.calls[0][1].aborted).toBe(true);
    second.requests[0].reject(Error('aborted')); await second.flush(); expect(second.writesAfterUnmount).toBe(0);
  });
});
