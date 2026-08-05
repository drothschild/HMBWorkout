#!/usr/bin/env node
/**
 * Applies (or reverts) a *runtime-toggleable* .unref() on WatermelonDB's dev-mode
 * queue-warning timer, so the two arms of the issue #129 experiment differ by
 * exactly one variable and nothing else.
 *
 * This patches node_modules and is therefore NOT a shippable fix — it does not
 * survive `npm install`. It exists purely so that
 * scripts/measure-worker-exit-warning.mjs can run a controlled A/B: the same
 * files, the same node_modules, the same jest, with the timer's ref-ness
 * switched by the WMDB_UNREF_QUEUE_WARNING env var at run time. Baking the
 * toggle into the patch (rather than patching between arms) keeps the two arms
 * byte-identical on disk.
 *
 * USAGE
 *   node scripts/patch-workqueue-unref.js apply    [nodeModulesDir]
 *   node scripts/patch-workqueue-unref.js revert   [nodeModulesDir]
 *   node scripts/patch-workqueue-unref.js status   [nodeModulesDir]
 *
 * nodeModulesDir defaults to ./node_modules relative to the repo root. Point it
 * at a worktree-local copy (see AGENTS.md / the rsync recipe) rather than a
 * shared checkout's node_modules, so concurrent work is not disturbed.
 *
 * Both operations are idempotent.
 */

const fs = require('node:fs');
const path = require('node:path');

const TARGET_RELATIVE = path.join('@nozbe', 'watermelondb', 'Database', 'WorkQueue.js');

// The exact tail of the dev-mode warning-timer statement in watermelondb 0.28.0's
// compiled WorkQueue.js. Anchored on the closing of the setTimeout call.
const ORIGINAL = '        }, 1500);';

const PATCHED = [
  '        }, 1500);',
  '        // [issue #129 experiment] toggleable unref; see scripts/patch-workqueue-unref.js',
  "        if ('1' === process.env.WMDB_UNREF_QUEUE_WARNING && __wmdbWarnTimer && __wmdbWarnTimer.unref) {",
  '          __wmdbWarnTimer.unref();',
  '        }',
].join('\n');

const ORIGINAL_OPEN = '        setTimeout(function () {';
const PATCHED_OPEN = '        var __wmdbWarnTimer = setTimeout(function () {';

const MARKER = '[issue #129 experiment]';

function resolveTarget(nodeModulesDir) {
  const dir = nodeModulesDir || path.join(__dirname, '..', 'node_modules');
  const target = path.join(dir, TARGET_RELATIVE);
  if (!fs.existsSync(target)) {
    throw new Error(`patch-workqueue-unref: not found: ${target}`);
  }
  return target;
}

function apply(target) {
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(MARKER)) {
    return { changed: false, reason: 'already applied' };
  }
  if (!source.includes(ORIGINAL_OPEN) || !source.includes(ORIGINAL)) {
    throw new Error(
      'patch-workqueue-unref: anchors not found — watermelondb version drift? ' +
        'Re-derive the anchors from the installed WorkQueue.js before trusting any measurement.',
    );
  }
  const patched = source
    .replace(ORIGINAL_OPEN, PATCHED_OPEN)
    .replace(ORIGINAL, PATCHED);
  fs.writeFileSync(target, patched);
  return { changed: true, reason: 'applied' };
}

function revert(target) {
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(MARKER)) {
    return { changed: false, reason: 'not applied' };
  }
  const reverted = source.replace(PATCHED, ORIGINAL).replace(PATCHED_OPEN, ORIGINAL_OPEN);
  fs.writeFileSync(target, reverted);
  return { changed: true, reason: 'reverted' };
}

function main() {
  const [, , command, nodeModulesDir] = process.argv;
  const target = resolveTarget(nodeModulesDir);

  if (command === 'apply') {
    console.log(JSON.stringify({ target, ...apply(target) }));
  } else if (command === 'revert') {
    console.log(JSON.stringify({ target, ...revert(target) }));
  } else if (command === 'status') {
    const applied = fs.readFileSync(target, 'utf8').includes(MARKER);
    console.log(JSON.stringify({ target, applied }));
  } else {
    console.error('usage: patch-workqueue-unref.js <apply|revert|status> [nodeModulesDir]');
    process.exitCode = 1;
  }
}

main();
