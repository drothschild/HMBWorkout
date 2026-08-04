/**
 * Static single-call-site gate for `injectRealExecutors`.
 *
 * `injectRealExecutors` replaces the global store outright — a second call
 * passing a partial executor map silently reverts every executor it omits to
 * the no-op defaults, and drops the live `sessionState` with nothing to
 * rehydrate it. Only `_layout.tsx`'s boot effect is allowed to call it, because
 * only that effect re-reads `engine_state` and re-hydrates immediately after.
 *
 * That invariant is about call *sites*, not call *counts*, so it cannot be
 * enforced at runtime: a Fast Refresh re-invocation from the legitimate boot
 * path and a genuine second caller are both just function calls. It is checked
 * statically here instead. See the docstring on `injectRealExecutors` in
 * `activeSession.ts` for why a module-level latch would be worse than nothing.
 *
 * Reading the tree as text (rather than importing it) is deliberate: the one
 * legal call site is a `.tsx` screen full of RN/expo-router imports the node
 * jest project cannot load.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

/** Where the function is declared — naturally mentions its own name. */
const DEFINITION_FILE = 'state/activeSession.ts';

/** The one call site the docstring permits. */
const ALLOWED_CALL_SITE = 'app/_layout.tsx';

/** This gate's own file, which has to spell the identifier to check for it. */
const SELF_FILE = path.relative(SRC_ROOT, __filename);

type SourceFile = {
  readonly relPath: string;
  readonly source: string;
};

/**
 * Pure: every file whose text references `identifier` as a whole word.
 *
 * A bare mention in prose counts. That is the intended strictness — a comment
 * elsewhere naming this function is itself a sign the invariant is drifting,
 * and the fix (add the file to the allowlist, or reword) is a conscious edit
 * rather than a silent one.
 */
function filesReferencing(
  files: readonly SourceFile[],
  identifier: string
): readonly string[] {
  const pattern = new RegExp(`\\b${identifier}\\b`);
  return files
    .filter((file) => pattern.test(file.source))
    .map((file) => file.relPath)
    .sort();
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

describe('filesReferencing', () => {
  it('finds no files when nothing references the identifier', () => {
    const files = [
      { relPath: 'a.ts', source: 'export const x = 1;' },
      { relPath: 'b.ts', source: '// unrelated comment' },
    ];

    expect(filesReferencing(files, 'injectRealExecutors')).toEqual([]);
  });

  it('finds only the files that reference the identifier', () => {
    const files = [
      { relPath: 'a.ts', source: 'export const x = 1;' },
      { relPath: 'b.ts', source: 'injectRealExecutors({ onNotify });' },
      { relPath: 'c.ts', source: "import { injectRealExecutors } from '@/state/activeSession';" },
    ];

    expect(filesReferencing(files, 'injectRealExecutors')).toEqual(['b.ts', 'c.ts']);
  });

  it('does not match identifiers that merely contain the name', () => {
    const files = [
      { relPath: 'a.ts', source: 'reinjectRealExecutors();' },
      { relPath: 'b.ts', source: 'injectRealExecutorsTwice();' },
    ];

    expect(filesReferencing(files, 'injectRealExecutors')).toEqual([]);
  });
});

describe('injectRealExecutors single-call-site gate', () => {
  const sourceTree = readSourceTree(SRC_ROOT);

  it('scans the whole src tree, including .tsx screens', () => {
    // Guards against the classic source-scan failure: a broken walk makes the
    // gate below pass vacuously.
    expect(sourceTree.length).toBeGreaterThan(50);
    expect(sourceTree.map((file) => file.relPath)).toContain(ALLOWED_CALL_SITE);
    expect(sourceTree.map((file) => file.relPath)).toContain(DEFINITION_FILE);
  });

  it('is referenced only by the app bootstrap', () => {
    const referencing = filesReferencing(sourceTree, 'injectRealExecutors').filter(
      (relPath) => relPath !== DEFINITION_FILE && relPath !== SELF_FILE
    );

    expect(referencing).toEqual([ALLOWED_CALL_SITE]);
  });
});
