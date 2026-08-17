/**
 * Structural gate: every site that groups superset runs goes through the one
 * shared helper (#278), and no inline re-implementation has grown back.
 *
 * Two of the three re-pointed call sites are behaviourally covered by their own
 * suites (`routineDetailPresenter.test.ts`, `restCommentaryStore.test.ts`). The
 * third, `src/app/ai-coach.tsx`, is not and cannot be: `src/app` has no jest
 * coverage at all (AGENTS.md, Testing gotchas — screens are untested by
 * `npm test`), so nothing can render `DraftCard` and assert on its output.
 * Where nothing can execute the code, a structural read of the source is the
 * criterion — the precedent is `src/state/activeSession.callSites.test.ts` and
 * `src/state/routineDetailKeys.static.test.ts`, both of which read a `.tsx`
 * screen as text rather than importing it (the node project cannot load
 * RN/expo-router modules).
 *
 * The negative assertions matter as much as the positive ones. The defect this
 * issue fixed was not any single wrong walk — it was that the walk existed in
 * several places and drifted. A new inline `currentGroup` accumulator is the
 * shape that regression takes.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf-8');

describe('superset grouping call sites', () => {
  describe('src/app/ai-coach.tsx (no jest coverage — structural criterion)', () => {
    const source = read('app/ai-coach.tsx');

    it('reads the screen source (guards against a broken path passing vacuously)', () => {
      expect(source.length).toBeGreaterThan(500);
      expect(source).toContain('function DraftCard');
    });

    it('groups a draft through the shared helper', () => {
      expect(source).toContain("from '@/domain/supersetGrouping'");
      expect(source).toContain('groupBySupersetRuns');
    });

    it('no longer walks the draft with its own group accumulator', () => {
      expect(source).not.toContain('currentGroup');
      expect(source).not.toContain('exercise.supersetGroup ?? null');
    });
  });

  describe('src/state/routineDetailPresenter.ts', () => {
    const source = read('state/routineDetailPresenter.ts');

    it('builds items through the shared helper', () => {
      expect(source.length).toBeGreaterThan(500);
      expect(source).toContain("from '@/domain/supersetGrouping'");
      expect(source).toContain('groupBySupersetRuns');
    });

    it('no longer extends the last pushed item in place', () => {
      expect(source).not.toContain('lastItem');
      expect(source).not.toContain('exercises.push');
    });
  });

  describe('src/state/restCommentaryStore.ts', () => {
    const source = read('state/restCommentaryStore.ts');

    it('finds the group end through the shared helper', () => {
      expect(source.length).toBeGreaterThan(500);
      expect(source).toContain("from '@/domain/supersetGrouping'");
      expect(source).toContain('supersetRunEndIndex');
    });

    it('no longer scans forward with its own while loop', () => {
      expect(source).not.toContain('groupEnd + 1');
      expect(source).not.toContain('groupEnd += 1');
    });
  });

  it('src/db/repository.ts no longer carries the retired dead copy', () => {
    const source = read('db/repository.ts');

    expect(source.length).toBeGreaterThan(500);
    expect(source).not.toContain('getSupersetGroups');
    expect(source).not.toContain('currentGroupKey');
  });
});
