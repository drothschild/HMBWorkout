/**
 * Static gate on how `buildLogSetValues` is consumed (#288).
 *
 * The function returns `SetInputValues | undefined`, and `onLogSet` takes a
 * non-optional `SetInputValues`, so `tsc` already refuses the unguarded
 * dispatch this issue was about — that is the primary defence and it needs no
 * test. What `tsc` accepts is a call site that *launders* the undefined back
 * into a value: `buildLogSetValues({...})!`, `?? {}`, `|| {}`, or an `as`
 * cast, on the call itself or on the variable it is bound to. Each of those
 * compiles and reinstates the bug exactly.
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
 * Pure: the non-whitespace text immediately following a position, capped
 * short. Long enough to see `!`, `??`, `||` or `as`, short enough not to drag
 * in the rest of the statement.
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
 * Pure: the variable a call's result is bound to, when it is bound at all.
 *
 * Needed because the laundering can happen one step later — `const v =
 * buildLogSetValues({...}); onLogSet(v ?? {})` narrows nothing and compiles,
 * so checking only the call expression would miss it.
 */
export function assignedNameOf(source: string, start: number): string | undefined {
  const before = source.slice(0, start).replace(/\s+$/, '');
  const match = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=$/);
  return match ? match[1] : undefined;
}

/** Pure: the laundering operator a token run begins with, if any. */
function launderingIn(next: string): string | undefined {
  if (next.startsWith('!') && !next.startsWith('!=')) return 'non-null assertion';
  if (next.startsWith('??')) return '?? fallback';
  if (next.startsWith('||')) return '|| fallback';
  if (/^as\b/.test(next)) return 'as cast';
  return undefined;
}

/**
 * Pure: every way a file launders the optional result back into a value —
 * on the call expression itself, or on the variable it is bound to.
 * Empty means the file only ever consumes the call under a real check.
 */
export function launderedUses(source: string, identifier: string, sink: string): readonly string[] {
  const problems: string[] = [];

  for (const span of findCallSpans(source, identifier)) {
    if (isDirectArgumentOf(source, span.start, sink)) {
      problems.push(`passed straight to ${sink}(`);
    }

    const direct = launderingIn(tokenAfter(source, span.end));
    if (direct) problems.push(direct);

    const bound = assignedNameOf(source, span.start);
    if (bound === undefined) continue;

    const uses = new RegExp(`\\b${bound}\\b`, 'g');
    for (let use = uses.exec(source); use !== null; use = uses.exec(source)) {
      const indirect = launderingIn(tokenAfter(source, use.index + bound.length));
      if (indirect) problems.push(`${bound}: ${indirect}`);
    }
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

describe('assignedNameOf', () => {
  it('reads the binding a call is assigned to', () => {
    const source = 'const logSetValues = buildLogSetValues({});';
    const [span] = findCallSpans(source, 'buildLogSetValues');
    expect(assignedNameOf(source, span.start)).toBe('logSetValues');
  });

  it('is undefined for a call that is not bound', () => {
    const source = 'onLogSet(buildLogSetValues({}));';
    const [span] = findCallSpans(source, 'buildLogSetValues');
    expect(assignedNameOf(source, span.start)).toBeUndefined();
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

  it('flags each laundering operator on the call itself', () => {
    expect(
      launderedUses('const v = buildLogSetValues({})!;', 'buildLogSetValues', 'onLogSet')
    ).toEqual(['non-null assertion']);
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

  it('follows the binding: laundering the variable is caught too', () => {
    // This compiles and reinstates the bug, so checking the call expression
    // alone is not enough.
    const source = 'const v = buildLogSetValues({});\nonLogSet(v ?? {});';
    expect(launderedUses(source, 'buildLogSetValues', 'onLogSet')).toEqual(['v: ?? fallback']);
  });

  it('follows the binding through a non-null assertion', () => {
    const source = 'const v = buildLogSetValues({});\nonLogSet(v!);';
    expect(launderedUses(source, 'buildLogSetValues', 'onLogSet')).toEqual([
      'v: non-null assertion',
    ]);
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
      expect([site, findCallSpans(file!.source, IDENTIFIER).length]).toEqual([site, 1]);
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

  it('narrows with an explicit undefined comparison, not a truthiness test', () => {
    // A truthiness guard would treat any future falsy value as "nothing to
    // log" — the exact collapse the `reps: 0` rule forbids one layer down.
    // Whitespace-normalized so a reformat cannot fail this spuriously.
    for (const site of ALLOWED_CALL_SITES) {
      const file = production.find((candidate) => candidate.relPath === site);
      const normalized = file!.source.replace(/\s+/g, ' ');
      const bound = assignedNameOf(file!.source, findCallSpans(file!.source, IDENTIFIER)[0].start);

      expect([site, bound]).toEqual([site, expect.any(String)]);
      expect([site, normalized.includes(`if (${bound} === undefined) return;`)]).toEqual([
        site,
        true,
      ]);
      expect([site, normalized.includes(`if (!${bound})`)]).toEqual([site, false]);
    }
  });

  it('binds the Log Set button’s disabled state to the same check', () => {
    // The onPress guard already makes a blank tap harmless, so this is about
    // feedback rather than data: without it the button looks live and does
    // nothing, which is how the mis-tap went unnoticed in the first place.
    const file = production.find((candidate) => candidate.relPath === 'components/SetLogger.tsx');
    const normalized = file!.source.replace(/\s+/g, ' ');

    expect(normalized).toContain('disabled={logSetValues === undefined}');
    expect(normalized).toContain('logSetValues === undefined && styles.buttonDisabled');
  });

  it('announces the disabled state to assistive tech, not just visually', () => {
    // Round-1 review survivor: `accessibilityState={{ disabled: false }}`
    // survived every other check. `disabled=` and the dimmed style are both
    // pinned above, but a screen reader reads neither — it reads this, and
    // would announce a dimmed, inert button as available. Cosmetic only if
    // you can see the opacity.
    const file = production.find((candidate) => candidate.relPath === 'components/SetLogger.tsx');
    const normalized = file!.source.replace(/\s+/g, ' ');

    expect(normalized).toContain('accessibilityState={{ disabled: logSetValues === undefined }}');
  });

  it('the hoisted call still passes the rpe it will dispatch', () => {
    // Round-1 review survivor, and a gap this PR's own hoist created:
    // `rpe: currentRpe` → `rpe: undefined` survives everything else, because
    // rpe is not an arm of the predicate and so cannot flip the disabled
    // state. But `logSetValues` is not only what the button reads — it is
    // also the object dispatched on the non-last-set path, so dropping the
    // rpe silently stops it reaching a logged set. Asserted inside the call's
    // own span rather than over the file, since `currentRpe` also appears on
    // the RPE slider and a file-wide match would pass without the argument.
    const file = production.find((candidate) => candidate.relPath === 'components/SetLogger.tsx');
    const [span] = findCallSpans(file!.source, IDENTIFIER);
    const call = file!.source.slice(span.start, span.end).replace(/\s+/g, ' ');

    expect(call).toContain('rpe: currentRpe');
  });
});
