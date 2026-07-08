import { lex, parseProgram, evaluate, createPrelude, Value } from 'rill-lang';

// JS → Rill conversion
export function jsToRill(value: unknown): Value {
  if (value === null || value === undefined) {
    return { kind: 'Unit' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'Bool', value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { kind: 'Int', value }
      : { kind: 'Float', value };
  }
  if (typeof value === 'string') {
    return { kind: 'String', value };
  }
  if (Array.isArray(value)) {
    return { kind: 'List', elements: value.map(jsToRill) };
  }
  if (typeof value === 'object') {
    const fields = new Map<string, Value>();
    for (const [k, v] of Object.entries(value)) {
      fields.set(k, jsToRill(v));
    }
    return { kind: 'Record', fields };
  }
  return { kind: 'Unit' };
}

// Rill → JS conversion
export function rillToJs(value: Value): unknown {
  switch (value.kind) {
    case 'Int':
    case 'Float':
      return value.value;
    case 'String':
      return value.value;
    case 'Bool':
      return value.value;
    case 'Unit':
      return null;
    case 'List':
      return value.elements.map(rillToJs);
    case 'Tuple':
      return value.elements.map(rillToJs);
    case 'Record': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value.fields) {
        obj[k] = rillToJs(v);
      }
      return obj;
    }
    case 'Tag':
      if (value.args.length === 0) return value.tag;
      if (value.args.length === 1) return { tag: value.tag, value: rillToJs(value.args[0]) };
      return { tag: value.tag, values: value.args.map(rillToJs) };
    case 'Closure':
    case 'BuiltinFn':
      return `<function:${value.kind === 'Closure' ? 'closure' : value.name}>`;
  }
}

// Rule evaluation result
export interface RuleResult {
  success: boolean;
  value: unknown;
  error?: string;
}

// Evaluate a Rill source string with injected data
export function evaluateSource(
  source: string,
  data: Record<string, unknown>
): RuleResult {
  try {
    const env = createPrelude();
    for (const [key, val] of Object.entries(data)) {
      env.set(key, jsToRill(val));
    }
    const tokens = lex(source);
    const program = parseProgram(tokens);
    // A rule header names the exact inputs the host must inject — fail the
    // injection boundary with the parameter's name instead of mid-evaluation.
    if (program.header) {
      const missing = program.header.params
        .map((p) => p.name)
        .filter((name) => !(name in data));
      if (missing.length > 0) {
        return {
          success: false,
          value: null,
          error: `rule '${program.header.name}' is missing injected input(s): ${missing.join(', ')}`,
        };
      }
    }
    const result = evaluate(program.body, env);
    return { success: true, value: rillToJs(result) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, value: null, error: message };
  }
}
