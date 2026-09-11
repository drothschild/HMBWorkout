import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

type Node = { type: string; props: Record<string, any> };
function render(disabled = false, width = 320, source?: string) {
  const output = ts.transpileModule(source ?? fs.readFileSync(path.join(__dirname, 'WorkoutPhotoActions.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const actions = { onCamera: jest.fn(), onLibrary: jest.fn(), onSkip: jest.fn() };
  const module = { exports: {} as any };
  const modules: Record<string, any> = {
    'react/jsx-runtime': { jsx: (type: string, props: any) => ({ type, props }), jsxs: (type: string, props: any) => ({ type, props }) },
    '@expo/ui': Object.fromEntries(['Host', 'Column', 'Row', 'Button', 'Text', 'Icon'].map(x => [x, x])),
    '@/hooks/use-theme': { useTheme: () => ({ text: '#000000', backgroundElement: '#F0F0F3' }) },
    '@/theme/actionButtonColors': { ActionButtonColor: { primary: '#0071EB' } },
  };
  vm.runInNewContext(output, { exports: module.exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  } });
  const tree = module.exports.WorkoutPhotoActions({ ...actions, disabled, width });
  const nodes: Node[] = [];
  function walk(node: any) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); nodes.push(node); walk(node.props?.children); }
  walk(tree);
  return { actions, nodes };
}

describe('workout photo actions', () => {
  it('keeps camera, library and skip as three distinct native actions', () => {
    const { nodes, actions } = render();
    const buttons = nodes.filter(n => n.type === 'Button');
    expect(buttons).toHaveLength(3);
    buttons[0].props.onPress(); buttons[1].props.onPress(); buttons[2].props.onPress();
    expect(actions.onCamera).toHaveBeenCalledTimes(1);
    expect(actions.onLibrary).toHaveBeenCalledTimes(1);
    expect(actions.onSkip).toHaveBeenCalledTimes(1);
  });
  it('disables every action during an in-flight picker or save', () => {
    expect(render(true).nodes.filter(n => n.type === 'Button').map(n => n.props.disabled)).toEqual([true, true, true]);
    expect(render(false).nodes.filter(n => n.type === 'Button').map(n => n.props.disabled)).toEqual([false, false, false]);
  });
  it.each([272, 345, 552])('fills the %i-point content column without clipping the text', width => {
    const nodes = render(false, width).nodes;
    const rows = nodes.filter(n => n.type === 'Row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.props.style.width).toBe(width);
      expect(row.props.style.paddingVertical).toBeGreaterThanOrEqual(16);
      const text = row.props.children.find((n: Node) => n.type === 'Text');
      expect(text.props.style.width).toBeLessThanOrEqual(width - 64);
      expect(text.props.numberOfLines).toBeUndefined();
    }
  });
});
