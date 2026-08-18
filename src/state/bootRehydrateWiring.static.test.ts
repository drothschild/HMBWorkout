/**
 * Static gate on the boot rehydrate's drop-disposal wiring (#276 Phase 6 review).
 *
 * `rehydrateActiveSession` clears the `engine_state` of a state it refuses to
 * restore, and that clear is load-bearing rather than tidying:
 * `loadActiveEngineState` returns the FIRST `ended_at IS NULL` row carrying a
 * non-null state, so a dropped row that keeps its state shadows every later
 * in-progress session for the life of the install. The decision and the
 * behaviour are pinned in `sessionRehydrate.ts` and covered behaviourally in
 * `sessionRehydrateLegacyPlan.test.ts` and `sessionRehydrate.integration.test.ts`.
 *
 * What neither of those can see is the PRODUCTION wiring. `src/app` is invisible
 * to every suite (see the jest `testMatch` note in AGENTS.md), so nothing else
 * notices if `_layout.tsx` satisfies the required `RehydrateDeps` parameter with
 * a no-op. `tsc` cannot either — a stub type-checks perfectly, and the whole
 * defect is behavioural. This is the same structural-read precedent as
 * `sessionPrefillWiring.static.test.ts`.
 *
 * The assertion is deliberately not a bare `toContain('clearEngineState')`: the
 * import line alone satisfies that and would survive the substitution it exists
 * to catch. The dep object handed to the call is extracted and required to
 * forward to the real `clearEngineState(database, …)`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const LAYOUT = join(__dirname, '..', 'app', '_layout.tsx');

/**
 * The argument text of the `rehydrateActiveSession(...)` call, from the opening
 * paren to its matching close. Throws rather than returning empty when the call
 * is not found, so a refactor that moves it fails loudly instead of vacuously.
 */
function rehydrateCallArgs(source: string): string {
  const callAt = source.indexOf('rehydrateActiveSession(');
  if (callAt === -1) {
    throw new Error('_layout.tsx no longer calls rehydrateActiveSession; re-anchor this gate');
  }

  const open = source.indexOf('(', callAt);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }

  throw new Error('unbalanced parens after rehydrateActiveSession(; re-anchor this gate');
}

describe('_layout.tsx boot rehydrate wiring', () => {
  const source = () => readFileSync(LAYOUT, 'utf8');

  it('imports the real clearEngineState from the db layer', () => {
    expect(source()).toMatch(/import \{[^}]*\bclearEngineState\b[^}]*\} from '@\/db\/engineState';/);
  });

  it('hands rehydrateActiveSession a clearEngineState that forwards to the db', () => {
    const args = rehydrateCallArgs(source()).replace(/\s+/g, ' ');

    // The dep must be present at the call...
    expect(args).toContain('clearEngineState:');
    // ...and must actually reach the database, not resolve to a no-op stub.
    expect(args).toMatch(/clearEngineState:\s*\([^)]*\)\s*=>\s*clearEngineState\(database,/);
  });
});
