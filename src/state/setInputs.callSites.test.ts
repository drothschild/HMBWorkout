/**
 * Static gate on how `buildLogSetValues` is consumed (#288).
 *
 * The function returns `SetInputValues | undefined`, and `onLogSet` takes a
 * non-optional `SetInputValues`, so `tsc` already refuses the unguarded
 * dispatch this issue was about — that is the primary defence and it needs no
 * test. What `tsc` accepts is a call site that *launders* the undefined back
 * into a value: `buildLogSetValues({...})!`, `?? {}`, `|| {}`, or an `as`
 * cast. Each of those compiles and reinstates the bug exactly.
 *
 * Both consumers are `.tsx` (`components/SetLogger.tsx`, `app/session.tsx`)
 * and jest runs a single node project whose `testMatch` is `*.test.ts`, so no
 * suite can render either one. The invariant is therefore checked as text,
 * on the precedent of `activeSession.callSites.test.ts`.
 *
 * This reads the tree rather than importing it, for the same reason that file
 * does: the legal call sites are screens full of RN/expo-router imports the
 * node project cannot load.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

const IDENTIFIER = 'buildLogSetValues';

/** Where the function is declared. */
const DEFINITION_FILE = 'state/setInputs.ts';

/** The only production files allowed to call it, both untestable `.tsx`. */
const ALLOWED_CALL_SITES = ['app/session.tsx', 'components/SetLogger.tsx'];

/** The sink whose argument must never be a raw call to it. */
const SINK = 'onLogSet';

type SourceFile = {
  readonly relPath: string;
  readonly source: string;
};

type CallSpan = {
  /** Index of the first character of the identifier. */
  readonly start: number;
  /** Index one past the call's closing paren. */
  readonly end: number;
};

/**
 * Pure: every `identifier(...)` call in `source`, with the span of the whole
 * call expression.
 *
 * Paren-matched rather than regex-terminated, because every real call here
 * spans several lines and wraps an object literal. An unbalanced call (only
 * possible in a file that does not compile) is skipped rather than guessed at.
 */
export function findCallSpans(source: string, identifier: string): readonly CallSpan[] {
  const spans: CallSpan[] = [];
  const pattern = new RegExp(`\\b${identifier}\\s*\\(`, 'g');

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    let depth = 0;
    let cursor = match.index + match[0].length - 1;

    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '(') depth += 1;
      else if (source[cursor] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    if (depth === 0) spans.push({ start: match.index, end: cursor + 1 });
  }

  return spans;
}

/**
 * Pure: the non-whitespace text immediately following a call, capped short.
 * Long enough to see `!`, `??`, `||` or `as`, short enough not to drag in the
 * rest of the statement.
 */
export function tokenAfter(source: string, end: number): string {
  return source.slice(end).replace(/^\s+/, '').slice(0, 2);
}

/**
 * Pure: true when the call at `start` is written directly as an argument to
 * `sink(`, i.e. `sink(identifier({...}))` with nothing in between to check it.
 */
export function isDirectArgumentOf(source: string, start: number, sink: string): boolean {
  const before = source.slice(0, start).replace(/\s+$/, '');
  return before.endsWith(`${sink}(`);
}

/**
 * Pure: every way a file launders the optional result back into a value.
 * Empty means the file only ever consumes the call under a real check.
 */
export function launderedUses(source: string, identifier: string, sink: string): readonly string[] {
  const problems: string[] = [];

  for (const span of findCallSpans(source, identifier)) {
    if (isDirectArgumentOf(source, span.start, sink)) {
      problems.push(`passed straight to ${sink}(`);
    }

    const next = tokenAfter(source, span.end);
    if (next.startsWith('!') && !next.startsWith('!=')) problems.push('non-null assertion');
    if (next.startsWith('??')) problems.push('?? fallback');
    if (next.startsWith('||')) problems.push('|| fallback');
    if (/^as\b/.test(next)) problems.push('as cast');
  }

  return problems;
}

/** Imperative: every .ts/.tsx file under src/, keyed by src-relative path. */
function readSourceTree(dir: string): SourceFile[] {
  const collected: SourceFile[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collected.push(...readSourceTree(absolute));
      continue;
    }

    if (/\.tsx?$/.test(entry.name)) {
      collected.push({
        relPath: path.relative(SRC_ROOT, absolute),
        source: fs.readFileSync(absolute, 'utf-8'),
      });
    }
  }

  return collected;
}

