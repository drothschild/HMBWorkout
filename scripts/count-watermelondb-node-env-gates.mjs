#!/usr/bin/env node
/**
 * Counts the `NODE_ENV !== 'production'` gate sites in the installed
 * WatermelonDB, for GitHub issue #129.
 *
 * WHY THIS EXISTS AS A SCRIPT
 * ---------------------------
 * The count is load-bearing: it is the argument *against* the fix issue #129
 * originally floated (running jest with NODE_ENV=production to silence the
 * WorkQueue warning timer). If that flag only gated the one timer, flipping it
 * would be free. It does not, and the size of what else it gates is the whole
 * point.
 *
 * The number also cannot be re-derived by the obvious command, which is exactly
 * why the project's rule is that quantitative claims come from a committed
 * script. The naive version:
 *
 *   grep -rn "process.env.NODE_ENV" node_modules/@nozbe/watermelondb
 *
 * reports roughly double the true figure, because the published package ships
 * TWO copies of everything: the compiled CommonJS at the package root, and a
 * byte-mirrored Flow source tree under `src/`. Only the compiled copy is ever
 * executed — `package.json`'s `main` resolves to `./index.js` at the root — so
 * every `src/` hit is a phantom. This script excludes `src/` explicitly and
 * reports both numbers, so the discrepancy is visible rather than surprising.
 *
 * USAGE
 *   node scripts/count-watermelondb-node-env-gates.mjs [nodeModulesDir]
 *
 * Exit code is always 0 — this is a measurement, not a gate.
 */

import fs from 'node:fs';
import path from 'node:path';

const nodeModulesDir = process.argv[2] ?? path.join(process.cwd(), 'node_modules');
const pkgDir = path.join(nodeModulesDir, '@nozbe', 'watermelondb');

if (!fs.existsSync(pkgDir)) {
  console.error(`watermelondb not found at ${pkgDir}`);
  console.error('Point this at a real node_modules, or rsync one in (see AGENTS.md).');
  process.exit(0);
}

/** Every .js file under the package, as paths relative to the package root. */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(path.relative(pkgDir, full));
  }
  return acc;
}

const GATE = /process\.env\.NODE_ENV/g;

const executed = new Map(); // relative path -> gate count, compiled copy only
const phantom = new Map(); // relative path -> gate count, src/ mirror

for (const rel of walk(pkgDir)) {
  const hits = (fs.readFileSync(path.join(pkgDir, rel), 'utf8').match(GATE) ?? []).length;
  if (hits === 0) continue;
  // `src/` is unbundled Flow source shipped for reference. `main` resolves to
  // the compiled copy at the package root, so nothing under src/ ever runs.
  (rel.split(path.sep)[0] === 'src' ? phantom : executed).set(rel, hits);
}

const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);

const result = {
  package: `@nozbe/watermelondb@${JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version}`,
  executed: { sites: sum(executed), files: executed.size },
  phantomSrcMirror: { sites: sum(phantom), files: phantom.size },
  naiveGrepWouldReport: { sites: sum(executed) + sum(phantom), files: executed.size + phantom.size },
};

console.log(JSON.stringify(result, null, 2));
console.log('\nExecuted gate sites by file (the ones that actually matter):');
for (const [rel, n] of [...executed].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(n).padStart(3)}  ${rel}`);
}
