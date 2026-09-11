import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// Executes the real component in the node project. Native leaves are inert;
// hooks retain state and effect cleanup, so async/session races are exercised.
const sourcePath = path.join(__dirname, 'WorkoutDiaryChatEntry.tsx');
function harness(source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : 'export function WorkoutDiaryChatEntry() { return null; }') {
  let cursor = 0;
  const state: any[] = [];
  const effects: { deps: any[]; cleanup?: () => void }[] = [];
  let effectCursor = 0;
  const queued: (() => void)[] = [];
  const reads: { id: string; resolve: (value: any) => void; reject: () => void }[] = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(effect: () => any, deps: any[]) {
      const index = effectCursor++;
      if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
        effects[index]?.cleanup?.();
        effects[index] = { deps };
        queued.push(() => { effects[index].cleanup = effect(); });
      }
    },
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (styles: any) => styles } },
    'expo-image': { Image: 'Image' },
    '@/db': { database: {} },
    '@/db/workoutDiary': { readWorkoutDiary: (_db: any, id: string) => new Promise((resolve, reject) => reads.push({ id, resolve, reject: () => reject(new Error('offline')) })) },
    '@/state/workoutSelfieFiles': { workoutSelfieUri: (value: string) => `file:///documents/${value}` },
    './themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16 } },
    '@/theme/actionButtonColors': { ActionButtonColor: { primary: '#0071EB' } },
  };
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', output)((name: string) => { if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`); return modules[name]; }, exports);
  return {
    reads,
    keepOpeningVisible: exports.shouldKeepDiaryEntryVisible,
    render(id = 'session-a') { cursor = 0; effectCursor = 0; const tree = exports.WorkoutDiaryChatEntry({ sessionId: id }); queued.splice(0).forEach(run => run()); return tree; },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
}
function nodes(tree: any): any[] {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const saved = { diary: 'Hey there', selfiePath: 'workout-selfies/photo.jpg', ready: true };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('loads saved journal and local selfie as the opening user entry on mount and reopen', async () => {
  for (let open = 0; open < 2; open++) {
    const h = harness();
    h.render();
    expect(h.reads.map(read => read.id)).toEqual(['session-a']);
    h.reads[0].resolve(saved); await settle();
    const tree = nodes(h.render());
    expect(tree).toContain('Hey there');
    expect(tree.find(node => node.type === 'Image').props.source.uri).toBe('file:///documents/workout-selfies/photo.jpg');
    h.unmount();
  }
});

test('skipped selfie has journal text without an image frame', async () => {
  const h = harness(); h.render(); h.reads[0]?.resolve({ ...saved, selfiePath: null }); await settle();
  const tree = nodes(h.render()); expect(tree).toContain('Hey there'); expect(tree.some(node => node.type === 'Image')).toBe(false);
});

test('session changes hide the previous journal immediately and discard late reads', async () => {
  const h = harness(); h.render();
  h.reads[0]?.resolve(saved); await settle();
  expect(nodes(h.render())).toContain('Hey there');
  expect(nodes(h.render('session-b'))).not.toContain('Hey there');
  h.render('session-c');
  h.reads[2]?.resolve({ ...saved, diary: 'Current session' }); await settle();
  h.reads[1]?.resolve({ ...saved, diary: 'Stale session' }); await settle();
  const tree = nodes(h.render('session-c'));
  expect(tree).toContain('Current session'); expect(tree).not.toContain('Stale session');
});

test('a failed read offers retry and recovers the saved journal', async () => {
  const h = harness(); h.render(); h.reads[0]?.reject(); await settle();
  const retry = nodes(h.render()).find(node => node.type === 'Pressable'); expect(retry).toBeDefined();
  retry.props.onPress(); h.render(); h.reads[1].resolve(saved); await settle(); expect(nodes(h.render())).toContain('Hey there');
});

test('an unreadable local photo has an explicit fallback while keeping the journal', async () => {
  const h = harness(); h.render(); h.reads[0]?.resolve(saved); await settle();
  const photo = nodes(h.render()).find(node => node.type === 'Image'); expect(photo).toBeDefined();
  photo.props.onError(); const tree = nodes(h.render()); expect(tree).toContain('Photo unavailable on this device.'); expect(tree).toContain('Hey there');
});

test('debrief screen places the saved entry in the list header before replies', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../app/ai-coach.tsx'), 'utf8');
  expect(screen).toMatch(/ListHeaderComponent=\{mode.kind === 'debrief' \?\s*<WorkoutDiaryChatEntry key=\{mode.sessionId\} sessionId=\{mode.sessionId\} \/> : null\}/);
});


test('the initial debrief keeps its journal visible, while a user follow-up restores reply anchoring', () => {
  const h = harness();
  expect(h.keepOpeningVisible).toBeDefined();
  expect(h.keepOpeningVisible([{ role: 'user', hidden: true }, { role: 'assistant' }])).toBe(true);
  expect(h.keepOpeningVisible([{ role: 'user', hidden: true }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant' }])).toBe(false);
});