describe('findCallSpans', () => {
  it('spans a multi-line call with a nested object literal', () => {
    const source = 'const v = buildLogSetValues({\n  rpe: fn(1),\n});\n';
    const spans = findCallSpans(source, 'buildLogSetValues');

    expect(spans).toHaveLength(1);
    expect(source.slice(spans[0].start, spans[0].end)).toBe(
      'buildLogSetValues({\n  rpe: fn(1),\n})'
    );
  });

  it('does not match an identifier that merely contains the name', () => {
    expect(findCallSpans('rebuildLogSetValues({});', 'buildLogSetValues')).toEqual([]);
  });

  it('does not match a bare import mention', () => {
    expect(findCallSpans("import { buildLogSetValues } from './x';", 'buildLogSetValues')).toEqual(
      []
    );
  });

  it('finds every call in a file', () => {
    expect(findCallSpans('a(x({}));\nb(x({}));\n', 'x')).toHaveLength(2);
  });
});

describe('launderedUses', () => {
  it('flags the exact pre-fix shape', () => {
    // Positive control: this is the code this gate exists to keep out, and
    // the shape that shipped before #288.
    const source = 'presenter.onLogSet(\n  buildLogSetValues({ repsText })\n);';
    expect(launderedUses(source, 'buildLogSetValues', 'onLogSet')).toEqual([
      'passed straight to onLogSet(',
    ]);
  });

  it('flags each laundering operator', () => {
    expect(launderedUses('const v = buildLogSetValues({})!;', 'buildLogSetValues', 'onLogSet')).toEqual(
      ['non-null assertion']
    );
    expect(
      launderedUses('const v = buildLogSetValues({}) ?? {};', 'buildLogSetValues', 'onLogSet')
    ).toEqual(['?? fallback']);
    expect(
      launderedUses('const v = buildLogSetValues({}) || {};', 'buildLogSetValues', 'onLogSet')
    ).toEqual(['|| fallback']);
    expect(
      launderedUses(
        'const v = buildLogSetValues({}) as SetInputValues;',
        'buildLogSetValues',
        'onLogSet'
      )
    ).toEqual(['as cast']);
  });

  it('does not flag a comparison against undefined', () => {
    const source = 'if (buildLogSetValues({}) !== undefined) log();';
    expect(launderedUses(source, 'buildLogSetValues', 'onLogSet')).toEqual([]);
  });

  it('does not flag the guarded shape', () => {
    const source = 'const v = buildLogSetValues({});\nif (v === undefined) return;\nonLogSet(v);';
    expect(launderedUses(source, 'buildLogSetValues', 'onLogSet')).toEqual([]);
  });
});

describe('buildLogSetValues call-site gate', () => {
  const sourceTree = readSourceTree(SRC_ROOT);
  const production = sourceTree.filter((file) => !/\.test\.tsx?$/.test(file.relPath));

  it('scans the whole src tree, including .tsx screens', () => {
    // Guards against the classic source-scan failure: a broken walk makes the
    // assertions below pass vacuously.
    expect(sourceTree.length).toBeGreaterThan(50);
    const paths = sourceTree.map((file) => file.relPath);
    expect(paths).toContain(DEFINITION_FILE);
    for (const site of ALLOWED_CALL_SITES) expect(paths).toContain(site);
  });

  it('is called from exactly the two screens that guard it', () => {
    // The declaration itself matches `identifier(` — its own parameter list.
    const callers = production
      .filter((file) => file.relPath !== DEFINITION_FILE)
      .filter((file) => findCallSpans(file.source, IDENTIFIER).length > 0)
      .map((file) => file.relPath)
      .sort();

    expect(callers).toEqual([...ALLOWED_CALL_SITES].sort());
  });

  it('finds a real call in each of them, not just an import', () => {
    for (const site of ALLOWED_CALL_SITES) {
      const file = production.find((candidate) => candidate.relPath === site);
      expect(findCallSpans(file!.source, IDENTIFIER)).toHaveLength(1);
    }
  });

  it('never launders the optional result back into a value', () => {
    for (const file of production) {
      expect([file.relPath, launderedUses(file.source, IDENTIFIER, SINK)]).toEqual([
        file.relPath,
        [],
      ]);
    }
  });

  it('checks the result against undefined at every call site', () => {
    // The compiler forces *some* narrowing; this pins that it is an explicit
    // `undefined` comparison rather than a truthiness test, which would treat
    // a future falsy value as "nothing to log" — the exact collapse the
    // `reps: 0` rule forbids one layer down.
    for (const site of ALLOWED_CALL_SITES) {
      const file = production.find((candidate) => candidate.relPath === site);
      expect([site, /=== undefined/.test(file!.source)]).toEqual([site, true]);
    }
  });
});
