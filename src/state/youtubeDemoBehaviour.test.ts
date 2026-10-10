/**
 * Behavioural tests for the exercise detail screen's YouTube demonstration
 * controls (#390). The real screen source is transpiled and rendered through a
 * minimal hook harness with mocked modules, using the real URL parser.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

type Node = { type: any; props: Record<string, any> };

const CANONICAL_A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const CANONICAL_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';

function textOf(n: any): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  return textOf(n.props?.children);
}

function harness(savedUrl: string | null) {
  // State order in the screen: 0 exercise, 1 loading, ... 13 youtubeDemoUrl,
  // 14 savedYouTubeDemoUrl. Seeded by index; the first test asserts the seed.
  const values: any[] = [{ title: 'Row', kind: 'strength', imagePath: null }, false];
  values[13] = savedUrl ?? '';
  values[14] = savedUrl;
  const refs: any[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  const updateUrl = jest.fn().mockResolvedValue({});
  const modules: Record<string, any> = {
    react: {
      useState: (initial: any) => {
        const i = stateIndex++;
        if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
        return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }];
      },
      useRef: (v: any) => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: v }); },
      useEffect: () => {},
      useCallback: (f: any) => f,
    },
    'react/jsx-runtime': {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
      Fragment: 'Fragment',
    },
    'react-native': {
      ...Object.fromEntries(['TextInput', 'Pressable', 'ScrollView', 'View'].map((n) => [n, n])),
      StyleSheet: { create: (s: any) => s },
      AccessibilityInfo: {},
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/YouTubeDemo': { __esModule: true, default: 'YouTubeDemo' },
    '@/domain/youtubeDemoUrl': require('../domain/youtubeDemoUrl'),
    '@/domain/youtubePlayer': { describeYouTubePlayerFailure: () => '' },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({ id: 'row-id' }), useFocusEffect: () => {} },
    'expo-image-picker': {},
    'expo-glass-effect': { isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false, GlassView: 'GlassView' },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/themed-view': { ThemedView: 'ThemedView' },
    '@/components/ExerciseImage': { ExerciseImage: 'ExerciseImage' },
    '@/components/ExerciseImageSearch': { ExerciseImageSearch: 'ExerciseImageSearch' },
    '@/constants/theme': { Spacing: {}, MaxContentWidth: 600 },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/theme/actionButtonColors': { ActionButtonColor: {}, StatusColor: {} },
    '@/db': { database: {} },
    '@/db/repository': { updateExerciseDescription: jest.fn(), updateExerciseYouTubeDemoUrl: updateUrl },
    '@/state/exerciseImageResolverRegistry': {},
    '@/state/exerciseImageOverride': {},
    '@/state/exerciseImageFiles': {},
    '@/state/exercisePhotoPicker': {},
    '@/state/exerciseHistoryPresenter': {},
  };
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../app/exercise/[id].tsx'), 'utf8'),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const exports: any = {};
  vm.runInNewContext(output, {
    exports, console, setTimeout, clearTimeout,
    require: (name: string) => { if (!(name in modules)) throw Error(name); return modules[name]; },
  });
  function render() {
    stateIndex = 0;
    refIndex = 0;
    const nodes: Node[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      nodes.push(n);
      walk(n.props?.children);
    };
    walk(exports.default());
    return nodes;
  }
  const button = (label: string) => render().find((n) => n.type === 'Pressable' && textOf(n.props.children) === label);
  const input = () => render().find((n) => n.type === 'TextInput' && String(n.props.placeholder).startsWith('https://www.youtube.com'))!;
  const hasText = (text: string) => render().some((n) => n.type === 'ThemedText' && textOf(n.props.children).includes(text));
  const hasPlayer = () => render().some((n) => n.type === 'YouTubeDemo');
  return { render, button, input, hasText, hasPlayer, updateUrl, values };
}

describe('exercise detail YouTube demonstration behaviour (#390)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the unopened control for a saved URL and mounts no player', () => {
    const h = harness(CANONICAL_A);
    expect(h.button('Watch demonstration')).toBeDefined();
    expect(h.hasPlayer()).toBe(false);
  });

  it('rejects an invalid URL with the validation message and saves nothing', async () => {
    const h = harness(null);
    h.input().props.onChangeText('http://www.youtube.com/watch?v=aaaaaaaaaaa');
    await h.button('Use this video')!.props.onPress();
    expect(h.updateUrl).not.toHaveBeenCalled();
    expect(h.hasText('Enter a valid HTTPS YouTube video URL.')).toBe(true);
    expect(h.hasText("Couldn't save that video.")).toBe(false);
  });

  it('saves a valid URL, then returns an opened player to the unopened state', async () => {
    const h = harness(CANONICAL_A);
    h.button('Watch demonstration')!.props.onPress();
    expect(h.hasPlayer()).toBe(true);

    h.input().props.onChangeText('https://youtu.be/bbbbbbbbbbb');
    await h.button('Use this video')!.props.onPress();

    expect(h.updateUrl).toHaveBeenCalledTimes(1);
    expect(h.hasPlayer()).toBe(false);
    expect(h.button('Watch demonstration')).toBeDefined();
    expect(h.values[14]).toBe(CANONICAL_B);
  });
});
