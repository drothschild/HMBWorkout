import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * #312 — structural criterion for the keep-awake wiring.
 *
 * Jest runs a single `node` project with no React Native runtime (AGENTS.md,
 * "Testing gotchas"), so nothing here can mount a component and observe that
 * `useKeepAwake` was called. The decision itself is genuinely covered by
 * `src/state/keepAwake.test.ts`; what no suite can execute is the *wiring* —
 * that each component actually consumes the predicate, and that the very same
 * boolean gates its tick interval and its keep-awake mount.
 *
 * AGENTS.md's established answer for that gap (see the `session.tsx:303`
 * `routineRevision` dependency, AC6.9) is a structural read of the source. That
 * is what this file is. It cannot prove the screen stays lit — only a simulator
 * walk can — but it does fail loudly if the wiring is deleted or if the two
 * gates drift apart, which is the failure mode that leaks a lock forever.
 */

const componentsDir = __dirname;
const repoRoot = join(componentsDir, '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('KeepScreenAwake', () => {
  const source = readSource('src/components/KeepScreenAwake.tsx');

  it('holds the lock through expo-keep-awake for as long as it is mounted', () => {
    expect(source).toMatch(/import\s*\{[^}]*\buseKeepAwake\b[^}]*\}\s*from\s*'expo-keep-awake'/);
  });

  it('forwards the caller tag rather than sharing one default lock', () => {
    // useKeepAwake() with no tag falls back to a per-component id; passing the
    // tag explicitly is what keeps the two surfaces independently released.
    expect(source).toMatch(/useKeepAwake\(\s*tag\s*\)/);
  });

  it('renders nothing, so it can be mounted anywhere the timer is running', () => {
    expect(source).toMatch(/return\s+null\s*;/);
  });
});

describe('RestCountdown keep-awake wiring', () => {
  const source = readSource('src/components/RestCountdown.tsx');

  it('imports the predicate and tag from the covered state module', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bisRestTimerRunning\b[^}]*\}\s*from\s*'@\/state\/keepAwake'/
    );
    expect(source).toMatch(/import\s*\{[^}]*\bKeepAwakeTag\b[^}]*\}\s*from\s*'@\/state\/keepAwake'/);
    expect(source).toMatch(/import\s*\{\s*KeepScreenAwake\s*\}\s*from\s*'\.\/KeepScreenAwake'/);
  });

  it('gates the tick interval and the keep-awake on one and the same boolean', () => {
    const assignment = /const\s+(\w+)\s*=\s*isRestTimerRunning\(\s*\{\s*deadlineMs\s*,\s*isPaused\s*,?\s*\}\s*\)/.exec(
      source
    );
    expect(assignment).not.toBeNull();
    const flag = assignment![1];

    // The effect's early return must be that flag, not a re-spelled condition.
    // A duplicated condition is how the lock and the interval drift apart.
    expect(source).toMatch(new RegExp(`if\\s*\\(\\s*!${flag}\\s*\\)\\s*return\\s*;`));
    // ...and the same flag must decide whether the lock is mounted.
    expect(source).toMatch(
      new RegExp(`\\{\\s*${flag}\\s*&&\\s*<KeepScreenAwake\\s+tag=\\{KeepAwakeTag\\.restCountdown\\}`)
    );
  });

  it('no longer carries the old inline guard the predicate replaced', () => {
    expect(source).not.toMatch(/if\s*\(\s*isPaused\s*\|\|\s*!deadlineMs\s*\)/);
  });
});

describe('ExerciseStopwatch keep-awake wiring', () => {
  const source = readSource('src/components/ExerciseStopwatch.tsx');

  it('imports the predicate and tag from the covered state module', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bisExerciseStopwatchRunning\b[^}]*\}\s*from\s*'@\/state\/keepAwake'/
    );
    expect(source).toMatch(/import\s*\{[^}]*\bKeepAwakeTag\b[^}]*\}\s*from\s*'@\/state\/keepAwake'/);
    expect(source).toMatch(/import\s*\{\s*KeepScreenAwake\s*\}\s*from\s*'\.\/KeepScreenAwake'/);
  });

  it('gates the tick interval and the keep-awake on one and the same boolean', () => {
    const assignment = /const\s+(\w+)\s*=\s*isExerciseStopwatchRunning\(\s*\{\s*stopwatchKey\s*,\s*running\s*,\s*control\s*,?\s*\}\s*\)/.exec(
      source
    );
    expect(assignment).not.toBeNull();
    const flag = assignment![1];

    expect(source).toMatch(new RegExp(`if\\s*\\(\\s*!${flag}\\s*\\)\\s*return\\s*;`));
    expect(source).toMatch(
      new RegExp(
        `\\{\\s*${flag}\\s*&&\\s*<KeepScreenAwake\\s+tag=\\{KeepAwakeTag\\.exerciseStopwatch\\}`
      )
    );
  });

  it('keeps the flag in the tick effect dependency list', () => {
    // The interval effect must re-run when the flag flips, or a stopped clock
    // keeps its interval — and, with the same flag driving the render, the
    // mismatch would be invisible until the battery died.
    const deps = /\}, \[([^\]]*)\]\);/.exec(source);
    expect(deps).not.toBeNull();
    expect(deps![1]).toMatch(/stopwatchRunning/);
  });

  it('no longer carries the old inline guard the predicate replaced', () => {
    expect(source).not.toMatch(/if\s*\(\s*stopwatchKey === undefined \|\| !running \|\| control !== 'running'\s*\)/);
  });
});

describe('scoping decision: the whole-session clock does not hold the screen awake', () => {
  it('WorkoutStopwatch stays free of keep-awake', () => {
    // Deliberate (#312). The header clock runs for the entire session and never
    // pauses, so binding a lock to it is whole-session keep-awake by another
    // name — the phone would stay lit while the user is away from it. The issue
    // asks for "when timer is running", and this clock is ambient chrome rather
    // than a timer anyone is waiting on.
    const source = readSource('src/components/WorkoutStopwatch.tsx');
    expect(source).not.toMatch(/KeepScreenAwake|keepAwake|KeepAwake/);
  });
});

describe('expo-keep-awake dependency', () => {
  it('is declared directly rather than borrowed from expo hoisting', () => {
    const pkg = JSON.parse(readSource('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['expo-keep-awake']).toBeDefined();
  });
});
