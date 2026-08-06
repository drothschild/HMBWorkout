#!/usr/bin/env node
/**
 * Controlled A/B for GitHub issue #129: does WatermelonDB's dev-mode queue-warning
 * timer cause jest's "A worker process has failed to exit gracefully" warning?
 *
 * WHY AN A/B AND NOT A SINGLE RUN
 * -------------------------------
 * The warning is intermittent and load-sensitive — across the samples on the
 * original ticket it tracked machine load more than any code change. A single
 * run proves nothing in either direction. This script runs the full suite N
 * times per arm and reports the rate.
 *
 * ARMS
 *   control    jest as-is; the warning timer holds a ref on the worker event loop
 *   unref      identical, except WMDB_UNREF_QUEUE_WARNING=1 makes that one timer
 *              .unref(), so it can no longer keep a worker alive
 *
 * The arms differ by exactly one environment variable. Both require
 * scripts/patch-workqueue-unref.js to have been applied to node_modules first
 * (the patch is inert unless the env var is set), so the two arms run
 * byte-identical files.
 *
 * Runs are INTERLEAVED (control, unref, control, unref, ...) rather than blocked.
 * Machine load drifts over a multi-minute measurement; interleaving spreads that
 * drift across both arms instead of confounding it with the arm.
 *
 * USAGE
 *   node scripts/measure-worker-exit-warning.mjs [runsPerArm]
 *
 * Prereqs (see AGENTS.md for the node_modules rsync recipe):
 *   node scripts/patch-workqueue-unref.js apply
 *
 * Exit code is always 0 — this is a measurement, not a gate.
 */

import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JEST_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'jest');
const WARNING_NEEDLE = 'failed to exit gracefully';

const runsPerArm = Number.parseInt(process.argv[2] ?? '10', 10);

function runJest(extraEnv) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(JEST_BIN, [], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 'close' fires even after a spawn failure, so this does not hang — but
    // without it a failed spawn resolves silently into {warned:false,
    // testsRan:false} and a "0/N" summary looks like a finding rather than a
    // misconfiguration. Log the reason.
    child.on('error', (err) => {
      console.error(`  ! failed to spawn jest: ${err.message}`);
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    child.on('close', (code) => {
      resolve({
        warned: output.includes(WARNING_NEEDLE),
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        // Guard against a silently-broken measurement: if the suite stopped
        // running tests we want that visible, not averaged in.
        testsRan: /Tests:\s+\d+/.test(output),
      });
    });
  });
}

const ARMS = [
  { name: 'control', env: {} },
  { name: 'unref', env: { WMDB_UNREF_QUEUE_WARNING: '1' } },
];

/**
 * Refuse to run unless patch-workqueue-unref.js has been applied.
 *
 * Without the patch both arms execute identical unpatched code, so the
 * measurement comes back as a clean "no difference either way" — which reads
 * exactly like a negative finding about the mechanism, when it is really a
 * misconfigured harness. Failing loudly is the whole point: a silent null
 * result here would be worse than no result.
 */
function assertPatchApplied() {
  const statusScript = path.join(REPO_ROOT, 'scripts', 'patch-workqueue-unref.js');
  let applied = false;
  try {
    const out = execFileSync(process.execPath, [statusScript, 'status'], { encoding: 'utf8' });
    applied = JSON.parse(out).applied === true;
  } catch (err) {
    console.error(`Could not determine patch status: ${err.message}`);
    process.exit(1);
  }
  if (!applied) {
    console.error(
      'Refusing to run: the WorkQueue unref patch is NOT applied, so both arms\n' +
        'would execute identical code and report a meaningless 0% difference.\n\n' +
        '  node scripts/patch-workqueue-unref.js apply ./node_modules\n\n' +
        'Remember to revert it when the measurement is done.',
    );
    process.exit(1);
  }
}

async function main() {
  assertPatchApplied();

  const results = new Map(ARMS.map((arm) => [arm.name, []]));

  console.log(
    `# issue #129 — worker-exit-warning A/B\n` +
      `# runsPerArm=${runsPerArm}  node=${process.version}  cpus=${os.cpus().length}\n` +
      `# loadavg at start: ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}\n`,
  );

  for (let i = 0; i < runsPerArm; i += 1) {
    for (const arm of ARMS) {
      const result = await runJest(arm.env);
      results.get(arm.name).push(result);
      console.log(
        `run ${String(i + 1).padStart(2)} ${arm.name.padEnd(8)} ` +
          `warned=${String(result.warned).padEnd(5)} ` +
          `exit=${result.exitCode} testsRan=${result.testsRan} ${result.durationMs}ms ` +
          `load=${os.loadavg()[0].toFixed(2)}`,
      );
    }
  }

  console.log('\n# summary');
  for (const arm of ARMS) {
    const runs = results.get(arm.name);
    const warned = runs.filter((r) => r.warned).length;
    const clean = runs.filter((r) => r.exitCode === 0 && r.testsRan).length;
    console.log(
      `${arm.name.padEnd(8)} warned ${warned}/${runs.length}  ` +
        `(suite green+ran: ${clean}/${runs.length})`,
    );
  }
  console.log(`\n# loadavg at end: ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}`);
}

main();
