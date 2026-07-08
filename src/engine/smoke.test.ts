import { lex, parseProgram, evaluate, createPrelude, Value } from 'rill-lang';
import smokeSource from './rules/smoke.lv';

describe('smoke test: .lv imports and evaluation', () => {
  it('imports smoke.lv as a string with rule header', () => {
    expect(typeof smokeSource).toBe('string');
    expect(smokeSource).toContain('rule smoke_test() -> Int');
    expect(smokeSource).toContain('1 + 1');
  });

  it('evaluates smoke.lv rule body to Int(2)', () => {
    const env = createPrelude();
    const tokens = lex(smokeSource);
    const program = parseProgram(tokens);
    const result: Value = evaluate(program.body, env);

    expect(result.kind).toBe('Int');
    expect((result as any).value).toBe(2);
  });
});
