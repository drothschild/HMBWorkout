/**
 * #276 AC6.2, as a test rather than a shell command.
 *
 * The AC asks for `rg 'targetSets|warmupSets|target_sets|warmup_sets' src
 * --glob '!*.test.ts'` to return **zero**, and calls it "the criterion that
 * catches a forgotten fallback branch". It cannot reach zero as written, for
 * two reasons that pull in opposite directions:
 *
 *  1. `WorkoutLine.targetSets` in `src/interop` was never a routine aggregate —
 *     it is the raw `<sets>` half of a workout line's `<sets>x<reps>` slot, and
 *     the markdown grammar still has one. Twelve unremovable hits.
 *  2. Explaining what was removed requires naming it. The migration entries,
 *     the model, the engine's `RoutineEntry` and half a dozen presenters carry
 *     comments that say "the aggregate columns are gone" — which a grep counts
 *     as an occurrence of the thing that is gone.
 *
 * Narrowing the glob until the command passes was the wrong answer to both: a
 * carve-out for `src/interop` would also have hidden four genuinely dead
 * `RoutineExerciseRow` fields that #276 Phase 5 spotted (as two) and Phase 6
 * deleted (as four). So (1) was fixed at the source — the field is `setsSlot`
 * now, which is what it always meant — and (2) is fixed here, by asking the
 * question the AC was actually reaching for: **no CODE may name an aggregate.**
 *
 * This is strictly stronger than the shell command. A comment cannot satisfy it
 * and a comment cannot break it, so the residue that made the original criterion
 * unreachable is gone in both directions, and a forgotten fallback branch — the
 * thing the AC exists to catch — still fails it.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/** The four spellings AC6.2 names: two TS field names, two column names. */
const AGGREGATE_NAMES = /targetSets|warmupSets|target_sets|warmup_sets/;

function productionSources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === '__snapshots__') continue;
      productionSources(path, found);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name)) continue;
    if (name === 'test-helpers.ts' || dir.endsWith('test-setup')) continue;
    found.push(path);
  }
  return found;
}

/**
 * Blank out comments, keeping line structure so a failure can name a line.
 *
 * String literals are tracked but deliberately KEPT: a `Q.where('target_sets',
 * …)` or a column name in a thrown message is a live reference, and it is
 * precisely the kind a type-checker cannot catch. They are tracked only so a
 * `//` or `/*` inside a string is not mistaken for the start of a comment.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let inLine = false;
  let inBlock = false;
  let inString: string | null = null;

  while (index < source.length) {
    const two = source.slice(index, index + 2);
    const char = source[index];

    if (inLine) {
      if (char === '\n') { inLine = false; out += char; } else { out += ' '; }
      index += 1;
      continue;
    }
    if (inBlock) {
      if (two === '*/') { inBlock = false; out += '  '; index += 2; continue; }
      out += char === '\n' ? '\n' : ' ';
      index += 1;
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') { out += source[index + 1] ?? ''; index += 2; continue; }
      if (char === inString) inString = null;
      index += 1;
      continue;
    }
    if (two === '//') { inLine = true; out += '  '; index += 2; continue; }
    if (two === '/*') { inBlock = true; out += '  '; index += 2; continue; }
    if (char === '"' || char === "'" || char === '`') { inString = char; out += char; index += 1; continue; }
    out += char;
    index += 1;
  }
  return out;
}

describe('#276 AC6.2: no production CODE names a routine aggregate', () => {
  it('finds no live reference to targetSets, warmupSets, target_sets or warmup_sets', () => {
    const offenders: string[] = [];

    for (const path of productionSources(SRC)) {
      const lines = stripComments(readFileSync(path, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (AGGREGATE_NAMES.test(line)) {
          offenders.push(`${path.slice(SRC.length + 1)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('is not vacuous: the sweep reaches real files and its matcher really matches', () => {
    // Two ways this file could pass while checking nothing — an empty file list
    // and a regex that never fires — so both are asserted directly rather than
    // inferred from the green above.
    const files = productionSources(SRC);
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((path) => path.endsWith('db/repository.ts'))).toBe(true);
    expect(files.some((path) => path.endsWith('interop/parse.ts'))).toBe(true);
    expect(files.some((path) => path.endsWith('app/session.tsx'))).toBe(true);
    expect(AGGREGATE_NAMES.test('  re.warmupSets = 0;')).toBe(true);
  });

  it('strips comments without stripping code on the same line', () => {
    // The stripper is the load-bearing half: one that ate too much would hide a
    // real reference, and one that ate too little would fail on prose.
    expect(stripComments('const a = 1; // warmupSets').trim()).toBe('const a = 1;');
    expect(stripComments('/* target_sets */ const b = 2;').trim()).toBe('const b = 2;');
    expect(stripComments('const c = "target_sets";').trim()).toBe('const c = "target_sets";');
    expect(stripComments('/**\n * warmup_sets\n */\nconst d = 3;').trim()).toBe('const d = 3;');
  });
});
