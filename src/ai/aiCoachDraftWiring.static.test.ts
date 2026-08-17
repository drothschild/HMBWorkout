/**
 * Static gate on the coach screen's draft preview (#276 Phase 4).
 *
 * `src/app` is invisible to every jest suite (AGENTS.md Testing gotchas), and
 * the draft card is the one place a user sees a ramp BEFORE it is written to
 * the database. `tsc` catches the removal of the aggregate fields the card used
 * to render, but it cannot catch the lazy replacement — `{exercise.sets.length}
 * sets` typechecks perfectly and shows "7 sets" where seven prescriptions
 * belong, which is the aggregate model back again in the only place the user
 * gets to say no.
 *
 * Reading the tree as text is the precedent set by
 * `sessionPrefillWiring.static.test.ts` and `activeSession.callSites.test.ts`:
 * the screen is a `.tsx` full of RN and expo-router imports the node project
 * cannot load.
 *
 * These assertions are deliberately not satisfiable by an import line. The
 * first pins a CALL to the shared per-set formatter (an `import { … }` contains
 * no `(`), and the second is a whole-block extraction — deleting the preview
 * throws rather than passing vacuously.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SCREEN = join(__dirname, '..', 'app', 'ai-coach.tsx');

/**
 * The body of the `DraftCard` component, from its declaration to the next
 * top-level `function`/`const` declaration. Throws when the component is gone
 * or renamed, so a refactor fails loudly rather than passing on an empty
 * string.
 */
function draftCardBody(source: string): string {
  const start = source.indexOf('function DraftCard(');
  if (start === -1) {
    throw new Error('ai-coach.tsx no longer declares DraftCard; re-anchor this gate');
  }

  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:function |const |export )/);
  const body = next === -1 ? rest : rest.slice(0, next);

  if (!body.includes('draft.exercises')) {
    throw new Error('DraftCard no longer renders draft.exercises; re-anchor this gate');
  }

  return body;
}

describe('ai-coach.tsx draft preview wiring (#276 Phase 4)', () => {
  const source = () => readFileSync(SCREEN, 'utf8');

  it('renders one row per prescribed set, through the shared formatter', () => {
    const body = draftCardBody(source());

    // The call, not the import: `formatDraftSetLine(` cannot be satisfied by
    // `import { formatDraftSetLine } from ...`.
    expect(body).toContain('formatDraftSetLine(');
    expect(body).toContain('exercise.sets.map(');
  });

  it('does not reduce the set list to a count', () => {
    // The lazy replacement this gate exists for. `sets.length` in the preview
    // is the aggregate model reintroduced at the last screen before the write.
    const body = draftCardBody(source());

    expect(body).not.toMatch(/sets\.length/);
  });

  it('no longer renders the per-exercise aggregates the set list replaced', () => {
    const text = source();

    expect(text).not.toContain('targetSets');
    expect(text).not.toContain('targetReps');
    expect(text).not.toContain('targetDurationSeconds');
    expect(text).not.toContain('warmupSets');
    expect(text).not.toContain('targetWeightLbs');
  });
});
