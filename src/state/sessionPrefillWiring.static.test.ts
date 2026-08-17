/**
 * Static gate on the session screen's set-prefill effect (#276 AC3.10).
 *
 * `exerciseReplaceStore.routineRevision` exists for exactly one consumer: the
 * prefill effect in `src/app/session.tsx`. The store side of the contract —
 * bump strictly after `applyToRoutine` resolves, never on a rejected swap or a
 * thrown write — is pinned behaviourally in `exerciseReplaceStore.test.ts`. The
 * SCREEN side has no automated cover at all: `src/app` is invisible to every
 * suite, and deleting the dependency-array entry passes the whole suite while
 * leaving a swapped exercise showing the outgoing exercise's prescribed load.
 *
 * Since #276 the entry's whole set list is re-read after a swap rather than one
 * column, so the same deletion now strands a seven-step warmup ramp on the
 * substitute — the stale-prescription bug multiplied.
 *
 * Reading the tree as text (rather than importing it) is the precedent set by
 * `activeSession.callSites.test.ts` and by the `commentaryKey` gate in
 * `restCommentaryStore.test.ts`: the screen is a `.tsx` full of RN and
 * expo-router imports the node jest project cannot load.
 *
 * These assertions are deliberately NOT bare `toContain('routineRevision')` —
 * that is satisfied by the `const routineRevision = …` selector line alone and
 * would survive the deletion it exists to catch. The dependency array is
 * extracted and compared as a set.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SCREEN = join(__dirname, '..', 'app', 'session.tsx');

/**
 * The dependency array of the `useEffect` that contains `marker`.
 *
 * Finds the marker, then the first `}, [ … ]);` after it — the effect's own
 * closing line — and returns its entries with whitespace collapsed. Throws
 * rather than returning empty when the shape is not found, so a refactor that
 * moves the effect fails loudly instead of passing vacuously.
 */
function dependencyArrayAfter(source: string, marker: string): string[] {
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) {
    throw new Error(`session.tsx no longer contains ${marker}; re-anchor this gate`);
  }

  const closing = /\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/g;
  closing.lastIndex = markerAt;
  const match = closing.exec(source);
  if (!match) {
    throw new Error(`no useEffect dependency array found after ${marker}; re-anchor this gate`);
  }

  return match[1]
    .split(',')
    .map((entry) => entry.replace(/\s+/g, ''))
    .filter((entry) => entry.length > 0);
}

describe('session.tsx set-prefill effect wiring (#276 AC3.10)', () => {
  const source = () => readFileSync(SCREEN, 'utf8');

  it('depends on routineRevision, so an exercise swap re-reads the prescription', () => {
    const deps = dependencyArrayAfter(source(), 'computeSetPrefill(fresh, fallback,');

    expect(deps).toContain('routineRevision');
  });

  it('depends on the whole effect key, not just the revision', () => {
    // Spelled out so dropping any one of them — the exercise id in particular,
    // which a swap changes without touching sessionId or exerciseIndex — is a
    // failure rather than a silent behaviour change.
    const deps = dependencyArrayAfter(source(), 'computeSetPrefill(fresh, fallback,');

    expect(new Set(deps)).toEqual(
      new Set([
        'sessionState?.sessionId',
        'sessionState?.exerciseIndex',
        'currentEntryExerciseId',
        'routineRevision',
      ])
    );
  });

  it('reads the prescription per set from the database, not off engine state', () => {
    // `entry.sets` survives a ReplaceExercise untouched by design, so sourcing
    // the load from it would make `updateRoutineExerciseExerciseId`'s clear
    // invisible to the running session.
    const text = source();

    expect(text).toContain('getPrescribedSetsForEntry(');
    expect(text).toContain('computeSetPrefill(fresh, fallback, prescribedSets)');
  });

  it('subscribes to routineRevision from the replace store', () => {
    expect(source()).toContain(
      'exerciseReplaceStore((state) => state.routineRevision)'
    );
  });
});
