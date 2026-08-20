/**
 * Static gate on the Settings → Data screen's export wiring (#267 AC1.5).
 *
 * `src/app` is invisible to every jest project (the node project's `testMatch`
 * is `*.test.ts` under a fixed domain list; `.tsx` screens full of RN /
 * expo-router imports cannot load), so the screen's behaviour has no runtime
 * cover. Reading the tree as text is the precedent set by
 * `sessionPrefillWiring.static.test.ts` and `activeSession.callSites.test.ts`.
 *
 * The one invariant worth pinning is the #212 data-loss guard: the
 * session-history export produces `{ markdown, failures }`, and a screen that
 * writes `markdown` while dropping `failures` silently reinstates the bug
 * (AGENTS.md). So these assertions verify the ACTUAL `exportOutcome` call on the
 * history path is handed `history.failures` — NOT a bare `toContain('failures')`
 * or `toContain('exportOutcome')`, either of which an import line alone
 * satisfies. The argument object of each `exportOutcome(...)` call is extracted
 * and inspected.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DATA_SCREEN = join(__dirname, '..', 'app', '(tabs)', 'settings', 'data.tsx');
const SETTINGS_INDEX = join(__dirname, '..', 'app', '(tabs)', 'settings', 'index.tsx');

/**
 * The whitespace-collapsed argument bodies of every `exportOutcome({ ... })`
 * call in `source`. Throws when there are none, so a refactor that renames or
 * removes the call fails loudly rather than passing vacuously.
 */
function exportOutcomeCallBodies(source: string): string[] {
  const bodies = [...source.matchAll(/exportOutcome\(\{([^}]*)\}\)/g)].map((m) =>
    m[1].replace(/\s+/g, '')
  );
  if (bodies.length === 0) {
    throw new Error(
      'data.tsx no longer calls exportOutcome({ ... }); re-anchor this gate'
    );
  }
  return bodies;
}

describe('Settings → Data export wiring (#267 AC1.5)', () => {
  const dataSource = () => readFileSync(DATA_SCREEN, 'utf8');
  const indexSource = () => readFileSync(SETTINGS_INDEX, 'utf8');

  it('routes the message through the pure exportOutcome presenter', () => {
    // The decision must not live inline in the screen; it must call the
    // jest-covered pure function.
    expect(dataSource()).toContain("from '@/export/exportOutcome'");
    expect(exportOutcomeCallBodies(dataSource()).length).toBeGreaterThan(0);
  });

  it('passes the session-history failures into exportOutcome, never dropping them (#212)', () => {
    const bodies = exportOutcomeCallBodies(dataSource());
    // At least one call site — the history export — must forward the real
    // failure list. A screen that passed `failures: []` here reinstates the
    // silent-partial-export bug, and this assertion fails on it.
    expect(bodies.some((body) => body.includes('failures:history.failures'))).toBe(true);
  });

  it('feeds exportOutcome the live session-history result, not a fabricated one', () => {
    // The failures passed above must come from `exportSessionHistory`'s return,
    // bound to `history`. Pins the source of `history.failures` so the previous
    // assertion cannot be satisfied by an unrelated `history` object.
    const collapsed = dataSource().replace(/\s+/g, '');
    expect(collapsed).toContain('history=awaitexportSessionHistory(database)');
  });

  it('renders exportOutcome output to the user', () => {
    const collapsed = dataSource().replace(/\s+/g, '');
    // The message is stored in state from the presenter's return...
    expect(collapsed).toContain('setStatus(exportOutcome({');
    // ...and that state is rendered in the JSX tree.
    expect(collapsed).toContain('{status}');
  });

  it("widens SectionRow.href's union to admit the Data route (the phase-greenness trap)", () => {
    const hrefType = /href:\s*([^;]+);/.exec(indexSource());
    if (!hrefType) {
      throw new Error('SectionRow.href type not found in settings/index.tsx; re-anchor');
    }
    expect(hrefType[1]).toContain("'/settings/data'");
  });

  it('adds a Data SectionRow pointing at the new route', () => {
    // Distinct from the type widening above: the type could admit the route
    // while no row navigates to it. This asserts a concrete SECTIONS entry.
    const collapsed = indexSource().replace(/\s+/g, '');
    expect(collapsed).toContain("href:'/settings/data'");
    expect(collapsed).toContain("title:'Data'");
  });
});

/**
 * The import half (#267 Phase 2). Same reasoning as above: the screen is
 * jest-invisible, so its one real decision — that a REFUSED document never
 * reaches the DB half — is read out of the source.
 */
describe('Settings → Data import wiring (#267 Phase 2)', () => {
  const dataSource = () => readFileSync(DATA_SCREEN, 'utf8');
  const TODAY_SCREEN = join(__dirname, '..', 'app', '(tabs)', 'index.tsx');

  it('calls the pure importer and the state-layer writer, holding neither decision itself', () => {
    const source = dataSource();
    expect(source).toContain("from '@/interop/importRoutine'");
    expect(source).toContain("from '@/state/applyRoutineImport'");
    expect(source).toContain("from '@/state/routineImportOutcome'");
  });

  it('guards applyRoutineImport behind the importer verdict (AC2.5: a refused file writes nothing)', () => {
    const collapsed = dataSource().replace(/\s+/g, '');

    const parseAt = collapsed.indexOf('parsed=importRoutine(markdown)');
    const guardAt = collapsed.indexOf('if(!parsed.ok)');
    const writeAt = collapsed.indexOf('applyRoutineImport(database,parsed.routine)');

    // Each anchor must exist — a rename that quietly removes one would
    // otherwise make the ordering assertion below pass on -1s.
    expect(parseAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThanOrEqual(0);

    // ...and the write must come after the guard, which must come after the
    // parse. Deleting the early return puts the write before nothing at all.
    expect(parseAt).toBeLessThan(guardAt);
    expect(guardAt).toBeLessThan(writeAt);
    expect(collapsed.slice(guardAt, writeAt)).toContain('return');
  });

  it('renders an Import Routine control', () => {
    const collapsed = dataSource().replace(/\s+/g, '');
    expect(collapsed).toContain('onPress={handleImportRoutine}');
    expect(collapsed).toContain('ImportRoutine');
  });

  it('routes every import banner through the pure presenter', () => {
    // A `setStatus('...')` literal on the import path would be a decision the
    // node project cannot execute. The catch-all `catch` keeps one, which is
    // the export path's existing precedent; every *outcome* arm goes through
    // the presenter.
    const collapsed = dataSource().replace(/\s+/g, '');
    for (const arm of ["kind:'cancelled'", "kind:'unreadable'", "kind:'refused'", "kind:'imported'"]) {
      expect(collapsed).toContain(`routineImportOutcome({${arm}`);
    }
  });

  it("names two ways to create a routine on the Today tab, without the word 'vault'", () => {
    // `remove-vault-sync.AC2.7` — the copy this feature is allowed to narrow,
    // but not by reintroducing the vocabulary that plan removed.
    const source = readFileSync(TODAY_SCREEN, 'utf8');
    const emptyState = /No routines yet\.[^<]*/.exec(source);
    if (!emptyState) {
      throw new Error('Today-tab empty-state copy not found; re-anchor this gate');
    }
    expect(emptyState[0]).toMatch(/AI Coach/);
    expect(emptyState[0]).toMatch(/import/i);
    expect(emptyState[0].toLowerCase()).not.toContain('vault');
    expect(emptyState[0].toLowerCase()).not.toContain('sync');
  });
});
